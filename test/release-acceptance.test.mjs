import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { loadReleaseAcceptancePolicy, releaseAcceptanceRequirements, runReleaseAcceptance as runReleaseAcceptanceCore } from '../src/release-acceptance.mjs';

const cli = path.resolve('bin/aicg.js');

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-release-${name}-`));
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...options });
}

function runReleaseAcceptance(target, options) {
  const preview = runReleaseAcceptanceCore(target, options);
  return runReleaseAcceptanceCore(target, {
    ...options,
    replayCommands: true,
    replayApproval: preview.replayPlan?.planHash ?? null,
  });
}

function writeFile(root, relative, content = 'verified\n') {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
  return relative;
}

function git(root, args) {
  const result = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function commit(root, message) {
  git(root, ['add', '--all']);
  git(root, ['-c', 'user.name=AICG Test', '-c', 'user.email=aicg@example.invalid', 'commit', '--quiet', '-m', message]);
}

function policyDigest() {
  return createHash('sha256').update(fs.readFileSync(path.resolve('assets/policies/release-acceptance-policy.json'))).digest('hex');
}

function fileDigest(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function npmPack(root) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout)[0];
}

function npmRun(root, script) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], { cwd: root, encoding: 'utf8' });
  return {
    exitCode: result.status,
    stdoutSha256: createHash('sha256').update(result.stdout ?? '').digest('hex'),
    stderrSha256: createHash('sha256').update(result.stderr ?? '').digest('hex'),
  };
}

function completeEvidence(root, changeType, previousVersion, releaseVersion, riskSignals = [], verifyCommand = 'node -e "process.exit(0)"', fixtureOptions = {}) {
  const policy = loadReleaseAcceptancePolicy();
  const requirements = releaseAcceptanceRequirements(changeType, riskSignals, policy);
  git(root, ['init', '--quiet']);
  const packageDocument = (version) => ({
    name: 'release-fixture',
    version,
    files: ['src/'],
    scripts: {
      verify: verifyCommand,
      'probe:fail': 'node -e "process.stderr.write(\'expected failure\\n\'); process.exit(1)"',
      'probe:recover': 'node -e "process.stdout.write(\'recovered\\n\')"',
      ...(fixtureOptions.extraScripts ?? {}),
    },
  });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageDocument(previousVersion)));
  writeFile(root, 'src/release-candidate.txt', 'base\n');
  commit(root, 'base');
  const baseRevision = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageDocument(releaseVersion)));
  writeFile(root, 'src/release-candidate.txt', `${releaseVersion}\n`);
  commit(root, 'release candidate');
  const releaseRevision = git(root, ['rev-parse', 'HEAD']);
  const releaseTree = git(root, ['rev-parse', 'HEAD^{tree}']);
  const digest = policyDigest();
  const submittedAt = new Date(Date.now() - 2000).toISOString();
  const consensusAt = new Date(Date.now() - 1000).toISOString();
  const generatedAt = new Date().toISOString();
  for (const ignoredPath of fixtureOptions.ignoredPaths ?? []) {
    fs.appendFileSync(path.join(root, '.git', 'info', 'exclude'), `\n/${ignoredPath}\n`);
  }
  const commandResult = npmRun(root, 'verify');
  const probeFailure = npmRun(root, 'probe:fail');
  const probeRecovery = npmRun(root, 'probe:recover');
  const scorecard = Object.fromEntries(policy.scorecard.dimensions.map((dimension) => [dimension.id, 90]));
  const engineers = Array.from({ length: requirements.minimumParticipants.engineers }, (_, index) => ({
    id: `engineer-${index + 1}`,
    scorecard: writeFile(root, `docs/ai/release-evidence/reviews/engineer-${index + 1}.json`, JSON.stringify({
      schemaVersion: 1,
      participantId: `engineer-${index + 1}`,
      role: 'engineer',
      independent: true,
      verdict: 'passed',
      primaryScenario: requirements.requiredEngineerScenarios[index],
      candidateRevision: releaseRevision,
      candidateTree: releaseTree,
      policySha256: digest,
      submittedAt,
      scores: scorecard,
      findings: [],
    }, null, 2)),
  }));
  const architects = Array.from({ length: requirements.minimumParticipants.architects }, (_, index) => ({
    id: `architect-${index + 1}`,
    scorecard: writeFile(root, `docs/ai/release-evidence/reviews/architect-${index + 1}.json`, JSON.stringify({
      schemaVersion: 1,
      participantId: `architect-${index + 1}`,
      role: 'architect',
      independent: true,
      verdict: 'approved',
      primaryLens: requirements.requiredArchitectLenses[index],
      candidateRevision: releaseRevision,
      candidateTree: releaseTree,
      policySha256: digest,
      submittedAt,
      scores: scorecard,
      findings: [],
    }, null, 2)),
  }));
  const evidence = requirements.requiredEvidence.map((id) => {
    const mode = policy.evidenceCatalog[id].verificationModes[0];
    const subjectReference = writeFile(root, `docs/ai/release-evidence/subjects/${id}.txt`, `${id} verified output\n`);
    return {
      id,
      status: 'passed',
      reference: writeFile(root, `docs/ai/release-evidence/receipts/${id}.json`, JSON.stringify({
      schemaVersion: 1,
      evidenceId: id,
      candidateRevision: releaseRevision,
      candidateTree: releaseTree,
      policySha256: digest,
      recordedAt: generatedAt,
      verification: {
        mode,
        outcome: 'passed',
        summary: `${id} was independently verified.`,
        startedAt: submittedAt,
        finishedAt: consensusAt,
        subjectReference,
        subjectSha256: fileDigest(path.join(root, subjectReference)),
        ...(mode === 'command' ? {
          runner: 'npm-script',
          packagePath: 'package.json',
          script: 'verify',
          exitCode: 0,
          stdoutSha256: commandResult.stdoutSha256,
          stderrSha256: commandResult.stderrSha256,
        } : {}),
        ...(mode === 'probe' ? {
          runner: 'npm-script',
          packagePath: 'package.json',
          steps: [
            { phase: 'failure', script: 'probe:fail', ...probeFailure },
            { phase: 'recovery', script: 'probe:recover', ...probeRecovery },
          ],
        } : {}),
      },
      }, null, 2)),
    };
  });
  const payload = {
    schemaVersion: 1,
    changeType,
    previousVersion,
    releaseVersion,
    releaseUnit: { type: 'npm-package', packagePath: 'package.json' },
    versionAuthority: { type: 'package-json', path: 'package.json' },
    riskSignals,
    candidate: { baseRevision, releaseRevision, releaseTree },
    policy: { id: policy.policyId, sha256: digest },
    generatedAt,
    consensusAt,
    implementationAuthors: ['author-1'],
    riskAssessments: [
      { role: 'implementer', reviewerId: 'author-1', candidateRevision: releaseRevision, candidateTree: releaseTree, policySha256: digest, submittedAt, signals: riskSignals, rationale: 'Implementer reviewed the declared change surface.' },
      { role: 'independent-reviewer', reviewerId: architects[0].id, candidateRevision: releaseRevision, candidateTree: releaseTree, policySha256: digest, submittedAt, signals: riskSignals, rationale: 'Independent reviewer reviewed the declared change surface.' },
    ],
    participants: { engineers, architects },
    findings: [],
    evidence,
  };
  const evidencePath = `docs/ai/release-evidence/${releaseVersion}.json`;
  writeFile(root, evidencePath, JSON.stringify(payload, null, 2));
  commit(root, 'release evidence');
  return { evidencePath, payload, requirements };
}

test('release policy records the shared scorecard and risk-proportional participant counts', () => {
  const policy = loadReleaseAcceptancePolicy();
  assert.equal(policy.scorecard.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0), 100);
  assert.deepEqual(policy.tiers.bugfix.minimumParticipants, { engineers: 1, architects: 1 });
  assert.deepEqual(policy.tiers.feature.minimumParticipants, { engineers: 2, architects: 2 });
  assert.deepEqual(policy.tiers.major.minimumParticipants, { engineers: 5, architects: 3 });
});

test('bugfix acceptance passes only with patch versioning and complete repository-local evidence', (context) => {
  const root = fixture('bugfix');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '1.2.3', '1.2.4');
  const result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.weightedScore, 90);
  assert.deepEqual(result.evidenceCoverage, { passed: 7, required: 7 });
  assert.deepEqual(result.commandReplays.map(({ script, status }) => ({ script, status })), [
    { script: 'probe:fail', status: 'passed' },
    { script: 'probe:recover', status: 'passed' },
    { script: 'verify', status: 'passed' },
  ]);
});

test('feature acceptance blocks low critical scores, unresolved P1 findings, and missing evidence', (context) => {
  const root = fixture('feature-fail');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'feature', '1.2.3', '1.3.0');
  const scorecardPath = path.join(root, prepared.payload.participants.architects[0].scorecard);
  const scorecard = JSON.parse(fs.readFileSync(scorecardPath, 'utf8'));
  scorecard.scores['business-understanding'] = 79;
  fs.writeFileSync(scorecardPath, JSON.stringify(scorecard, null, 2));
  prepared.payload.findings.push({ id: 'ARCH-1', severity: 'P1', status: 'open', summary: 'Architecture boundary remains unresolved.' });
  prepared.payload.evidence = prepared.payload.evidence.filter((entry) => entry.id !== 'canonical-reuse-review');
  writeFile(root, prepared.evidencePath, JSON.stringify(prepared.payload, null, 2));
  commit(root, 'record failing evidence');
  const result = runReleaseAcceptance(root, { changeType: 'feature', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('business-understanding')));
  assert.ok(result.errors.some((error) => error.includes('unresolved blocking P1')));
  assert.ok(result.errors.some((error) => error.includes('canonical-reuse-review')));
});

test('high-risk patches retain patch versioning but are escalated to feature acceptance', (context) => {
  const root = fixture('risk-escalation');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '2.4.0', '2.4.1', ['authorization']);
  const result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.effectiveAcceptanceTier, 'feature');
  assert.deepEqual(result.participants, { engineers: 2, architects: 2 });
});

test('breaking contracts require a major version and the full five-by-three evidence tier', (context) => {
  const rejectedRoot = fixture('breaking-rejected');
  const majorRoot = fixture('major');
  context.after(() => {
    fs.rmSync(rejectedRoot, { recursive: true, force: true });
    fs.rmSync(majorRoot, { recursive: true, force: true });
  });
  const rejected = completeEvidence(rejectedRoot, 'bugfix', '1.0.0', '1.0.1', ['breaking-public-api']);
  const rejectedResult = runReleaseAcceptance(rejectedRoot, { changeType: 'bugfix', evidencePath: rejected.evidencePath });
  assert.equal(rejectedResult.ok, false);
  assert.ok(rejectedResult.errors.some((error) => error.includes('requires changeType major')));

  const major = completeEvidence(majorRoot, 'major', '1.9.4', '2.0.0');
  const majorResult = runReleaseAcceptance(majorRoot, { changeType: 'major', evidencePath: major.evidencePath });
  assert.equal(majorResult.ok, true, majorResult.errors.join('\n'));
  assert.deepEqual(majorResult.participants, { engineers: 5, architects: 3 });
});

test('CLI and exact chat intent use the same release acceptance core', (context) => {
  const root = fixture('cli-chat');
  const configRoot = fixture('cli-chat-config');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(configRoot, { recursive: true, force: true });
  });
  const prepared = completeEvidence(root, 'feature', '3.1.4', '3.2.0');
  const directPreview = run(['release-check', root, '--type', 'feature', '--evidence', prepared.evidencePath, '--json']);
  assert.equal(directPreview.status, 1);
  const directPlan = JSON.parse(directPreview.stdout).replayPlan;
  const direct = run(['release-check', root, '--type', 'feature', '--evidence', prepared.evidencePath, '--replay', '--approve', directPlan.planHash, '--json']);
  assert.equal(direct.status, 0, direct.stderr);
  assert.equal(JSON.parse(direct.stdout).effectiveAcceptanceTier, 'feature');

  const config = path.join(configRoot, writeFile(configRoot, 'release-request.json', JSON.stringify({
    releaseAcceptance: { changeType: 'feature', evidencePath: prepared.evidencePath, replayCommands: true },
  })));
  const chatPreview = run(['request', root, '--text', '检查发布验收', '--config', config, '--json']);
  assert.equal(chatPreview.status, 1);
  const chatPlan = JSON.parse(chatPreview.stdout).result.replayPlan;
  const chat = run(['request', root, '--text', '检查发布验收', '--config', config, '--approve', chatPlan.planHash, '--json']);
  assert.equal(chat.status, 0, chat.stderr);
  assert.equal(JSON.parse(chat.stdout).result.ok, true);
});

test('release evidence and participant scorecards cannot use symlinks or leave the repository', (context) => {
  const root = fixture('unsafe-reference');
  const outside = fixture('outside');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const prepared = completeEvidence(root, 'bugfix', '4.0.0', '4.0.1');
  fs.writeFileSync(path.join(outside, 'scorecard.md'), 'outside\n');
  const engineerCard = path.join(root, prepared.payload.participants.engineers[0].scorecard);
  fs.rmSync(engineerCard);
  fs.symlinkSync(path.join(outside, 'scorecard.md'), engineerCard);
  const result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('must not traverse a symbolic link')));
});

test('ignored release evidence cannot pass without an auditable Git blob', (context) => {
  const root = fixture('ignored-evidence');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '4.1.0', '4.1.1');
  fs.appendFileSync(path.join(root, '.git', 'info', 'exclude'), `\n/${prepared.evidencePath}\n`);
  git(root, ['rm', '--cached', '--quiet', '--', prepared.evidencePath]);
  commit(root, 'remove root evidence from Git');
  const result = runReleaseAcceptanceCore(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('release evidence must be tracked by Git')));
});

test('a project policy may tighten but cannot weaken the built-in release baseline', (context) => {
  const root = fixture('policy-floor');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'feature', '5.0.0', '5.1.0');
  const policy = loadReleaseAcceptancePolicy();
  policy.tiers.feature.minimumParticipants.engineers = 1;
  policy.tiers.feature.requiredEngineerScenarios = policy.tiers.feature.requiredEngineerScenarios.slice(0, 1);
  writeFile(root, 'docs/ai/release-acceptance-override.json', JSON.stringify(policy, null, 2));
  commit(root, 'add weakened project override');
  assert.throws(
    () => runReleaseAcceptance(root, { changeType: 'feature', evidencePath: prepared.evidencePath }),
    /cannot require fewer engineers/,
  );
});

test('evidence becomes stale when code changes after the bound release candidate', (context) => {
  const root = fixture('stale-candidate');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '6.0.0', '6.0.1');
  writeFile(root, 'src/release-candidate.txt', 'changed after review\n');
  commit(root, 'change after review');
  const result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('Only release evidence may change after candidate.releaseRevision')));
});

test('a leading-space path cannot masquerade as the release evidence directory', (context) => {
  const root = fixture('odd-path');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '6.1.0', '6.1.1');
  writeFile(root, ' docs/ai/release-evidence/hidden.txt', 'not release evidence\n');
  commit(root, 'add deceptive path');
  const result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes(' docs/ai/release-evidence/hidden.txt')));
});

test('hard-linked or identical receipts cannot satisfy multiple required evidence items', (context) => {
  const root = fixture('receipt-reuse');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '7.0.0', '7.0.1');
  const first = path.join(root, prepared.payload.evidence[0].reference);
  const second = path.join(root, prepared.payload.evidence[1].reference);
  fs.rmSync(second);
  fs.linkSync(first, second);
  commit(root, 'reuse evidence receipt');
  const result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /hard-linked|identical evidence content/.test(error)));
});

test('an executable gate cannot be replaced by a prose review receipt', (context) => {
  const root = fixture('receipt-mode');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '7.1.0', '7.1.1');
  const entry = prepared.payload.evidence.find((candidate) => candidate.id === 'governance-gate');
  const receiptPath = path.join(root, entry.reference);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  receipt.verification = { mode: 'review', outcome: 'passed', summary: 'Claimed in prose only.' };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  commit(root, 'replace executable receipt with prose');
  const result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('governance-gate receipt must contain a passing verification with an allowed mode')));
});

test('a claimed exitCode zero cannot pass when the bound npm script replay fails', (context) => {
  const root = fixture('failed-replay');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '7.2.0', '7.2.1', [], 'node -e "process.exit(1)"');
  const result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('replay exitCode did not match its receipt')));
});

test('npm replay targets the actual package.json and rejects a lookalike JSON file', (context) => {
  const root = fixture('fake-package');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '7.2.1', '7.2.2');
  const entry = prepared.payload.evidence.find((candidate) => candidate.id === 'affected-scope-verification');
  const receiptPath = path.join(root, entry.reference);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  receipt.verification.packagePath = 'fake.json';
  writeFile(root, 'fake.json', JSON.stringify({ scripts: { verify: 'node -e "process.exit(0)"' } }));
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  commit(root, 'point receipt at lookalike package metadata');
  const result = runReleaseAcceptanceCore(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('packagePath must name package.json')));
});

test('replay approval must match a plan that exposes exact candidate script text and hash', (context) => {
  const root = fixture('replay-plan');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '7.2.2', '7.2.3');
  const preview = runReleaseAcceptanceCore(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.match(preview.replayPlan.commands[0].commandText, /^node /);
  assert.match(preview.replayPlan.commands[0].commandSha256, /^[a-f0-9]{64}$/);
  const rejected = runReleaseAcceptanceCore(root, {
    changeType: 'bugfix',
    evidencePath: prepared.evidencePath,
    replayCommands: true,
    replayApproval: '0'.repeat(64),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.commandReplays.length, 0);
  assert.ok(rejected.errors.some((error) => error.includes('Replay approval must match the exact command plan')));
});

test('replayed output digests must match the committed receipt', (context) => {
  const root = fixture('output-digest');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '7.2.3', '7.2.4');
  for (const entry of prepared.payload.evidence) {
    const receiptPath = path.join(root, entry.reference);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt.verification.mode !== 'command') continue;
    receipt.verification.stdoutSha256 = '0'.repeat(64);
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  }
  commit(root, 'forge replay output digest');
  const result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('replay output did not match its receipt')));
});

test('probe evidence must replay an expected failure and a successful recovery', (context) => {
  const root = fixture('probe-phases');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '7.2.4', '7.2.5');
  const entry = prepared.payload.evidence.find((candidate) => candidate.id === 'defect-reproduction');
  const receiptPath = path.join(root, entry.reference);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  receipt.verification.steps = [receipt.verification.steps[1]];
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  commit(root, 'remove negative probe phase');
  const result = runReleaseAcceptanceCore(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('exactly failure and recovery steps')));
});

test('probe replay preserves failure then recovery even when script names sort in reverse', (context) => {
  const root = fixture('probe-order');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '7.2.4', '7.2.5', [], 'node -e "process.exit(0)"', {
    extraScripts: {
      'z-fail': 'node -e "process.exit(1)"',
      'a-recover': 'node -e "process.exit(0)"',
    },
  });
  const failure = { phase: 'failure', script: 'z-fail', ...npmRun(root, 'z-fail') };
  const recovery = { phase: 'recovery', script: 'a-recover', ...npmRun(root, 'a-recover') };
  for (const entry of prepared.payload.evidence) {
    const receiptPath = path.join(root, entry.reference);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt.verification.mode !== 'probe') continue;
    receipt.verification.steps = [failure, recovery];
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  }
  commit(root, 'record reverse-sorted probe scripts');
  const preview = runReleaseAcceptanceCore(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  const probeSteps = preview.replayPlan.commands.filter((command) => command.phase !== 'command');
  assert.deepEqual(probeSteps.map(({ phase, script, sequence }) => ({ phase, script, sequence })), [
    { phase: 'failure', script: 'z-fail', sequence: 1 },
    { phase: 'recovery', script: 'a-recover', sequence: 2 },
  ]);
});

test('npm replay rejects implicit pre and post hooks that are absent from the approved plan', (context) => {
  const root = fixture('implicit-hook');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '7.2.5', '7.2.6', [], 'node -e "process.exit(0)"', {
    extraScripts: { preverify: 'node -e "process.exit(0)"' },
  });
  const result = runReleaseAcceptanceCore(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('must not have implicit pre/post lifecycle hooks')));
});

test('replay cannot return success after a verification script mutates the worktree', (context) => {
  const root = fixture('replay-mutation');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const command = 'node -e "const fs=require(\'fs\');fs.mkdirSync(\'docs/ai/release-evidence\',{recursive:true});fs.appendFileSync(\'docs/ai/release-evidence/run-count\',\'x\')"';
  const prepared = completeEvidence(root, 'bugfix', '7.2.5', '7.2.6', [], command);
  const result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('clean Git worktree')));
});

test('replay cannot replace committed evidence with a new clean commit', (context) => {
  const root = fixture('replay-commit');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidencePath = 'docs/ai/release-evidence/7.2.7.json';
  const command = `node -e "const fs=require('fs'),cp=require('child_process');if(fs.existsSync('${evidencePath}')){const p='docs/ai/release-evidence/script-commit.txt';fs.writeFileSync(p,'changed');cp.execFileSync('git',['add',p]);cp.execFileSync('git',['-c','user.name=AICG Script','-c','user.email=script@example.invalid','commit','--quiet','-m','script changed evidence'])}"`;
  const prepared = completeEvidence(root, 'bugfix', '7.2.6', '7.2.7', [], command);
  const result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('must not change the preflight HEAD')));
});

test('replay cannot reset away the evidence after it was validated in memory', (context) => {
  const root = fixture('replay-reset');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidencePath = 'docs/ai/release-evidence/7.2.8.json';
  const command = `node -e "const fs=require('fs'),cp=require('child_process');if(fs.existsSync('${evidencePath}'))cp.execFileSync('git',['reset','--hard','HEAD~1'])"`;
  const prepared = completeEvidence(root, 'bugfix', '7.2.7', '7.2.8', [], command);
  const result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /preflight HEAD|removed a validated evidence artifact/.test(error)));
});

test('npm publication mode recomputes the packed artifact after replay', (context) => {
  const root = fixture('post-replay-package');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const command = 'node -e "require(\'fs\').appendFileSync(\'src/generated.txt\',\'x\')"';
  const prepared = completeEvidence(root, 'feature', '7.2.6', '7.3.0', [], command, { ignoredPaths: ['src/generated.txt'] });
  const packed = npmPack(root);
  prepared.payload.packageArtifact = {
    type: 'npm-pack',
    filename: packed.filename,
    shasum: packed.shasum,
    integrity: packed.integrity,
    entryCount: packed.entryCount,
  };
  writeFile(root, prepared.evidencePath, JSON.stringify(prepared.payload, null, 2));
  commit(root, 'bind pre-replay package artifact');
  const result = runReleaseAcceptance(root, {
    changeType: 'feature',
    evidencePath: prepared.evidencePath,
    verifyPackageArtifact: true,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('packageArtifact does not match')));
});

test('npm publication mode cannot redirect acceptance to a nested package', (context) => {
  const root = fixture('nested-release-unit');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'feature', '7.3.0', '7.4.0');
  prepared.payload.releaseUnit = { type: 'npm-package', packagePath: 'fake/package.json' };
  prepared.payload.versionAuthority = { type: 'package-json', path: 'fake/package.json' };
  writeFile(root, 'fake/package.json', JSON.stringify({ name: 'fake', version: '7.4.0', scripts: { verify: 'node -e "process.exit(0)"' } }));
  writeFile(root, prepared.evidencePath, JSON.stringify(prepared.payload, null, 2));
  commit(root, 'redirect publication evidence to nested package');
  const result = runReleaseAcceptanceCore(root, {
    changeType: 'feature',
    evidencePath: prepared.evidencePath,
    verifyPackageArtifact: true,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('repository root package.json')));
});

test('command and probe receipts require explicit replay authorization', (context) => {
  const root = fixture('replay-required');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '7.3.0', '7.3.1');
  const result = runReleaseAcceptanceCore(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('requires explicit --replay --approve')));
  assert.match(result.replayPlan.planHash, /^[a-f0-9]{64}$/);
});

test('participant findings cannot be omitted and resolved P0 findings require a bound receipt', (context) => {
  const root = fixture('finding-union');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '8.0.0', '8.0.1');
  const reportPath = path.join(root, prepared.payload.participants.architects[0].scorecard);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  report.findings = [{ id: 'SEC-1', severity: 'P0' }];
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  commit(root, 'record participant finding');
  let result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.ok(result.errors.some((error) => error.includes('participant finding is missing from root findings: SEC-1')));

  prepared.payload.findings = [{ id: 'SEC-1', severity: 'P0', status: 'resolved', summary: 'Resolved before release.' }];
  writeFile(root, prepared.evidencePath, JSON.stringify(prepared.payload, null, 2));
  commit(root, 'claim finding resolved');
  result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('SEC-1 resolution reference')));
});

test('major review seats require distinct primary scenarios and architect lenses', (context) => {
  const root = fixture('major-coverage');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'major', '8.9.0', '9.0.0');
  const reportPath = path.join(root, prepared.payload.participants.engineers[1].scorecard);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  report.primaryScenario = prepared.requirements.requiredEngineerScenarios[0];
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  commit(root, 'duplicate major scenario');
  const result = runReleaseAcceptance(root, { changeType: 'major', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('engineer primaryScenario assignments must be unique')));
});

test('participant counts are minimums and allow additional independent reviewers', (context) => {
  const root = fixture('extra-reviewer');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'feature', '9.0.0', '9.1.0');
  const originalPath = path.join(root, prepared.payload.participants.engineers[0].scorecard);
  const report = JSON.parse(fs.readFileSync(originalPath, 'utf8'));
  report.participantId = 'engineer-extra';
  report.primaryScenario = 'observability-and-operations';
  const scorecard = writeFile(root, 'docs/ai/release-evidence/reviews/engineer-extra.json', JSON.stringify(report, null, 2));
  prepared.payload.participants.engineers.push({ id: 'engineer-extra', scorecard });
  writeFile(root, prepared.evidencePath, JSON.stringify(prepared.payload, null, 2));
  commit(root, 'add extra independent reviewer');
  const result = runReleaseAcceptance(root, { changeType: 'feature', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(result.participants, { engineers: 3, architects: 2 });
});

test('implementation authors cannot self-approve and placeholder scorecards cannot pass', (context) => {
  const root = fixture('self-review');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '9.1.0', '9.1.1');
  const engineer = prepared.payload.participants.engineers[0];
  prepared.payload.implementationAuthors = [engineer.id];
  prepared.payload.riskAssessments[0].reviewerId = engineer.id;
  fs.writeFileSync(path.join(root, engineer.scorecard), '{}\n');
  writeFile(root, prepared.evidencePath, JSON.stringify(prepared.payload, null, 2));
  commit(root, 'attempt self review');
  const result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('cannot review an implementation they authored')));
  assert.ok(result.errors.some((error) => error.includes('scorecard schemaVersion must be 1')));
});

test('dual risk assessments are unioned and cannot silently downgrade a high-risk patch', (context) => {
  const root = fixture('risk-union');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'bugfix', '10.0.0', '10.0.1', ['authorization']);
  prepared.payload.riskSignals = [];
  writeFile(root, prepared.evidencePath, JSON.stringify(prepared.payload, null, 2));
  commit(root, 'omit declared risk');
  const result = runReleaseAcceptance(root, { changeType: 'bugfix', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, false);
  assert.equal(result.effectiveAcceptanceTier, 'feature');
  assert.ok(result.errors.some((error) => error.includes('riskSignals must equal the union')));
});

test('SemVer build metadata is accepted while numeric identifiers with leading zeroes are rejected', (context) => {
  const validRoot = fixture('semver-build');
  const invalidRoot = fixture('semver-invalid');
  context.after(() => {
    fs.rmSync(validRoot, { recursive: true, force: true });
    fs.rmSync(invalidRoot, { recursive: true, force: true });
  });
  const valid = completeEvidence(validRoot, 'bugfix', '1.2.3+build.1', '1.2.4+build.2');
  assert.equal(runReleaseAcceptance(validRoot, { changeType: 'bugfix', evidencePath: valid.evidencePath }).ok, true);
  const invalid = completeEvidence(invalidRoot, 'bugfix', '1.2.03', '1.2.4');
  const result = runReleaseAcceptance(invalidRoot, { changeType: 'bugfix', evidencePath: invalid.evidencePath });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('previousVersion must be valid semver.'));
});

test('Git tags can be the version authority for non-Node release units', (context) => {
  const root = fixture('git-tags');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'feature', '12.0.0', '12.1.0');
  git(root, ['tag', 'v12.0.0', prepared.payload.candidate.baseRevision]);
  git(root, ['tag', 'v12.1.0', prepared.payload.candidate.releaseRevision]);
  prepared.payload.versionAuthority = { type: 'git-tags', previousTag: 'v12.0.0', releaseTag: 'v12.1.0' };
  writeFile(root, prepared.evidencePath, JSON.stringify(prepared.payload, null, 2));
  commit(root, 'use Git tag version authority');
  const result = runReleaseAcceptance(root, { changeType: 'feature', evidencePath: prepared.evidencePath });
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('prepublish gate refuses to contact a registry without explicit tier and evidence inputs', () => {
  const environment = { ...process.env };
  delete environment.AICG_RELEASE_TYPE;
  delete environment.AICG_RELEASE_EVIDENCE;
  delete environment.AICG_RELEASE_APPROVAL;
  const result = spawnSync(process.execPath, [path.resolve('scripts/prepublish-check.mjs')], { encoding: 'utf8', env: environment });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Publishing requires AICG_RELEASE_TYPE.*AICG_RELEASE_APPROVAL/);
});

test('npm publication mode binds acceptance to the exact packed artifact', (context) => {
  const root = fixture('npm-artifact');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prepared = completeEvidence(root, 'feature', '11.0.0', '11.1.0');
  const packed = npmPack(root);
  prepared.payload.packageArtifact = {
    type: 'npm-pack',
    filename: packed.filename,
    shasum: packed.shasum,
    integrity: packed.integrity,
    entryCount: packed.entryCount,
  };
  writeFile(root, prepared.evidencePath, JSON.stringify(prepared.payload, null, 2));
  commit(root, 'bind npm package artifact');
  const result = runReleaseAcceptance(root, { changeType: 'feature', evidencePath: prepared.evidencePath, verifyPackageArtifact: true });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.packageArtifact.shasum, packed.shasum);
});
