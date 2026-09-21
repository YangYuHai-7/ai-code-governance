import path from 'node:path';
import { writeGateReport } from '../../adapters/filesystem/index.mjs';
import { assessArchitecture } from '../../architecture-assessment.mjs';
import { checkProject, printCheck } from '../../checker.mjs';
import { doctor, printDoctor } from '../../doctor.mjs';
import { assessmentSummary } from '../../project-assessment.mjs';
import { scanProject } from '../../scanner.mjs';
import { technicalStandardsSummary } from '../../technical-standards.mjs';
import { readTeamContext, teamRecommendation } from '../../team-recommendation.mjs';
import { addReadOnlyGuidance, printHumanGuidance } from '../read-only-guidance.mjs';
import { configForStandards, loadExistingConfig } from '../shared.mjs';

function existingConfigForGuidance(scan) {
  try {
    return loadExistingConfig(scan.root);
  } catch {
    return null;
  }
}

export function doctorCommand(target, options) {
  let result;
  try {
    const scan = scanProject(target, { probeEnvironment: true });
    result = addReadOnlyGuidance('doctor', doctor(scan), scan, { locale: options.locale, config: existingConfigForGuidance(scan) });
  } catch (error) { result = { ok: false, status: 'error', errors: [error.message] }; }
  const reportPath = writeGateReport(path.resolve(target), 'doctor', result);
  if (result.status === 'error') console.log(JSON.stringify({ ...result, reportPath, gateMode: options.enforce ? 'enforce' : 'report' }, null, 2));
  else if (options.json) printDoctor({ ...result, reportPath, gateMode: options.enforce ? 'enforce' : 'report' }, true);
  else { printHumanGuidance(result); console.log(`REPORT: ${reportPath}`); }
  if (options.enforce && !result.ok) process.exitCode = 1;
}

export function assessCommand(target, options) {
  const scan = scanProject(target);
  const result = addReadOnlyGuidance('assess', assessmentSummary(scan), scan, { locale: options.locale, config: existingConfigForGuidance(scan) });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else printHumanGuidance(result);
}

export function architectureCommand(target, options) {
  const scan = scanProject(target);
  const result = addReadOnlyGuidance('architecture', assessArchitecture(scan), scan, { locale: options.locale, config: existingConfigForGuidance(scan) });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else printHumanGuidance(result);
}

export function standardsCommand(target) {
  const scan = scanProject(target);
  console.log(JSON.stringify(technicalStandardsSummary(scan, configForStandards(scan)), null, 2));
}

export function teamCommand(target, options) {
  const root = path.resolve(target);
  const context = readTeamContext(root, options.config);
  console.log(JSON.stringify(teamRecommendation(root, context), null, 2));
}

export function checkCommand(target, options) {
  let result;
  try { result = checkProject(scanProject(target)); }
  catch (error) { result = { ok: false, status: 'error', errors: [error.message], warnings: [] }; }
  const reportPath = writeGateReport(path.resolve(target), 'check', result);
  if (result.status === 'error') console.log(JSON.stringify({ ...result, reportPath, gateMode: options.enforce ? 'enforce' : 'report' }, null, 2));
  else printCheck({ ...result, reportPath, gateMode: options.enforce ? 'enforce' : 'report' }, Boolean(options.json));
  if (!options.json) console.log(`REPORT: ${reportPath}`);
  if (options.enforce && !result.ok) process.exitCode = 1;
}
