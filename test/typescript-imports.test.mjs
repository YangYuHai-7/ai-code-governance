import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractTypeScriptReferences,
  resolveTypeScriptReference,
} from '../src/modules/architecture/index.mjs';

const files = [
  { relative: 'apps/api/src/domain/user.ts', type: 'file' },
  { relative: 'apps/api/src/domain/lazy.ts', type: 'file' },
  { relative: 'apps/api/src/shared/value.ts', type: 'file' },
  { relative: 'packages/contracts/src/index.ts', type: 'file' },
  { relative: 'outside/escaped.ts', type: 'link' },
];

const aliases = {
  tsconfigPaths: {
    '@/*': ['apps/api/src/*'],
    '@contracts': ['packages/contracts/src/index.ts'],
  },
  viteAliases: {
    '~': 'apps/api/src',
  },
};

test('extracts static TypeScript imports and exports while marking dynamic syntax unsupported', () => {
  const extracted = extractTypeScriptReferences(`
    import type { User } from '@/domain/user';
    import { value } from './shared/value';
    import './shared/effects';
    export type { PublicValue } from '~\/shared/value';
    const lazy = import('./domain/lazy');
    const computed = import(name);
  `);

  assert.deepEqual(extracted.references.map((reference) => ({
    specifier: reference.specifier,
    kind: reference.kind,
    typeOnly: reference.typeOnly,
  })), [
    { specifier: '@/domain/user', kind: 'import', typeOnly: true },
    { specifier: './shared/value', kind: 'import', typeOnly: false },
    { specifier: './shared/effects', kind: 'import', typeOnly: false },
    { specifier: '~/shared/value', kind: 'export', typeOnly: true },
    { specifier: './domain/lazy', kind: 'dynamic-import', typeOnly: false },
  ]);
  assert.equal(extracted.unsupported, true);
  assert.deepEqual(extracted.unsupportedReasons, ['computed-dynamic-import', 'dynamic-import']);
});

test('resolves relative paths, declared aliases, workspace packages, and external packages deterministically', () => {
  const shared = resolveTypeScriptReference({
    source: 'apps/api/src/domain/user.ts',
    specifier: '../shared/value',
    files,
    aliases,
    workspacePackages: { '@workspace/contracts': 'packages/contracts/src/index.ts' },
  });
  assert.deepEqual(shared, {
    kind: 'relative', target: 'apps/api/src/shared/value.ts', packageName: null, supported: true, reason: null,
  });

  const alias = resolveTypeScriptReference({
    source: 'apps/api/src/domain/user.ts',
    specifier: '@/domain/user',
    files,
    aliases,
    workspacePackages: {},
  });
  assert.deepEqual(alias, {
    kind: 'alias', target: 'apps/api/src/domain/user.ts', packageName: null, supported: true, reason: null,
  });

  const workspace = resolveTypeScriptReference({
    source: 'apps/api/src/domain/user.ts',
    specifier: '@workspace/contracts',
    files,
    aliases,
    workspacePackages: { '@workspace/contracts': 'packages/contracts/src/index.ts' },
  });
  assert.deepEqual(workspace, {
    kind: 'workspace', target: 'packages/contracts/src/index.ts', packageName: '@workspace/contracts', supported: true, reason: null,
  });

  assert.deepEqual(resolveTypeScriptReference({
    source: 'apps/api/src/domain/user.ts', specifier: 'zod', files, aliases, workspacePackages: {},
  }), {
    kind: 'external', target: null, packageName: 'zod', supported: true, reason: null,
  });
});

test('fails closed for computed, ambiguous, unsafe, and unresolved TypeScript references', () => {
  const ambiguous = resolveTypeScriptReference({
    source: 'apps/api/src/domain/user.ts',
    specifier: '@/domain/user',
    files,
    aliases: { tsconfigPaths: { '@/*': ['apps/api/src/*', 'packages/contracts/src/*'] }, viteAliases: {} },
    workspacePackages: {},
  });
  assert.deepEqual(ambiguous, {
    kind: 'alias', target: null, packageName: null, supported: false, reason: 'ambiguous-alias',
  });

  const escaped = resolveTypeScriptReference({
    source: 'apps/api/src/domain/user.ts',
    specifier: '@/../../../../outside/escaped',
    files,
    aliases,
    workspacePackages: {},
  });
  assert.deepEqual(escaped, {
    kind: 'alias', target: null, packageName: null, supported: false, reason: 'unsafe-target',
  });

  const unresolved = resolveTypeScriptReference({
    source: 'apps/api/src/domain/user.ts', specifier: './missing', files, aliases, workspacePackages: {},
  });
  assert.deepEqual(unresolved, {
    kind: 'relative', target: null, packageName: null, supported: false, reason: 'unresolved-target',
  });
});
