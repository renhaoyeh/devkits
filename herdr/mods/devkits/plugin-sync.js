// Use Codex's installer so plugin metadata and caches stay consistent. Never copy credentials or plugin data.
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { mkdir, symlink, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
export async function linkBundledMarketplace(source, target) {
  const destination = join(target, '.tmp', 'bundled-marketplaces', 'openai-bundled');
  await mkdir(dirname(destination), { recursive: true });
  try { await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (error.code !== 'EEXIST' || await realpath(destination) !== await realpath(source)) throw error;
  }
  return destination;
}

// Ask Codex to parse its configuration, including explicit false values; never parse TOML or copy config files.
export function pluginChoices(home) {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', ['app-server'], { env: { ...process.env, CODEX_HOME: home },
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout });
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer); lines.close(); child.stdin.end();
      const kill = setTimeout(() => child.kill('SIGKILL'), 800); kill.unref();
      child.once('close', () => clearTimeout(kill));
      if (error) reject(new Error(error)); else resolve(value);
    };
    const timer = setTimeout(() => finish('Plugin configuration read timed out.'), 15000);
    const send = message => { if (!done) child.stdin.write(`${JSON.stringify(message)}\n`); };
    child.on('error', () => finish('Cannot start Codex to read plugin configuration.'));
    child.on('close', () => finish('Codex closed before returning plugin configuration.'));
    child.stdin.on('error', () => finish('Cannot communicate with Codex.'));
    lines.on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.id === 1) {
        if (message.error) return finish('Codex initialization failed.');
        send({ method: 'initialized' });
        send({ id: 2, method: 'config/read', params: { includeLayers: false } });
      } else if (message.id === 2) {
        if (message.error) return finish('Cannot read Codex plugin configuration.');
        finish(null, message.result?.config?.plugins || {});
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'devkits_plugins', version: '0.1.0' } } });
  });
}
async function codex(home, args) {
  const { stdout } = await execute('codex', ['plugin', ...args, '--json'], {
    env: { ...process.env, CODEX_HOME: home }, windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function syncPlugins(source, target, call = codex, choices = pluginChoices, linkBundled = linkBundledMarketplace) {
  if (resolve(source) === resolve(target)) return { installed: [] };
  const [plugins, sourceMarkets, targetMarkets] = await Promise.all([
    call(source, ['list']), call(source, ['marketplace', 'list']), call(target, ['marketplace', 'list']),
  ]);
  // Remote plugins belong to the signed-in account and may require separate service authorization.
  const local = (plugins.installed || []).filter(plugin => plugin.installed && plugin.enabled && plugin.source?.source === 'local');
  const markets = new Map((targetMarkets.marketplaces || []).map(market => [market.name, market]));
  for (const name of new Set(local.map(plugin => plugin.marketplaceName))) {
    if (markets.has(name)) continue;
    const market = sourceMarkets.marketplaces?.find(market => market.name === name);
    if (!market?.root) throw new Error(`Could not find the global plugin marketplace ${name}.`);
    // Register the same local root, including global Git snapshots; the global installation owns their refresh.
    // Codex reserves this name: discover its files at the usual bundled path instead of registering it.
    const root = name === 'openai-bundled' ? await linkBundled(market.root, target) : market.root;
    await call(target, ['marketplace', 'add', root]);
    markets.set(name, market);
  }
  if (!local.length) return { installed: [] };
  // Read after registering marketplaces so Codex resolves the profile's own enabled/disabled choices.
  const [current, configured] = await Promise.all([call(target, ['list', '--available']), choices(target)]);
  const installed = new Set((current.installed || []).map(plugin => plugin.pluginId));
  const available = new Map((current.available || []).map(plugin => [plugin.pluginId, plugin]));
  const added = [];
  for (const plugin of local) {
    if (installed.has(plugin.pluginId)) continue;
    const candidate = available.get(plugin.pluginId);
    if (!candidate) throw new Error(`Plugin ${plugin.pluginId} is unavailable in this profile's marketplace.`);
    if (configured[plugin.pluginId]?.enabled === false) continue;
    await call(target, ['add', plugin.pluginId]);
    added.push(plugin.pluginId);
  }
  return { installed: added };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Expected global and profile Codex directories.');
    console.log(JSON.stringify(await syncPlugins(process.argv[2], process.argv[3])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
