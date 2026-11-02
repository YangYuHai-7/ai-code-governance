import { spawnSync } from "node:child_process";

// Idempotent reset: the evaluation workflow has to start from a known state every time, and an
// ON CONFLICT DO NOTHING seed silently leaves a previous run's state in place.
const psql = process.env.PSQL_BIN ?? "psql";
const database = process.env.PGDATABASE ?? "tracker";
const sql = [
  "DELETE FROM audit_entries",
  "DELETE FROM work_items WHERE id <> 'cccccccc-1111-1111-1111-111111111111'",
  "DELETE FROM boards WHERE id <> 'aaaaaaaa-1111-1111-1111-111111111111'",
  "DELETE FROM organizations WHERE id <> '11111111-1111-1111-1111-111111111111'",
  "INSERT INTO organizations (id, name) VALUES ('11111111-1111-1111-1111-111111111111','Org A') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name",
  "INSERT INTO boards (id, organization_id, title) VALUES ('aaaaaaaa-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','Sprint A') ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title",
  "INSERT INTO work_items (id, organization_id, board_id, title, state, version) VALUES ('cccccccc-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','aaaaaaaa-1111-1111-1111-111111111111','Draft item A','todo',1) ON CONFLICT (id) DO UPDATE SET state = 'todo', version = 1, title = EXCLUDED.title",
].join("; ");
const result = spawnSync(
  psql,
  ["-d", database, "-v", "ON_ERROR_STOP=1", "-c", sql],
  { encoding: "utf8" },
);
if (result.status !== 0) {
  process.stderr.write(
    `seed failed: ${result.stderr?.trim() || result.error?.message || "unknown error"}\n`,
  );
  process.exit(1);
}
process.stdout.write("seed reset to todo/version 1\n");
