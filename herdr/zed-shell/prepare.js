import { cp, mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installZed } from '../install-zed.js';

const root = dirname(fileURLToPath(import.meta.url));
export async function prepare({ home } = {}) {
  // Only a new home may receive the actual installable Devkits source.
  if (home) {
    home = resolve(home);
    try { await access(home); throw new Error(`Destination already exists: ${home}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(home, { recursive: true });
  } else home = await mkdtemp(join(tmpdir(), 'zed-shell-'));
  await installZed(home);
  const project = join(home, 'workspace'), codeHome = join(home, 'data/preview-codex'), claudeHome = join(home, 'data/preview-claude');
  await mkdir(join(project, 'herdr'), { recursive: true });
  await mkdir(codeHome, { recursive: true }); await mkdir(claudeHome, { recursive: true });
  await cp(join(root, '../../design.md'), join(project, 'design.md'));
  await cp(join(root, '../../AGENTS.md'), join(project, 'AGENTS.md'));
  await cp(join(root, '../DEVELOPMENT.md'), join(project, 'herdr/DEVELOPMENT.md'));
  await writeFile(join(project, 'README.md'), '# Workspace\n\nThe original Devkits interface, with a fresh project and no imported conversations.\n\n- Create threads from the project sidebar.\n- Open files from the right-hand Files panel.\n- Preview documents in the central editor.\n- Use the workspace dock controls and native Herdr settings.\n\nThe original design guidelines and development workflow are included beside this file.\n');
  await writeFile(join(home, 'programs.json'), JSON.stringify({ programs: {
    claude: { run: ['env', `CLAUDE_CONFIG_DIR=${claudeHome}`, 'claude'] },
    codex: { run: ['env', `CODEX_HOME=${codeHome}`, 'codex', '--no-daemon'] },
  } }, null, 2));
  await writeFile(join(home, 'shared.json'), JSON.stringify({
    layout: 'devkits-zed', 'frame.welcomed': 'skipped', 'devkits.projects': [project],
    'devkits.files-tabs': { [JSON.stringify([null, project])]: { paths: ['README.md'], file: 'README.md', preview: null, history: ['README.md'] } },
  }));
  await writeFile(join(home, 'zed-shell-preview.json'), JSON.stringify({ version: 3, project, coreSession: 'zed-shell-copy' }));
  return home;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let home;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--home' && args[i + 1]) home = args[++i];
      else throw new Error(`Unknown or incomplete option: ${args[i]}`);
    }
    console.log(await prepare({ home }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
