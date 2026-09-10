import path from 'node:path';
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
  const scan = scanProject(target, { probeEnvironment: true });
  const result = addReadOnlyGuidance('doctor', doctor(scan), scan, { locale: options.locale, config: existingConfigForGuidance(scan) });
  if (options.json) printDoctor(result, true);
  else printHumanGuidance(result);
  if (!result.ok) process.exitCode = 1;
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
  const result = checkProject(scanProject(target));
  printCheck(result, Boolean(options.json));
  if (!result.ok) process.exitCode = 1;
}
