import path from 'node:path';
import { assessArchitecture } from '../../architecture-assessment.mjs';
import { checkProject, printCheck } from '../../checker.mjs';
import { doctor, printDoctor } from '../../doctor.mjs';
import { assessmentSummary } from '../../project-assessment.mjs';
import { scanProject } from '../../scanner.mjs';
import { technicalStandardsSummary } from '../../technical-standards.mjs';
import { readTeamContext, teamRecommendation } from '../../team-recommendation.mjs';
import { configForStandards } from '../shared.mjs';

export function doctorCommand(target, options) {
  const result = doctor(scanProject(target, { probeEnvironment: false }));
  printDoctor(result, Boolean(options.json));
  if (!result.ok) process.exitCode = 1;
}

export function assessCommand(target) {
  console.log(JSON.stringify(assessmentSummary(scanProject(target)), null, 2));
}

export function architectureCommand(target) {
  console.log(JSON.stringify(assessArchitecture(scanProject(target)), null, 2));
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
