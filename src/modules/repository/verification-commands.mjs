import path from 'node:path';

export const VERIFICATION_COMMAND_SCHEMA_VERSION = 1;

export const VERIFICATION_COMMAND_TRUST_LEVELS = Object.freeze([
  'untrusted',
  'declared',
  'structurally-trusted',
  'execution-verified',
]);

const SOURCE_KINDS = new Set(['npm-script', 'maven-pom', 'declared']);
const TRUST_LEVELS = new Set(VERIFICATION_COMMAND_TRUST_LEVELS);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function invalid(message) {
  throw new TypeError(`Invalid verification command: ${message}`);
}

function safeRelative(value, label, { allowDot = false, allowGlob = false } = {}) {
  if (typeof value !== 'string' || !value || CONTROL.test(value) || path.isAbsolute(value)) invalid(`${label} must be a safe repository-relative path`);
  if (allowDot && value === '.') return value;
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').some((segment) => segment === '..' || segment === '')) invalid(`${label} must be a safe repository-relative path`);
  if (!allowGlob && /[*?{}[\]]/.test(normalized)) invalid(`${label} cannot contain glob syntax`);
  return normalized;
}

function stringList(value, label, { ids = false, globs = false } = {}) {
  if (!Array.isArray(value) || value.length > 128) invalid(`${label} must be a bounded array`);
  const normalized = value.map((entry) => {
    if (typeof entry !== 'string' || !entry || entry.length > 4096 || CONTROL.test(entry)) invalid(`${label} contains an invalid value`);
    if (ids && !ID.test(entry)) invalid(`${label} contains an invalid identifier`);
    return globs ? safeRelative(entry, label, { allowGlob: true }) : entry;
  });
  return [...new Set(normalized)];
}

/**
 * Normalize the portable, shell-free representation used by verification discovery.
 * This function is intentionally filesystem-free so callers can bind it to any scan.
 */
export function normalizeVerificationCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('input must be an object');
  if (input.schemaVersion !== undefined && input.schemaVersion !== VERIFICATION_COMMAND_SCHEMA_VERSION) invalid(`schemaVersion must be ${VERIFICATION_COMMAND_SCHEMA_VERSION}`);
  if (!ID.test(input.id ?? '')) invalid('id must be a stable identifier');
  if (!ID.test(input.unitId ?? '')) invalid('unitId must be a stable identifier');
  const cwd = safeRelative(input.cwd ?? '.', 'cwd', { allowDot: true });
  if (!Array.isArray(input.argv) || input.argv.length === 0 || input.argv.length > 64) invalid('argv must be a non-empty bounded array');
  const argv = input.argv.map((entry) => {
    if (typeof entry !== 'string' || !entry || entry.length > 4096 || CONTROL.test(entry)) invalid('argv contains an invalid argument');
    return entry;
  });

  const source = input.source;
  if (!source || typeof source !== 'object' || Array.isArray(source) || !SOURCE_KINDS.has(source.kind)) invalid('source.kind is unsupported');
  const normalizedSource = {
    kind: source.kind,
    path: safeRelative(source.path, 'source.path'),
  };
  if (source.sha256 !== undefined) {
    if (typeof source.sha256 !== 'string' || !SHA256.test(source.sha256)) invalid('source.sha256 must be a lowercase SHA-256 digest');
    normalizedSource.sha256 = source.sha256;
  }
  if (source.scriptName !== undefined) {
    if (typeof source.scriptName !== 'string' || !SCRIPT_NAME.test(source.scriptName)) invalid('source.scriptName is invalid');
    normalizedSource.scriptName = source.scriptName;
  }

  const purpose = stringList(input.purpose ?? [], 'purpose', { ids: true });
  const scopeGlobs = stringList(input.scopeGlobs ?? [], 'scopeGlobs', { globs: true });
  const sideEffects = stringList(input.sideEffects ?? [], 'sideEffects', { ids: true });
  const level = input.trust?.level ?? 'declared';
  if (!TRUST_LEVELS.has(level)) invalid('trust.level is unsupported');

  return {
    schemaVersion: VERIFICATION_COMMAND_SCHEMA_VERSION,
    id: input.id,
    unitId: input.unitId,
    cwd,
    argv,
    source: normalizedSource,
    purpose,
    scopeGlobs,
    sideEffects,
    trust: { level, reasons: [] },
  };
}

function executable(argv) {
  return path.basename(argv[0]).toLowerCase().replace(/\.cmd$/, '');
}

function npmScriptName(command) {
  if (command.source.kind === 'npm-script' && command.source.scriptName) return command.source.scriptName;
  const [binary, first, second] = [executable(command.argv), command.argv[1], command.argv[2]];
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(binary)) return null;
  if (first === 'run' || first === 'run-script') return second ?? null;
  if (binary === 'npm' && first === 'test') return 'test';
  if (['pnpm', 'yarn', 'bun'].includes(binary) && first && !first.startsWith('-')) return first;
  return null;
}

function addReason(reasons, code, severity, message) {
  if (!reasons.some((entry) => entry.code === code && entry.message === message)) reasons.push({ code, severity, message });
}

function addSideEffect(sideEffects, value) {
  if (!sideEffects.includes(value)) sideEffects.push(value);
}

function hasShellComposition(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote === "'") {
      if (character === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = null;
      else if (character === '`' || (character === '$' && text[index + 1] === '(')) return true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (';&|<>`\n\r'.includes(character) || (character === '$' && text[index + 1] === '(')) return true;
  }
  return false;
}

function shellWords(text) {
  const words = [];
  let current = '';
  let quote = null;
  let active = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\') {
      if (index + 1 >= text.length) return null;
      current += text[index + 1];
      active = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      active = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      active = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (active) words.push(current);
      current = '';
      active = false;
      continue;
    }
    current += character;
    active = true;
  }
  if (quote) return null;
  if (active) words.push(current);
  return words;
}

function argumentPresent(args, ...names) {
  return args.some((argument) => names.includes(argument) || names.some((name) => argument.startsWith(`${name}=`)));
}

function assessNpmRunner(body, reasons, sideEffects) {
  if (hasShellComposition(body)) {
    addReason(reasons, 'npm-shell-composition', 'blocking', 'The npm script uses shell composition, redirection, or substitution that cannot be structurally bounded.');
    return;
  }
  const words = shellWords(body);
  if (!words?.length) {
    addReason(reasons, 'npm-script-unparseable', 'warning', 'The npm script is empty or cannot be parsed as one shell-free command.');
    return;
  }
  const runner = path.basename(words[0]).toLowerCase().replace(/\.cmd$/, '');
  const args = words.slice(1);
  const fileDeletion = new Set(['rm', 'rmdir', 'del', 'erase', 'unlink', 'rimraf', 'shred']);
  const network = new Set(['curl', 'wget', 'ssh', 'scp', 'sftp', 'ftp', 'nc', 'ncat', 'telnet', 'rsync']);
  const external = new Set(['aws', 'gcloud', 'az', 'kubectl', 'helm', 'terraform', 'pulumi', 'vercel', 'firebase', 'netlify', 'heroku', 'docker', 'podman']);
  const arbitraryShell = new Set(['sh', 'bash', 'zsh', 'fish', 'cmd', 'cmd.exe', 'powershell', 'pwsh', 'npx', 'bunx']);
  if (fileDeletion.has(runner)) {
    addSideEffect(sideEffects, 'file-delete');
    addReason(reasons, 'npm-file-deletion', 'blocking', `npm script invokes file-deletion runner ${runner}.`);
    return;
  }
  if (network.has(runner)) {
    addSideEffect(sideEffects, 'network-access');
    addReason(reasons, 'npm-network-command', 'blocking', `npm script invokes network runner ${runner}.`);
    return;
  }
  if (external.has(runner)) {
    addSideEffect(sideEffects, 'external-action');
    addReason(reasons, 'npm-external-action', 'blocking', `npm script invokes cloud or external-action runner ${runner}.`);
    return;
  }
  if (arbitraryShell.has(runner)) {
    addSideEffect(sideEffects, 'arbitrary-command');
    addReason(reasons, 'npm-external-command', 'blocking', `npm script delegates to unbounded command runner ${runner}.`);
    return;
  }

  if (runner === 'node') {
    if (argumentPresent(args, '-e', '--eval', '-p', '--print')) {
      addSideEffect(sideEffects, 'arbitrary-code');
      addReason(reasons, 'npm-node-eval', 'blocking', 'Node evaluation flags can execute arbitrary code and are not a structurally bounded verification runner.');
    } else if (!args.includes('--test')) {
      addReason(reasons, 'npm-runner-arguments-unproven', 'warning', 'Node is trusted only with the built-in --test runner; arbitrary script entrypoints remain declared.');
    }
    return;
  }
  if (runner === 'vitest') {
    if (args[0] !== 'run' && !args.includes('--run')) addReason(reasons, 'npm-runner-arguments-unproven', 'warning', 'Vitest is trusted only in explicit run mode.');
    return;
  }
  if (runner === 'jest') return;
  if (['mocha', 'ava', 'tap', 'pytest'].includes(runner)) return;
  if (runner === 'python' || runner === 'python3') {
    if (!(args[0] === '-m' && args[1] === 'pytest')) addReason(reasons, 'npm-runner-arguments-unproven', 'warning', 'Python is trusted only for the explicit -m pytest runner.');
    return;
  }
  if (runner === 'go') {
    if (args[0] !== 'test') addReason(reasons, 'npm-runner-arguments-unproven', 'warning', 'Go is trusted only for the test subcommand.');
    return;
  }
  if (runner === 'cargo') {
    if (args[0] !== 'test') addReason(reasons, 'npm-runner-arguments-unproven', 'warning', 'Cargo is trusted only for the test subcommand.');
    return;
  }
  if (runner === 'eslint') {
    if (argumentPresent(args, '--cache', '--cache-location', '--output-file', '-o')) {
      addSideEffect(sideEffects, 'file-write');
      addReason(reasons, 'npm-runner-arguments-unproven', 'warning', 'ESLint cache and output-file modes write files and remain declared.');
    }
    return;
  }
  if (runner === 'tsc' || runner === 'vue-tsc') {
    if (!args.includes('--noEmit')) addReason(reasons, 'npm-runner-arguments-unproven', 'warning', `${runner} is trusted only with --noEmit.`);
    return;
  }
  if (['vite', 'next', 'nuxt'].includes(runner) && args[0] === 'build') {
    addSideEffect(sideEffects, 'build-output');
    return;
  }
  if (['webpack', 'rollup'].includes(runner)) {
    addSideEffect(sideEffects, 'build-output');
    return;
  }
  addReason(reasons, 'npm-runner-unsupported', 'warning', `npm script runner ${runner} is not on the structural verification allowlist.`);
}

function npmTrust(command, evidence, reasons, sideEffects) {
  const scriptName = npmScriptName(command);
  const scripts = evidence.npmScripts ?? evidence.packageJson?.scripts;
  if (!scriptName) {
    addReason(reasons, 'npm-script-unresolved', 'warning', 'The npm-family script name could not be resolved from argv and source metadata.');
    return true;
  }
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    addReason(reasons, 'npm-script-body-unavailable', 'warning', `The body of npm script ${scriptName} was not supplied for structural review.`);
    return true;
  }
  const body = scripts[scriptName];
  if (typeof body !== 'string') {
    addReason(reasons, 'npm-script-missing', 'blocking', `The declared npm script ${scriptName} does not exist.`);
    return true;
  }
  const commandText = `${body} ${command.argv.slice(1).join(' ')}`;

  for (const hook of [`pre${scriptName}`, `post${scriptName}`]) {
    if (typeof scripts[hook] !== 'string') continue;
    addSideEffect(sideEffects, 'implicit-lifecycle-hook');
    addReason(reasons, 'npm-lifecycle-hook', 'blocking', `npm script ${scriptName} has implicit lifecycle hook ${hook}.`);
  }

  const normalizedName = scriptName.toLowerCase();
  if (/(^|[:._-])(watch|dev|serve|start)(?=$|[:._-])/.test(normalizedName)
    || /(^|\s)(?:--watch(?:all)?(?:=\S+)?|vite(?!\s+build(?:\s|$))(?:\s|$)|next\s+dev\b|nuxt\s+dev\b|webpack\s+serve\b|react-scripts\s+start\b)/i.test(commandText)) {
    addSideEffect(sideEffects, 'non-terminating-process');
    addReason(reasons, 'npm-non-terminating-script', 'blocking', `npm script ${scriptName} starts a watch or development process.`);
  }
  if (/(^|\s)--fix(?:=\S+)?(?=\s|$)/i.test(commandText) && !/(^|\s)--fix-dry-run(?=\s|$)/i.test(commandText)) {
    addSideEffect(sideEffects, 'source-write');
    addReason(reasons, 'npm-fix-writes-source', 'blocking', `npm script ${scriptName} enables a source-writing --fix mode.`);
  }
  if (/(^|\s)--write(?:=\S+)?(?=\s|$)/i.test(commandText)) {
    addSideEffect(sideEffects, 'source-write');
    addReason(reasons, 'npm-write-writes-source', 'blocking', `npm script ${scriptName} enables a source-writing --write mode.`);
  }
  if (/(^|[:._-])(publish|deploy)(?=$|[:._-])/.test(normalizedName)
    || /\b(?:npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish|firebase\s+deploy|vercel(?:\s+deploy|\s+--prod)|kubectl\s+(?:apply|delete)|helm\s+(?:upgrade|install)|terraform\s+(?:apply|destroy)|semantic-release|release-it)\b/i.test(commandText)) {
    addSideEffect(sideEffects, 'external-action');
    addReason(reasons, 'npm-external-action', 'blocking', `npm script ${scriptName} can publish, release, or deploy.`);
  }
  const separator = command.argv.indexOf('--');
  const forwarded = separator >= 0 ? command.argv.slice(separator + 1) : [];
  assessNpmRunner([body, ...forwarded].join(' '), reasons, sideEffects);
  return true;
}

function commandProperties(argv) {
  const values = new Map();
  for (const argument of argv.slice(1)) {
    const match = argument.match(/^-D([^=]+)(?:=(.*))?$/);
    if (match) values.set(match[1], match[2] ?? 'true');
  }
  return values;
}

function activeMavenProfiles(argv) {
  const profiles = [];
  for (let index = 1; index < argv.length; index += 1) {
    let value = null;
    if (argv[index] === '-P' || argv[index] === '--activate-profiles') value = argv[index + 1];
    else if (argv[index].startsWith('-P') && argv[index].length > 2) value = argv[index].slice(2);
    else if (argv[index].startsWith('--activate-profiles=')) value = argv[index].slice('--activate-profiles='.length);
    if (!value) continue;
    for (const profile of value.split(',').map((entry) => entry.trim()).filter(Boolean)) {
      if (!profile.startsWith('!') && !profile.startsWith('-')) profiles.push(profile);
    }
  }
  return profiles;
}

function xmlValues(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...xml.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'gi'))]
    .map((match) => match[1].trim());
}

function pomSections(pomText, activeProfiles) {
  const profiles = new Map();
  const profilePattern = /<profile(?:\s[^>]*)?>([\s\S]*?)<\/profile>/gi;
  for (const match of pomText.matchAll(profilePattern)) {
    const id = xmlValues(match[1], 'id')[0];
    if (id) profiles.set(id, { text: match[1], activeByDefault: xmlValues(match[1], 'activeByDefault').some((value) => /^true$/i.test(value)) });
  }
  const base = pomText.replace(/<profiles(?:\s[^>]*)?>[\s\S]*?<\/profiles>/gi, '');
  const active = new Set(activeProfiles);
  return [
    base,
    ...[...profiles.entries()]
      .filter(([id, profile]) => active.has(id) || profile.activeByDefault)
      .map(([, profile]) => profile.text),
  ];
}

function resolvedPomValue(sections, tags) {
  const tagList = Array.isArray(tags) ? tags : [tags];
  const propertyValues = new Map();
  for (const section of sections) {
    for (const match of section.matchAll(/<([A-Za-z_][A-Za-z0-9_.-]*)>([^<>]*)<\/\1>/g)) propertyValues.set(match[1], match[2].trim());
  }
  const values = sections.flatMap((section) => tagList.flatMap((tag) => xmlValues(section, tag)));
  if (values.length === 0) return { status: 'absent', value: 'false' };
  let value = values.at(-1);
  const seen = new Set();
  while (/^\$\{[^}]+}$/.test(value)) {
    const key = value.slice(2, -1);
    if (seen.has(key) || !propertyValues.has(key)) return { status: 'unresolved', value };
    seen.add(key);
    value = propertyValues.get(key);
  }
  if (!/^(?:true|false)$/i.test(value)) return { status: 'unresolved', value };
  return { status: 'resolved', value: value.toLowerCase() };
}

function commandBoolean(properties, names) {
  for (const name of names) {
    if (!properties.has(name)) continue;
    const value = properties.get(name);
    return /^(?:true|false)$/i.test(value) ? { status: 'resolved', value: value.toLowerCase() } : { status: 'unresolved', value };
  }
  return null;
}

function mavenModelArguments(model, reasons) {
  const config = model?.mavenConfig;
  if (!config || !['absent', 'parsed'].includes(config.status)) {
    addReason(reasons, 'maven-effective-model-incomplete', 'warning', 'The .mvn/maven.config state is not proven absent or fully parsed.');
    return [];
  }
  if (config.status === 'absent') return [];
  if (typeof config.text !== 'string' || hasShellComposition(config.text)) {
    addReason(reasons, 'maven-config-unparseable', 'warning', '.mvn/maven.config could not be parsed into bounded Maven arguments.');
    return [];
  }
  const words = shellWords(config.text.replace(/^\s*#.*$/gm, ''));
  if (!words) {
    addReason(reasons, 'maven-config-unparseable', 'warning', '.mvn/maven.config contains unsupported quoting.');
    return [];
  }
  return words;
}

function completePomEvidence(pomText, model, reasons) {
  const documents = [];
  const hasParent = /<parent(?:\s[^>]*)?>[\s\S]*?<\/parent>/i.test(pomText);
  const moduleCount = xmlValues(pomText, 'module').length;
  const hasModules = moduleCount > 0;
  const parents = model?.parents;
  const modules = model?.modules;
  if (hasParent && (parents?.status !== 'complete' || !Array.isArray(parents.pomTexts) || parents.pomTexts.length === 0)) {
    addReason(reasons, 'maven-parent-model-incomplete', 'warning', 'The parent POM hierarchy is not fully available for effective-model review.');
  }
  if (hasModules && (modules?.status !== 'complete' || !Array.isArray(modules.pomTexts) || modules.pomTexts.length < moduleCount)) {
    addReason(reasons, 'maven-module-model-incomplete', 'warning', 'The reactor module POMs are not fully available for effective-model review.');
  }
  if (!model || parents?.status !== 'complete' || modules?.status !== 'complete') {
    addReason(reasons, 'maven-effective-model-incomplete', 'warning', 'Maven parent, module, and local config completeness was not attested by the scanner.');
  }
  documents.push([...(parents?.status === 'complete' ? parents.pomTexts ?? [] : []), pomText].join('\n'));
  if (modules?.status === 'complete') documents.push(...(modules.pomTexts ?? []));
  return documents;
}

function evaluateMavenSettings(argv, pomText, reasons) {
  const properties = commandProperties(argv);
  const sections = pomSections(pomText, activeMavenProfiles(argv));
  const settings = [
    { tags: ['skipTests'], properties: ['skipTests'], code: 'maven-skip-tests', message: 'Maven skipTests is true, so the command does not execute tests.' },
    { tags: ['maven.test.skip'], properties: ['maven.test.skip'], code: 'maven-test-skip', message: 'Maven maven.test.skip is true, so tests are not compiled or executed.' },
    { tags: ['testFailureIgnore', 'maven.test.failure.ignore'], properties: ['maven.test.failure.ignore', 'testFailureIgnore'], code: 'maven-test-failure-ignore', message: 'Maven testFailureIgnore is true, so failing tests may still return success.' },
  ];
  for (const setting of settings) {
    const result = commandBoolean(properties, setting.properties) ?? resolvedPomValue(sections, setting.tags);
    if (result.status === 'unresolved') addReason(reasons, `${setting.code}-unresolved`, 'warning', `Maven ${setting.tags[0]} could not be resolved from the supplied model.`);
    else if (result.value === 'true') addReason(reasons, setting.code, 'blocking', setting.message);
  }
}

function mavenTrust(command, evidence, reasons) {
  const configArgs = mavenModelArguments(evidence.mavenModel, reasons);
  const effectiveArgv = [command.argv[0], ...configArgs, ...command.argv.slice(1)];
  const goals = effectiveArgv.slice(1).filter((argument) => !argument.startsWith('-'));
  if (!goals.some((goal) => /^(?:test|verify|integration-test)$/.test(goal) || /:(?:test|verify)$/.test(goal))) {
    addReason(reasons, 'maven-verification-goal-missing', 'blocking', 'The Maven command does not select a test or verify lifecycle goal.');
  }
  const pomText = evidence.pomText;
  if (typeof pomText !== 'string') {
    addReason(reasons, 'maven-model-unavailable', 'warning', 'The Maven POM model was not supplied for structural review.');
    return true;
  }
  for (const document of completePomEvidence(pomText, evidence.mavenModel, reasons)) evaluateMavenSettings(effectiveArgv, document, reasons);
  return true;
}

/**
 * Evaluate only structural trust. It never executes a command and therefore never
 * returns execution-verified.
 */
export function evaluateVerificationCommandTrust(input, evidence = {}) {
  const command = normalizeVerificationCommand(input);
  const reasons = [];
  const sideEffects = [...command.sideEffects];
  const binary = executable(command.argv);
  let recognized = false;
  if (command.source.kind === 'npm-script' || ['npm', 'pnpm', 'yarn', 'bun'].includes(binary)) recognized = npmTrust(command, evidence, reasons, sideEffects);
  if (command.source.kind === 'maven-pom' || ['mvn', 'mvnw'].includes(binary)) recognized = mavenTrust(command, evidence, reasons);
  if (!recognized) addReason(reasons, 'verification-runner-unsupported', 'warning', 'No structural trust evaluator exists for this command runner.');

  const level = reasons.some((entry) => entry.severity === 'blocking')
    ? 'untrusted'
    : reasons.some((entry) => entry.severity === 'warning') ? 'declared' : 'structurally-trusted';
  return {
    ...command,
    sideEffects: sideEffects.sort(),
    trust: { level, reasons: reasons.sort((left, right) => left.code.localeCompare(right.code) || left.message.localeCompare(right.message)) },
  };
}
