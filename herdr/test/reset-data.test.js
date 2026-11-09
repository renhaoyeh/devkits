import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectReset, clearReset, cleanDefaultClaude, signOut, stopAccountSessions, idleAccounts, stopDevkitsServices, resetProcessPids, resetShortcuts } from '../mods/devkits/reset-data.js';
import { KEYS } from '../install.js';
import { evaluateNative } from './source-harness.js';

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'devkits-reset-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const root = join(folder, 'herdr'), userHome = join(folder, 'user');
  const data = join(root, 'data', 'devkits');
  const codex = join(data, 'codex', 'account-123456789abc'), claude = join(data, 'claude', 'account-abcdefghijkl');
  for (const path of [codex, claude, join(userHome, '.claude'), join(userHome, '.codex'), join(root, 'mods', 'devkits-sim-frames')]) await mkdir(path, { recursive: true });
  const programs = { shells: ['fish'], programs: {
    codex: { name: 'Codex', run: ['codex'] }, unrelated: { name: 'My tool', run: ['tool'] },
    'devkits-codex-account-123456789abc': { name: 'Work', run: ['env', `CODEX_HOME=${codex}`, 'codex'] },
    'devkits-claude-account-abcdefghijkl': { name: 'Personal', run: ['env', `CLAUDE_CONFIG_DIR=${claude}`, 'claude'] },
  } };
  const state = { layout: 'devkits', 'devkits.agent-configs': [{ name: 'private' }], 'devkits.calendar-events': ['private'], 'another-mod': { keep: true } };
  await writeFile(join(root, 'programs.json'), JSON.stringify(programs));
  await writeFile(join(root, 'shared.json'), JSON.stringify(state));
  await writeFile(join(root, 'keys.json'), JSON.stringify({ global: { 'ctrl-x': 'terminal' }, 'layout:devkits': { f5: 'custom' } }));
  await writeFile(join(codex, 'auth.json'), 'dedicated credentials');
  await writeFile(join(claude, 'history.jsonl'), 'dedicated history');
  await writeFile(join(data, 'asana.json'), 'private token');
  await writeFile(join(userHome, '.codex', 'auth.json'), 'default credentials');
  await writeFile(join(userHome, '.claude', 'history.jsonl'), 'default history');
  await writeFile(join(root, 'mods', 'devkits-sim-frames', 'frame-0.jpg'), 'frame');
  await writeFile(join(root, 'mods', 'devkits-sim-frames', 'main.js'), 'keep code');
  const calls = [], sensorCache = join(folder, 'sensor-cache');
  await mkdir(sensorCache);
  const services = { userHome, sensorCache, stopAccounts: async () => {}, stopServices: async () => {}, idleAccounts: async () => {}, cleanCodex: async () => {},
    signOut: async account => { calls.push(account); } };
  return { folder, root, userHome, data, codex, claude, programs, state, services, calls };
}

test('inspection is read-only and enumerates Devkits namespaces and dedicated accounts only', async t => {
  const f = await fixture(t), plan = await inspectReset(f.root);
  assert.equal(plan.accounts.length, 2);
  assert.deepEqual(plan.sharedKeys.sort(), ['devkits.agent-configs', 'devkits.calendar-events']);
  assert.equal(plan.accountKeys.length, 2);
  assert.equal(await readFile(join(f.codex, 'auth.json'), 'utf8'), 'dedicated credentials');
  assert.equal(await readFile(join(f.data, 'asana.json'), 'utf8'), 'private token');
  assert.deepEqual(f.calls, []);
});

test('full reset signs out dedicated accounts, clears their data and restores only Devkits shortcut scope', async t => {
  const f = await fixture(t), sharedBefore = await readFile(join(f.root, 'shared.json'), 'utf8');
  const result = await clearReset(f.root, 'DEVKITS', f.services);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => call.directory.startsWith(f.data)));
  await assert.rejects(readFile(join(f.codex, 'auth.json')), { code: 'ENOENT' });
  await assert.rejects(readdir(f.data), { code: 'ENOENT' });
  assert.equal(await readFile(join(f.userHome, '.codex', 'auth.json'), 'utf8'), 'default credentials');
  assert.equal(await readFile(join(f.userHome, '.claude', 'history.jsonl'), 'utf8'), 'default history');
  assert.deepEqual(JSON.parse(await readFile(join(f.root, 'programs.json'), 'utf8')), { shells: ['fish'], programs: {
    codex: f.programs.programs.codex, unrelated: f.programs.programs.unrelated,
  } });
  assert.deepEqual(JSON.parse(await readFile(join(f.root, 'keys.json'), 'utf8')), {
    global: { 'ctrl-x': 'terminal' }, 'layout:devkits': KEYS['layout:devkits'],
  });
  assert.deepEqual(resetShortcuts, KEYS['layout:devkits']);
  assert.equal(await readFile(join(f.root, 'shared.json'), 'utf8'), sharedBefore, 'Only the native caller clears shared state');
  assert.ok(result.sharedKeys.every(key => key.startsWith('devkits.')));
  assert.deepEqual(await readdir(join(f.root, 'mods', 'devkits-sim-frames')), ['main.js']);
  await assert.rejects(readdir(f.services.sensorCache), { code: 'ENOENT' });
});

test('confirmation, active account sessions and failed sign-out prevent account file removal', async t => {
  const f = await fixture(t);
  await assert.rejects(clearReset(f.root, 'devkits', f.services), /Type DEVKITS/);
  await assert.rejects(clearReset(f.root, 'DEVKITS', { ...f.services, idleAccounts: async () => { throw new Error('active sessions'); } }), /active sessions/);
  assert.deepEqual(f.calls, []);
  await assert.rejects(clearReset(f.root, 'DEVKITS', { ...f.services, signOut: async () => { throw new Error('sign-out failed'); } }), /sign-out failed/);
  assert.equal(await readFile(join(f.codex, 'auth.json'), 'utf8'), 'dedicated credentials');
  assert.deepEqual(JSON.parse(await readFile(join(f.root, 'programs.json'), 'utf8')), f.programs);
  assert.ok(!(await readdir(f.root)).includes('.devkits-reset.lock'));
});

test('concurrent account changes are retained and reset can be retried', async t => {
  const f = await fixture(t), changed = { ...f.programs, shells: ['zsh'] };
  await assert.rejects(clearReset(f.root, 'DEVKITS', { ...f.services, cleanCodex: async () => {
    await writeFile(join(f.root, 'programs.json'), JSON.stringify(changed));
  } }), /changed during reset/);
  assert.equal(await readFile(join(f.codex, 'auth.json'), 'utf8'), 'dedicated credentials');
  assert.deepEqual(JSON.parse(await readFile(join(f.root, 'programs.json'), 'utf8')), changed);
  await clearReset(f.root, 'DEVKITS', f.services);
  await assert.rejects(readdir(f.data), { code: 'ENOENT' });
});

test('reset refuses linked deletion roots and leaves account symlink targets untouched', async t => {
  const f = await fixture(t), outside = join(f.folder, 'outside');
  await mkdir(outside); await writeFile(join(outside, 'private'), 'keep');
  await symlink(outside, join(f.data, 'codex', 'linked'));
  await clearReset(f.root, 'DEVKITS', f.services);
  assert.equal(await readFile(join(outside, 'private'), 'utf8'), 'keep');
  await symlink(outside, f.data);
  await assert.rejects(clearReset(f.root, 'DEVKITS', f.services), /symbolic link/);
  assert.equal(await readFile(join(outside, 'private'), 'utf8'), 'keep');
});

test('default Claude cleanup restores a chained status line and preserves unrelated settings and credentials', async t => {
  const f = await fixture(t), directory = join(f.userHome, '.claude');
  const previous = { type: 'command', command: 'my-status-line' };
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ theme: 'dark', statusLine: {
    type: 'command', command: `node "${f.root}/mods/devkits-usage/claude-statusline.js"`,
  } }));
  await writeFile(join(directory, 'devkits-statusline-chain.json'), JSON.stringify(previous));
  await writeFile(join(directory, 'devkits-usage.json'), 'quota');
  await cleanDefaultClaude(f.root, f.userHome);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')), { theme: 'dark', statusLine: previous });
  await assert.rejects(readFile(join(directory, 'devkits-usage.json')), { code: 'ENOENT' });
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ statusLine: { command: 'new-user-choice' } }));
  await cleanDefaultClaude(f.root, f.userHome);
  assert.equal(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).statusLine.command, 'new-user-choice');
});

test('logout uses only the dedicated account and removes inherited authentication overrides', async () => {
  const calls = [], execute = async (...args) => calls.push(args);
  await signOut({ provider: 'claude', directory: '/dedicated/claude' }, execute);
  await signOut({ provider: 'codex', directory: '/dedicated/codex' }, execute);
  assert.deepEqual(calls[0].slice(0, 2), ['claude', ['auth', 'logout']]);
  assert.equal(calls[0][2].env.CLAUDE_CONFIG_DIR, '/dedicated/claude');
  assert.equal(calls[0][2].env.CLAUDE_SECURESTORAGE_CONFIG_DIR, '/dedicated/claude');
  assert.deepEqual(calls[1].slice(0, 2), ['codex', ['logout']]);
  assert.equal(calls[1][2].env.CODEX_HOME, '/dedicated/codex');
  for (const call of calls) for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'])
    assert.equal(call[2].env[name], undefined);
});

test('Windows sign-out uses the existing Git shell launcher for npm CLI shims', async () => {
  let actual;
  await signOut({ provider: 'codex', directory: 'C:\\Herdr\\data\\devkits\\codex\\one' }, async (...args) => { actual = args; }, 'windows');
  assert.equal(actual[0], 'git');
  assert.deepEqual(actual[1], ['-c', 'alias.devkits-shell=!sh', 'devkits-shell', '-c', 'exec "$@"', 'devkits-command', 'codex', 'logout']);
  assert.equal(actual[2].env.CODEX_HOME, 'C:\\Herdr\\data\\devkits\\codex\\one');
});

test('default Codex cleanup uses the provider helper with no servers and preserves its account data', async t => {
  const f = await fixture(t), directory = join(f.userHome, '.codex');
  const provider = join(f.root, 'mods', 'devkits-agents'); await mkdir(provider);
  await writeFile(join(directory, 'config.toml'), '[devkits_shared_mcp]\n');
  await writeFile(join(directory, 'config.toml.before-mcp-sync.bak'), 'old managed backup');
  await writeFile(join(provider, 'shared-mcp-sync.js'), `
    const fs = require('node:fs');
    if (process.argv[2] !== ${JSON.stringify(directory)} || process.argv[3] !== '{}') process.exit(1);
    fs.writeFileSync(process.argv[2] + '/config.toml', 'model = "keep"\\n');
  `);
  await clearReset(f.root, 'DEVKITS', { ...f.services, cleanCodex: undefined });
  assert.equal(await readFile(join(directory, 'config.toml'), 'utf8'), 'model = "keep"\n');
  assert.equal(await readFile(join(directory, 'auth.json'), 'utf8'), 'default credentials');
  await assert.rejects(readFile(join(directory, 'config.toml.before-mcp-sync.bak')), { code: 'ENOENT' });
});

test('an unrelated or malformed program entry is never silently removed by reset', async t => {
  const f = await fixture(t);
  f.programs.programs['devkits-codex-account-123456789abc'].run = ['codex'];
  await writeFile(join(f.root, 'programs.json'), JSON.stringify(f.programs));
  await assert.rejects(clearReset(f.root, 'DEVKITS', f.services), /outside Devkits/);
  assert.deepEqual(f.calls, []);
  assert.equal(await readFile(join(f.codex, 'auth.json'), 'utf8'), 'dedicated credentials');
});

test('a live reset lock prevents parallel deletion; a dead helper can be explicitly retried', async t => {
  const f = await fixture(t), lock = join(f.root, '.devkits-reset.lock');
  await writeFile(lock, JSON.stringify({ pid: process.pid }));
  await assert.rejects(clearReset(f.root, 'DEVKITS', f.services), /Another Devkits reset/);
  assert.deepEqual(f.calls, []);
  await writeFile(lock, JSON.stringify({ pid: 2147483647 }));
  await clearReset(f.root, 'DEVKITS', f.services);
  await assert.rejects(readdir(f.data), { code: 'ENOENT' });
});

test('reset waits for account terminals and finite cache writers without stopping unrelated processes', async () => {
  let terminals = [{ state: 'live', argv: ['env', 'CODEX_HOME=/herdr/data/devkits/codex/account', 'codex'] }];
  let processes = '999999 1 node node /herdr/mods/devkits-usage/analytics-reader.js\n';
  const run = async command => ({ stdout: command === 'hc' ? JSON.stringify({ terminals }) : processes });
  await assert.rejects(idleAccounts('/herdr/data/devkits', run, 'darwin'), /Close the terminals/);
  terminals = [];
  await assert.rejects(idleAccounts('/herdr/data/devkits', run, 'darwin'), /services are still stopping/);
  processes = '999999 1 node node /another/mods/devkits/reader.js\n999998 1 zsh zsh /herdr/mods/devkits/reader.js\n';
  await idleAccounts('/herdr/data/devkits', run, 'darwin');
  await assert.rejects(idleAccounts('/herdr/data/devkits', async command => ({ stdout: command === 'hc' ? '{"terminals":[]}' : '[123]' }), 'win32'), /services are still stopping/);
});

test('Windows reset process inspection returns only this installation helper PIDs', async () => {
  class Enumerator {
    constructor(rows) { this.rows = rows; this.index = 0; }
    atEnd() { return this.index >= this.rows.length; }
    moveNext() { this.index++; }
    item() { return this.rows[this.index]; }
  }
  const { resetWriterPids } = await evaluateNative('../mods/devkits/reset-processes-windows.js', { Enumerator }, 'resetWriterPids');
  assert.deepEqual(resetWriterPids([
    { ProcessId: 1, Name: 'node.exe', CommandLine: 'node C:\\Herdr\\mods\\devkits\\reset-data.js' },
    { ProcessId: 2, Name: 'node.exe', CommandLine: 'node C:\\Herdr\\mods\\devkits-usage\\analytics-reader.js' },
    { ProcessId: 3, Name: 'node.exe', CommandLine: 'node C:\\Other\\mods\\devkits\\reader.js' },
    { ProcessId: 4, Name: 'node.exe', CommandLine: 'node "C:\\Herdr\\mods\\devkits-tasks\\mcp-server.cjs"' },
  ], 'C:\\Herdr', 1), [2, 4]);
});

test('confirmed reset stops dedicated account sessions and their children, preserving unrelated terminals', async () => {
  let terminals = [
    { address: 't1', state: 'live', argv: ['env', 'CODEX_HOME=/herdr/data/devkits/codex/one', 'codex'] },
    { address: 't2', state: 'live', parent: 't1', argv: ['node', 'watch.js'] },
    { address: 't3', state: 'live', argv: ['codex'] },
    { address: 't4', state: 'live', argv: ['env', 'CODEX_HOME=/another/data/devkits/codex/one', 'codex'] },
  ];
  const killed = [];
  await stopAccountSessions('/herdr/data/devkits', async (_command, args) => {
    if (args[0] === 'kill') { killed.push(args[1]); terminals = terminals.filter(item => item.address !== args[1]); return {}; }
    return { stdout: JSON.stringify({ terminals }) };
  });
  assert.deepEqual(killed, ['t2', 't1']);
  assert.deepEqual(terminals.map(item => item.address), ['t3', 't4']);
});

test('service stop terminates MCP and helpers, then verifies exit before returning', async () => {
  const calls = []; let live = true;
  await stopDevkitsServices('/herdr/data/devkits', async (command, args) => {
    if (command === 'hc') return { stdout: '{"terminals":[]}' };
    calls.push(args.at(-1));
    if (args.at(-1) === 'stop') { live = false; return { stdout: '[123]' }; }
    return { stdout: live ? '[123]' : '[]' };
  }, 'win32');
  assert.deepEqual(calls, ['stop', String(process.pid)]);
});

test('service discovery includes persistent MCP descendants and excludes adjacent installations and reset itself', () => {
  assert.deepEqual(resetProcessPids([
    '100 1 node node /herdr/mods/devkits-tasks/mcp-server.cjs',
    '101 100 sh sh child.sh',
    '102 1 node node /herdr/mods/devkits-system/hardware-reader.js',
    '103 1 node node /herdr/mods/devkits-other-copy/reader.js',
    '104 1 node node /herdr/mods/devkits/reset-data.js',
    '105 1 node node /else/herdr/mods/devkits/reader.js',
    '106 1 node node /herdr/mods/devkits-backup/reader.js',
  ].join('\n'), '/herdr', 104), [100, 102, 103, 106, 101]);
});

test('failed service shutdown preserves account credentials before sign-out', async t => {
  const f = await fixture(t);
  await assert.rejects(clearReset(f.root, 'DEVKITS', { ...f.services,
    stopServices: async () => { throw new Error('service could not stop'); } }), /service could not stop/);
  assert.deepEqual(f.calls, []);
  assert.equal(await readFile(join(f.codex, 'auth.json'), 'utf8'), 'dedicated credentials');
});

test('a failed account-session stop prevents the reset before account sign-out or file deletion', async t => {
  const f = await fixture(t);
  await assert.rejects(clearReset(f.root, 'DEVKITS', { ...f.services, stopAccounts: async () => { throw new Error('could not stop'); } }), /could not stop/);
  assert.deepEqual(f.calls, []);
  assert.equal(await readFile(join(f.codex, 'auth.json'), 'utf8'), 'dedicated credentials');
});
