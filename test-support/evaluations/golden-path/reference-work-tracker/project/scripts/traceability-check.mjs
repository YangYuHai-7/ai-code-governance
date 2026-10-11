import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Traceability is verified against the contracts and the recorded session state, not asserted:
// the requirement and architecture must satisfy their own schemas, the architecture must be bound
// to the requirement digest, every owned module root must exist, and no delivery session may be
// left mid-flight without a resumable checkpoint.
const root = process.cwd();
const fixtureRoot = process.env.AICG_TRACEABILITY_ROOT ?? root;
const policyRoot = process.env.AICG_ROOT;
if (typeof policyRoot !== "string" || policyRoot.length === 0) {
  process.stderr.write("this gate requires the governance policy module: set AICG_ROOT to the governance checkout\n");
  process.exit(1);
}
const load = (relative) => import(pathToFileURL(path.join(policyRoot, relative)).href);
let validateRequirementIr;
let validateArchitectureIr;
let canonicalContractDigest;
try {
  ({ validateRequirementIr, validateArchitectureIr, canonicalContractDigest } = await load("src/modules/delivery-core/index.mjs"));
} catch (error) {
  process.stderr.write(`the governance contract module could not be loaded: ${error.message}\n`);
  process.exit(1);
}
const loadFile = (name) => {
  for (const base of [fixtureRoot, path.join(fixtureRoot, ".."), root]) {
    const candidate = path.join(base, name);
    if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, "utf8"));
  }
  throw new Error(`${name} was not found next to the project`);
};
const problems = [];
let requirement;
let architecture;
try {
  requirement = validateRequirementIr(loadFile("expected-requirement.json"));
} catch (error) {
  problems.push(`the requirement contract is invalid: ${error.message}`);
}
try {
  architecture = validateArchitectureIr(loadFile("expected-architecture.json"));
} catch (error) {
  problems.push(`the architecture contract is invalid: ${error.message}`);
}
if (requirement && architecture) {
  const digest = canonicalContractDigest("requirement", requirement);
  if (architecture.requirementDigest !== digest) problems.push("the architecture contract is not bound to the current requirement");
  const scenarios = requirement.acceptanceScenarios ?? [];
  if (scenarios.length === 0) problems.push("the requirement declares no acceptance scenarios");
  const seen = new Set();
  scenarios.forEach((scenario, index) => {
    const id = typeof scenario?.id === "string" ? scenario.id : "";
    if (id === "") problems.push(`acceptance scenario ${index} has no id`);
    if (seen.has(id)) problems.push(`acceptance scenario ${id} is declared twice`);
    seen.add(id);
  });
  const modules = architecture.modules ?? [];
  if (modules.length === 0) problems.push("the architecture contract declares no modules");
  for (const module of modules) {
    const id = typeof module?.id === "string" ? module.id : "(unnamed)";
    const owns = module?.owns ?? module?.roots ?? [];
    if (!Array.isArray(owns) || owns.length === 0) problems.push(`module ${id} owns no path`);
    for (const entry of owns) if (!fs.existsSync(path.join(root, entry))) problems.push(`module ${id}: ${entry} does not exist`);
  }
  for (const entry of architecture.compositionRoots ?? []) {
    const target = typeof entry === "string" ? entry : entry?.path;
    if (typeof target !== "string" || !fs.existsSync(path.join(root, target))) problems.push(`composition root ${target ?? "(unnamed)"} does not exist`);
  }
}
const sessionsRoot = path.join(root, ".ai-governance/state/delivery-sessions");
const terminal = new Set(["completed", "cancelled", "failed"]);
if (fs.existsSync(sessionsRoot)) {
  for (const entry of fs.readdirSync(sessionsRoot)) {
    const file = path.join(sessionsRoot, entry, "session.json");
    if (!fs.existsSync(file)) continue;
    let session;
    try {
      session = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      problems.push(`delivery session ${entry} is not readable: ${error.message}`);
      continue;
    }
    const state = typeof session.state === "string" ? session.state : "";
    const resumable = typeof session.previousDigest === "string" && Number.isSafeInteger(session.sequence) && session.sequence > 0;
    if (!terminal.has(state) && !resumable) problems.push(`delivery session ${entry} is ${state || "stateless"} without a resumable checkpoint`);
  }
}
const contractsDir = path.join(root, "packages/contracts/src");
if (fs.existsSync(contractsDir)) {
  let approved = null;
  try {
    approved = loadFile("expected-contracts.json").surface ?? [];
  } catch (error) {
    problems.push(`the approved contract surface could not be read: ${error.message}`);
  }
  if (approved) {
    const extracted = new Set();
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(absolute, "utf8");
          for (const match of text.matchAll(/export\s+(?:interface|type|const|function|class|enum)\s+([A-Za-z0-9_]+)/g)) extracted.add(match[1]);
        }
      }
    };
    walk(contractsDir);
    const actual = [...extracted].sort();
    const added = actual.filter((name) => !approved.includes(name));
    const removed = approved.filter((name) => !actual.includes(name));
    if (added.length > 0) problems.push(`the contract surface gained undeclared exports: ${added.join(", ")}`);
    if (removed.length > 0) problems.push(`the contract surface lost approved exports: ${removed.join(", ")}`);
  }
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`traceability ok: contracts validated, ${(architecture.modules ?? []).length} modules bound to the requirement digest, session state consistent\n`);