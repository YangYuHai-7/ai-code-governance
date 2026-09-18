import path from 'node:path';
import { readBoundedRepositoryFile } from '../../preconditions.mjs';
import { exists, writeAtomicFile } from '../../adapters/filesystem/index.mjs';
import { defaultConfig, validateConfig } from '../../generator.mjs';
import { scanProject } from '../../scanner.mjs';
import { stableJson } from '../../shared/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import {
  defaultTestCaseManifest,
  recordTestCaseResults,
  renderTestReport,
  safeTestingPath,
  selectTestCasePacket,
  validateTestCaseManifest,
} from '../../testing.mjs';
import { loadExistingConfig, mergeConfig } from '../shared.mjs';

function configured(root) {
  const scan = scanProject(root, { probeEnvironment: false });
  return validateConfig(mergeConfig(defaultConfig(scan), loadExistingConfig(root) ?? {}));
}

function jsonFile(root, relative, label) {
  if (!relative) throw usageError(`${label} is required.`);
  const bytes = readBoundedRepositoryFile(root, relative, 512 * 1024).bytes;
  try { return JSON.parse(bytes.toString('utf8')); }
  catch (error) { throw usageError(`${label} is not valid JSON: ${error.message}`); }
}

function relativeOrDefault(value, fallback) {
  return value || fallback;
}

function baselineTemplate(manifest, language) {
  if (language === 'zh-CN') return `# ${manifest.scope} 测试用例基线\n\n- 基线版本：\`${manifest.baselineVersion}\`\n- 执行清单：\`${manifest.scope}-execution.json\`\n\n## 测试依据\n\n待从已确认需求、开发文档、契约和代码风险补全。\n\n## 覆盖决策\n\n所有覆盖维度必须在执行清单中标记为 COVERED、PARTIAL、GAP 或 NOT_APPLICABLE。\n\n## 用例\n\n使用执行清单中的稳定 Case ID；不得仅为补齐编号而重排已有 ID。\n`;
  return `# ${manifest.scope} test-case baseline\n\n- Baseline version: \`${manifest.baselineVersion}\`\n- Execution manifest: \`${manifest.scope}-execution.json\`\n\n## Test basis\n\nComplete this section from confirmed requirements, development documentation, contracts, and code risks.\n\n## Coverage decisions\n\nEvery coverage dimension must be COVERED, PARTIAL, GAP, or NOT_APPLICABLE in the execution manifest.\n\n## Cases\n\nUse the stable Case IDs from the execution manifest; never renumber surviving cases merely to close gaps.\n`;
}

function initCases(root, options, config) {
  if (!options.scope) throw usageError('test-case init requires --scope.');
  if (!options.yes) throw usageError('test-case init writes a baseline and requires --yes.');
  const format = options.format ?? config.testing.caseFormat;
  if (!['aicg-json-v2', 'markdown-plus-json'].includes(format)) throw usageError('Unsupported test-case format; use aicg-json-v2 or markdown-plus-json.');
  const caseRoot = options.output ?? config.testing.caseRoot;
  const manifest = defaultTestCaseManifest({
    scope: options.scope,
    locale: config.testing.reportLanguage,
    evidenceDir: `${config.testing.reportRoot}/evidence/${options.scope}`,
  });
  const manifestRelative = format === 'markdown-plus-json'
    ? `${caseRoot}/${options.scope}-execution.json`
    : `${caseRoot}/${options.scope}-test-cases.json`;
  const manifestPath = safeTestingPath(root, manifestRelative);
  if (exists(manifestPath)) throw usageError(`Refuse to replace existing test-case manifest: ${manifestRelative}.`);
  writeAtomicFile(manifestPath, `${stableJson(manifest)}\n`);
  const files = [manifestRelative];
  if (format === 'markdown-plus-json') {
    const baselineRelative = `${caseRoot}/${options.scope}-test-cases.md`;
    const baselinePath = safeTestingPath(root, baselineRelative);
    if (exists(baselinePath)) throw usageError(`Refuse to replace existing test baseline: ${baselineRelative}.`);
    writeAtomicFile(baselinePath, baselineTemplate(manifest, config.testing.reportLanguage));
    files.push(baselineRelative);
  }
  console.log(JSON.stringify({ created: true, format, files, next: `Fill stable cases, then run aicg test-case validate . --manifest ${manifestRelative}` }, null, 2));
}

function validateCases(root, options) {
  const manifest = jsonFile(root, options.manifest, '--manifest');
  validateTestCaseManifest(manifest);
  console.log(JSON.stringify({ valid: true, schemaVersion: manifest.schemaVersion, scope: manifest.scope, caseCount: manifest.cases.length }, null, 2));
}

function selectCases(root, options) {
  const manifest = jsonFile(root, options.manifest, '--manifest');
  const packet = selectTestCasePacket(manifest, {
    cases: options.cases,
    priorities: options.priorities,
    tags: options.tags,
    drivers: options.drivers,
  });
  if (options.output) {
    const output = safeTestingPath(root, options.output);
    writeAtomicFile(output, `${stableJson(packet)}\n`);
    console.log(JSON.stringify({ selected: packet.selectedCount, output: options.output, packetDigest: packet.packetDigest }, null, 2));
  } else console.log(stableJson(packet));
}

function recordCases(root, options, config) {
  const manifest = jsonFile(root, options.manifest, '--manifest');
  const packet = jsonFile(root, options.packet, '--packet');
  const external = jsonFile(root, options.results, '--results');
  const ledgerPath = relativeOrDefault(options.ledger, `${config.testing.reportRoot}/${manifest.scope}-results.json`);
  const recorded = recordTestCaseResults(root, { manifest, packet, external, ledgerPath });
  const reportPath = relativeOrDefault(options.report, `${config.testing.reportRoot}/${manifest.scope}-test-report.md`);
  const absoluteReport = safeTestingPath(root, reportPath);
  writeAtomicFile(absoluteReport, renderTestReport(manifest, recorded.session, config.testing.reportLanguage));
  console.log(JSON.stringify({ status: recorded.status, sessionId: recorded.session.sessionId, sessionDigest: recorded.session.sessionDigest, ledger: ledgerPath, report: reportPath }, null, 2));
}

export function testCaseCommand(target, action, options) {
  const root = path.resolve(target);
  const config = configured(root);
  if (action === 'init') return initCases(root, options, config);
  if (action === 'validate') return validateCases(root, options);
  if (action === 'select') return selectCases(root, options);
  if (action === 'record') return recordCases(root, options, config);
  throw usageError('test-case requires init, validate, select, or record.');
}
