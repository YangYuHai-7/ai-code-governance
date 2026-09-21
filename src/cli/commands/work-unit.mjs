import { readWorkUnit, planWorkUnit, checkWorkUnit } from '../../modules/work-units/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { readMemoryFile } from '../../modules/memory/index.mjs';
import { validateConfig } from '../../modules/governance/index.mjs';
import path from 'node:path';
import { writeGateReport } from '../../adapters/filesystem/index.mjs';

export function workUnitCommand(target, action, options) {
  if (!options['work-unit']) throw usageError('work-unit requires --work-unit <safe-relative-json>.');
  let result;
  try {
    const unit = readWorkUnit(target, options['work-unit']);
    let config = {};
    try { config = validateConfig(JSON.parse(readMemoryFile(target, '.ai-governance/config.json'))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    result = action === 'plan' ? planWorkUnit(target, unit, { config }) : checkWorkUnit(target, unit, { config, completion: false });
  } catch (error) {
    result = { ok: false, status: 'invalid', issues: [error.message] };
  }
  const reportPath = writeGateReport(path.resolve(target), 'work-unit', { action, ...result });
  console.log(JSON.stringify({ ...result, reportPath, gateMode: options.enforce ? 'enforce' : 'report' }, null, 2));
  if (options.enforce && result.ok === false) process.exitCode = 1;
}
