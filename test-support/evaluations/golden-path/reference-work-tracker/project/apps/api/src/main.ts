import { fastify } from "fastify";
import { createBoardRepository } from "./infrastructure/index";
import { readDatabaseConfig } from "./infrastructure/db";
import { createTransport } from "./transport/index";

export async function start(port = 3000, env = process.env) {
  const config = readDatabaseConfig(env as Record<string, string | undefined>);
  const store = createBoardRepository(config);
  store.database.applyFile("migrations/0001_init.sql");
  const server = fastify({ logger: false });
  const transport = createTransport(store, server);
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
