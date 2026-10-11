import path from "node:path";
import { pathToFileURL } from "node:url";

// The documented entry point has to start the service it advertises. It runs the bundled API so
// the printed URL is only emitted after the listener is actually accepting connections.
const bundle = path.resolve(process.cwd(), "dist/api/main.js");
const port = Number(process.env.PORT ?? 3000);
const module = await import(pathToFileURL(bundle).href);
if (typeof module.start !== "function") {
  process.stderr.write(
    "dist/api/main.js does not export start(); run the build first\n",
  );
  process.exit(1);
}
await module.start(port);
process.stdout.write(`api listening on http://127.0.0.1:${port}\n`);
