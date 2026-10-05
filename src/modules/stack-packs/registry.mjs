import path from 'node:path';
import { readJson } from '../../adapters/filesystem/index.mjs';
import { PACKAGE_ROOT } from '../../constants.mjs';
import { usageError } from '../../kernel/index.mjs';
import { validateGoldenPathPack } from './contracts.mjs';

export const GOLDEN_PATH_PACK_ID = 'react-mantine-nest-fastify-drizzle-postgresql';

const PACKS = Object.freeze([
  Object.freeze({ id: GOLDEN_PATH_PACK_ID, path: 'assets/packs/react-mantine-nest-fastify-drizzle-postgresql-v1.json' }),
]);

function readPack(entry) {
  return validateGoldenPathPack(readJson(path.join(PACKAGE_ROOT, entry.path)));
}

export function listGoldenPathPacks() {
  return Object.freeze(PACKS.map(readPack));
}

export function loadGoldenPathPack(id) {
  const entry = PACKS.find((candidate) => candidate.id === id);
  if (!entry) throw usageError(`Unknown golden path Pack: ${id}`);
  return readPack(entry);
}
