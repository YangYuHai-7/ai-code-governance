import { liveFetch } from "../support/live-client";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Tenant isolation has to be attacked over the real surface: every case below talks to the running
// API, because a pure unit double cannot show whether a tenant boundary survives HTTP, SQL quoting,
// or malformed input. The gate fails closed when no API is reachable.
const API = process.env.AICG_LIVE_API ?? "http://127.0.0.1:3103";
const ORGANIZATION =
  process.env.AICG_LIVE_ORGANIZATION ?? "11111111-1111-1111-1111-111111111111";
const FOREIGN = "22222222-2222-2222-2222-222222222222";
const BOARD =
  process.env.AICG_LIVE_BOARD ?? "aaaaaaaa-1111-1111-1111-111111111111";
const ITEM =
  process.env.AICG_LIVE_ITEM ?? "cccccccc-1111-1111-1111-111111111111";

async function reachable(): Promise<boolean> {
  try {
    await liveFetch(`${API}/health`, { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

async function patch(body: unknown): Promise<Response> {
  return liveFetch(`${API}/work-items/${ITEM}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("tenant authorization against the running service", () => {
  it("never returns another tenant's items and never writes across tenants", async () => {
    expect(
      await reachable(),
      `this gate requires a running API at ${API}`,
    ).toBe(true);

    const foreignRead = await liveFetch(
      `${API}/boards/${BOARD}/items?organizationId=${FOREIGN}`,
    );
    expect(foreignRead.status).toBe(404);

    const foreignWrite = await patch({
      organizationId: FOREIGN,
      actorId: "member-synthetic-2",
      boardId: BOARD,
      state: "done",
      expectedVersion: 1,
    });
    expect(foreignWrite.status).toBe(404);

    const unknownTenant = await liveFetch(
      `${API}/boards?organizationId=00000000-0000-0000-0000-000000000000`,
    );
    expect(unknownTenant.status).toBe(404);

    const blankTenant = await globalThis.fetch(`${API}/boards`);
    expect(blankTenant.status).toBe(401);
  });

  it("treats injection attempts and malformed bodies as refusals, never as data", async () => {
    const injected = encodeURIComponent("' OR '1'='1");
    const response = await liveFetch(
      `${API}/boards?organizationId=${injected}`,
    );
    expect(response.status).toBe(400);

    const malformed = await patch({ state: "done" });
    expect(malformed.status).toBeGreaterThanOrEqual(400);
    expect(malformed.status).toBeLessThan(500);

    const wrongTypes = await patch({
      organizationId: ORGANIZATION,
      actorId: 42,
      boardId: BOARD,
      state: "nope",
      expectedVersion: "1",
    });
    expect(wrongTypes.status).toBeGreaterThanOrEqual(400);
    expect(wrongTypes.status).toBeLessThan(500);
  });

  it("accepts exactly one of many concurrent writes that claim the same version", async () => {
    const psql = process.env.PSQL_BIN ?? "psql";
    const database = process.env.PGDATABASE ?? "tracker";
    const tenant = ORGANIZATION;
    const board = randomUUID();
    const item = randomUUID();
    const seed = spawnSync(
      psql,
      [
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `INSERT INTO organizations (id, name) VALUES ('${tenant}', 'Concurrency tenant') ON CONFLICT (id) DO NOTHING; INSERT INTO boards (id, organization_id, title) VALUES ('${board}', '${tenant}', 'Concurrency board'); INSERT INTO work_items (id, organization_id, board_id, title, state, version) VALUES ('${item}', '${tenant}', '${board}', 'Concurrency item', 'todo', 1)`,
      ],
      { encoding: "utf8" },
    );
    expect(
      seed.status,
      `this gate requires PostgreSQL: ${seed.stderr ?? ""}`,
    ).toBe(0);

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        liveFetch(`${API}/work-items/${item}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organizationId: tenant,
            actorId: "member-synthetic-1",
            boardId: board,
            state: "in-progress",
            expectedVersion: 1,
          }),
        }),
      ),
    );
    const accepted = attempts.filter((response) => response.status === 200);
    const refused = attempts.filter((response) => response.status === 409);
    expect(accepted.length, "exactly one writer may win the version").toBe(1);
    expect(refused.length).toBe(attempts.length - 1);
  });
});
