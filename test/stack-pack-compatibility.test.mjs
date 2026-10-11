import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGoldenPathPack, resolvePackCompatibility } from '../src/modules/stack-packs/index.mjs';

const pack = loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql');

function exactFacts(overrides = {}) {
  return {
    runtime: { node: '24.18.0' },
    packageManager: { name: 'npm', version: '11.0.0', lockfile: 'package-lock.json' },
    packages: {
      react: '19.3.0',
      'react-dom': '19.3.0',
      vite: '8.3.0',
      '@mantine/core': '9.6.0',
      '@nestjs/core': '11.2.7',
      '@nestjs/platform-fastify': '11.2.7',
      fastify: '5.12.5',
      'drizzle-orm': '0.44.6',
    },
    database: { engine: 'postgresql', version: '18.6', extensions: [] },
    ...overrides,
  };
}

test('the exact reference combination is compatible and digest-bound', () => {
  const result = resolvePackCompatibility({ pack, repositoryFacts: exactFacts() });
  assert.equal(result.status, 'compatible');
  assert.deepEqual(result.exactVersions.packages, exactFacts().packages);
  assert.match(result.packDigest, /^[a-f0-9]{64}$/);
  assert.match(result.factsDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.gaps, []);
});

test('missing lockfile and non-exact package values are unresolved', () => {
  assert.equal(resolvePackCompatibility({ pack, repositoryFacts: exactFacts({ packageManager: { name: 'npm', version: '11.0.0', lockfile: null } }) }).status, 'unresolved');
  const packages = { ...exactFacts().packages, react: '19.x' };
  assert.equal(resolvePackCompatibility({ pack, repositoryFacts: exactFacts({ packages }) }).status, 'unresolved');
});

test('unsupported versions and incompatible combinations fail closed', () => {
  const cases = [
    exactFacts({ runtime: { node: '24.14.0' } }),
    exactFacts({ packages: { ...exactFacts().packages, '@nestjs/platform-fastify': '11.0.0' } }),
    exactFacts({ packages: { ...exactFacts().packages, 'react-dom': '19.2.0' } }),
    exactFacts({ packages: { ...exactFacts().packages, vite: '7.3.0' } }),
    exactFacts({ packages: { ...exactFacts().packages, 'drizzle-orm': '1.0.0-rc.1' } }),
    exactFacts({ database: { engine: 'postgresql', version: '17.11', extensions: [] } }),
    exactFacts({ packages: { ...exactFacts().packages, react: '19.3.1', 'react-dom': '19.3.1' } }),
  ];
  for (const repositoryFacts of cases) {
    const result = resolvePackCompatibility({ pack, repositoryFacts });
    assert.equal(result.status, 'incompatible');
    assert.ok(result.gaps.length > 0);
  }
});
