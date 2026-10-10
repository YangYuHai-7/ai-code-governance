import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const rules = [
  { under: 'apps/api/src/domain', forbidden: ['drizzle-orm', '@nestjs/', 'fastify'] },
  { under: 'apps/api/src/application', forbidden: ['drizzle-orm', 'fastify'] },
  { under: 'apps/web/src/features', forbidden: ['drizzle-orm', '@nestjs/'] },
];
const violations = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) inspect(absolute);
  }
}
function inspect(absolute) {
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  const content = readFileSync(absolute, 'utf8');
  for (const rule of rules) {
    if (!relative.startsWith(rule.under)) continue;
    for (const token of rule.forbidden) if (content.includes(`from '${token}`) || content.includes(`from "${token}`)) violations.push(`${relative}: ${token}`);
  }
}
for (const directory of ['apps', 'packages']) {
  try { if (statSync(path.join(root, directory)).isDirectory()) walk(path.join(root, directory)); } catch { /* optional */ }
}
if (violations.length) { console.error(violations.join('\n')); process.exit(1); }
console.log('architecture ok');
