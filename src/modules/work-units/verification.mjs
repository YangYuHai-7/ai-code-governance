import { readMemoryFile } from '../memory/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { sha256, stableJson } from '../../shared/index.mjs';
import { workUnitPlanDigest, HASH, fields } from './schema.mjs';

export function workUnitVerificationBinding(root, scan, unit) {
  const paths = [...new Set([...scan.files.filter((entry) => entry.type !== 'directory' && !/^(?:docs|\.ai-governance|\.agents|\.claude|\.cursor|\.github)\//.test(entry.relative)).map((entry) => entry.relative),
    ...unit.scope.flatMap((group) => group.paths), ...unit.testCases.map((entry) => entry.testPath), ...unit.references.map((entry) => entry.path)])]
    .filter((relative) => relative !== scan.workUnitPath && relative !== scan.approvalEvidence).sort();
  if (paths.length > 10000 || scan.scanBudget?.complete !== true) throw new Error('Work-unit verification input scan is incomplete.');
  let size = 0;
  const sources = paths.map((relative) => {
    try {
      const bytes = readMemoryFile(root, relative);
      size += Buffer.byteLength(bytes);
      if (size > 32 * 1024 * 1024) throw new Error('Work-unit verification inputs exceed 32 MiB.');
      return { path: relative, sha256: sha256(bytes), executable: (fs.lstatSync(path.join(root, relative)).mode & 0o111) !== 0 };
    } catch (error) { if (error.code === 'ENOENT') return { path: relative, missing: true }; throw error; }
  });
  const packageDigest = sha256(readMemoryFile(root, 'package.json'));
  return { planDigest: workUnitPlanDigest(unit), inputDigest: sha256(stableJson(sources)), commandDigest: sha256(stableJson({ command: unit.verification.command, packageDigest })) };
}

export function recordWorkUnitVerification(root, scan, unit, verification) {
  const binding = workUnitVerificationBinding(root, scan, unit);
  const evidence = { schemaVersion: 1, source: 'operator-declared', ...binding, command: verification.command, outputDigest: verification.outputDigest, exitCode: verification.exitCode, status: verification.status, resultsDigest: sha256(stableJson(verification.qaResults ?? [])) };
  return { ...evidence, evidenceDigest: sha256(stableJson(evidence)) };
}

export function replayWorkUnitVerification(root, scan, unit) {
  try {
    const evidence = unit.verification.evidence;
    fields(evidence, ['schemaVersion', 'source', 'planDigest', 'inputDigest', 'commandDigest', 'command', 'outputDigest', 'exitCode', 'status', 'resultsDigest', 'evidenceDigest'], 'verification evidence');
    const { evidenceDigest, ...body } = evidence;
    const binding = workUnitVerificationBinding(root, scan, unit);
    if (evidence.schemaVersion !== 1 || evidence.source !== 'operator-declared' || evidence.status !== 'passed' || evidence.exitCode !== 0 || evidence.command !== unit.verification.command
      || !['planDigest', 'inputDigest', 'commandDigest', 'outputDigest', 'resultsDigest', 'evidenceDigest'].every((key) => HASH.test(evidence[key] ?? ''))
      || evidenceDigest !== sha256(stableJson(body)) || Object.entries(binding).some(([key, value]) => evidence[key] !== value)
      || evidence.resultsDigest !== sha256(stableJson(unit.qa.results))) throw new Error('Recorded work-unit verification is stale or malformed.');
    return { status: 'passed', command: evidence.command, exitCode: 0, outputDigest: evidence.outputDigest, qaResults: unit.qa.results, qaError: null, markers: [],
      evidenceLevel: 'operator-declared', replayed: true, identityVerified: false,
      inputEvidence: { status: 'unchanged', beforeFingerprint: binding.inputDigest, afterFingerprint: binding.inputDigest },
      boundary: 'Recorded evidence is structurally bound to current inputs; command execution and authorship are operator-declared, not authenticated.' };
  } catch (error) { return { status: 'recorded-evidence-invalid', command: unit.verification.command, qaResults: [], qaError: error.message, evidenceLevel: 'operator-declared' }; }
}
