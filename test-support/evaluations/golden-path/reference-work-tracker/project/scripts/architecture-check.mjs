import path from "node:path";
import { pathToFileURL } from "node:url";

// This gate must enforce the governance policy itself, not a hand-written subset of it. It loads
// the policy from the governance checkout named by AICG_ROOT and fails closed when that checkout
// is unavailable: printing an unbacked "architecture ok" is exactly how a mutation slips through.
const root = process.cwd();
const policyRoot = process.env.AICG_ROOT;
if (typeof policyRoot !== "string" || policyRoot.length === 0) {
  console.error(
    "this gate requires the governance policy module: set AICG_ROOT to the governance checkout",
  );
  process.exit(1);
}
const load = async (relative) =>
  import(pathToFileURL(path.join(policyRoot, relative)).href);
let scanProject;
let evaluateGoldenPathArchitecture;
let loadGoldenPathPack;
try {
  ({ scanProject } = await load("src/scanner.mjs"));
  ({ evaluateGoldenPathArchitecture } = await load(
    "src/modules/architecture/index.mjs",
  ));
  ({ loadGoldenPathPack } = await load("src/modules/stack-packs/index.mjs"));
} catch (error) {
  console.error(
    `the governance policy module could not be loaded: ${error.message}`,
  );
  process.exit(1);
}
const pack = loadGoldenPathPack(
  process.env.AICG_PACK_ID ?? "react-mantine-nest-fastify-drizzle-postgresql",
);
const result = evaluateGoldenPathArchitecture(scanProject(root), pack);
if (result.status !== "passed") {
  for (const issue of result.issues)
    console.error(
      `${issue.source}: ${issue.code} ${issue.target ?? ""}`.trim(),
    );
  process.exit(1);
}
console.log(
  `architecture ok: ${result.checkedFiles ?? result.scannedFiles ?? "policy"} verified against ${pack.id}`,
);
