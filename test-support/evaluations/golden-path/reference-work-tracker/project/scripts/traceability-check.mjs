import fs from "node:fs";
import path from "node:path";

// Traceability is verified against the contracts, not asserted: acceptance scenarios must be
// identifiable, every module the architecture owns must exist, and every composition root too.
const root = process.cwd();
const fixtureRoot = process.env.AICG_TRACEABILITY_ROOT ?? root;
const load = (name) => {
  for (const base of [fixtureRoot, path.join(fixtureRoot, ".."), root]) {
    const candidate = path.join(base, name);
    if (fs.existsSync(candidate))
      return JSON.parse(fs.readFileSync(candidate, "utf8"));
  }
  throw new Error(`${name} was not found next to the project`);
};
const requirement = load("expected-requirement.json");
const architecture = load("expected-architecture.json");
const problems = [];

const scenarios = requirement.acceptanceScenarios ?? [];
if (scenarios.length === 0)
  problems.push("the requirement declares no acceptance scenarios");
const seen = new Set();
scenarios.forEach((scenario, index) => {
  const id = typeof scenario?.id === "string" ? scenario.id : "";
  if (id === "") problems.push(`acceptance scenario ${index} has no id`);
  if (seen.has(id))
    problems.push(`acceptance scenario ${id} is declared twice`);
  seen.add(id);
});

const modules = architecture.modules ?? [];
if (modules.length === 0)
  problems.push("the architecture contract declares no modules");
for (const module of modules) {
  const id = typeof module?.id === "string" ? module.id : "(unnamed)";
  const owns = module?.owns ?? module?.roots ?? [];
  if (!Array.isArray(owns) || owns.length === 0)
    problems.push(`module ${id} owns no path`);
  for (const entry of owns)
    if (!fs.existsSync(path.join(root, entry)))
      problems.push(`module ${id}: ${entry} does not exist`);
}

for (const entry of architecture.compositionRoots ?? []) {
  const target = typeof entry === "string" ? entry : entry?.path;
  if (typeof target !== "string" || !fs.existsSync(path.join(root, target)))
    problems.push(`composition root ${target ?? "(unnamed)"} does not exist`);
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(
  `traceability ok: ${scenarios.length} acceptance scenarios, ${modules.length} modules\n`,
);
