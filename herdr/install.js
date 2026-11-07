import { access, cp, mkdir, readFile, rename, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export async function install(home) {
  const layout = join(home, 'layouts', 'devkits.json');
  const mod = join(home, 'mods', 'devkits');
  const simulator = join(home, 'mods', 'devkits-simulator');
  const frames = join(home, 'mods', 'devkits-sim-frames');
  const themes = ['devkits', 'devkits-light'].map(name => join(home, 'themes', `${name}.json`));
  for (const path of [layout, mod, simulator, frames, ...themes]) {
    try { await access(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`Already exists: ${path}. Refusing to overwrite.`);
  }
  await mkdir(join(home, 'layouts'), { recursive: true });
  await mkdir(join(home, 'mods'), { recursive: true });
  await mkdir(join(home, 'themes'), { recursive: true });
  const stage = await mkdtemp(join(home, 'mods', '.devkits-'));
  let installed = false, simulatorInstalled = false, framesInstalled = false, layoutWritten = false;
  const writtenThemes = [];
  try {
    await cp(new URL('./mods/devkits/', import.meta.url), stage, { recursive: true,
      filter: source => !source.endsWith('/gpui-kit.d.ts') && !source.endsWith('/jsconfig.json') });
    await rename(stage, mod); installed = true;
    simulatorInstalled = true;
    await cp(new URL('./mods/devkits-simulator/', import.meta.url), simulator, { recursive: true, errorOnExist: true, force: false });
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
    throw error;
  } finally { await rm(stage, { recursive: true, force: true }); }
  return layout;
}

// F5 runs the shown project's chosen command (the header's run button). The person's other keys stay, and a key they
// already use for the Devkits layout is left alone.
export const KEYS = { 'layout:devkits': { f5: 'devkits.run' } };
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
  try { console.log(`Installed ${await install(home)}\nSelect the Devkits layout in Herdr, or run: herdr-app do layout.switch --name devkits`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
