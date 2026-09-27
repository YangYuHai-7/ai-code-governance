import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../../src/shared/index.mjs';

/**
 * Bind the project flow ledger to a requirement and a development plan so an L2/L3
 * completion can pass its flow-evidence gate. The ledger is an `ownership: seed` artifact,
 * so the executing side (here, the fixture) owns it after generation. The digest is the
 * SHA-256 of the referenced file's bytes, exactly what the completion gate checks.
 */
export function satisfyFlow(root, { requirement = 'docs/workflow/requirement.md', plan = 'docs/workflow/plan.md', report = 'docs/workflow/report.md' } = {}) {
  for (const [relative, body] of [[requirement, '# Requirement\n\nFixture requirement document.\n'], [plan, '# Development plan\n\nFixture development plan.\n'], [report, '# Test report\n\nFixture functional test report.\n']]) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), body);
  }
  // The ledger is footprint-aware: compact maps it under .ai-governance/state/, while a
  // preserve tree keeps docs/ai/flow-state.json. Accept either.
  const ledgerPath = ['.ai-governance/state/flow-state.json', 'docs/ai/flow-state.json']
    .map((relative) => path.join(root, relative))
    .find((absolute) => fs.existsSync(absolute));
  if (!ledgerPath) throw new Error('flow-state.json was not generated for this fixture');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  ledger.requirement = { path: requirement, digest: sha256(fs.readFileSync(path.join(root, requirement))) };
  ledger.plan = { path: plan, digest: sha256(fs.readFileSync(path.join(root, plan))), planHash: sha256('# approved fixture plan\n') };
  ledger.report = { path: report, digest: sha256(fs.readFileSync(path.join(root, report))) };
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  return { requirement, plan, report };
}
