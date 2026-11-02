import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertNoLinkAncestor } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';

/** Hash retained inputs in bounded memory without discarding large evidence files. */
export function changedFileDigest(root, relative, budget) {
  assertNoLinkAncestor(root, relative);
  const absolute = path.join(root, relative);
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size > 256n * 1024n * 1024n) throw usageError('Changed file exceeds the 256 MiB streaming approval budget.');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      bytes += count;
      budget.bytes += count;
      if (budget.bytes > 2 * 1024 * 1024 * 1024) throw usageError('Changed content exceeds the 2 GiB streaming approval budget.');
      hash.update(buffer.subarray(0, count));
    }
    assertNoLinkAncestor(root, relative);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(absolute, { bigint: true });
    if (BigInt(bytes) !== before.size || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key] || before[key] !== current[key])) {
      throw usageError('Changed file moved or mutated while preparing approval evidence.');
    }
    return hash.digest('hex');
  } finally { fs.closeSync(descriptor); }
}
