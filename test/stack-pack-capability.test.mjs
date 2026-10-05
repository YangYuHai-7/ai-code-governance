import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadCapabilityRegistry,
  resolveGoldenPathPackForCapability,
} from '../src/registry.mjs';
import {
  derivePackMaturity,
  loadGoldenPathPack,
  resolvePackCompatibility,
} from '../src/modules/stack-packs/index.mjs';
import { renderCapabilityArtifacts } from '../src/modules/capabilities/artifacts.mjs';

const pack = loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql');

function exactFacts() {
  return {
    runtime: { node: '24.18.0' },
    packageManager: { name: 'npm', version: '11.0.0', lockfile: 'package-lock.json' },
    packages: {
      react: '19.3.0',
      'react-dom': '19.3.0',
      vite: '8.3.0',
      '@mantine/core': '9.6.0',
      '@nestjs/core': '12.0.0',
      '@nestjs/platform-fastify': '12.0.0',
      fastify: '5.12.5',
      'drizzle-orm': '0.44.6',
    },
    database: { engine: 'postgresql', version: '18.6', extensions: [] },
  };
}

function linkedEntry() {
  return loadCapabilityRegistry().packs.find((entry) => entry.id === 'frontend-react');
}

function compatible() {
  return resolvePackCompatibility({ pack, repositoryFacts: exactFacts() });
}

function receipt(evidenceLevel, overrides = {}) {
  const current = compatible();
  return {
    evidenceLevel,
    packDigest: current.packDigest,
    factsDigest: current.factsDigest,
    current: true,
    ...overrides,
  };
}

test('legacy capability discovery remains intact while selected entries link to the exact Pack', () => {
  const registry = loadCapabilityRegistry();
  assert.ok(registry.packs.some((entry) => entry.id === 'frontend-vue'));
  assert.equal(linkedEntry().contract.goldenPathPackId, pack.id);
  assert.equal(resolveGoldenPathPackForCapability('frontend-react').id, pack.id);
  assert.equal(resolveGoldenPathPackForCapability('frontend-vue'), null);
});

test('without a current evaluation receipt, a compatible Pack remains guided and names all missing evidence', () => {
  const result = derivePackMaturity({ registryEntry: linkedEntry(), pack, compatibility: compatible() });
  assert.equal(result.maturity, 'guided');
  assert.equal(result.evidenceLevel, 'E0-generated');
  assert.match(result.claim, /guided/i);
  assert.deepEqual(result.gaps.map((gap) => gap.code), [
    'missing-evaluation-receipt',
    'missing-e2-integrated-evidence',
    'missing-e3-agent-evidence',
    'missing-e4-held-out-evidence',
    'missing-current-os-evidence',
    'missing-qualified-user-evidence',
  ]);
});

test('E2 is an executable candidate, not a certification claim', () => {
  const result = derivePackMaturity({
    registryEntry: linkedEntry(),
    pack,
    compatibility: compatible(),
    evaluation: receipt('E2-integrated'),
  });
  assert.equal(result.maturity, 'executable-candidate');
  assert.equal(result.evidenceLevel, 'E2-integrated');
  assert.ok(result.gaps.some((gap) => gap.code === 'missing-e3-agent-evidence'));

  const rendered = renderCapabilityArtifacts({ clients: [], artifactLanguage: 'en' }, [], null, {
    stackPackInputs: [{ registryEntry: linkedEntry(), pack, compatibility: compatible(), evaluation: receipt('E2-integrated') }],
  });
  assert.deepEqual(rendered.catalog.stackPackClaims[0], {
    packId: pack.id,
    capabilityId: 'frontend-react',
    maturity: 'executable-candidate',
    evidenceLevel: 'E2-integrated',
    claim: result.claim,
    gaps: result.gaps,
  });
});

test('only a current E4 receipt bound to this Pack and exact facts may claim certification', () => {
  const certified = derivePackMaturity({
    registryEntry: linkedEntry(),
    pack,
    compatibility: compatible(),
    evaluation: receipt('E4-golden-path-certified'),
  });
  assert.equal(certified.maturity, 'certified');
  assert.equal(certified.evidenceLevel, 'E4-golden-path-certified');
  assert.match(certified.claim, /certified/i);
  assert.deepEqual(certified.gaps, []);

  const stale = derivePackMaturity({
    registryEntry: linkedEntry(),
    pack,
    compatibility: compatible(),
    evaluation: receipt('E4-golden-path-certified', { current: false }),
  });
  assert.equal(stale.maturity, 'guided');
  assert.ok(stale.gaps.some((gap) => gap.code === 'stale-evaluation-receipt'));
});
