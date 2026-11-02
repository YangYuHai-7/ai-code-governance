import fs from 'node:fs';
import { evaluateRoleDisclosureReplay } from '../test-support/role-disclosure/replay.mjs';

try {
  if (process.argv.length !== 3) throw new TypeError('One local replay JSON path is required');
  const input = process.argv[2];
  const stat = fs.statSync(input);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new TypeError('Replay input must be a file under 2 MiB');
  const events = JSON.parse(fs.readFileSync(input, 'utf8'));
  const result = evaluateRoleDisclosureReplay(events);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'pass') process.exitCode = 1;
} catch {
  // Transcript text and local paths must not leak into diagnostic output.
  process.stdout.write(`${JSON.stringify({ status: 'invalid', turns: 0, findings: [], error: 'Invalid replay input' })}\n`);
  process.exitCode = 2;
}
