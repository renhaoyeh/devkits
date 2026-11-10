// Finite filesystem work for the explicit Devkits data reset. Never edits shared.json.
import { execFile as execFileCallback } from 'node:child_process';
import { lstat, readFile, readdir, realpath, rename, rm, writeFile, open } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { commandArgv } from './components/session-shell.js';

const execFile = promisify(execFileCallback);
export const resetShortcuts = { f5: 'devkits.run', 'cmd-n': 'devkits.new-thread', 'cmd-w': 'devkits.close-file' };
const read = path => readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
const entries = path => readdir(path, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
async function plain(path) {
  const stat = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (stat?.isSymbolicLink()) throw new Error(`Remove the symbolic link before resetting: ${path}`);
}
async function roots(directory) {
  const root = resolve(directory), physical = await realpath(root);
  if (physical === dirname(physical)) throw new Error('Invalid Herdr home.');
  await plain(join(root, 'data'));
  await plain(join(root, 'data', 'devkits'));
  return { root, data: join(root, 'data', 'devkits') };
}
function object(source, name) {
  let value;
  try { value = source === null ? {} : JSON.parse(source); }
  catch { throw new Error(`Could not parse ${name}. Repair it before resetting.`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${name}.`);
  return value;
}

async function acquireLock(path) {
  try {
    const existing = await lstat(path);
    await plain(path);
    let pid;
    try { pid = JSON.parse(await read(path))?.pid; } catch {}
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('A reset lock already exists. Check whether another reset is running.');
    let running = true;
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') running = false; }
    if (running) throw new Error('Another Devkits reset is running.');
    const current = await lstat(path);
    if (current.ino !== existing.ino || current.dev !== existing.dev) throw new Error('Another Devkits reset is running.');
    await rm(path);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let lock;
  try { lock = await open(path, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another Devkits reset is running.'); throw error; }
  try { await lock.writeFile(JSON.stringify({ pid: process.pid })); }
  catch (error) { await lock.close(); await rm(path, { force: true }); throw error; }
  return lock;
}
async function update(path, original, next) {
  await plain(path);
  if (await read(path) !== original) throw new Error('Settings changed during reset. Retry after closing other settings windows.');
  const temporary = `${path}.devkits-reset-${process.pid}`;
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (await read(path) !== original) throw new Error('Settings changed during reset. Please retry.');
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function inspectReset(directory) {
  const { root, data } = await roots(directory);
  await plain(join(root, 'programs.json'));
  const source = await read(join(root, 'programs.json'));
  const programs = object(source, 'programs.json');
  if (programs.programs !== undefined) object(JSON.stringify(programs.programs), 'program entries');
  const accountKeys = Object.entries(programs.programs || {}).filter(([key, entry]) => {
    if (!/^devkits-(?:claude|codex)-[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(key)) return false;
    if (!Array.isArray(entry?.run) || !entry.run.some(arg => String(arg).replaceAll('\\', '/').includes(data.replaceAll('\\', '/') + '/'))) {
      throw new Error(`Account ${key} uses a directory outside Devkits. Remove it from Agent settings before resetting.`);
    }
    return true;
  }).map(([key]) => key);
  const accounts = [];
  for (const provider of ['claude', 'codex']) {
    await plain(join(data, provider));
    for (const entry of await entries(join(data, provider)))
      if (entry.isDirectory()) accounts.push({ provider, directory: join(data, provider, entry.name) });
  }
  const state = object(await read(join(root, 'shared.json')), 'shared state');
  await plain(join(root, 'keys.json'));
  const keysSource = await read(join(root, 'keys.json'));
  const keys = object(keysSource, 'key bindings');
  return { accountKeys, accounts, sharedKeys: Object.keys(state).filter(key => key.startsWith('devkits.')),
    programsSource: source, programs, keysSource, keys };
}

export async function signOut({ provider, directory }, execute = execFile, platform = process.platform === 'win32' ? 'windows' : process.platform) {
  const env = { ...process.env };
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[key];
  if (provider === 'codex') env.CODEX_HOME = directory;
  else { env.CLAUDE_CONFIG_DIR = directory; env.CLAUDE_SECURESTORAGE_CONFIG_DIR = directory; }
  try {
    const [command, ...args] = commandArgv([provider, ...(provider === 'codex' ? ['logout'] : ['auth', 'logout'])], platform);
    await execute(command, args, { env, timeout: 30000, windowsHide: true });
  } catch { throw new Error(`Could not sign out a Devkits ${provider} account. Its files were kept; retry after checking the CLI.`); }
}

export async function stopAccountSessions(data, execute = execFile) {
  const options = { timeout: 10000, maxBuffer: 8 * 1024 * 1024, windowsHide: true };
  const { stdout } = await execute('hc', ['ls', '--json'], options);
  const listing = JSON.parse(stdout), terminals = Array.isArray(listing) ? listing : listing.terminals;
  if (!Array.isArray(terminals)) throw new Error('Could not check Devkits account sessions.');
  const prefix = data.replaceAll('\\', '/') + '/';
  const owned = new Set(terminals.filter(terminal => terminal.state !== 'finished' &&
    ['CODEX_HOME=', 'CLAUDE_CONFIG_DIR='].some(variable => JSON.stringify(terminal.argv || []).replaceAll('\\\\', '/').includes(variable + prefix)))
    .map(terminal => terminal.address));
  // Include actual child terminals, including children intentionally kept alive.
  for (let changed = true; changed;) {
    changed = false;
    for (const terminal of terminals) if (terminal.state !== 'finished' && owned.has(terminal.parent) && !owned.has(terminal.address)) {
      owned.add(terminal.address); changed = true;
    }
  }
  // Children first, so ending their parent cannot turn a following kill into a stale request.
  const ordered = terminals.filter(terminal => owned.has(terminal.address));
  const depth = terminal => {
    const seen = new Set(); let parent = terminal.parent;
    while (owned.has(parent) && !seen.has(parent)) { seen.add(parent); parent = terminals.find(item => item.address === parent)?.parent; }
    return seen.size;
  };
  ordered.sort((a, b) => depth(b) - depth(a));
  for (const terminal of ordered) {
    if (typeof terminal.address !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(terminal.address)) throw new Error('Invalid Devkits terminal address.');
    try { await execute('hc', ['kill', terminal.address], options); }
    catch (error) {
      // Another native project close can have finished or removed it in the meantime.
      const current = JSON.parse((await execute('hc', ['ls', '--json'], options)).stdout);
      const remaining = Array.isArray(current) ? current : current.terminals;
      if (!Array.isArray(remaining) || remaining.some(item => item.address === terminal.address && item.state !== 'finished'))
        throw new Error('Could not stop a Devkits account session. No account files were removed; Retry to try again.');
    }
  }
}

export async function idleAccounts(data, execute = execFile, platform = process.platform, stop = false) {
  const options = { timeout: 10000, maxBuffer: 8 * 1024 * 1024, windowsHide: true };
  const { stdout } = await execute('hc', ['ls', '--json'], options);
  const result = JSON.parse(stdout);
  const terminals = Array.isArray(result) ? result : result.terminals;
  if (!Array.isArray(terminals)) throw new Error('Could not check running account sessions.');
  const prefix = data.replaceAll('\\', '/');
  if (terminals.some(terminal => terminal.state !== 'finished' && JSON.stringify(terminal.argv || []).replaceAll('\\\\', '/').includes(prefix)))
    throw new Error('Close the terminals using Devkits accounts before clearing data.');
  // Unmounting a native view cancels its callbacks, but an already started exec can
  // finish later. In particular, analytics readers write cache files on completion.
  const root = dirname(dirname(data));
  let writers;
  if (platform === 'win32') {
    const result = await execute('cscript', ['//Nologo', join(root, 'mods/devkits/reset-processes-windows.js'), root, String(process.pid), ...(stop ? ['stop'] : [])], options);
    writers = JSON.parse(result.stdout);
  } else {
    const result = await execute('ps', ['-axww', '-o', 'pid=,ppid=,comm=,args='], options);
    writers = resetProcessPids(result.stdout, root);
    if (stop) for (const pid of [...writers].reverse()) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  if (!Array.isArray(writers)) throw new Error('Could not check Devkits background readers.');
  if (!stop && writers.length) throw new Error('Devkits services are still stopping. Wait a moment, then Retry.');
}

export function resetProcessPids(source, root, ownPid = process.pid) {
  const rows = source.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), name: match[3], args: match[4] }] : [];
  });
  const prefix = `${root}/mods/devkits`;
  const owned = rows.filter(row => {
    const offset = row.args.indexOf(prefix);
    return row.pid !== ownPid && /(?:^|\/)node$/.test(row.name) && offset >= 0 &&
      (offset === 0 || /["\s]/.test(row.args[offset - 1])) && /^(?:\/|-[a-z0-9-]+\/)/.test(row.args.slice(offset + prefix.length));
  }).map(row => row.pid);
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) if (row.pid !== ownPid && !owned.includes(row.pid) && owned.includes(row.parent)) {
      owned.push(row.pid); changed = true;
    }
  }
  return owned;
}

export async function stopDevkitsServices(data, execute = execFile, platform = process.platform) {
  const deadline = Date.now() + 15000;
  for (;;) {
    await idleAccounts(data, execute, platform, true);
    try { await idleAccounts(data, execute, platform); return; }
    catch (error) {
      if (!error.message.startsWith('Devkits services are still stopping.') || Date.now() >= deadline) throw error;
      await delay(250);
    }
  }
}

// Restore only integrations still owned by this installation. Default account credentials,
// conversations and independently changed settings stay outside the reset boundary.
export async function cleanDefaultClaude(root, userHome) {
  const directory = join(userHome, '.claude');
  await plain(directory);
  const path = join(directory, 'settings.json'), source = await read(path);
  const settings = object(source, 'Claude settings');
  const command = `node "${root.replaceAll('\\', '/')}/mods/devkits-usage/claude-statusline.js"`;
  if (settings.statusLine?.command === command) {
    const saved = await read(join(directory, 'devkits-statusline-chain.json'));
    if (saved === null) delete settings.statusLine;
    else settings.statusLine = object(saved, 'previous Claude status line');
    await update(path, source, settings);
  }
  for (const name of ['devkits-usage.json', 'devkits-usage.json.tmp', 'devkits-statusline-chain.json', 'settings.json.devkits-backup'])
    await rm(join(directory, name), { force: true });
}

async function cleanDefaultCodex(root, userHome) {
  const directory = join(userHome, '.codex');
  await plain(directory);
  const config = await read(join(directory, 'config.toml'));
  if (config?.includes('devkits_shared_mcp')) {
    try { await execFile(process.execPath, [join(root, 'mods/devkits-agents/shared-mcp-sync.js'), directory, '{}'], { timeout: 60000, windowsHide: true }); }
    catch { throw new Error('Could not remove Devkits MCP settings from the default Codex account. Check Codex CLI and retry.'); }
  }
  await rm(join(directory, 'config.toml.before-mcp-sync.bak'), { force: true });
}

export async function clearReset(directory, confirmation, services = {}) {
  if (confirmation !== 'DEVKITS') throw new Error('Type DEVKITS to confirm clearing data.');
  const { root, data } = await roots(directory);
  const lockPath = join(root, '.devkits-reset.lock');
  const lock = await acquireLock(lockPath);
  let signOutStarted = false;
  try {
    await (services.stopAccounts || stopAccountSessions)(data);
    await (services.stopServices || stopDevkitsServices)(data);
    await (services.idleAccounts || idleAccounts)(data);
    const plan = await inspectReset(root);
    const frames = join(root, 'mods', 'devkits-sim-frames');
    await plain(join(root, 'mods')); await plain(frames);
    signOutStarted = true;
    for (const account of plan.accounts) await (services.signOut || signOut)(account);
    const userHome = services.userHome || homedir();
    await (services.cleanClaude || cleanDefaultClaude)(root, userHome);
    await (services.cleanCodex || cleanDefaultCodex)(root, userHome);
    // Do not discard concurrent account additions or rename/remove changes.
    const latest = await inspectReset(root);
    if (latest.programsSource !== plan.programsSource || latest.keysSource !== plan.keysSource || JSON.stringify(latest.accounts) !== JSON.stringify(plan.accounts))
      throw new Error('Accounts changed during reset. No account files were removed; please retry.');
    for (const key of plan.accountKeys) delete plan.programs.programs[key];
    if (plan.accountKeys.length) await update(join(root, 'programs.json'), plan.programsSource, plan.programs);
    if (plan.keysSource !== null) await update(join(root, 'keys.json'), plan.keysSource, { ...plan.keys, 'layout:devkits': resetShortcuts });
    await roots(root); // Recheck the deletion boundary after asynchronous account operations.
    await rm(data, { recursive: true, force: true });
    for (const entry of await entries(frames)) if (/^frame-\d+\.jpg$/.test(entry.name)) await rm(join(frames, entry.name), { force: true });
    const sensorCache = services.sensorCache || join(tmpdir(), `devkits-smc-${process.getuid?.() || 0}-${process.arch}`);
    const sensorStat = await lstat(sensorCache).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (sensorStat && !sensorStat.isSymbolicLink() && (process.getuid === undefined || sensorStat.uid === process.getuid()))
      await rm(sensorCache, { recursive: true, force: true });
    return { sharedKeys: latest.sharedKeys };
  } catch (error) {
    error.message += signOutStarted ? ' Some accounts may already be signed out.'
      : ' Reset stopped before account sign-out; account files were kept.';
    throw error;
  } finally { await lock.close(); await rm(lockPath, { force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'inspect') {
      const plan = await inspectReset(process.argv[3]);
      process.stdout.write(JSON.stringify({ accounts: plan.accounts.length, sharedKeys: plan.sharedKeys }));
    } else if (process.argv[2] === 'clear') process.stdout.write(JSON.stringify(await clearReset(process.argv[3], process.argv[4])));
    else throw new Error('Unknown reset operation.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
