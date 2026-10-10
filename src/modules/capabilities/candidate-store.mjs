import fs from 'node:fs';
import path from 'node:path';
import { usageError } from '../../kernel/index.mjs';

export const CANDIDATE_STORE_RELATIVE_PATH = '.ai-governance/state/candidate-rules.json';

// Candidate state is repository-local and append-safe: a corrupted file is reported, never reset,
// because silently dropping candidates would silently drop the governance history behind them.
export function openCandidateStore(root) {
  if (typeof root !== 'string' || root.length === 0) throw usageError('candidateStore.root is required.');
  const base = path.resolve(root);
  const file = path.join(base, CANDIDATE_STORE_RELATIVE_PATH);
  return Object.freeze({
    path: file,
    read() {
      if (!fs.existsSync(file)) return Object.freeze([]);
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch { throw usageError('candidateStore: the candidate file is not valid JSON; refusing to reset it.'); }
      if (!Array.isArray(parsed)) throw usageError('candidateStore: the candidate file must contain an array.');
      return Object.freeze(parsed);
    },
    write(list) {
      if (!Array.isArray(list)) throw usageError('candidateStore.write expects an array.');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(list, null, 2)}\n`);
      fs.renameSync(temporary, file);
      return Object.freeze([...list]);
    },
  });
}
