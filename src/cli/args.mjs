import { usageError } from '../utils.mjs';
import { BOOLEAN_FLAGS, COMMAND_FLAGS, COMMAND_NAMES, VALUE_FLAGS } from './command-specs.mjs';

export { HELP } from './help.mjs';

export function parseArgs(argv) {
  const args = [...argv];
  if (args.length === 0) return { command: 'help', target: '.', options: {} };
  if (args[0] === '--help' || args[0] === '-h') return { command: 'help', target: '.', options: {} };
  if (args[0] === '--version' || args[0] === '-V') return { command: 'version', target: '.', options: {} };

  const command = args.shift();
  if (!COMMAND_NAMES.includes(command)) throw usageError(`Unknown command: ${command}`);

  let action = null;
  if (command === 'hook') {
    action = args.shift() ?? null;
    if (!['install', 'status'].includes(action)) throw usageError('hook requires an action: install or status.');
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
  return action ? { command, action, target, options } : { command, target, options };
}
