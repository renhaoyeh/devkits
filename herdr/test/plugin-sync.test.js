import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncPlugins, linkBundledMarketplace } from '../mods/devkits/plugin-sync.js';

const plugin = (id, extra = {}) => ({ pluginId: `${id}@local`, marketplaceName: 'local',
  installed: true, enabled: true, source: { source: 'local' }, ...extra });

test('sync installs missing local plugins through Codex, preserving existing and disabled plugins', async () => {
  const calls = [];
  const call = async (home, args) => {
    calls.push([home, args]);
    if (home === '/global' && args[0] === 'list') return { installed: [
      plugin('new'), plugin('existing'), plugin('disabled'), plugin('off', { enabled: false }),
      plugin('remote', { source: { source: 'remote' } }),
    ] };
    if (args[0] === 'marketplace' && args[1] === 'list') return {
      marketplaces: home === '/global' ? [{ name: 'local', root: '/source with spaces/本機' }] : [],
    };
    if (args[0] === 'list') return { installed: [plugin('existing')], available: [
      plugin('new', { installed: false, enabled: false }), plugin('disabled', { installed: false, enabled: false }),
    ] };
    return {};
  };
  assert.deepEqual(await syncPlugins('/global', '/profile', call, async () => ({ 'disabled@local': { enabled: false } })), { installed: ['new@local'] });
  assert.deepEqual(calls.filter(([, args]) => args[0] === 'add'), [['/profile', ['add', 'new@local']]]);
  assert.ok(calls.some(([home, args]) => home === '/profile' && args[1] === 'add' && args[2] === '/source with spaces/本機'));
  assert.ok(calls.findIndex(([, args]) => args[1] === 'add') < calls.findIndex(([, args]) => args[1] === '--available'));
});

test('sync retains the profile marketplace, is idempotent and avoids account-bound remote plugins', async () => {
  const calls = [];
  const call = async (home, args) => {
    calls.push([home, args]);
    if (args[0] === 'marketplace') return { marketplaces: [{ name: 'local', root: home === '/global' ? '/global-source' : '/own-source' }] };
    return { installed: [plugin('same'), plugin('remote', { source: { source: 'remote' } })], available: [] };
  };
  assert.deepEqual(await syncPlugins('/global', '/profile', call, async () => ({})), { installed: [] });
  assert.equal(calls.some(([, args]) => args.includes('add')), false);
  assert.deepEqual(await syncPlugins('/global', '/global', () => assert.fail('same home')), { installed: [] });
});

test('missing candidates and CLI failures stop sync without guessing the enabled state', async () => {
  const call = async (home, args) => {
    if (args[0] === 'marketplace') return { marketplaces: [{ name: 'local', root: '/source' }] };
    return home === '/global' ? { installed: [plugin('missing')] } : { available: [] };
  };
  await assert.rejects(syncPlugins('/global', '/profile', call, async () => ({})), /unavailable/);
  await assert.rejects(syncPlugins('/global', '/profile', async () => { throw Error('CLI unavailable'); }), /CLI unavailable/);
});

test('reserved bundled marketplaces are registered using a profile-local link', async () => {
  const calls = [], links = [];
  const bundled = plugin('browser', { pluginId: 'browser@openai-bundled', marketplaceName: 'openai-bundled' });
  const call = async (home, args) => {
    calls.push([home, args]);
    if (args[0] === 'marketplace' && args[1] === 'list') return {
      marketplaces: home === '/global' ? [{ name: 'openai-bundled', root: '/bundled' }] : [],
    };
    if (args[0] === 'list') return home === '/global' ? { installed: [bundled] } : { available: [bundled] };
    return {};
  };
  const link = async (...args) => { links.push(args); return '/profile/.tmp/bundled-marketplaces/openai-bundled'; };
  await syncPlugins('/global', '/profile', call, async () => ({}), link);
  assert.deepEqual(links, [['/bundled', '/profile']]);
  assert.ok(calls.some(([, args]) => args[1] === 'add' && args[2] === '/profile/.tmp/bundled-marketplaces/openai-bundled'));
});

test('marketplace links can be reused but never overwrite another directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'devkits-market-link-'));
  const source = join(root, 'source'), target = join(root, 'profile');
  await mkdir(source);
  const destination = await linkBundledMarketplace(source, target);
  assert.equal(await realpath(destination), await realpath(source));
  assert.equal(await linkBundledMarketplace(source, target), destination);
  const other = join(root, 'other'); await mkdir(other);
  await assert.rejects(linkBundledMarketplace(other, target), { code: 'EEXIST' });
});
