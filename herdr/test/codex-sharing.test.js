import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, lstat, readlink, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { syncProfile, sharedSettings, listSharedItems, openConfig } from '../mods/devkits/codex-sharing.js';

const directoryLink = process.platform === 'win32' ? 'junction' : 'dir';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'devkits-sharing-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const user = join(root, 'user'), source = join(user, '.codex'), app = join(root, 'herdr');
  const key = 'devkits-codex-account-000000000001';
  const target = join(app, 'data/devkits/codex/account-000000000001');
  for (const path of [source, target, join(source, 'plugins/cache/team/shared'), join(source, 'skills/自訂'),
    join(source, 'skills/.system'), join(target, 'plugins/cache/team'), join(target, 'plugins/cache/openai-curated-remote'), join(target, 'skills/.system')]) {
    await mkdir(path, { recursive: true });
  }
  await writeFile(join(source, 'skills/自訂/SKILL.md'), 'version one');
  await writeFile(join(source, 'plugins/cache/team/shared/bundle'), 'shared bundle');
  await writeFile(join(target, 'auth.json'), 'private credentials');
  await writeFile(join(target, 'plugins/cache/openai-curated-remote/private'), 'remote private');
  await writeFile(join(target, 'skills/.system/system'), 'managed by codex');
  await writeFile(join(target, 'config.toml'), '# original settings\nmodel = "private"\n');
  await writeFile(join(app, 'programs.json'), JSON.stringify({ programs: { [key]: { run: ['env', `CODEX_HOME=${target}`, 'codex'] } } }));
  const configs = new Map([
    [source, { marketplaces: { team: { source_type: 'git', source: 'https://example.com/team.git' },
      'openai-curated-remote': { source_type: 'git', source: 'https://example.com/remote.git' } },
    plugins: { 'shared@team': { enabled: true }, 'private@chatgpt-global': { enabled: true } } }],
    [target, { model: 'private', mcp_servers: { own: { command: 'private-server' } },
      plugins: { 'own@chatgpt-global': { enabled: false } } }],
  ]);
  let opens = 0, closes = 0, writes = 0;
  const service = async path => {
    opens++;
    return { config: structuredClone(configs.get(path)), close: async () => { closes++; }, write: async edits => {
      writes++;
      for (const edit of edits) {
        const [table, raw] = edit.keyPath.split(/\.(.*)/s), name = JSON.parse(raw);
        assert.ok(['plugins', 'marketplaces'].includes(table));
        assert.equal(edit.mergeStrategy, 'replace');
        const values = configs.get(path)[table] ||= {};
        if (edit.value === null) delete values[name]; else values[name] = edit.value;
      }
    } };
  };
  return { root, user, source, app, target, key, configs, service,
    run: () => syncProfile(app, key, user, service), counts: () => ({ opens, closes, writes }) };
}

test('Windows Sync accepts mixed path separators and keeps refusing another credentials directory', async t => {
  const f = await fixture(t);
  const home = f.target.replaceAll('\\', '/');
  await writeFile(join(f.app, 'programs.json'), JSON.stringify({ programs: { [f.key]: { run: ['git', `CODEX_HOME=${home}`, 'codex'] } } }));
  assert.equal((await f.run()).plugins, 1);
  await writeFile(join(f.app, 'programs.json'), JSON.stringify({ programs: { [f.key]: { run: ['env', `CODEX_HOME=${f.source}`, 'codex'] } } }));
  await assert.rejects(f.run(), /own Devkits directory/);
});

test('settings reads and writes use an npm-style Codex shim without a system shell on Windows', async t => {
  const directory = await mkdtemp(join(tmpdir(), "devkits config 中文 ' $(literal) "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = join(directory, 'server.cjs');
  await writeFile(join(directory, 'codex'), '#!/bin/sh\nexec "$DEVKITS_FIXTURE_NODE" "$DEVKITS_FIXTURE_SERVER" "$@"\n', { mode: 0o755 });
  await writeFile(server, `
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const m = JSON.parse(line); if (!m.id) return;
      const result = m.method === 'config/read' ? { layers: [{ name: { type: 'user',
        file: require('node:path').join(process.env.CODEX_HOME, 'config.toml') }, config: { model: 'fixture' }, version: 'fixture' }] } : {};
      console.log(JSON.stringify({ id: m.id, result }));
    });
  `);
  const saved = Object.fromEntries(['PATH', 'DEVKITS_FIXTURE_NODE', 'DEVKITS_FIXTURE_SERVER'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.PATH = directory + delimiter + process.env.PATH;
  process.env.DEVKITS_FIXTURE_NODE = process.execPath;
  process.env.DEVKITS_FIXTURE_SERVER = server;
  const config = await openConfig(directory);
  try { assert.equal(config.config.model, 'fixture'); await config.write([]); }
  finally { await config.close(); }
});

test('manual sync shares local bundles and legacy skills, preserving private data and settings; repeats are idempotent', async t => {
  const f = await fixture(t);
  const first = await f.run();
  assert.equal(first.plugins, 1); assert.equal(first.links, 2);
  assert.equal(await readlink(join(f.target, 'plugins/cache/team/shared')), join(f.source, 'plugins/cache/team/shared'));
  assert.equal(await readFile(join(f.target, 'skills/自訂/SKILL.md'), 'utf8'), 'version one');
  await writeFile(join(f.source, 'skills/自訂/SKILL.md'), 'version two');
  assert.equal(await readFile(join(f.target, 'skills/自訂/SKILL.md'), 'utf8'), 'version two');
  assert.equal(await readFile(join(f.target, 'auth.json'), 'utf8'), 'private credentials');
  assert.equal(await readFile(join(f.target, 'plugins/cache/openai-curated-remote/private'), 'utf8'), 'remote private');
  assert.equal(await readFile(join(f.target, 'skills/.system/system'), 'utf8'), 'managed by codex');
  assert.equal(await readFile(join(f.target, 'config.toml.devkits-backup'), 'utf8'), '# original settings\nmodel = "private"\n');
  assert.deepEqual(f.configs.get(f.target), { model: 'private', mcp_servers: { own: { command: 'private-server' } },
    plugins: { 'own@chatgpt-global': { enabled: false }, 'shared@team': { enabled: true } },
    marketplaces: { team: { source_type: 'git', source: 'https://example.com/team.git' } } });
  await f.run();
  assert.deepEqual(f.counts(), { opens: 4, closes: 4, writes: 1 });
  assert.ok(!(await readdir(f.target)).includes('.devkits-sharing.lock'));
});

test('removing shared entries removes only imported settings and Devkits-owned links', async t => {
  const f = await fixture(t); await f.run();
  f.configs.set(f.source, {});
  await rm(join(f.source, 'skills/自訂'), { recursive: true });
  await f.run();
  assert.deepEqual(f.configs.get(f.target).plugins, { 'own@chatgpt-global': { enabled: false } });
  await assert.rejects(lstat(join(f.target, 'plugins/cache/team/shared')), { code: 'ENOENT' });
  assert.ok((await lstat(join(f.source, 'plugins/cache/team/shared'))).isDirectory());
});

test('existing real data and foreign links cause a conflict before changes', async t => {
  for (const kind of ['directory', 'link']) {
    const f = await fixture(t);
    const path = join(f.target, 'plugins/cache/team/shared');
    if (kind === 'directory') { await mkdir(path); await writeFile(join(path, 'existing'), 'keep'); }
    else await symlink(join(f.root, 'elsewhere'), path, directoryLink);
    await assert.rejects(f.run(), /Already exists/);
    assert.equal(f.counts().writes, 0);
    await assert.rejects(lstat(join(f.target, 'skills/自訂')), { code: 'ENOENT' });
    if (kind === 'directory') assert.equal(await readFile(join(path, 'existing'), 'utf8'), 'keep');
  }
});

test('version conflicts roll back newly created links and preserve existing settings', async t => {
  const f = await fixture(t);
  await assert.rejects(syncProfile(f.app, f.key, f.user, async path => {
    const session = await f.service(path);
    if (path === f.target) session.write = async () => { throw Error('settings changed concurrently'); };
    return session;
  }), /concurrently/);
  await assert.rejects(lstat(join(f.target, 'plugins/cache/team/shared')), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.target, 'config.toml'), 'utf8'), '# original settings\nmodel = "private"\n');
  assert.equal(f.counts().opens, f.counts().closes);
});

test('does not adopt identical pre-existing user links or remove user replacements', async t => {
  const f = await fixture(t);
  await symlink(join(f.source, 'plugins/cache/team/shared'), join(f.target, 'plugins/cache/team/shared'), directoryLink);
  await f.run();
  const record = JSON.parse(await readFile(join(f.target, 'devkits-shared.json'), 'utf8'));
  assert.equal(record.links['plugins/cache/team/shared'], undefined);
  await rm(join(f.target, 'skills/自訂'));
  await mkdir(join(f.target, 'skills/自訂'));
  f.configs.set(f.source, {});
  await rm(join(f.source, 'skills/自訂'), { recursive: true });
  await f.run();
  assert.ok((await lstat(join(f.target, 'plugins/cache/team/shared'))).isSymbolicLink());
  assert.ok((await lstat(join(f.target, 'skills/自訂'))).isDirectory());
});

test('rejects invalid accounts, shared config files, linked parents, and overlapping source homes', async t => {
  const f = await fixture(t);
  for (const key of ['codex', 'devkits-claude-work', 'devkits-codex-../escape']) {
    await assert.rejects(syncProfile(f.app, key, f.user, f.service), /Only saved/);
  }
  await rm(join(f.target, 'config.toml'));
  // A junction exercises the linked-config guard without Windows symlink privileges.
  await symlink(process.platform === 'win32' ? f.source : join(f.source, 'config.toml'), join(f.target, 'config.toml'),
    process.platform === 'win32' ? 'junction' : 'file');
  await assert.rejects(f.run(), /independent files/);
  assert.equal(f.counts().opens, 0);
  await rm(join(f.target, 'config.toml'));
  await rm(join(f.target, 'plugins'), { recursive: true });
  await symlink(join(f.source, 'plugins'), join(f.target, 'plugins'), directoryLink);
  await assert.rejects(f.run(), /existing link/);
});

test('a second helper cannot synchronize an account while its filesystem lock is held', async t => {
  const f = await fixture(t);
  await mkdir(join(f.target, '.devkits-sharing.lock'));
  await assert.rejects(f.run(), /already synchronizing/);
  assert.equal(f.counts().opens, 0);
});

test('sharing uses only configured local/Git marketplaces with safe names', () => {
  assert.deepEqual(sharedSettings({ marketplaces: {
    local: { source_type: 'local', source: '/bundles' }, remote: { source_type: 'remote', source: 'https://example.com' },
    '../escape': { source_type: 'git', source: 'https://example.com' },
    'chatgpt-workspace': { source_type: 'git', source: 'https://example.com' },
  }, plugins: { 'ok@local': { enabled: false }, 'remote@remote': {}, 'bad@../escape': {}, 'missing@unknown': {} } }),
  { markets: { local: { source_type: 'local', source: '/bundles' } }, plugins: { 'ok@local': { enabled: false } } });
});

test('the picker reads candidates without syncing, starts unchecked and restores each profile’s selection', async t => {
  const f = await fixture(t);
  const first = await listSharedItems(f.app, f.key, f.user, f.service);
  assert.deepEqual(first.items.map(item => [item.kind, item.key, item.selected]),
    [['plugins', 'shared@team', false], ['skills', '自訂', false]]);
  assert.equal(f.counts().writes, 0);
  await assert.rejects(lstat(join(f.target, 'plugins/cache/team/shared')), { code: 'ENOENT' });
  await syncProfile(f.app, f.key, f.user, f.service, { plugins: ['shared@team'], skills: [] });
  const next = await listSharedItems(f.app, f.key, f.user, f.service);
  assert.deepEqual(next.items.map(item => item.selected), [true, false]);
  await assert.rejects(lstat(join(f.target, 'skills/自訂')), { code: 'ENOENT' });
});

test('selection applies only checked items, supports disabling sharing and keeps source files', async t => {
  const f = await fixture(t);
  await syncProfile(f.app, f.key, f.user, f.service, { plugins: [], skills: ['自訂'] });
  assert.equal(f.configs.get(f.target).marketplaces, undefined);
  await assert.rejects(lstat(join(f.target, 'plugins/cache/team/shared')), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.target, 'skills/自訂/SKILL.md'), 'utf8'), 'version one');
  await syncProfile(f.app, f.key, f.user, f.service, { plugins: [], skills: [] });
  await assert.rejects(lstat(join(f.target, 'skills/自訂')), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.source, 'skills/自訂/SKILL.md'), 'utf8'), 'version one');
  assert.deepEqual(f.configs.get(f.target).plugins, { 'own@chatgpt-global': { enabled: false } });
});

test('invalid or stale selections fail without changing the account', async t => {
  const f = await fixture(t);
  for (const selection of [{ plugins: ['missing@team'], skills: [] }, { plugins: [], skills: ['../escape'] }, {}]) {
    await assert.rejects(syncProfile(f.app, f.key, f.user, f.service, selection), /selection|source changed/i);
  }
  assert.equal(f.counts().writes, 0);
});

test('selecting one plugin does not expose other plugins in the same marketplace', async t => {
  const f = await fixture(t);
  await mkdir(join(f.source, 'plugins/cache/team/unselected'));
  f.configs.get(f.source).plugins['unselected@team'] = { enabled: true };
  await syncProfile(f.app, f.key, f.user, f.service, { plugins: ['shared@team'], skills: [] });
  assert.ok((await lstat(join(f.target, 'plugins/cache/team/shared'))).isSymbolicLink());
  await assert.rejects(lstat(join(f.target, 'plugins/cache/team/unselected')), { code: 'ENOENT' });
  assert.equal(f.configs.get(f.target).plugins['unselected@team'], undefined);
});

test('the picker checks actual settings and links without applying changes', async t => {
  const f = await fixture(t);
  const status = async () => (await listSharedItems(f.app, f.key, f.user, f.service)).items.map(item => item.status);
  assert.deepEqual(await status(), ['not-shared', 'not-shared']);
  await f.run();
  assert.deepEqual(await status(), ['synced', 'synced']);
  const writes = f.counts().writes;
  f.configs.get(f.source).plugins['shared@team'].enabled = false;
  assert.deepEqual(await status(), ['pending', 'synced']);
  f.configs.get(f.source).plugins['shared@team'].enabled = true;
  await rm(join(f.target, 'skills/自訂'));
  assert.deepEqual(await status(), ['synced', 'pending']);
  await mkdir(join(f.target, 'skills/自訂'));
  assert.deepEqual(await status(), ['synced', 'conflict']);
  await rm(join(f.target, 'plugins/cache/team/shared'));
  await symlink(join(f.root, 'elsewhere'), join(f.target, 'plugins/cache/team/shared'), directoryLink);
  assert.deepEqual(await status(), ['conflict', 'conflict']);
  assert.equal(f.counts().writes, writes);
  assert.equal(f.counts().opens, f.counts().closes);
});

test('the picker reports removed sources and follows legacy skill source symlinks', async t => {
  const f = await fixture(t);
  await f.run();
  delete f.configs.get(f.source).plugins['shared@team'];
  await rm(join(f.source, 'skills/自訂'), { recursive: true });
  let items = (await listSharedItems(f.app, f.key, f.user, f.service)).items;
  assert.ok(items.every(item => item.status === 'source-missing'));
  await mkdir(join(f.root, 'skill-source'));
  await symlink(join(f.root, 'skill-source'), join(f.source, 'skills/自訂'), directoryLink);
  items = (await listSharedItems(f.app, f.key, f.user, f.service)).items;
  assert.equal(items.find(item => item.kind === 'skills').status, 'synced');
});
