// Read-only snapshot of user skills; run outside the native mod runtime.
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const optional = async (read, fallback) => {
  try { return await read(); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return fallback; throw error; }
};

async function fingerprint(path, hash, ancestors = new Set()) {
  const actual = await realpath(path);
  if (ancestors.has(actual)) return;
  const info = await stat(path);
  if (info.isDirectory()) {
    hash.update('directory');
    const next = new Set(ancestors).add(actual);
    const names = (await readdir(path)).filter(name => !name.startsWith('.') && name !== 'node_modules').sort();
    for (const name of names) {
      hash.update(JSON.stringify(name));
      await fingerprint(join(path, name), hash, next);
    }
  } else if (info.isFile()) {
    hash.update(`file:${info.size}:`);
    hash.update(await readFile(path));
  }
}

export async function skillSnapshot(userHome = homedir()) {
  const items = {};
  for (const root of ['.agents/skills', '.codex/skills']) {
    const directory = join(userHome, root);
    const names = await optional(() => readdir(directory), []);
    for (const name of names.sort()) {
      if (name.startsWith('.')) continue;
      const path = join(directory, name);
      const info = await optional(() => stat(path), null);
      if (!info?.isDirectory()) continue;
      const hash = createHash('sha256');
      // A disappearing file invalidates this scan; retain the last successful snapshot.
      await fingerprint(path, hash);
      items[`${root}/${name}`] = hash.digest('hex');
    }
  }
  return items;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { console.log(JSON.stringify(await skillSnapshot())); }
  catch (error) { console.log(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
