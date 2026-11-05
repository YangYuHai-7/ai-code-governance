import fs from 'node:fs';
import path from 'node:path';

// Resolve files without invoking an interpreter or executing the candidate.
export function findExecutable(command, { env = process.env, cwd = process.cwd() } = {}) {
  if (typeof command !== 'string' || !command || command.includes('\0')) return null;
  const windows = process.platform === 'win32';
  const environment = (name) => windows
    ? Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
    : env[name];
  const extensions = windows && !path.extname(command)
    ? ['', ...(environment('PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
    : [''];
  const directories = command.includes('/') || (windows && command.includes('\\'))
    ? [''] : (environment('PATH') ?? '').split(path.delimiter);
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.resolve(cwd, directory, command + extension);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, windows ? fs.constants.F_OK : fs.constants.X_OK);
        return candidate;
      } catch { /* Missing or inaccessible candidates do not prove tool availability. */ }
    }
  }
  return null;
}
