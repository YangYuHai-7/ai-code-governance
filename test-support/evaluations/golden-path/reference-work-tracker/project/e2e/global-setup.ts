import { spawnSync } from "node:child_process";

// The browser scenario mutates the work item, so the suite resets the documented seed state
// before it runs; without this the gate only passed on the first run of a fresh database.
export default function globalSetup() {
  const result = spawnSync(process.execPath, ["scripts/seed-local.mjs"], {
    stdio: "inherit",
  });
  if (result.status !== 0)
    throw new Error("the evaluation seed could not be reset");
}
