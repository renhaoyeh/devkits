import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile, mkdtemp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export async function install(home) {
  const layout = join(home, 'layouts', 'devkits.json');
  const mod = join(home, 'mods', 'devkits');
  const simulator = join(home, 'mods', 'devkits-simulator');
  const companionNames = ['devkits-agents', 'devkits-system', 'devkits-asana', 'devkits-mantisbt', 'devkits-tasks', 'devkits-calendar', 'devkits-usage'];
  const companions = companionNames.map(name => join(home, 'mods', name));
  const frames = join(home, 'mods', 'devkits-sim-frames');
  const themes = ['devkits', 'devkits-light'].map(name => join(home, 'themes', `${name}.json`));
  for (const path of [layout, mod, simulator, frames, ...companions, ...themes]) {
    try { await access(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`Already exists: ${path}. Refusing to overwrite.`);
  }
  await mkdir(join(home, 'layouts'), { recursive: true });
  await mkdir(join(home, 'mods'), { recursive: true });
  await mkdir(join(home, 'themes'), { recursive: true });
  const stage = await mkdtemp(join(home, 'mods', '.devkits-'));
  let installed = false, simulatorInstalled = false, framesInstalled = false, layoutWritten = false;
  const writtenThemes = [], writtenCompanions = [];
  try {
    await cp(new URL('./mods/devkits/', import.meta.url), stage, { recursive: true,
      filter: source => !source.endsWith('/gpui-kit.d.ts') && !source.endsWith('/jsconfig.json') });
    await rename(stage, mod); installed = true;
    simulatorInstalled = true;
    await cp(new URL('./mods/devkits-simulator/', import.meta.url), simulator, { recursive: true, errorOnExist: true, force: false });
    for (const [index, name] of companionNames.entries()) {
      writtenCompanions.push(companions[index]);
      await cp(new URL(`./mods/${name}/`, import.meta.url), companions[index], { recursive: true, errorOnExist: true, force: false,
        filter: source => !source.endsWith('/gpui-kit.d.ts') && !source.endsWith('/jsconfig.json') });
    }
    await mkdir(frames);
    framesInstalled = true;
    for (const name of ['mod.json', 'main.js'])
      await writeFile(join(frames, name), await readFile(new URL(`./mods/devkits-sim-frames/${name}`, import.meta.url)), { flag: 'wx' });
    for (const [index, name] of ['devkits', 'devkits-light'].entries()) {
      await writeFile(themes[index], await readFile(new URL(`./themes/${name}.json`, import.meta.url)), { flag: 'wx' });
      writtenThemes.push(themes[index]);
    }
    await writeFile(layout, await readFile(new URL('./layouts/devkits.json', import.meta.url)), { flag: 'wx' }); layoutWritten = true;
    await bindKeys(join(home, 'keys.json'));
  } catch (error) {
    if (layoutWritten) await rm(layout);
    if (installed) await rm(mod, { recursive: true });
    if (simulatorInstalled) await rm(simulator, { recursive: true, force: true });
    if (framesInstalled) await rm(frames, { recursive: true });
    for (const path of writtenThemes) await rm(path);
    for (const path of writtenCompanions) await rm(path, { recursive: true, force: true });
    throw error;
  } finally { await rm(stage, { recursive: true, force: true }); }
  return layout;
}

// Prepare the entire bundle before touching the running installation. Keep the
// replaced files outside watched mod/layout folders and restore them on failure.
export async function reinstall(home) {
  await mkdir(home, { recursive: true });
  const stage = await mkdtemp(join(home, '.devkits-reinstall-'));
  const changes = [];
  let backup;
  try {
    const keys = await readFile(join(home, 'keys.json')).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (keys !== null) await writeFile(join(stage, 'keys.json'), keys);
    await install(stage);
    const paths = [];
    for (const folder of ['mods', 'themes', 'layouts'])
      for (const name of await readdir(join(stage, folder))) paths.push(join(folder, name));
    if (keys === null || !keys.equals(await readFile(join(stage, 'keys.json')))) paths.push('keys.json');
    await mkdir(join(home, 'backups'), { recursive: true });
    backup = await mkdtemp(join(home, 'backups', 'devkits-'));
    for (const path of paths) {
      const target = join(home, path), saved = join(backup, path);
      await mkdir(dirname(saved), { recursive: true });
      await mkdir(dirname(target), { recursive: true });
      const change = { target, saved, replaced: false, written: false };
      changes.push(change);
      try { await rename(target, saved); change.replaced = true; }
      catch (error) {
        if (error.code === 'ENOENT') { /* new path */ }
        // Windows refuses to move a folder while a running mod holds handles inside it; update it in place instead.
        else if (LOCKED.has(error.code) && (await stat(target)).isDirectory()) {
          await cp(target, saved, { recursive: true });
          change.replaced = change.inPlace = true;
          change.written = true;
          await syncDir(join(stage, path), target);
          continue;
        } else throw error;
      }
      await rename(join(stage, path), target);
      change.written = true;
    }
  } catch (error) {
    const failures = [];
    for (const change of changes.reverse()) {
      try {
        if (change.inPlace) { await syncDir(change.saved, change.target); continue; }
        if (change.written) await rm(change.target, { recursive: true, force: true });
        if (change.replaced) await rename(change.saved, change.target);
      } catch (failure) { failures.push(failure); }
    }
    if (failures.length) throw new AggregateError([error, ...failures], `Reinstall failed; recovery files: ${backup}`);
    throw error;
  } finally { await rm(stage, { recursive: true, force: true }); }
  return { layout: join(home, 'layouts', 'devkits.json'), backup };
}

const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES']);

// Make target match source without moving target itself.
async function syncDir(source, target) {
  const keep = new Set(await readdir(source));
  for (const name of await readdir(target))
    if (!keep.has(name)) await rm(join(target, name), { recursive: true, force: true });
  await cp(source, target, { recursive: true, force: true });
}

// F5 runs the project command; Cmd+N repeats its last agent. Preserve existing layout overrides and other keys.
export const KEYS = { 'layout:devkits': { f5: 'devkits.run', 'cmd-n': 'devkits.new-thread', 'cmd-w': 'devkits.close-file' } };
async function bindKeys(path) {
  let keys = {};
  try { keys = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let changed = false;
  for (const [section, bindings] of Object.entries(KEYS))
    for (const [key, action] of Object.entries(bindings))
      if (!keys[section]?.[key]) { keys[section] = { ...keys[section], [key]: action }; changed = true; }
  if (changed) await writeFile(path, `${JSON.stringify(keys, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const home = process.env.HERDR_APP_HOME || join(homedir(), '.config', 'herdr-app');
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--reinstall')) throw new Error('Usage: node herdr/install.js [--reinstall]');
    if (args.includes('--reinstall')) {
      const result = await reinstall(home);
      console.log(`Reinstalled ${result.layout}\nBackup: ${result.backup}\nHerdr reloads the updated files automatically.`);
    } else console.log(`Installed ${await install(home)}\nSelect the Devkits layout in Herdr, or run: herdr-app do layout.switch --name devkits`);
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
