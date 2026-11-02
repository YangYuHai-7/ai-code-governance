import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalContractDigest } from '../delivery-core/index.mjs';

const IGNORED = new Set(['node_modules', '.git', '.aicg-evaluation', 'dist', 'build', 'test-results', 'playwright-report']);

function walk(directory, prefix = '') {
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (IGNORED.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) entries.push(...walk(absolute, relative));
    else if (entry.isFile()) entries.push({ relative, absolute });
  }
  return entries;
}

export function digestEvaluationRepository(root) {
  const files = walk(root).map((entry) => `${entry.relative}:${createHash('sha256').update(fs.readFileSync(entry.absolute)).digest('hex')}`);
  const contentDigest = createHash('sha256').update(files.join('\n')).digest('hex');
  return canonicalContractDigest('evidence', {
    schemaVersion: 1,
    id: 'evidence.reference-tree',
    sessionId: 'session.reference',
    source: 'repository',
    verificationLevel: 'enforced',
    semanticDigest: contentDigest,
    repositoryDigest: contentDigest,
    commandDigest: null,
    resultDigest: createHash('sha256').update(String(files.length)).digest('hex'),
    artifactDigests: [],
    status: 'passed',
  });
}
