import { access, cp, mkdir, readFile, rename, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export async function install(home) {
  const layout = join(home, 'layouts', 'devkits.json');
  const mod = join(home, 'mods', 'devkits');
  const themes = ['devkits', 'devkits-light'].map(name => join(home, 'themes', `${name}.json`));
  for (const path of [layout, mod, ...themes]) {
    try { await access(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`Already exists: ${path}. Refusing to overwrite.`);
  }
  await mkdir(join(home, 'layouts'), { recursive: true });
  await mkdir(join(home, 'mods'), { recursive: true });
  await mkdir(join(home, 'themes'), { recursive: true });
  const stage = await mkdtemp(join(home, 'mods', '.devkits-'));
  let installed = false, layoutWritten = false;
  const writtenThemes = [];
  try {
    await cp(new URL('./mods/devkits/', import.meta.url), stage, { recursive: true,
      filter: source => !source.endsWith('/gpui-kit.d.ts') && !source.endsWith('/jsconfig.json') });
    await rename(stage, mod); installed = true;
    for (const [index, name] of ['devkits', 'devkits-light'].entries()) {
      await writeFile(themes[index], await readFile(new URL(`./themes/${name}.json`, import.meta.url)), { flag: 'wx' });
      writtenThemes.push(themes[index]);
    }
    await writeFile(layout, await readFile(new URL('./layouts/devkits.json', import.meta.url)), { flag: 'wx' }); layoutWritten = true;
  } catch (error) {
    if (layoutWritten) await rm(layout);
    if (installed) await rm(mod, { recursive: true });
    for (const path of writtenThemes) await rm(path);
    throw error;
  } finally { await rm(stage, { recursive: true, force: true }); }
  return layout;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const home = process.env.HERDR_APP_HOME || join(homedir(), '.config', 'herdr-app');
  try { console.log(`Installed ${await install(home)}\nSelect the Devkits layout in Herdr, or run: herdr-app do layout.switch --name devkits`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
