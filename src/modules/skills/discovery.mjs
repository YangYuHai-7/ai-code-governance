import fs from 'node:fs';
import path from 'node:path';
import { isSafeRelative, sha256, stableJson } from '../../shared/index.mjs';
import { MANIFEST_PATH, TOOL_NAME } from '../../constants.mjs';

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ENTRIES = 2048;
const MAX_DEPTH = 6;
const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** No link traversal, executable loading, or unbounded content reads. */
export function readSkillManifest(root, relative) {
  if (path.basename(relative) !== 'SKILL.md') throw new Error('Unsafe Skill source path.');
  return readBoundedMetadata(root, relative);
}

function readBoundedMetadata(root, relative) {
  if (!path.isAbsolute(root) || !isSafeRelative(relative)) throw new Error('Unsafe Skill source path.');
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw new Error('Unsafe Skill source root.');
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('Skill source traverses a symbolic link.');
  }
  const before = fs.lstatSync(current);
  if (!before.isFile() || before.size > MAX_MANIFEST_BYTES) throw new Error('Skill source must be a bounded regular file.');
  const fd = fs.openSync(current, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.size > MAX_MANIFEST_BYTES || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('Skill source changed while opening.');
    const buffer = Buffer.alloc(MAX_MANIFEST_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fs.fstatSync(fd);
    if (length > MAX_MANIFEST_BYTES || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error('Skill source changed or exceeded its read budget.');
    const bytes = buffer.subarray(0, length);
    const content = bytes.toString('utf8');
    if (!Buffer.from(content, 'utf8').equals(bytes)) throw new Error('Skill metadata must contain valid UTF-8 bytes.');
    return content;
  } finally { fs.closeSync(fd); }
}

function scalar(value) {
  const text = value.trim();
  if (text.startsWith('"')) return JSON.parse(text);
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) throw new Error('Unsupported quoted Skill metadata.');
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (/^[!&*{>|]/.test(text) || text.includes('\0')) throw new Error('Unsupported Skill metadata syntax.');
  return text;
}

function metadata(content) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!frontmatter || Buffer.byteLength(frontmatter) > 8192) throw new Error('Missing or oversized Skill metadata.');
  const values = {};
  let active = null;
  for (const line of frontmatter.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const header = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (header) {
      const [, key, raw] = header;
      if (Object.hasOwn(values, key)) throw new Error('Duplicate Skill metadata key.');
      active = key;
      values[key] = raw === '' ? [] : raw.startsWith('[') ? JSON.parse(raw) : scalar(raw);
    } else if (/^\s+-\s+/.test(line) && Array.isArray(values[active])) {
      values[active].push(scalar(line.replace(/^\s+-\s+/, '')));
    } else throw new Error('Unsupported Skill metadata structure.');
  }
  if (typeof values.name !== 'string' || !ID.test(values.name) || typeof values.description !== 'string' || !values.description.trim() || values.description.length > 500) throw new Error('Skill name and bounded description are required.');
  return values;
}

function ids(values, fallback = []) {
  const result = values ?? fallback;
  if (!Array.isArray(result) || result.length > 32 || result.some((value) => typeof value !== 'string' || !ID.test(value))) throw new Error('Skill metadata requires bounded identifier lists.');
  return [...new Set(result)].sort();
}

function candidate(record, sourceKind, source, required, location = null) {
  const capabilities = ids(record.capabilities, [record.name ?? record.id]);
  const matched = capabilities.filter((value) => required.includes(value));
  if (required.length && !matched.length) return null;
  const owner = record.capabilityOwner ?? capabilities[0];
  if (!ID.test(owner ?? '') || !capabilities.includes(owner)) throw new Error('Skill capabilityOwner must identify a declared capability.');
  const version = record.version ?? 'unverified';
  if (typeof version !== 'string' || !version || version.length > 128 || /[\r\n\0]/.test(version)) throw new Error('Invalid Skill version.');
  if (!/^[a-f0-9]{64}$/.test(record.contentSha256 ?? '')) throw new Error('Skill content digest is required.');
  const permissions = ids(record.permissions);
  return {
    id: `${record.name ?? record.id}-${sha256(source).slice(0, 12)}`,
    sourceKind, source, version, contentSha256: record.contentSha256,
    capabilities, capabilityOwner: owner,
    matchedEvidence: matched.map((id) => `required-capability:${id}`),
    reason: matched.length ? 'Matches an explicitly required capability.' : 'Available offline metadata; task applicability is not assumed.',
    overlaps: [], permissions, contextBudget: { estimatedTokens: Math.ceil((record.contentBytes ?? 0) / 4) },
    verification: 'stated',
    availability: sourceKind === 'official-curated' && !recentCatalog(record.verifiedAt) ? 'refresh-due' : 'available',
    ...(sourceKind === 'official-curated' ? { catalogVerifiedAt: record.verifiedAt ?? null } : {}),
    decision: 'discovered', ...(location ? { location } : {}),
  };
}

function recentCatalog(value) {
  const timestamp = Date.parse(value);
  return timestamp > Date.now() - 90 * 86400000 && timestamp <= Date.now();
}

function adapterEntries(root) {
  const manifest = JSON.parse(readBoundedMetadata(root, MANIFEST_PATH));
  if (manifest.schemaVersion !== 1 || manifest.generatedBy !== TOOL_NAME || !Array.isArray(manifest.files) || manifest.files.length > 256) throw new Error('Unverified project adapter manifest.');
  const seen = new Set();
  for (const entry of manifest.files) {
    if (seen.has(entry.path)) throw new Error('Duplicate project adapter manifest paths.');
    seen.add(entry.path);
  }
  return manifest.files.filter((entry) => entry.ownership === 'full'
    && ['adapter-skill', 'project-capability-adapter-skill', 'technical-standard-adapter-skill'].includes(entry.kind)
    && /^\.(?:agents|claude)\/skills\/[A-Za-z0-9._/-]+\/SKILL\.md$/.test(entry.path)
    && isSafeRelative(entry.path) && entry.source === `docs/ai/skills/${entry.path.split('/').slice(2).join('/')}`
    && /^[a-f0-9]{64}$/.test(entry.sha256 ?? ''));
}

export function assertSkillCandidateFresh(item, root = null) {
  if (item.sourceKind === 'official-curated') {
    if (!recentCatalog(item.catalogVerifiedAt)) throw new Error('Skill catalog snapshot is refresh-due; approval is stale.');
    return;
  }
  if (root && item.sourceKind === 'project' && item.location.root !== root) throw new Error('Approved project Skill source belongs to another root.');
  const content = readSkillManifest(item.location.root, item.location.relative);
  if (sha256(content) !== item.contentSha256) throw new Error(`Approved Skill source digest is stale: ${item.id}`);
  const current = candidate({ ...metadata(content), contentSha256: sha256(content), contentBytes: Buffer.byteLength(content) }, item.sourceKind, item.source, [], item.location);
  for (const key of ['version', 'capabilities', 'permissions', 'capabilityOwner']) {
    if (stableJson(current[key]) !== stableJson(item[key])) throw new Error(`Approved Skill source metadata is stale: ${key}`);
  }
  if (item.adapterEvidence) {
    const entry = adapterEntries(item.location.root).find((value) => value.path === item.location.relative);
    if (!entry || entry.sha256 !== item.contentSha256 || entry.source !== item.adapterEvidence.source || entry.kind !== item.adapterEvidence.kind) throw new Error('Approved Skill adapter source evidence is stale.');
  }
}

/** Return the JSON wire contract without dropping array-attached source diagnostics. */
export function serializeSkillDiscovery(discovery) {
  const candidates = Array.isArray(discovery) ? discovery : discovery?.candidates;
  const sourceStatus = Array.isArray(discovery) ? discovery.sourceStatus ?? [] : discovery?.sourceStatus;
  if (!Array.isArray(candidates) || candidates.length > 5 || !Array.isArray(sourceStatus)
    || sourceStatus.length > 8192) throw new Error('Skill discovery requires at most five candidates and bounded sourceStatus diagnostics.');
  for (const item of sourceStatus) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.source !== 'string' || !item.source || item.source.length > 2048
      || !['available', 'unavailable', 'skipped-unsafe'].includes(item.status)
      || (item.reason !== undefined && (typeof item.reason !== 'string' || item.reason.length > 4096))
      || Object.keys(item).some((key) => !['source', 'status', 'reason'].includes(key))) throw new Error('Invalid sourceStatus diagnostic.');
  }
  const result = { candidates: candidates.map((item) => structuredClone(item)), sourceStatus: structuredClone(sourceStatus) };
  if (Buffer.byteLength(stableJson(result.sourceStatus)) > 256 * 1024) throw new Error('Skill sourceStatus metadata budget exceeded.');
  return result;
}

/** Discover metadata only. installedRoots is mandatory even when intentionally empty. */
export function discoverSkills({ root, installedRoots, curatedCatalog = [], requiredCapabilities = [] } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('root must be an explicit absolute project directory.');
  if (!Array.isArray(installedRoots) || installedRoots.some((value) => typeof value !== 'string' || !path.isAbsolute(value))) throw new Error('installedRoots must be an explicit array of absolute directories.');
  if (installedRoots.length > 16 || !Array.isArray(curatedCatalog) || curatedCatalog.length > 256) throw new Error('Skill source budget exceeded.');
  const required = ids(requiredCapabilities);
  const found = [];
  const sourceStatus = [];
  let visited = 0;
  const scan = (sourceRoot, relative, sourceKind, label, depth = 0) => {
    const source = `${label}:${relative || '.'}`;
    try {
      const absolute = path.join(sourceRoot, relative);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('symbolic link');
      if (depth > MAX_DEPTH || ++visited > MAX_ENTRIES) throw new Error('scan budget exceeded');
      if (stat.isDirectory()) {
        const dir = fs.opendirSync(absolute);
        const entries = [];
        try {
          let entry;
          while ((entry = dir.readSync())) {
            if (entries.length + visited >= MAX_ENTRIES) throw new Error('scan budget exceeded');
            entries.push(entry.name);
          }
        } finally { dir.closeSync(); }
        for (const name of entries.sort()) scan(sourceRoot, relative ? `${relative}/${name}` : name, sourceKind, label, depth + 1);
      } else if (stat.isFile() && path.basename(relative) === 'SKILL.md') {
        const content = readSkillManifest(sourceRoot, relative);
        const result = candidate({ ...metadata(content), contentSha256: sha256(content), contentBytes: Buffer.byteLength(content) }, sourceKind, source, required, { root: sourceRoot, relative });
        if (result) found.push(result);
      }
    } catch (error) {
      sourceStatus.push({ source, status: error.code === 'ENOENT' || error.code === 'EACCES' ? 'unavailable' : 'skipped-unsafe', reason: error.code ?? error.message });
    }
  };
  // Only the canonical project tree is authoritative; generated client copies are not extra owners.
  // Verify every ancestor before walking, so a linked docs/ai parent cannot disclose external metadata.
  const scanRoot = (sourceRoot, relative, kind, label) => {
    try {
      const components = relative ? relative.split('/') : [];
      let current = sourceRoot;
      for (const component of ['', ...components]) {
        if (component) current = path.join(current, component);
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('unsafe source directory');
      }
      sourceStatus.push({ source: label, status: 'available' });
      scan(sourceRoot, relative, kind, label);
    } catch (error) { sourceStatus.push({ source: label, status: error.code === 'ENOENT' || error.code === 'EACCES' ? 'unavailable' : 'skipped-unsafe', reason: error.code ?? error.message }); }
  };
  scanRoot(root, 'docs/ai/skills', 'project', 'project');
  try {
    for (const entry of adapterEntries(root)) {
      try {
        const content = readSkillManifest(root, entry.path);
        if (sha256(content) !== entry.sha256) throw new Error('Adapter manifest digest mismatch.');
        const result = candidate({ ...metadata(content), contentSha256: entry.sha256, contentBytes: Buffer.byteLength(content) }, 'project', `project:${entry.path}`, required, { root, relative: entry.path });
        if (result) found.push({ ...result, adapterEvidence: { source: entry.source, kind: entry.kind } });
      } catch (error) { sourceStatus.push({ source: entry.path, status: 'skipped-unsafe', reason: error.message }); }
    }
  } catch (error) { sourceStatus.push({ source: 'project-adapters', status: error.code === 'ENOENT' ? 'unavailable' : 'skipped-unsafe', reason: error.code ?? error.message }); }
  for (const [index, sourceRoot] of [...new Set(installedRoots)].entries()) scanRoot(sourceRoot, '', 'installed', `installed-${index}`);
  for (const record of curatedCatalog) {
    try {
      if (!record || !ID.test(record.id ?? '') || typeof record.source !== 'string' || !/^(?:official|curated):[A-Za-z0-9._/-]{1,180}$/.test(record.source)) throw new Error('Invalid offline catalog identity.');
      const result = candidate(record, 'official-curated', record.source, required);
      if (result) found.push(result);
    } catch (error) { sourceStatus.push({ source: 'official-curated', status: 'skipped-unsafe', reason: error.message }); }
  }
  const owners = new Map();
  const priority = { project: 0, installed: 1, 'official-curated': 2 };
  for (const item of found) {
    const previous = owners.get(item.capabilityOwner);
    if (!previous) owners.set(item.capabilityOwner, item);
    else {
      previous.overlaps.push({ id: item.id, source: item.source, contentSha256: item.contentSha256 });
      if (priority[previous.sourceKind] === priority[item.sourceKind] && previous.contentSha256 !== item.contentSha256) previous.availability = 'needs-user-decision';
    }
  }
  const result = [...owners.values()].slice(0, 5);
  Object.defineProperties(result, {
    sourceStatus: { value: sourceStatus, enumerable: false },
    toJSON: { value: () => serializeSkillDiscovery(result), enumerable: false },
  });
  return result;
}
