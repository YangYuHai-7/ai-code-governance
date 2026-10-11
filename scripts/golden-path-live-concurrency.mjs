import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Lost updates only appear when several API processes share one database, so this check drives
// exactly that: it seeds its own tenant, board, and item, then fires concurrent writers that all
// claim the same version and requires exactly one acceptance, one version increment, and one audit
// row. It fails closed when the ports are not serving.
const read = (name, fallback) => {
  const index = process.argv.indexOf('--' + name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const ports = (read('ports', '3103,3104,3105')).split(',').map((value) => Number(value.trim()));
const writers = Number(read('writers', String(ports.length * 2)));
const database = read('database', process.env.PGDATABASE ?? 'tracker');
const psql = process.env.PSQL_BIN ?? read('psql', 'psql');
const host = read('host', '127.0.0.1');
const tenant = randomUUID();
const board = randomUUID();
const item = randomUUID();

function sql(statement) {
  const result = spawnSync(psql, ['-d', database, '-v', 'ON_ERROR_STOP=1', '-tAc', statement], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('psql failed: ' + (result.stderr ?? '').trim());
  return (result.stdout ?? '').trim();
}

const health = await Promise.all(
  ports.map(async (port) => {
    try {
      const response = await fetch('http://' + host + ':' + port + '/health', { signal: AbortSignal.timeout(5000) });
      return response.status;
    } catch {
      return 0;
    }
  }),
);
if (health.some((status) => status !== 200)) {
  process.stderr.write('this check requires every API process to be serving; health: ' + JSON.stringify(health) + '\n');
  process.exit(1);
}

sql("INSERT INTO organizations (id, name) VALUES ('" + tenant + "', 'Concurrency tenant')");
sql("INSERT INTO boards (id, organization_id, title) VALUES ('" + board + "', '" + tenant + "', 'Concurrency board')");
sql("INSERT INTO work_items (id, organization_id, board_id, title, state, version) VALUES ('" + item + "', '" + tenant + "', '" + board + "', 'Concurrency item', 'todo', 1)");

const body = JSON.stringify({ organizationId: tenant, actorId: 'member-synthetic-1', boardId: board, state: 'in-progress', expectedVersion: 1 });
const attempts = await Promise.all(
  Array.from({ length: writers }, (_value, index) => {
    const port = ports[index % ports.length];
    return fetch('http://' + host + ':' + port + '/work-items/' + item, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body,
    }).then((response) => response.status);
  }),
);

const accepted = attempts.filter((status) => status === 200).length;
const refused = attempts.filter((status) => status === 409).length;
const version = Number(sql("SELECT version FROM work_items WHERE id = '" + item + "'"));
const audits = Number(sql("SELECT count(*) FROM audit_entries WHERE item_id = '" + item + "'"));
const receipt = {
  check: 'concurrent-writers-one-version',
  platform: process.platform,
  processes: ports.length,
  writers,
  accepted,
  refused,
  version,
  audits,
  passed: accepted === 1 && refused === writers - 1 && version === 2 && audits === 1,
};
const target = process.env.AICG_CONCURRENCY_RECEIPT;
if (typeof target === 'string' && target.length > 0) fs.writeFileSync(path.resolve(target), JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(JSON.stringify(receipt) + '\n');
process.exit(receipt.passed ? 0 : 1);