import type { FastifyInstance } from "fastify";
import { createBoardService, type BoardStore } from "../application/index";
import { registerBoardRoutes } from "./board-routes";

type Server = Pick<
  FastifyInstance,
  "get" | "patch" | "options" | "addHook" | "listen"
>;

// The evaluation client is served from a different origin than the API, so the transport owns the
// CORS surface the browser needs instead of leaving cross-origin reads to fail silently.
export function createTransport(store: BoardStore, server: Server) {
  const service = createBoardService(store);
  server.addHook("onSend", async (_request, reply, payload) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-headers", "content-type");
    reply.header("access-control-allow-methods", "GET,PATCH,OPTIONS");
    return payload;
  });
  server.options("/*", async (_request, reply) => reply.code(204).send());
  registerBoardRoutes(server, service);
  return { server, service };
}
