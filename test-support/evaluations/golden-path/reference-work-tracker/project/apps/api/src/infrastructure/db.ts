import { spawnSync } from "node:child_process";

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  database: string;
  psql: string;
}

export function readDatabaseConfig(
  env: Record<string, string | undefined>,
): DatabaseConfig {
  const url = env.DATABASE_URL;
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port === "" ? 5432 : parsed.port),
      user: decodeURIComponent(parsed.username),
      database: parsed.pathname.replace(/^\//, ""),
      psql: env.PSQL_BIN ?? "psql",
    };
  }
  return {
    host: env.PGHOST ?? "127.0.0.1",
    port: Number(env.PGPORT ?? 5432),
    user: env.PGUSER ?? "postgres",
    database: env.PGDATABASE ?? "tracker",
    psql: env.PSQL_BIN ?? "psql",
  };
}

function literal(value: string | number): string {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export interface Database {
  query(sql: string): string[][];
  execute(sql: string): void;
  applyFile(path: string): void;
}

export function createDatabase(config: DatabaseConfig): Database {
  const base = [
    "-h",
    config.host,
    "-p",
    String(config.port),
    "-U",
    config.user,
    "-d",
    config.database,
    "-v",
    "ON_ERROR_STOP=1",
  ];
  const run = (args: string[]) => {
    const result = spawnSync(config.psql, [...base, ...args], {
      encoding: "utf8",
    });
    if (result.status !== 0)
      throw new Error(
        `psql failed: ${result.stderr?.trim() || result.error?.message || "unknown error"}`,
      );
    return result.stdout ?? "";
  };
  return {
    query(sql) {
      return run(["-tAF", "\t", "-c", sql])
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => line.split("\t"));
    },
    execute(sql) {
      run(["-c", sql]);
    },
    applyFile(path) {
      run(["-f", path]);
    },
  };
}

export function sqlLiteral(value: string | number): string {
  return literal(value);
}
