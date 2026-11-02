import fs from 'node:fs';
import path from 'node:path';
import { runGit } from '../../adapters/process/index.mjs';

const gitOptions = { timeout: 5000, maxBuffer: 256 * 1024 };
const text = (locale, en, zh) => locale === 'zh-CN' ? zh : en;

function baseline(scan) {
  if (scan.environmentProbe !== 'executed') return { status: 'not-probed', relationship: 'unknown' };
  if (scan.git?.availability !== 'detected') return { status: 'command-required', relationship: 'unknown' };
  if (!scan.gitRoot) return { status: 'repository-required', relationship: 'none' };
  let member;
  try { member = path.relative(fs.realpathSync(scan.gitRoot), fs.realpathSync(scan.root)).split(path.sep).join('/'); }
  catch { return { status: 'unverified', relationship: 'unknown' }; }
  let relationship = 'own';
  if (member) {
    const tracked = runGit(scan.gitRoot, ['ls-files', '-z', '--', member], gitOptions);
    if (tracked.error || tracked.status !== 0) return { status: 'unverified', relationship: 'ancestor' };
    if (!tracked.stdout.trim()) {
      const ignored = runGit(scan.gitRoot, ['check-ignore', '--', member], gitOptions);
      return { status: ignored.status === 0 ? 'project-boundary-required' : 'project-boundary-unverified', relationship: 'ancestor' };
    }
    relationship = 'ancestor-tracked';
  }
  const head = runGit(scan.gitRoot, ['rev-parse', '--verify', 'HEAD^{commit}'], gitOptions);
  return { status: head.error || head.status !== 0 ? 'initial-commit-required' : 'ready', relationship };
}

function manifestText(file) {
  try {
    if (file.type !== 'file' || file.contentScannable === false || fs.lstatSync(file.absolute).isSymbolicLink()) return null;
    if (fs.statSync(file.absolute).size > 256 * 1024) return null;
    return fs.readFileSync(file.absolute, 'utf8');
  } catch { return null; }
}

/** File evidence and existing environment facts only; no scripts, installs, or network probes. */
export function diagnosePrerequisites(scan, { locale = 'en' } = {}) {
  const gitBaseline = baseline(scan);
  const toolchains = [];
  const dependencies = [];
  const databaseSignals = new Set();
  const seen = new Set();
  for (const file of scan.files ?? []) {
    const name = path.basename(file.relative);
    const runtime = name === 'package.json' ? 'node' : name === 'pom.xml' || /^build\.gradle(?:\.kts)?$/.test(name) ? 'java'
      : ['pyproject.toml', 'requirements.txt', 'Pipfile'].includes(name) ? 'python'
        : ['Gemfile', 'Gemfile.lock'].includes(name) ? 'ruby' : name === 'go.mod' ? 'go' : name === 'Cargo.toml' ? 'rust' : null;
    if (!runtime) continue;
    const content = manifestText(file);
    if (content === null) continue;
    const directory = path.dirname(file.relative);
    const key = `${directory}:${runtime}`;
    if (!seen.has(key)) {
      seen.add(key);
      let requestedVersion = null;
      if (runtime === 'node') {
        try { requestedVersion = JSON.parse(content)?.engines?.node ?? null; } catch { /* Invalid metadata cannot establish a version requirement. */ }
      }
      toolchains.push({ id: runtime, manifest: file.relative, status: runtime === 'node' ? 'current-process-detected' : 'not-probed', version: runtime === 'node' ? process.versions.node : null, requestedVersion, compatibility: 'not-verified' });
      const dependencyDir = runtime === 'node' ? path.join(scan.root, directory, 'node_modules') : null;
      const lockNames = runtime === 'node' ? ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']
        : runtime === 'python' ? ['poetry.lock', 'uv.lock', 'Pipfile.lock'] : runtime === 'ruby' ? ['Gemfile.lock'] : runtime === 'rust' ? ['Cargo.lock'] : runtime === 'go' ? ['go.sum'] : [];
      const locks = lockNames.filter((lock) => fs.existsSync(path.join(scan.root, directory, lock))).map((lock) => path.join(directory, lock).split(path.sep).join('/'));
      dependencies.push({ manifest: file.relative, locks, status: dependencyDir ? fs.existsSync(dependencyDir) ? 'directory-present-unverified' : 'installation-not-observed' : 'not-verified' });
    }
    if (/\b(?:pg|postgresql|postgres|psycopg\w*|asyncpg|pgx)\b/i.test(content)) databaseSignals.add('postgresql');
    if (/\b(?:mysql\w*|mariadb\w*|pymysql)\b/i.test(content)) databaseSignals.add('mysql-compatible');
    if (/\b(?:sqlite\w*|better-sqlite3)\b/i.test(content)) databaseSignals.add('sqlite');
    if (/\b(?:mongodb|mongoose|pymongo)\b/i.test(content)) databaseSignals.add('mongodb');
  }
  const database = { status: databaseSignals.size ? 'detected-unverified' : 'not-detected', signals: [...databaseSignals].sort(), connection: 'not-probed' };
  return localizePrerequisites({ gitBaseline, toolchains, dependencies, database }, { locale });
}

/** Translate captured facts without accessing files, commands, or the environment. */
export function localizePrerequisites(facts, { locale = 'en' } = {}) {
  const { gitBaseline, toolchains, dependencies, database } = facts;
  const diagnostics = [];
  const gitCauses = {
    'not-probed': ['Repository commands were not probed.', '尚未探测版本仓库命令。'],
    'command-required': ['The Git executable was not detected.', '未检测到版本仓库命令。'],
    'repository-required': ['This directory has no detected repository.', '此目录尚未检测到版本仓库。'],
    'initial-commit-required': ['The repository has no readable initial commit.', '版本仓库还没有可读取的初始提交。'],
    'project-boundary-required': ['This ignored project is not tracked by its ancestor repository.', '此项目被上层仓库忽略，不能借用上层仓库的基线。'],
    'project-boundary-unverified': ['The ancestor repository does not track this project; ownership is unconfirmed.', '上层仓库尚未跟踪此项目，项目归属还未确认。'],
    unverified: ['The repository baseline could not be read reliably.', '无法可靠读取仓库基线。'],
  };
  if (gitBaseline.status !== 'ready') diagnostics.push({
    id: 'git-baseline', status: gitBaseline.status,
    cause: text(locale, ...(gitCauses[gitBaseline.status] ?? gitCauses.unverified)),
    affectedCapability: text(locale, 'Formal completion/change-set binding only; document preparation and local tests can still proceed.', '影响正式完成记录和变更集绑定；文档准备与本地测试仍可继续。'),
    nextSafeAction: text(locale, 'Confirm the intended project/repository boundary with its maintainer, review its history and files, then explicitly decide how to establish a baseline. No repository or commit was created.', '先与维护者确认项目与仓库边界、检查历史和文件，再明确决定如何建立基线；本次未创建仓库或提交。'),
  });
  if (toolchains.length) diagnostics.push({
    id: 'project-toolchain', status: 'not-verified',
    cause: text(locale, 'Project manifests declare runtimes; their project build compatibility has not been tested.', '项目声明了运行环境，但尚未验证项目构建兼容性。'),
    affectedCapability: text(locale, 'Project builds and native test execution, not governance document checks.', '影响项目构建和原生测试，不影响治理文档检查。'),
    nextSafeAction: text(locale, 'Review each manifest and requested version, confirm the selected local toolchain, then explicitly choose a safe build/test command. No project script was run.', '检查各项目声明及版本要求，确认选定的本地工具链后，再明确选择安全的构建或测试命令；本次未运行项目脚本。'),
  });
  if (dependencies.length) diagnostics.push({
    id: 'project-dependencies', status: 'not-verified',
    cause: text(locale, 'Manifest, lockfile, and dependency-directory presence cannot prove dependencies are installed or compatible.', '声明、锁文件和依赖目录的存在不代表依赖已正确安装或兼容。'),
    affectedCapability: text(locale, 'Dependency-dependent builds and tests.', '影响需要依赖的构建与测试。'),
    nextSafeAction: text(locale, 'Review the lockfile, package manager and lifecycle scripts before requesting any installation; then verify with the selected native command.', '安装前先检查锁文件、包管理器及生命周期脚本并取得明确选择，再用选定的原生命令验证。'),
  });
  if (database.signals.length) diagnostics.push({
    id: 'project-database', status: 'detected-unverified',
    cause: text(locale, 'Database-related manifest signals were found; no service, credentials, schema, or connection was tested.', '项目声明中发现数据库相关信号；尚未测试服务、凭据、表结构或连接。'),
    affectedCapability: text(locale, 'Database-dependent integration tests only; this is not a global doctor failure.', '仅影响数据库相关集成测试，不构成全局诊断失败。'),
    nextSafeAction: text(locale, 'Confirm whether the selected tests need a database and obtain an approved isolated test environment before connecting. Do not use production credentials.', '先确认所选测试是否需要数据库；连接前确认获准的隔离测试环境，不使用生产凭据。'),
  });
  return { gitBaseline, toolchains, dependencies, database, diagnostics,
    boundary: text(locale, 'Advisory file/environment evidence only. No project scripts, installations, repository initialization, commits, or database requests ran. Ready baseline does not mean verified application.', '仅提供文件和环境证据建议，未执行项目脚本、安装、仓库初始化、提交或数据库请求；基线可读不等于应用已验证。') };
}
