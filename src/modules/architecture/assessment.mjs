import { classifyProject } from '../repository/index.mjs';
import { readText } from '../../utils.mjs';
import { isArchitectureNonSourcePath } from './source-classification.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.java', '.kt', '.kts', '.rb', '.php', '.rs', '.cs', '.swift']);
const GOVERNANCE_PREFIXES = ['AGENTS.md', 'CLAUDE.md', '.cursor/', '.claude/', '.agents/', 'docs/ai/', '.ai-governance/'];

function isGovernancePath(relative) {
  return GOVERNANCE_PREFIXES.some((prefix) => relative === prefix || relative.startsWith(prefix));
}

function isBuildConfiguration(relative) {
  const basename = relative.split('/').at(-1);
  return /^(?:vite|next|webpack|rollup|eslint|prettier|tailwind|postcss|jest|vitest)\.config\.[^/]+$/.test(basename)
    || ['build.gradle.kts', 'build.gradle', 'settings.gradle.kts', 'settings.gradle'].includes(basename);
}

function sourceFiles(scan) {
  return scan.files.filter((file) => {
    if (file.type !== 'file' || isGovernancePath(file.relative) || isBuildConfiguration(file.relative) || isArchitectureNonSourcePath(file.relative)) return false;
    const extension = file.relative.slice(file.relative.lastIndexOf('.'));
    return SOURCE_EXTENSIONS.has(extension);
  });
}

function architectureBlueprint(stacks) {
  const ids = new Set(stacks.map((stack) => stack.id));
  const blueprints = [];
  if (ids.has('frontend-react')) blueprints.push({
    id: 'react-feature-modules',
    directories: ['src/app', 'src/features/<feature>', 'src/entities/<entity>', 'src/shared/ui', 'src/shared/lib', 'src/shared/api'],
    rule: 'Keep feature-specific UI, state, API calls, and tests inside the feature; shared code must not depend on features.',
  });
  if (ids.has('backend-node')) blueprints.push({
    id: 'node-domain-modules',
    directories: ['src/bootstrap', 'src/modules/<domain>', 'src/platform', 'src/shared'],
    rule: 'Expose one module boundary per domain; transport handlers depend on application services, and infrastructure depends inward through interfaces.',
  });
  if (blueprints.length === 0) blueprints.push({
    id: 'generic-module-first',
    directories: ['src/app', 'src/modules/<domain>', 'src/shared'],
    rule: 'Organize by domain and dependency direction; avoid a single catch-all source directory.',
  });
  return blueprints;
}

function countLines(file) {
  try {
    return readText(file.absolute).split(/\r?\n/).length;
  } catch {
    return 0;
  }
}

export function assessArchitecture(scan) {
  const classification = classifyProject(scan);
  const source = sourceFiles(scan);
  const sourceRoots = [...new Set(source.map((file) => file.relative.split('/')[0]))].sort();
  const srcRootFiles = source.filter((file) => file.relative.startsWith('src/') && !file.relative.slice(4).includes('/'));
  const largeFiles = source.filter((file) => countLines(file) > 400).map((file) => file.relative).slice(0, 8);
  const topLevelKinds = new Set(srcRootFiles.map((file) => file.relative.split('/').at(-1).replace(/\.[^.]+$/, '').toLowerCase()));
  const mixedLayerNames = ['controller', 'service', 'repository', 'component', 'store'].filter((name) => [...topLevelKinds].some((value) => value.includes(name)));
  const findings = [];
  if (source.length === 0) {
    findings.push({ id: 'no-substantive-source', severity: 'info', evidence: [], message: 'No substantive application source was detected; propose a module-first scaffold before implementation.' });
  }
  if (srcRootFiles.length >= 8) {
    findings.push({ id: 'flat-source-root', severity: 'attention', evidence: srcRootFiles.slice(0, 8).map((file) => file.relative), message: 'Many source files are directly under src; introduce domain or feature modules before adding more cross-cutting code.' });
  }
  if (mixedLayerNames.length >= 3) {
    findings.push({ id: 'mixed-layer-root', severity: 'attention', evidence: srcRootFiles.slice(0, 8).map((file) => file.relative), message: `The source root mixes ${mixedLayerNames.join(', ')} concerns; separate transport, domain, and infrastructure boundaries by module.` });
  }
  if (largeFiles.length > 0) {
    findings.push({ id: 'large-source-files', severity: 'advisory', evidence: largeFiles, message: 'Large source files deserve an explicit responsibility review before adding more behavior.' });
  }
  const lifecycle = classification.codebase.lifecycle.value;
  return {
    schemaVersion: 1,
    sourceSummary: {
      sourceFileCount: source.length,
      sourceRoots,
      inspectedPaths: source.slice(0, 12).map((file) => file.relative),
    },
    findings,
    recommendedBlueprints: architectureBlueprint(scan.stacks).map((blueprint) => ({
      ...blueprint,
      status: lifecycle === 'ambiguous' ? 'conditional' : 'candidate',
      appliesWhen: lifecycle === 'ambiguous' ? 'only after the user confirms a greenfield lifecycle' : null,
    })),
    migrationOptions: lifecycle === 'ambiguous'
      ? [
          { id: 'confirm-project-lifecycle', writesBusinessCode: false, description: 'Confirm whether this scaffold is greenfield or existing before selecting a directory policy.' },
        ]
      : lifecycle === 'existing'
      ? [
          { id: 'advice-only', writesBusinessCode: false, description: 'Keep existing code unchanged and record recommendations only.' },
          { id: 'new-code-standard', writesBusinessCode: false, description: 'Keep existing code unchanged; require future code to follow the selected module blueprint.' },
          { id: 'staged-migration', writesBusinessCode: true, description: 'Create a separate approved modernization plan with bounded modules, compatibility checks, and rollback points.' },
          { id: 'keep-current', writesBusinessCode: false, description: 'Keep the current structure and do not add architecture governance rules.' },
        ]
      : [
          { id: 'module-first', writesBusinessCode: false, description: 'Use the proposed module blueprint before the first application feature is created.' },
        ],
    boundary: 'This assessment is advisory. It does not move files, rewrite business code, or authorize a migration.',
  };
}
