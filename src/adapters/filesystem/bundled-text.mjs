import fs from 'node:fs';
import path from 'node:path';

/** Read packaged text without links, special files or unbounded tree traversal. */
export function readBoundedTextTree(root, { maxFiles = 16, maxBytes = 128 * 1024, maxDepth = 4 } = {}) {
  const files = [];
  let bytes = 0;
  const walk = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!/^[A-Za-z0-9._-]+$/.test(entry.name) || entry.name === '.' || entry.name === '..' || entry.isSymbolicLink()) throw new Error('Bundled Skill contains an unsafe path.');
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (relative.split('/').length > maxDepth) throw new Error('Bundled Skill exceeds directory depth.');
        walk(absolute, relative);
      } else if (entry.isFile()) {
        if (files.length >= maxFiles) throw new Error('Bundled Skill exceeds its file budget.');
        const data = fs.readFileSync(absolute);
        bytes += data.length;
        const content = data.toString('utf8');
        if (bytes > maxBytes || !Buffer.from(content, 'utf8').equals(data)) throw new Error('Bundled Skill contains invalid or oversized text.');
        files.push({ relative, content });
      } else throw new Error('Bundled Skill contains an unsupported file type.');
    }
  };
  walk(root);
  return files;
}
