import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// run-app.js with a fake Herdr host; no real session or terminal is touched.
async function load(host = {}) {
  const source = await readFile(new URL('../mods/devkits/run-app.js', import.meta.url), 'utf8');
  return new Function(...Object.keys(host), source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')
    + '\nreturn { projectScripts, simulatorId, runApp, RunMenu };')(...Object.values(host));
}

const SHELL = '"${SHELL:-/bin/zsh}" -lic "$1"; exec "${SHELL:-/bin/zsh}" -l';

test('the run menu lists package.json scripts through the project\'s package manager', async () => {
  let pkg = { scripts: { dev: 'expo start', iphone: 'expo run:ios' } }, files = 'bun.lock\npackage.json\n';
  const { projectScripts } = await load({ readTextFile: async () => pkg && JSON.stringify(pkg), exec: async () => ({ code: 0, stdout: files }) });
  assert.deepEqual(await projectScripts('/p'), ['bun run dev', 'bun run iphone']);
  pkg = { packageManager: 'pnpm@9.0.0', scripts: { dev: 'x' } };
  assert.deepEqual(await projectScripts('/p'), ['pnpm run dev']);
  pkg = { scripts: { dev: 'x' } }; files = 'package-lock.json\n';
  assert.deepEqual(await projectScripts('/p'), ['npm run dev']);
  pkg = null;
  assert.deepEqual(await projectScripts('/p'), []);
});

test('{udid} is the simulator panel\'s choice, else the first booted simulator', async () => {
  let chosen = 'CHOSEN';
  const booted = { devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [{ udid: 'BOOTED' }] } };
  const { simulatorId } = await load({ shared: () => chosen, exec: async () => ({ code: 0, stdout: JSON.stringify(booted) }) });
  assert.equal(await simulatorId(), 'CHOSEN');
  chosen = null;
  assert.equal(await simulatorId(), 'BOOTED');
});

test('Run runs the shown project\'s chosen command in a Run tab, replacing the previous one', async () => {
  const calls = [], notes = [];
  let runs = {}, booted = [];
  const space = { id: 's1', name: 'app', active: true, folder: '/p', machine: null, tabs: [{ id: 't1', name: 'Run' }, { id: 't2', name: 'Codex' }] };
  const { runApp } = await load({ spaces: () => [{ id: 's0', tabs: [] }, space], run: (name, args) => calls.push([name, args]),
    notify: n => notes.push(n.body), shared: key => key === 'devkits.run-commands' ? runs : null,
    exec: async () => ({ code: 0, stdout: JSON.stringify({ devices: { ios: booted } }) }) });
  const tabNew = command => ['tab.new', { space: 's1', folder: '/p', name: 'Run', argv: ['sh', '-c', SHELL, 'sh', command] }];
  await runApp();
  assert.deepEqual(calls, []);
  runs = { '/p': 'bun run dev' };
  await runApp();
  assert.deepEqual(calls, [['tab.close', { id: 't1' }], ['devkits.reveal-conversation', undefined], tabNew('bun run dev')]);
  runs = { '/p': 'bun expo run:ios --device {udid}' }; calls.length = 0;
  await runApp();
  assert.deepEqual(calls, []);
  booted = [{ udid: 'ABC' }];
  await runApp();
  assert.deepEqual(calls, [['tab.close', { id: 't1' }], ['devkits.reveal-conversation', undefined], tabNew('bun expo run:ios --device ABC')]);
  space.machine = 'server'; calls.length = 0;
  await runApp();
  assert.deepEqual(calls, []);
  assert.deepEqual(notes, ['Choose what app runs from the run menu at the top.', 'Choose a simulator in the simulator panel first.',
    'Choose a project on this Mac first.']);
});

test('the run menu saves a script or a typed command for its project', async () => {
  const closed = [];
  let runs = { '/other': 'npm run ios' }, submit;
  const input = { value: () => '  bun run duo  ', on: (_event, fn) => { submit = fn; } };
  const { RunMenu } = await load({ props: () => ({ overlay: 'menu', folder: '/p' }), closeOverlay: id => closed.push(id),
    shared: () => runs, setShared: (_key, value) => { runs = value; }, InputState: { new: () => input } });
  const menu = new RunMenu();
  menu.init({ focus_handle: () => ({ focus() {} }), spawn() {} });
  menu.choose('bun run iphone');
  assert.deepEqual(runs, { '/other': 'npm run ios', '/p': 'bun run iphone' });
  submit();
  assert.deepEqual(runs, { '/other': 'npm run ios', '/p': 'bun run duo' });
  assert.deepEqual(closed, ['menu', 'menu']);
});
