import { liveFetch } from "../support/live-client";
import { describe, expect, it } from "vitest";

// Observability means the running service can be watched: health carries a correlation id, errors
// answer with a structured field instead of internals, and responses declare their cross-origin
// surface. Asserting that a route was registered says none of that, so this gate talks to the API.
const API = process.env.AICG_LIVE_API ?? "http://127.0.0.1:3103";
const ORGANIZATION =
  process.env.AICG_LIVE_ORGANIZATION ?? "11111111-1111-1111-1111-111111111111";
const ITEM =
  process.env.AICG_LIVE_ITEM ?? "cccccccc-1111-1111-1111-111111111111";
const BOARD =
  process.env.AICG_LIVE_BOARD ?? "aaaaaaaa-1111-1111-1111-111111111111";

async function reachable(): Promise<boolean> {
  try {
    await liveFetch(`${API}/health`, { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

describe("observability surface", () => {
  it("reports health with a correlation id and never leaks internals", async () => {
    expect(
      await reachable(),
      `this gate requires a running API at ${API}`,
    ).toBe(true);

    const health = await liveFetch(`${API}/health`);
    expect(health.status).toBe(200);
    const body = (await health.json()) as {
      status?: string;
      correlationId?: string;
    };
    expect(body.status).toBe("ok");
    expect(typeof body.correlationId).toBe("string");
    expect((body.correlationId ?? "").length).toBeGreaterThan(0);
    expect(health.headers.get("access-control-allow-origin")).toBeTruthy();

    const listResponse = await liveFetch(
      `${API}/boards?organizationId=${ORGANIZATION}`,
    );
    expect(listResponse.status).toBe(200);
    expect(
      listResponse.headers.get("access-control-allow-origin"),
    ).toBeTruthy();

    const conflict = await liveFetch(`${API}/work-items/${ITEM}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: ORGANIZATION,
        actorId: "member-synthetic-1",
        boardId: BOARD,
        state: "done",
        expectedVersion: 999,
      }),
    });
    expect(conflict.status).toBe(409);
    const errorBody = await conflict.text();
    expect(errorBody.length).toBeGreaterThan(0);
    expect(JSON.parse(errorBody)).toHaveProperty("error");
    expect(errorBody).not.toMatch(/\s+at\s+[A-Za-z_$][\w$.]*\s*\(/);
    expect(errorBody).not.toMatch(/node_modules|\/Users\/|\/home\//);
  });
});
