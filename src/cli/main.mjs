import { parseArgs } from './args.mjs';
import { dispatchCommand } from './command-registry.mjs';

export async function run(argv) {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major < 22) throw new Error(`Node.js 22 or newer is required; current version is ${process.versions.node}.`);
  return dispatchCommand(parseArgs(argv));
}
