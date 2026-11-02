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
test("client sends session token and consumes every page", async () => {
  const { createClient } = await import("../../apps/web/src/api-client.ts");
  const calls = [];
  const client = createClient(
    "http://api",
    "session-token",
    async (url, options) => {
      calls.push({ url, options });
      return Response.json(
        calls.length === 1
          ? { items: [{ id: "one" }], nextCursor: "one" }
          : { items: [{ id: "two" }], nextCursor: null },
      );
    },
  );
  const signal = new AbortController().signal;
  assert.deepEqual(await client.items("board", signal), [
    { id: "one" },
    { id: "two" },
  ]);
  assert.match(calls[1].url, /cursor=one/);
  for (const call of calls) {
    assert.equal(call.options.headers.authorization, "Bearer session-token");
    assert.equal(call.options.signal, signal);
  }
});
test("client reports failed mutations instead of treating them as success", async () => {
  const { createClient } = await import("../../apps/web/src/api-client.ts");
  const client = createClient("http://api", "session-token", async () =>
    Response.json({ error: "stale version" }, { status: 409 }),
  );
  await assert.rejects(
    client.move("board", { id: "item", version: 1 }, "in-progress"),
    /stale version/,
  );
});
