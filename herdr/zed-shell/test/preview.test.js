import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepare } from '../prepare.js';

test('preview contains a native shell and visual assets, without companion services or account data', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'zed-preview-test-'));
  try {
    const home = await prepare({ home: join(parent, 'preview') });
    assert.deepEqual((await readdir(join(home, 'mods'))).sort(), ['devkits', 'devkits-zed']);
    await assert.rejects(readFile(join(home, 'mods/devkits/main.js')), { code: 'ENOENT' });
    for (const file of ['main.js', 'files.js', 'workspace-editor.js', 'native-threads.js', 'native-launcher.js'])
      assert.equal(await readFile(join(home, 'mods/devkits-zed', file), 'utf8'), await readFile(new URL(`../../mods/devkits-zed/${file}`, import.meta.url), 'utf8'));
    await assert.rejects(prepare({ home }), /already exists/);
    const shared = JSON.parse(await readFile(join(home, 'shared.json'), 'utf8'));
    assert.deepEqual(shared['devkits.projects'], [join(home, 'workspace')]);
    assert.equal(Object.keys(shared).some(key => /usage|system|task|agent-config|profile|mcp/.test(key)), false);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
