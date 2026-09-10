import path from 'node:path';
import { assertNoLinkAncestor, lstatSafe, readJson } from '../../adapters/filesystem/index.mjs';
import { detectSurfaceSignals, SURFACE_VERIFICATION_PATH, surfaceVerificationProfiles, verificationNpmCommands } from '../repository/index.mjs';

const PROFILES = surfaceVerificationProfiles().profiles;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function matchesProfile(commandName, profile) {
  return profile.acceptedScriptPrefixes.some((prefix) => commandName === prefix || commandName.startsWith(`${prefix}:`));
}

function allowedCommands(scan, profile) {
  return verificationNpmCommands(scan.commands)
    .filter((candidate) => matchesProfile(candidate.name, profile))
    .map((candidate) => candidate.command)
    .sort((left, right) => left.localeCompare(right));
}

function aggregate(results) {
  if (results.some((result) => result.status === 'blocked')) return 'blocked';
  if (results.some((result) => result.status === 'unverified')) return 'unverified';
  return results.length > 0 ? 'passed' : 'not-applicable';
}

function blocked(signal, reason, extra = {}) {
  return { signalId: signal.id, kind: signal.kind, status: 'blocked', reason, ...extra };
}

export function evaluateSurfaceVerification(scan, projectVerification) {
  const signals = detectSurfaceSignals(scan);
  if (signals.length === 0) return { status: 'not-applicable', path: SURFACE_VERIFICATION_PATH, signals, results: [], issues: [] };
  const absolute = path.join(scan.root, SURFACE_VERIFICATION_PATH);
  const stat = lstatSafe(absolute);
  if (!stat) {
    const results = signals.map((signal) => ({
      signalId: signal.id,
      kind: signal.kind,
      status: 'unverified',
      reason: `${SURFACE_VERIFICATION_PATH} does not declare a reachable project-owned story for this detected surface.`,
      suggestedVerificationProfile: signal.suggestedVerificationProfile,
    }));
    return { status: 'unverified', path: SURFACE_VERIFICATION_PATH, signals, results, issues: [] };
  }
  let declaration;
  try {
    assertNoLinkAncestor(scan.root, SURFACE_VERIFICATION_PATH);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('must be a regular repository-local file.');
    declaration = readJson(absolute);
  } catch (error) {
    const issue = `${SURFACE_VERIFICATION_PATH}: ${error.message}`;
    const results = signals.map((signal) => blocked(signal, issue));
    return { status: 'blocked', path: SURFACE_VERIFICATION_PATH, signals, results, issues: [issue] };
  }
  const issues = [];
  if (declaration.schemaVersion !== 1) issues.push('schemaVersion must be 1.');
  if (!Array.isArray(declaration.stories)) issues.push('stories must be an array.');
  if (issues.length > 0) {
    const results = signals.map((signal) => blocked(signal, `${SURFACE_VERIFICATION_PATH}: ${issues.join(' ')}`));
    return { status: 'blocked', path: SURFACE_VERIFICATION_PATH, signals, results, issues };
  }
  const signalIds = new Set(signals.map((signal) => signal.id));
  const seenStories = new Set();
  for (const story of declaration.stories) {
    if (!nonEmptyString(story?.id) || seenStories.has(story.id)) issues.push(`Story id ${story?.id ?? 'missing'} is missing or duplicate.`);
    else seenStories.add(story.id);
    if (!signalIds.has(story?.signalId)) issues.push(`${story?.id ?? 'story'}: signalId does not match a detected surface.`);
  }
  const results = signals.map((signal) => {
    const stories = declaration.stories.filter((story) => story?.signalId === signal.id);
    if (stories.length === 0) return {
      signalId: signal.id,
      kind: signal.kind,
      status: 'unverified',
      reason: 'No project-owned story is declared for this detected surface.',
      suggestedVerificationProfile: signal.suggestedVerificationProfile,
    };
    if (stories.length > 1) return blocked(signal, 'Multiple stories target the same signal; declare one auditable surface verification story.');
    const story = stories[0];
    const profile = PROFILES.find((candidate) => candidate.id === story.profileId && candidate.signalIds.includes(signal.id));
    if (!profile) return blocked(signal, `Profile ${story.profileId ?? 'missing'} is not valid for ${signal.id}.`, { storyId: story.id });
    const commands = allowedCommands(scan, profile);
    if (!nonEmptyString(story.entrypoint)) return blocked(signal, 'A concrete externally reachable entrypoint is required.', { storyId: story.id, profileId: profile.id });
    if (!['reachable', 'internal-only'].includes(story.reachability)) return blocked(signal, 'reachability must be reachable or internal-only.', { storyId: story.id, profileId: profile.id });
    if (!['available', 'unavailable'].includes(story.environment)) return blocked(signal, 'environment must be available or unavailable.', { storyId: story.id, profileId: profile.id });
    if (story.reachability === 'internal-only') return blocked(signal, 'The declared story is internal-only and does not prove user-reachable behavior.', { storyId: story.id, profileId: profile.id });
    if (story.environment === 'unavailable') return {
      signalId: signal.id, kind: signal.kind, storyId: story.id, profileId: profile.id, status: 'unverified',
      reason: `The ${profile.environment} verification environment is unavailable; absence is not success.`, allowedCommands: commands,
    };
    if (!commands.includes(story.command)) return blocked(signal, 'The declared command is not a discovered safe verification script for this profile.', {
      storyId: story.id, profileId: profile.id, allowedCommands: commands,
    });
    if (projectVerification.command !== story.command) return {
      signalId: signal.id, kind: signal.kind, storyId: story.id, profileId: profile.id, status: 'unverified',
      reason: `Run aicg complete . --verify "${story.command}" to execute this declared story.`, allowedCommands: commands,
    };
    if (projectVerification.status !== 'passed') return blocked(signal, `The selected surface verification command ended with ${projectVerification.status}.`, {
      storyId: story.id, profileId: profile.id, command: story.command,
    });
    return {
      signalId: signal.id, kind: signal.kind, storyId: story.id, profileId: profile.id, status: 'passed',
      command: story.command,
      claimBoundary: 'Only this declared project-owned entrypoint and selected command passed; broader production support remains unverified.',
    };
  });
  if (issues.length > 0) {
    for (const signal of signals) {
      if (!results.some((result) => result.signalId === signal.id && result.status === 'blocked')) {
        results.push(blocked(signal, `${SURFACE_VERIFICATION_PATH}: declaration contains invalid or unauditable stories.`));
      }
    }
  }
  return { status: issues.length > 0 ? 'blocked' : aggregate(results), path: SURFACE_VERIFICATION_PATH, signals, results, issues };
}
