import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install, reinstall } from '../install.js';

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'devkits-reinstall-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await install(home);
  return home;
}

test('reinstall replaces the complete bundle, keeps backups and preserves user data on repeated runs', async t => {
  const home = await fixture(t);
  const obsolete = join(home, 'mods/devkits/obsolete.js');
  await writeFile(obsolete, 'old code');
  await writeFile(join(home, 'mods/devkits/main.js'), 'local version');
  const preserved = ['settings.json', 'shared.json', 'data/accounts.json', 'layouts/custom.json', 'mods/custom/main.js'];
  for (const path of preserved) {
    await mkdir(join(home, path, '..'), { recursive: true });
    await writeFile(join(home, path), `keep ${path}`);
  }
  const keys = JSON.stringify({ global: { 'cmd-t': 'tab.new' }, 'layout:devkits': {
    f5: 'custom.run', 'cmd-n': 'custom.new', 'cmd-w': 'custom.close',
  } });
  await writeFile(join(home, 'keys.json'), keys);
  const first = await reinstall(home);
  assert.equal(await readFile(join(first.backup, 'mods/devkits/main.js'), 'utf8'), 'local version');
  assert.equal(await readFile(join(first.backup, 'mods/devkits/obsolete.js'), 'utf8'), 'old code');
  await assert.rejects(readFile(obsolete), { code: 'ENOENT' });
  for (const name of (await readdir(join(home, 'mods'))).filter(name => name.startsWith('devkits')))
    assert.equal(await readFile(join(home, 'mods', name, 'main.js'), 'utf8'),
      await readFile(new URL(`../mods/${name}/main.js`, import.meta.url), 'utf8'));
  assert.equal(await readFile(first.layout, 'utf8'), await readFile(new URL('../layouts/devkits.json', import.meta.url), 'utf8'));
  const second = await reinstall(home);
  assert.notEqual(first.backup, second.backup);
  assert.equal(await readFile(join(home, 'keys.json'), 'utf8'), keys);
  for (const path of preserved) assert.equal(await readFile(join(home, path), 'utf8'), `keep ${path}`);
  assert.ok(!(await readdir(home)).some(name => name.startsWith('.devkits-reinstall-')));
});

test('reinstall adds missing shortcuts while backing up existing key bindings', async t => {
  const home = await fixture(t);
  const keys = '{"layout:devkits":{"f5":"custom.run"}}';
  await writeFile(join(home, 'keys.json'), keys);
  const { backup } = await reinstall(home);
  assert.equal(await readFile(join(backup, 'keys.json'), 'utf8'), keys);
  assert.deepEqual(JSON.parse(await readFile(join(home, 'keys.json'), 'utf8')), {
    'layout:devkits': { f5: 'custom.run', 'cmd-n': 'devkits.new-thread', 'cmd-w': 'devkits.close-file' },
  });
});

test('reinstall restores replaced mods when a later destination fails', async t => {
  const home = await fixture(t);
  await writeFile(join(home, 'mods/devkits/main.js'), 'original');
  await writeFile(join(home, 'mods/devkits/obsolete.js'), 'keep on failure');
  await rm(join(home, 'themes'), { recursive: true });
  await writeFile(join(home, 'themes'), 'blocked destination');
  await assert.rejects(reinstall(home), { code: 'EEXIST' });
  assert.equal(await readFile(join(home, 'mods/devkits/main.js'), 'utf8'), 'original');
  assert.equal(await readFile(join(home, 'mods/devkits/obsolete.js'), 'utf8'), 'keep on failure');
  assert.equal(await readFile(join(home, 'themes'), 'utf8'), 'blocked destination');
  assert.ok(!(await readdir(home)).some(name => name.startsWith('.devkits-reinstall-')));
});

test('reinstall validates existing keys before replacing any live files', async t => {
  const home = await fixture(t);
  await writeFile(join(home, 'keys.json'), 'invalid JSON');
  await writeFile(join(home, 'mods/devkits/main.js'), 'original');
  await assert.rejects(reinstall(home), SyntaxError);
  assert.equal(await readFile(join(home, 'mods/devkits/main.js'), 'utf8'), 'original');
  assert.equal(await readFile(join(home, 'keys.json'), 'utf8'), 'invalid JSON');
  assert.ok(!(await readdir(home)).includes('backups'));
});
