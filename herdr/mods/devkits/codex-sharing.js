// Invoked only by Manage's explicit Sync action. Never part of session startup.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { lstat, stat as fileStat, realpath, readFile, readdir, mkdir, symlink, readlink, unlink, writeFile, rename, rm } from 'node:fs/promises';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const manifestName = 'devkits-shared.json';
const remoteMarket = name => /^(?:chatgpt(?:-|$)|openai-curated-remote$)/i.test(name);
const safeName = name => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name) && name !== '..';
const absent = async path => { try { return await lstat(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const inside = (root, path) => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)); };

// Use Codex's TOML parser/editor, preserving comments, unrelated keys and concurrent edits.
export async function openConfig(directory) {
  const env = { ...process.env, CODEX_HOME: directory };
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN']) delete env[key];
  const child = spawn('codex', ['-c', 'cli_auth_credentials_store="file"', 'app-server', '--listen', 'stdio://'],
    { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume(); // Diagnostics may contain private config; do not forward them to the UI.
  const lines = createInterface({ input: child.stdout });
  let id = 0;
  const pending = new Map();
  const fail = error => { for (const item of pending.values()) item.reject(error); pending.clear(); };
  child.on('error', () => fail(new Error('Could not start Codex. Check that Codex CLI is installed.')));
  child.on('exit', () => fail(new Error('Codex stopped before settings synchronization finished.')));
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error.message || 'Codex rejected the settings update.'));
    else item.resolve(message.result);
  });
  child.stdin.on('error', () => fail(new Error('Could not send settings to Codex.')));
  const request = (method, params) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error('Settings synchronization timed out.')); }, 30000);
    pending.set(key, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    child.stdin.write(`${JSON.stringify({ id: key, method, params })}\n`);
  });
  const close = async () => {
    lines.close(); child.stdin.end();
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill();
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1500);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  };
  try {
    await request('initialize', { clientInfo: { name: 'devkits_settings_sync', version: '0.1.0' } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    const result = await request('config/read', { includeLayers: true });
    const layer = result.layers?.find(layer => layer.name.type === 'user' && !layer.name.profile &&
      resolve(layer.name.file) === join(directory, 'config.toml'));
    if (!layer || layer.disabledReason) throw new Error('Codex did not return this account’s user settings. Update Codex CLI and retry.');
    return { config: layer.config, version: layer.version, close,
      write: edits => request('config/batchWrite', { edits, expectedVersion: layer.version,
        filePath: join(directory, 'config.toml'), reloadUserConfig: false }) };
  } catch (error) { await close(); throw error; }
}

function entries(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
}

export function sharedSettings(config) {
  // Only explicitly configured local/Git marketplaces. Account-owned catalogs are excluded.
  const markets = Object.fromEntries(entries(config.marketplaces).filter(([name, value]) => safeName(name) &&
    !remoteMarket(name) && ['local', 'git'].includes(value?.source_type) && typeof value.source === 'string'));
  const plugins = Object.fromEntries(entries(config.plugins).filter(([key]) => {
    const at = key.lastIndexOf('@');
    return at > 0 && safeName(key.slice(0, at)) && Object.hasOwn(markets, key.slice(at + 1));
  }));
  return { markets, plugins };
}

async function ownedDirectory(root, directory) {
  if (!inside(root, directory) || (await realpath(directory)) !== directory) {
    throw new Error('The account directory must be a real directory inside Devkits. Nothing was synchronized.');
  }
}

async function checkParents(root, path) {
  let parent = dirname(path);
  while (parent !== root) {
    const stat = await absent(parent);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error(`Cannot share through an existing link or file: ${parent}`);
    parent = dirname(parent);
  }
}

async function atomicJson(path, value) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); await rename(tmp, path); }
  finally { await rm(tmp, { force: true }); }
}

async function profileContext(root, key, userHome) {
  root = resolve(root);
  const match = /^devkits-codex-([a-zA-Z0-9][a-zA-Z0-9_-]{0,47})$/.exec(key || '');
  if (!match) throw new Error('Only saved Devkits Codex accounts can synchronize shared settings.');
  const directory = join(root, 'data', 'devkits', 'codex', match[1]);
  const programs = JSON.parse(await readFile(join(root, 'programs.json'), 'utf8')).programs;
  const argv = programs?.[key]?.run;
  if (!Array.isArray(argv) || !argv.includes(`CODEX_HOME=${directory}`)) throw new Error('This account does not use its own Devkits directory.');
  await ownedDirectory(root, directory);
  const source = await realpath(join(userHome, '.codex'));
  if (inside(source, directory) || inside(directory, source)) throw new Error('The shared source and account must be separate directories.');
  return { directory, source };
}

async function legacySkills(source) {
  const skills = await readdir(join(source, 'skills'), { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  return skills.filter(skill => !skill.name.startsWith('.') && (skill.isDirectory() || skill.isSymbolicLink())).map(skill => skill.name);
}

export async function listSharedItems(root, key, userHome = homedir(), configService = openConfig) {
  const { directory, source } = await profileContext(root, key, userHome);
  const base = await configService(source);
  let target;
  try {
    const { markets, plugins } = sharedSettings(base.config);
    const record = await readFile(join(directory, manifestName), 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    const old = record ? JSON.parse(record) : { plugins: [], links: {} };
    const items = Object.keys(plugins).map(key => ({ kind: 'plugins', key, label: key.slice(0, key.lastIndexOf('@')),
      detail: key.slice(key.lastIndexOf('@') + 1), selected: old.plugins.includes(key) }));
    for (const key of await legacySkills(source)) items.push({ kind: 'skills', key, label: key,
      selected: Object.hasOwn(old.links || {}, `skills/${key}`) });
    // Retain removed source items in the picker so a manual apply can clean them up.
    for (const key of old.plugins || []) if (!items.some(item => item.kind === 'plugins' && item.key === key)) {
      items.push({ kind: 'plugins', key, label: key, detail: 'Removed from source', selected: false, unavailable: true });
    }
    for (const name of Object.keys(old.links || {})) if (name.startsWith('skills/') && !items.some(item => item.kind === 'skills' && item.key === name.slice(7))) {
      items.push({ kind: 'skills', key: name.slice(7), label: name.slice(7), detail: 'Removed from source', selected: false, unavailable: true });
    }
    if ((await absent(join(directory, 'config.toml')))?.isSymbolicLink()) throw new Error('Profile settings must be independent files.');
    target = await configService(directory);
    for (const item of items) {
      if (item.unavailable) { item.status = 'source-missing'; continue; }
      const at = item.key.lastIndexOf('@');
      const market = item.key.slice(at + 1);
      const name = item.kind === 'skills' ? `skills/${item.key}` : `plugins/cache/${market}/${item.key.slice(0, at)}`;
      const path = join(directory, name), from = join(source, name);
      try { await checkParents(directory, path); }
      catch { item.status = 'conflict'; continue; }
      const stat = await absent(path);
      if (stat && (!stat.isSymbolicLink() || resolve(dirname(path), await readlink(path)) !== from)) {
        item.status = 'conflict'; continue;
      }
      const sourceStat = item.kind === 'skills' ? await fileStat(from).catch(e => { if (e.code === 'ENOENT') return null; throw e; }) : await absent(from);
      if (!sourceStat?.isDirectory()) { item.status = 'source-missing'; continue; }
      const settingsMatch = item.kind === 'skills' || (isDeepStrictEqual(target.config.plugins?.[item.key], plugins[item.key]) &&
        isDeepStrictEqual(target.config.marketplaces?.[market], markets[market]));
      item.status = stat && settingsMatch ? 'synced' : item.selected || stat ? 'pending' : 'not-shared';
    }
    return { items, remoteCount: Object.keys(base.config.plugins || {}).filter(key => !Object.hasOwn(plugins, key)).length };
  } finally { await Promise.allSettled([base.close(), target?.close()]); }
}

export async function syncProfile(root, key, userHome = homedir(), configService = openConfig, selection = null) {
  if (selection !== null && (!selection || !Array.isArray(selection.plugins) || !Array.isArray(selection.skills) ||
      ![...selection.plugins, ...selection.skills].every(key => typeof key === 'string'))) throw new Error('Invalid sharing selection.');
  const { directory, source } = await profileContext(root, key, userHome);
  // A filesystem lock also covers another Manage dialog or helper process.
  const lock = join(directory, '.devkits-sharing.lock');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('This account is already synchronizing.'); throw e; }
  let base, target;
  const created = [], removed = [];
  let committed = false;
  try {
    const manifestPath = join(directory, manifestName);
    const manifestStat = await absent(manifestPath);
    if (manifestStat?.isSymbolicLink()) throw new Error('The sharing record must not be a symlink.');
    const old = manifestStat ? JSON.parse(await readFile(manifestPath, 'utf8')) : { links: {}, plugins: [], marketplaces: [] };
    if (old.version !== undefined && old.version !== 1) throw new Error('Unsupported sharing record version.');
    for (const path of ['config.toml', 'config.toml.devkits-backup']) {
      if ((await absent(join(directory, path)))?.isSymbolicLink()) throw new Error('Profile settings must be independent files.');
    }
    base = await configService(source);
    let { markets, plugins } = sharedSettings(base.config);
    await base.close(); base = null;
    const skills = await legacySkills(source);
    if (selection) {
      if (selection.plugins.some(key => !Object.hasOwn(plugins, key)) || selection.skills.some(key => !skills.includes(key))) {
        throw new Error('The source changed. Reopen Sync and choose items again.');
      }
      plugins = Object.fromEntries(Object.entries(plugins).filter(([key]) => selection.plugins.includes(key)));
      const selectedMarkets = new Set(Object.keys(plugins).map(key => key.slice(key.lastIndexOf('@') + 1)));
      markets = Object.fromEntries(Object.entries(markets).filter(([key]) => selectedMarkets.has(key)));
    }
    const links = {};
    for (const key of Object.keys(plugins)) {
      const at = key.lastIndexOf('@'), plugin = key.slice(0, at), market = key.slice(at + 1);
      const name = `plugins/cache/${market}/${plugin}`;
      const from = join(source, name);
      if (!(await absent(from))?.isDirectory()) throw new Error(`Install ${plugin} in the main Codex profile before syncing.`);
      links[name] = from;
    }
    // Modern user skills already live in ~/.agents/skills. Link only legacy custom entries.
    for (const skill of skills) {
      if (!selection || selection.skills.includes(skill)) links[`skills/${skill}`] = join(source, 'skills', skill);
    }
    const managedPath = name => /^(?:plugins\/cache\/[a-zA-Z0-9][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_.-]*)?|skills\/[^/.][^/]*)$/.test(name) && !name.includes('\\');
    // Validate every conflict before creating any links or writing profile settings.
    for (const [name, from] of Object.entries(links)) {
      const path = join(directory, name);
      await checkParents(directory, path);
      const stat = await absent(path);
      if (stat && (!stat.isSymbolicLink() || resolve(dirname(path), await readlink(path)) !== from)) {
        throw new Error(`Already exists: ${name}. Existing files were kept; move or merge them before syncing.`);
      }
    }
    target = await configService(directory);
    const edits = [];
    for (const [table, values] of [['marketplaces', markets], ['plugins', plugins]]) {
      for (const [name, value] of Object.entries(values)) {
        if (!isDeepStrictEqual(target.config[table]?.[name], value)) {
          edits.push({ keyPath: `${table}.${JSON.stringify(name)}`, value, mergeStrategy: 'replace' });
        }
      }
      // Remove only entries previously imported by Devkits, preserving account-specific plugins.
      for (const name of old[table] || []) {
        if (typeof name !== 'string' || (table === 'marketplaces' ? !safeName(name) || remoteMarket(name) : remoteMarket(name.slice(name.lastIndexOf('@') + 1)))) continue;
        if (!Object.hasOwn(values, name) && Object.hasOwn(target.config[table] || {}, name)) {
          edits.push({ keyPath: `${table}.${JSON.stringify(name)}`, value: null, mergeStrategy: 'replace' });
        }
      }
    }
    if (edits.length) {
      const config = await readFile(join(directory, 'config.toml')).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
      if (config) await writeFile(join(directory, 'config.toml.devkits-backup'), config, { flag: 'wx', mode: 0o600 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
    }
    const managedLinks = {};
    for (const [name, from] of Object.entries(links)) {
      const path = join(directory, name);
      if (await absent(path)) {
        if (old.links?.[name] === from) managedLinks[name] = from;
        continue;
      }
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await symlink(from, path, process.platform === 'win32' ? 'junction' : 'dir');
      created.push(path);
      managedLinks[name] = from;
    }
    if (edits.length) await target.write(edits);
    // Config writes are version-checked by Codex. Once committed, keep the matching links.
    committed = true;
    for (const [name, from] of Object.entries(old.links || {})) {
      if (Object.hasOwn(links, name) || !managedPath(name) || typeof from !== 'string') continue;
      const path = join(directory, name);
      await checkParents(directory, path);
      if ((await absent(path))?.isSymbolicLink() && resolve(dirname(path), await readlink(path)) === from) {
        await unlink(path); removed.push(name);
      }
    }
    await atomicJson(manifestPath, { version: 1, source, links: managedLinks, plugins: Object.keys(plugins), marketplaces: Object.keys(markets) });
    return { links: Object.keys(links).length, plugins: Object.keys(plugins).length, removed: removed.length,
      message: 'Changes apply to new sessions.' };
  } catch (error) {
    if (!committed) for (const path of created.reverse()) await unlink(path).catch(() => {});
    if (committed) throw new Error(`Settings were updated, but sharing cleanup did not finish. Retry Sync shared settings. ${error.message}`);
    throw error;
  } finally {
    await Promise.allSettled([base?.close(), target?.close()]);
    await rm(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = process.argv[4] === '--list'
      ? await listSharedItems(process.argv[2], process.argv[3])
      : await syncProfile(process.argv[2], process.argv[3], homedir(), openConfig, process.argv[4] ? JSON.parse(process.argv[4]) : null);
    console.log(JSON.stringify(result));
  }
  catch (error) { console.log(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
