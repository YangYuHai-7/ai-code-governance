import path from 'node:path';
import { assertNoLinkAncestor } from './repository-state.mjs';
import { writeAtomicFile } from './files.mjs';

const REPORTS = new Set(['check', 'complete', 'release-check', 'doctor', 'work-unit', 'test-case', 'config']);

export function writeGateReport(root, command, result) {
  if (!REPORTS.has(command)) throw new Error(`Unsupported gate report: ${command}`);
  const relative = `reports/aicg/latest-${command}.json`;
  assertNoLinkAncestor(root, relative);
  const absolute = path.join(root, relative);
  writeAtomicFile(absolute, JSON.stringify({
    schemaVersion: 1,
    command,
    mode: 'report',
    generatedAt: new Date().toISOString(),
    passed: result.ok !== false,
    result,
  }, null, 2) + '\n', 0o600);
  return relative;
}
