import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GOLDEN_PATH_PACK_VERSION,
  QUALITY_MATRIX_VERSION,
  GOLDEN_PATH_PACK_ID,
  listGoldenPathPacks,
  loadGoldenPathPack,
  packContractDigest,
  validateGoldenPathPack,
  validateQualityMatrix,
} from '../src/modules/stack-packs/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function matrix(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'quality.web-api',
    gates: [
      {
        id: 'build',
        owner: 'reproducibility',
        applicability: 'always',
        required: true,
        purpose: 'build',
        timeoutMs: 60_000,
        maxOutputBytes: 65_536,
        artifactBudgetBytes: 1_048_576,
        evidence: 'Build output is captured.',
      },
    ],
    ...overrides,
  };
}

function pack(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'react-mantine-nest-fastify-drizzle-postgresql',
    release: 'v1',
    lifecycle: 'active',
    maturity: 'candidate',
    sourceDigest: 'a'.repeat(64),
    compatibility: {
      runtime: { node: { major: 24, minMinor: 15 } },
      packageManager: { name: 'npm', lockfile: 'package-lock.json' },
      packages: [
        { name: 'react', range: '19.x' },
        { name: 'react-dom', range: '19.x' },
        { name: 'vite', range: '8.x' },
        { name: '@mantine/core', range: '9.x' },
        { name: '@nestjs/core', range: '12.x' },
        { name: '@nestjs/platform-fastify', range: '12.x' },
        { name: 'fastify', range: '5.x' },
        { name: 'drizzle-orm', range: 'stable' },
      ],
      database: { engine: 'postgresql', major: 18, extensions: [] },
    },
    detection: {
      requiredPaths: ['package.json'],
      requiredPackages: ['react', '@nestjs/core', 'drizzle-orm'],
      forbiddenPackages: ['next'],
    },
    architecture: {
      modules: [
        {
          id: 'web.feature',
          roots: ['apps/web/src/features'],
          allowedDependencies: ['web.shared', 'contracts'],
          publicEntrypoints: ['index.ts'],
        },
      ],
      compositionRoots: ['apps/web/src/main.tsx', 'apps/api/src/main.ts'],
    },
    generation: {
      requiredPaths: ['apps/web/src/main.tsx', 'apps/api/src/main.ts'],
      forbiddenPaths: ['apps/api/src/domain/**/framework/**'],
    },
    qualityMatrix: matrix(),
    failureCatalog: [
      {
        id: 'domain-framework-dependency',
        owner: 'architecture',
        severity: 'error',
        repair: 'Move framework imports to an adapter.',
      },
    ],
    repairCatalog: [
      {
        id: 'architecture-local-repair',
        owns: ['architecture'],
        maxAttempts: 2,
      },
    ],
    knownLimitations: [
      {
        id: 'external-identity',
        statement: 'External identity providers are not evaluated.',
      },
    ],
    ...overrides,
  };
}

test('golden path Pack and quality matrix contracts are explicit and deeply frozen', () => {
  assert.equal(GOLDEN_PATH_PACK_VERSION, 1);
  assert.equal(QUALITY_MATRIX_VERSION, 1);
  const value = validateGoldenPathPack(pack());
  const quality = validateQualityMatrix(matrix());
  assert.equal(value.schemaVersion, 1);
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.compatibility));
  assert.ok(Object.isFrozen(value.qualityMatrix.gates));
  assert.ok(Object.isFrozen(quality));
  assert.match(packContractDigest(value), /^[a-f0-9]{64}$/);
});

test('Pack and quality matrix JSON Schema assets are closed', () => {
  for (const name of ['golden-path-pack-v1-schema.json', 'quality-matrix-v1-schema.json']) {
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'assets/contracts', name), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.additionalProperties, false);
  }
});

test('contracts reject duplicate gates, missing gate owners, unsafe paths, unknown fields, and future versions', () => {
  assert.throws(
    () => validateQualityMatrix(matrix({ gates: [matrix().gates[0], { ...matrix().gates[0] }] })),
    /duplicate gate/i,
  );
  const missingOwner = matrix();
  delete missingOwner.gates[0].owner;
  assert.throws(() => validateQualityMatrix(missingOwner), /owner/i);
  assert.throws(
    () => validateGoldenPathPack(pack({ detection: { ...pack().detection, requiredPaths: ['../secret'] } })),
    /requiredPaths.*safe|safe.*requiredPaths/i,
  );
  assert.throws(() => validateGoldenPathPack({ ...pack(), future: true }), /unknown field/i);
  assert.throws(() => validateGoldenPathPack(pack({ schemaVersion: 2 })), /unsupported version/i);
  assert.throws(() => validateQualityMatrix(matrix({ schemaVersion: 2 })), /unsupported version/i);
});

test('the first package-owned golden path validates and is loaded deterministically', () => {
  assert.equal(GOLDEN_PATH_PACK_ID, 'react-mantine-nest-fastify-drizzle-postgresql');
  const packs = listGoldenPathPacks();
  assert.deepEqual(packs.map((entry) => entry.id), [GOLDEN_PATH_PACK_ID]);
  const value = loadGoldenPathPack(GOLDEN_PATH_PACK_ID);
  assert.equal(value.id, GOLDEN_PATH_PACK_ID);
  assert.ok(Object.isFrozen(value));
  for (const gate of value.qualityMatrix.gates.filter((entry) => entry.required)) {
    assert.ok(gate.owner);
    assert.ok(gate.applicability);
  }
  assert.throws(() => loadGoldenPathPack('unknown-pack'), /Unknown golden path Pack/i);
});
