import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateGoldenPathArchitecture } from '../src/modules/architecture/index.mjs';
import { canonicalContractDigest, validateArchitectureIr, validateRequirementIr } from '../src/modules/delivery-core/index.mjs';
import { loadGoldenPathPack, resolvePackCompatibility } from '../src/modules/stack-packs/index.mjs';
import { scanProject } from '../src/scanner.mjs';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
// The fixture lives outside test/ so bare node --test discovery cannot execute its app sources.
const fixture = path.join(testRoot, '..', 'test-support/evaluations/golden-path/reference-work-tracker');
const project = path.join(fixture, 'project');
const pack = loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql');

const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(relative), 'utf8'));
const manifest = () => readJson(path.join(project, 'package.json'));
const expectedRequirement = () => validateRequirementIr(readJson(path.join(fixture, 'expected-requirement.json')));
const expectedArchitecture = () => validateArchitectureIr(readJson(path.join(fixture, 'expected-architecture.json')));

const GATE_SCRIPTS = {
  'reproducible-build': 'build',
  'static-format': 'format:check',
  'static-lint': 'lint',
  'static-types': 'typecheck',
  'architecture-boundaries': 'architecture',
  'unit-tests': 'test:unit',
  'api-integration': 'test:integration',
  'contract-tests': 'test:contract',
  'browser-e2e': 'test:e2e',
  'security-probes': 'test:security',
  'migration-safety': 'test:migration',
  'runtime-observability': 'test:observability',
  'performance-budget': 'test:performance',
};
const MANAGED_GATES = { 'requirement-traceability': 'delivery-core.traceability' };
const REQUIRED_SCRIPTS = ['build', 'format:check', 'lint', 'typecheck', 'architecture', 'test:unit', 'test:integration', 'test:contract', 'test:e2e', 'test:security', 'test:migration', 'test:observability', 'test:performance', 'start:local'];

test('the expected requirement and architecture contracts validate and bind to each other', () => {
  const requirement = expectedRequirement();
  const architecture = expectedArchitecture();
  assert.equal(architecture.requirementDigest, canonicalContractDigest('requirement', requirement));
  assert.equal(architecture.id, 'architecture.reference-work-tracker');
  assert.ok(fs.readFileSync(path.join(fixture, 'requirement.md'), 'utf8').trim().length > 200);
});

test('the fixture manifests resolve the exact evaluated Pack combination', () => {
  const current = manifest();
  const lock = readJson(path.join(project, 'package-lock.json'));
  const environment = current.aicgEvaluation.environment;
  for (const [name, version] of Object.entries(current.dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, name);
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, name);
  }
  assert.equal(environment.packageManager.name, pack.compatibility.packageManager.name);
  assert.equal(environment.packageManager.version, pack.compatibility.referenceCombinations[0].packageManager.version);
  assert.equal(environment.packageManager.lockfile, pack.compatibility.packageManager.lockfile);
  assert.equal(environment.runtime.node, pack.compatibility.referenceCombinations[0].runtime.node);
  assert.equal(environment.database.version, pack.compatibility.referenceCombinations[0].database.version);
  const facts = {
    runtime: environment.runtime,
    packageManager: { ...environment.packageManager },
    packages: { ...current.dependencies },
    database: environment.database,
  };
  const compatibility = resolvePackCompatibility({ pack, repositoryFacts: facts });
  assert.equal(compatibility.status, 'compatible');
  assert.deepEqual(compatibility.gaps, []);
});

test('the reference repository satisfies the Pack module topology', () => {
  const result = evaluateGoldenPathArchitecture(scanProject(project), pack);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.unsupportedFiles, []);
  assert.equal(result.status, 'passed');
  const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  for (const module of pack.architecture.modules) {
    for (const root of module.roots) {
      const absolute = path.join(project, root);
      assert.ok(fs.existsSync(absolute), `${module.id}:${root}`);
      const files = walk(absolute).map((file) => path.basename(file));
      for (const entry of module.publicEntrypoints) assert.ok(files.includes(entry), `${module.id}:${root}/${entry}`);
    }
  }
  for (const root of pack.architecture.compositionRoots) assert.ok(fs.existsSync(path.join(project, root)), root);
});

test('every Pack quality gate maps to a declared script or a managed driver', () => {
  const current = manifest();
  for (const gate of pack.qualityMatrix.gates) {
    const script = GATE_SCRIPTS[gate.id];
    const managed = MANAGED_GATES[gate.id];
    assert.ok(script || managed, `unmapped gate ${gate.id}`);
    if (script) assert.ok(current.scripts[script], `missing script ${script} for ${gate.id}`);
  }
  for (const script of REQUIRED_SCRIPTS) assert.ok(current.scripts[script], script);
  assert.ok(fs.existsSync(path.join(project, 'README.md')));
  assert.ok(fs.existsSync(path.join(project, 'migrations/0001_init.sql')));
});

test('the workload declares no external provider and records the Pack limitations', () => {
  const current = manifest();
  const all = { ...current.dependencies, ...(current.devDependencies ?? {}) };
  assert.ok(!Object.keys(all).some((name) => /stripe|sendgrid|auth0|twilio|aws-sdk|firebase|clerk/i.test(name)));
  assert.equal(current.dependencies.next, undefined);
  const declared = new Set(expectedArchitecture().evidenceGaps.map((gap) => gap.id));
  for (const limitation of pack.knownLimitations) assert.ok(declared.has(limitation.id), limitation.id);
});
