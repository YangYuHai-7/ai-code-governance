import { fastify } from "fastify";
import { createBoardRepository } from "./infrastructure/index";
import { readDatabaseConfig } from "./infrastructure/db";
import { createTransport } from "./transport/index";

export async function start(port = 3000, env = process.env) {
  const config = readDatabaseConfig(env as Record<string, string | undefined>);
  const store = createBoardRepository(config);
  store.database.applyFile("migrations/0001_init.sql");
  // Synthetic sessions represent already authenticated organization memberships.
  // Tokens and identities are provisioned by the operator, never by the HTTP client.
  const sessions = JSON.parse(env.TRACKER_SESSIONS ?? "{}") as Record<
    string,
    { organizationId: string; actorId: string; expiresAt: string }
  >;
  for (const session of Object.values(sessions)) {
    if (
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
        session.organizationId,
      ) ||
      typeof session.actorId !== "string" ||
      !session.actorId ||
      !Number.isFinite(Date.parse(session.expiresAt))
    )
      throw new Error("invalid TRACKER_SESSIONS configuration");
  }
  const server = fastify({ logger: { redact: ["req.headers.authorization"] } });
  server.setErrorHandler((error, request, reply) => {
    const candidate = (error as { statusCode?: number })?.statusCode;
    const status =
      typeof candidate === "number" && candidate >= 400 && candidate < 500
        ? candidate
        : 500;
    request.log.error(
      { err: error, correlationId: request.id },
      "request failed",
    );
    reply.code(status).send({
      error: status === 500 ? "internal server error" : "invalid request",
      correlationId: request.id,
    });
  });
  const transport = createTransport(
    store,
    server,
    (request) => {
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) return null;
      const token = authorization.slice(7);
      if (!Object.hasOwn(sessions, token)) return null;
      const session = sessions[token];
      return Date.parse(session.expiresAt) > Date.now() ? session : null;
    },
    env.WORK_TRACKER_ENABLED !== "false",
  );
  await server.listen({ port, host: "127.0.0.1" });
  return { server, service: transport.service };
}

if (process.argv[1] && process.argv[1].endsWith("main.js")) {
  const port = Number(process.env.PORT ?? 3000);
  start(port)
    .then(() =>
      process.stdout.write(`api listening on http://127.0.0.1:${port}\n`),
    )
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    });
}
