import path from 'node:path';
import { readBoundedRepositoryFile } from '../../adapters/filesystem/index.mjs';
import { adapterSkillSuffix, sha256, skillAdapterContent } from '../../shared/index.mjs';
import { selectedSkillDirectories } from '../../catalogs/index.mjs';

export const DEVELOPMENT_DOCUMENT_ROOT = 'docs/development';
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Keep source evidence as plain paths, never as code hyperlinks or filesystem links. */
export function migrateHumanDocument(content, previous, current) {
  const references = new Map();
  const code = target => /\.(?:[cm]?[jt]sx?|java|kt|kts|swift|vue|py|cs|go|rb|php|sh)(?:#.*)?$/i.test(target) && !/^https?:/.test(target);
  const sourcePath = target => path.posix.normalize(path.posix.join(path.posix.dirname(previous), target));
  let result = content.replace(/^\[([^\]]+)\]:\s*<?([^\s>]+)>?[^\n]*$/gm, (line, id, target) => {
    if (!code(target)) return line;
    references.set(id, sourcePath(target));
    return '';
  });
  result = result.replace(/\[([^\]]+)\]\[([^\]]+)\]/g, (text, label, id) => references.has(id) ? `${label} (source: \`${references.get(id)}\`)` : text);
  result = result.replace(/\[([^\]]+)\]\(<?([^\s)>]+)>?\)/g, (text, label, target) => {
    if (code(target)) return `${label} (source: \`${sourcePath(target)}\`)`;
    if (/^(?:https?:|#)/.test(target)) return text;
    const [file, anchor] = target.split('#');
    const resolved = sourcePath(file).replace(/^docs\/ai\/development\/root\.md$/, 'docs/development/README.md')
      .replace(/^docs\/ai\/development\//, 'docs/development/');
    return `[${label}](${path.posix.relative(path.posix.dirname(current), resolved)}${anchor ? `#${anchor}` : ''})`;
  });
  return result;
}

export function retainedHumanDocument(root, current, legacy, fallback) {
  for (const relative of [current, legacy]) {
    try {
      const content = readBoundedRepositoryFile(root, relative, 256 * 1024).bytes.toString('utf8');
      return relative === current ? content : migrateHumanDocument(content, relative, current);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return fallback;
}

/** Human documents own the instructions; compiled Skills carry their complete body. */
export function compileDevelopmentDocument(root, relative, fallback, header) {
  let content = fallback;
  if (root) {
    try { content = readBoundedRepositoryFile(root, relative, 128 * 1024).bytes.toString('utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const sourceSha256 = sha256(content);
  return {
    document: { path: relative, content, ownership: 'seed', kind: 'development-guidance-document', source: 'development-guidance' },
    content: `${header.trimEnd()}\nsource_document: ${relative}\n---\n\n${content.trim()}\n`,
    sourceSha256,
  };
}

export function humanDocumentFromSkill(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error('Development guidance requires a named Skill header.');
  return { header: `---\n${match[1]}`, body: content.slice(match[0].length).trimStart() };
}

/** Explicitly authored project guides are compiled; filenames never invent business rules. */
export function buildProjectDocumentSkills(config, scan) {
  const artifacts = [];
  const ids = new Set();
  const sources = [];
  for (const file of scan.files ?? []) {
    if (file.type !== 'file' || !/^docs\/development\/skills\/[^/]+\.md$/.test(file.relative)) continue;
    const text = readBoundedRepositoryFile(scan.root, file.relative, 128 * 1024).bytes.toString('utf8');
    const { header, body } = humanDocumentFromSkill(text);
    const id = header.match(/^name:\s*([a-z0-9-]+)\s*$/m)?.[1];
    if (!id || !ID.test(id) || ids.has(id) || path.posix.basename(file.relative) !== `${id}.md`) throw new Error(`Invalid or duplicate development guide name: ${file.relative}`);
    ids.add(id);
    if (!/^description:\s*\S.+/m.test(header)) throw new Error(`Development guide needs a task description: ${file.relative}`);
    for (const section of ['When to use', 'Required invariants', 'Correct implementation shape', 'Incorrect implementation shape', 'Verification matrix']) {
      if (!body.includes(`## ${section}`)) throw new Error(`Development guide ${file.relative} is missing ${section}.`);
    }
    if (body.length < 200 || !body.includes('```')) throw new Error(`Development guide must contain instructions and implementation examples: ${file.relative}`);
    const compiled = compileDevelopmentDocument(null, file.relative, body, header);
    sources.push({ id, document: file.relative, sha256: sha256(text), skill: `docs/ai/skills/development/${id}/SKILL.md` });
    const canonical = `docs/ai/skills/development/${id}/SKILL.md`;
    artifacts.push({ path: canonical, content: compiled.content, ownership: 'full', kind: 'project-document-skill', source: file.relative });
    for (const directory of selectedSkillDirectories(config.clients ?? [])) artifacts.push({
      path: `${directory}/${adapterSkillSuffix(canonical)}`, content: skillAdapterContent(canonical, compiled.content),
      ownership: 'full', kind: 'project-document-adapter-skill', source: canonical,
    });
  }
  if (sources.length) artifacts.push({ path: 'docs/ai/development/skills.json', content: JSON.stringify({ schemaVersion: 1, sources }, null, 2) + '\n', ownership: 'full', kind: 'development-skill-index', source: 'development-guidance' });
  return { artifacts };
}
