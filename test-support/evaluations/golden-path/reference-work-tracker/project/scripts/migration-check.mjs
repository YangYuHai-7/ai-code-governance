import { spawnSync } from "node:child_process";

// The migration gate has to apply the migration and prove transaction semantics, not grep the SQL.
// It works in a scratch schema so the evidence run never touches evaluation data, and it fails
// closed when the database is unreachable or when a rejected transaction leaves objects behind.
const psql = process.env.PSQL_BIN ?? "psql";
const database = process.env.PGDATABASE ?? "tracker";
const schema = `migration_probe_${process.pid}`;

function run(extra) {
  return spawnSync(psql, ["-d", database, "-v", "ON_ERROR_STOP=1", ...extra], {
    encoding: "utf8",
  });
}

if (
  typeof process.env.PSQL_BIN !== "string" &&
  process.env.PGHOST === undefined
) {
  process.stderr.write(
    "this gate requires PostgreSQL: set PSQL_BIN or the PG* variables\n",
  );
  process.exit(1);
}

const setup = run([
  "-c",
  `DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`,
]);
if (setup.status !== 0) {
  process.stderr.write(
    `the scratch schema could not be prepared: ${setup.stderr?.trim()}\n`,
  );
  process.exit(1);
}

const applied = run([
  "--single-transaction",
  "-c",
  `SET search_path TO ${schema}`,
  "-f",
  "migrations/0001_init.sql",
]);
if (applied.status !== 0) {
  process.stderr.write(
    `the migration could not be applied: ${(applied.stderr ?? "").trim()}\n`,
  );
  process.exit(1);
}

const rejected = run([
  "--single-transaction",
  "-c",
  `SET search_path TO ${schema}; CREATE TABLE probe_rollback (id int); SELECT 1 / 0`,
]);
if (rejected.status === 0) {
  process.stderr.write("the migration runner accepted a failing statement\n");
  process.exit(1);
}

const leftover = run([
  "-tAc",
  `SELECT count(*) FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = 'probe_rollback'`,
]);
if (leftover.status !== 0 || (leftover.stdout ?? "").trim() !== "0") {
  process.stderr.write("a rejected transaction left an object behind\n");
  process.exit(1);
}

run(["-c", `DROP SCHEMA IF EXISTS ${schema} CASCADE`]);
process.stdout.write(
  "migration ok: applied in a scratch schema and a failing statement rolled back\n",
);
