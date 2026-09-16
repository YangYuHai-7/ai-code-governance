import { readWorkUnit, planWorkUnit, checkWorkUnit } from '../../modules/work-units/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { readMemoryFile } from '../../modules/memory/index.mjs';
import { validateConfig } from '../../modules/governance/index.mjs';

export function workUnitCommand(target, action, options) {
  if (!options['work-unit']) throw usageError('work-unit requires --work-unit <safe-relative-json>.');
  const unit = readWorkUnit(target, options['work-unit']);
  let config = {};
  try { config = validateConfig(JSON.parse(readMemoryFile(target, '.ai-governance/config.json'))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = action === 'plan' ? planWorkUnit(target, unit, { config }) : checkWorkUnit(target, unit, { config, completion: false });
  console.log(JSON.stringify(result, null, 2));
  if (result.ok === false) process.exitCode = 1;
}
