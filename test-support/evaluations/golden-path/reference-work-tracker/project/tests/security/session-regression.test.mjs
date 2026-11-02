import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".")) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
const { registerBoardRoutes } = await import(
  "../../apps/api/src/transport/board-routes.ts"
);
const { createBoardService } = await import(
  "../../apps/api/src/application/board-service.ts"
);
const tenant = "11111111-1111-1111-1111-111111111111";
const foreign = "22222222-2222-2222-2222-222222222222";
const boardId = "aaaaaaaa-1111-1111-1111-111111111111";
const itemId = "cccccccc-1111-1111-1111-111111111111";

function fixture(enabled = true) {
  const routes = new Map();
  const calls = [];
  const service = createBoardService({
    boards(org) {
      calls.push(org);
      return org === tenant
        ? [{ id: boardId, organizationId: tenant, title: "Board" }]
        : [];
    },
    items() {
      return [
        {
          id: itemId,
          organizationId: tenant,
          boardId,
          title: "Item",
          state: "todo",
          version: 1,
        },
      ];
    },
    save(item, action, actor) {
      calls.push({ item, action, actor });
    },
  });
  const server = {
    get(path, handler) {
      routes.set(`GET ${path}`, handler);
    },
    patch(path, handler) {
      routes.set(`PATCH ${path}`, handler);
    },
  };
  registerBoardRoutes(
    server,
    service,
    (request) =>
      request.headers.authorization === "Bearer valid-session"
        ? { organizationId: tenant, actorId: "trusted-member" }
        : null,
    enabled,
  );
  return {
    calls,
    async request(route, input = {}) {
      let status = 200;
      const reply = {
        code(value) {
          status = value;
          return this;
        },
        send(value) {
          return value;
        },
      };
      const body = await routes.get(route)(
        { headers: {}, query: {}, params: {}, id: "request-1", ...input },
        reply,
      );
      return { status, body };
    },
  };
}
const headers = { authorization: "Bearer valid-session" };
const update = { boardId, state: "in-progress", expectedVersion: 1 };

test("unauthenticated requests cannot select a tenant", async () => {
  const f = fixture();
  assert.equal(
    (await f.request("GET /boards", { query: { organizationId: tenant } }))
      .status,
    401,
  );
  assert.deepEqual(f.calls, []);
});
test("authenticated reads derive tenant from session", async () => {
  const f = fixture();
  assert.equal((await f.request("GET /boards", { headers })).status, 200);
  assert.deepEqual(f.calls, [tenant]);
});
test("client tenant override cannot read another organization", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.request("GET /boards", {
        headers,
        query: { organizationId: foreign },
      })
    ).status,
    404,
  );
  assert.deepEqual(f.calls, []);
});
test("audit identity comes from session even when body spoofs actor", async () => {
  const f = fixture();
  const response = await f.request("PATCH /work-items/:itemId", {
    headers,
    params: { itemId },
    body: { ...update, organizationId: tenant, actorId: "attacker" },
  });
  assert.equal(response.status, 200);
  assert.equal(f.calls.at(-1).actor, "trusted-member");
});
test("missing items produce not-found", async () => {
  const f = fixture();
  const response = await f.request("PATCH /work-items/:itemId", {
    headers,
    params: { itemId: foreign },
    body: { ...update, organizationId: tenant },
  });
  assert.equal(response.status, 404);
});
test("invalid pagination never reaches service", async () => {
  const f = fixture();
  for (const limit of ["0", "-1", "NaN", "1.5", "101"]) {
    assert.equal(
      (
        await f.request("GET /boards/:boardId/items", {
          headers,
          params: { boardId },
          query: { organizationId: tenant, limit },
        })
      ).status,
      400,
    );
  }
  assert.deepEqual(f.calls, []);
});

test("feature flag disables work tracking while health remains available", async () => {
  const f = fixture(false);
  assert.equal((await f.request("GET /boards", { headers })).status, 503);
  assert.equal((await f.request("GET /health")).status, 200);
  assert.deepEqual(f.calls, []);
});
