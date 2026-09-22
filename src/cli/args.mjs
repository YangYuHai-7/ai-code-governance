import { usageError } from '../kernel/index.mjs';
import { BOOLEAN_FLAGS, COMMAND_FLAGS, COMMAND_NAMES, VALUE_FLAGS } from './command-specs.mjs';

export { HELP } from './help.mjs';

function defaultInteractionLocale(environment, runtimeLocale) {
  const locale = environment.LC_ALL || environment.LC_MESSAGES || environment.LANG || runtimeLocale || '';
  return /^zh(?:[_-]|$)/i.test(locale) ? 'zh-CN' : 'en';
}

export function parseArgs(argv, {
  environment = process.env,
  runtimeLocale = Intl.DateTimeFormat().resolvedOptions().locale,
  interactive = Boolean(process.stdin.isTTY),
} = {}) {
  const args = [...argv];
  if (args.length === 0) {
    // Page-first: a bare `aicg` in an interactive terminal opens the visual editor. Headless
    // callers keep the explicit guided-init surface so a script never starts a server.
    if (interactive) return { command: 'config', action: 'open', target: '.', options: {} };
    return {
      command: 'init',
      target: '.',
      options: { guided: true, locale: defaultInteractionLocale(environment, runtimeLocale) },
    };
  }
  if (args[0] === '--help' || args[0] === '-h') return { command: 'help', target: '.', options: {} };
  if (args[0] === '--version' || args[0] === '-V') return { command: 'version', target: '.', options: {} };

  const command = args.shift();
  if (!COMMAND_NAMES.includes(command)) throw usageError(`Unknown command: ${command}`);

  let action = null;
  let subAction = null;
  if (command === 'config') {
    action = args.shift() ?? null;
    if (!['init', 'validate', 'open', 'launcher'].includes(action)) throw usageError('config requires an action: init, validate, open, or launcher.');
  } else if (command === 'delivery') {
    action = args.shift() ?? null;
    if (!['work-unit', 'test-case', 'complete', 'hook', 'release-check'].includes(action)) throw usageError('delivery requires an action: work-unit, test-case, complete, hook, or release-check.');
    const SUB_ACTIONS = { 'work-unit': ['plan', 'status'], 'test-case': ['init', 'validate', 'select', 'record'], hook: ['install', 'status'] };
    if (SUB_ACTIONS[action]) {
      subAction = args.shift() ?? null;
      if (!SUB_ACTIONS[action].includes(subAction)) throw usageError(`delivery ${action} requires an action: ${SUB_ACTIONS[action].join(', ')}.`);
    }
  } else if (command === 'work-unit') {
    action = args.shift() ?? null;
    if (!['plan', 'status'].includes(action)) throw usageError('work-unit requires an action: plan or status.');
  } else if (command === 'test-case') {
    action = args.shift() ?? null;
    if (!['init', 'validate', 'select', 'record'].includes(action)) throw usageError('test-case requires an action: init, validate, select, or record.');
  } else if (command === 'hook') {
    action = args.shift() ?? null;
    if (!['install', 'status'].includes(action)) throw usageError('hook requires an action: install or status.');
  } else if (command === 'evidence') {
    action = args.shift() ?? null;
    if (!['record', 'status', 'export'].includes(action)) throw usageError('evidence requires an action: record, status, or export.');
  }

  let target = '.';
  let targetSet = false;
  const options = {};
  while (args.length > 0) {
    const token = args.shift();
    if (!token.startsWith('-')) {
      if (targetSet) throw usageError(`Unexpected positional argument: ${token}`);
      target = token;
      targetSet = true;
      continue;
    }
    const normalized = token.replace(/^--?/, '');
    const equals = normalized.indexOf('=');
    const name = equals === -1 ? normalized : normalized.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : normalized.slice(equals + 1);
    if (!VALUE_FLAGS.has(name) && !BOOLEAN_FLAGS.has(name)) throw usageError(`Unknown option: ${token}`);
    if (VALUE_FLAGS.has(name)) {
      const value = inlineValue ?? args.shift();
      if (!value || value.startsWith('--')) throw usageError(`Option --${name} requires a value.`);
      options[name] = value;
    } else {
      if (inlineValue !== undefined) throw usageError(`Option --${name} does not accept a value.`);
      options[name] = true;
    }
  }
  for (const name of Object.keys(options)) {
    if (!COMMAND_FLAGS[command].has(name)) throw usageError(`Option --${name} is not valid for ${command}.`);
  }
  if (command === 'config' && action === 'launcher') {
    if (targetSet) throw usageError('config launcher does not take a project path; use --output <absolute-directory> for a custom launcher location.');
    for (const name of Object.keys(options)) {
      if (!['yes', 'json', 'output', 'help'].includes(name)) throw usageError(`Option --${name} is not valid for config launcher.`);
    }
  }
  if (command === 'config' && action === 'open' && !targetSet) target = null;
  if (action) return { command, action, ...(subAction ? { subAction } : {}), target, options };
  return { command, target, options };
}
