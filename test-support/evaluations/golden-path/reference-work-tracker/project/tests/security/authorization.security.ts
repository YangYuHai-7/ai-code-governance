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
    await fetch(`${API}/health`, { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

async function patch(body: unknown): Promise<Response> {
  return fetch(`${API}/work-items/${ITEM}`, {
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

    const foreignRead = await fetch(
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

    const unknownTenant = await fetch(
      `${API}/boards?organizationId=00000000-0000-0000-0000-000000000000`,
    );
    expect(unknownTenant.status).toBe(200);
    expect(
      ((await unknownTenant.json()) as { items: unknown[] }).items,
    ).toEqual([]);

    const blankTenant = await fetch(`${API}/boards`);
    expect(blankTenant.status).toBe(400);
  });

  it("treats injection attempts and malformed bodies as refusals, never as data", async () => {
    const injected = encodeURIComponent("' OR '1'='1");
    const response = await fetch(`${API}/boards?organizationId=${injected}`);
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
});
