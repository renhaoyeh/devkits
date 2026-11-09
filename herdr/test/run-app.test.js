import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// run-app.js with a fake Herdr host; no real session or terminal is touched.
async function load(host = {}) {
  const source = await readFile(new URL('../mods/devkits/run-app.js', import.meta.url), 'utf8');
  return new Function(...Object.keys(host), source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')
    + '\nreturn { projectScripts, simulatorId, runApp, RunMenu, recentRuns };')(...Object.values(host));
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

test('Run names its thread after the executed command and replaces its previous run regardless of title', async () => {
  const calls = [], notes = [], memory = {};
  let runs = {}, booted = [];
  const space = { id: 's1', name: 'app', active: true, folder: '/p', machine: null, tabs: [{ id: 't1', name: 'Run' }, { id: 't2', name: 'bun run dev' }, { id: 't3', name: 'Run' }] };
  const live = [
    { labels: { 'herdr.space': 's1', 'herdr.tab': 't1' }, argv: ['/bin/zsh', '-lic', 'wrapper', '/bin/zsh', 'sh', '-c', SHELL, 'sh', 'bun run ios'] },
    { labels: { 'herdr.space': 's1', 'herdr.tab': 't2' }, argv: ['bun', 'run', 'dev'] },
    { labels: { 'herdr.space': 's1', 'herdr.tab': 't3' }, argv: ['zsh'] },
    { labels: { 'herdr.space': 's0', 'herdr.tab': 'other' }, argv: ['sh', '-c', SHELL, 'sh', 'bun run ios'] },
  ];
  const { runApp } = await load({ spaces: () => [{ id: 's0', tabs: [] }, space], run: (name, args) => calls.push([name, args]),
    terminals: () => live,
    notify: n => notes.push(n.body), shared: key => key === 'devkits.run-commands' ? runs : memory[key],
    setShared: (key, value) => { memory[key] = value; },
    exec: async () => ({ code: 0, stdout: JSON.stringify({ devices: { ios: booted } }) }) });
  const tabNew = command => ['tab.new', { space: 's1', folder: '/p', name: command, argv: ['sh', '-c', SHELL, 'sh', command] }];
  await runApp();
  assert.deepEqual(calls, []);
  assert.equal(memory['devkits.run-history'], undefined);
  runs = { '/p': 'bun run dev' };
  await runApp();
  assert.deepEqual(calls, [['tab.close', { id: 't1' }], ['devkits.reveal-conversation', undefined], tabNew('bun run dev')]);
  space.tabs[0].name = 'bun run dev';
  live[0].argv = ['sh', '-c', SHELL, 'sh', 'bun run dev'];
  runs = { '/p': 'bun expo run:ios --device {udid}' }; calls.length = 0;
  await runApp();
  assert.deepEqual(calls, []);
  assert.deepEqual(memory['devkits.run-history']['/p'], ['bun run dev']);
  booted = [{ udid: 'ABC' }];
  await runApp();
  assert.deepEqual(calls, [['tab.close', { id: 't1' }], ['devkits.reveal-conversation', undefined], tabNew('bun expo run:ios --device ABC')]);
  assert.deepEqual(memory['devkits.run-history']['/p'], ['bun expo run:ios --device {udid}', 'bun run dev']);
  space.machine = 'server'; calls.length = 0;
  await runApp();
  assert.deepEqual(calls, []);
  assert.deepEqual(notes, ['Choose what app runs from the run menu at the top.', 'Choose a simulator in the simulator panel first.',
    'Choose a project on this Mac first.']);
});

test('the run menu saves a script or a typed command for its project', async () => {
  const closed = [];
  const memory = { 'devkits.run-commands': { '/other': 'npm run ios' } };
  let submit;
  const input = { value: () => '  bun run duo  ', on: (_event, fn) => { submit = fn; } };
  const { RunMenu } = await load({ props: () => ({ overlay: 'menu', folder: '/p' }), closeOverlay: id => closed.push(id),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, InputState: { new: () => input } });
  const menu = new RunMenu();
  menu.init({ focus_handle: () => ({ focus() {} }), spawn() {} });
  menu.choose('bun run iphone');
  assert.deepEqual(memory['devkits.run-commands'], { '/other': 'npm run ios', '/p': 'bun run iphone' });
  submit();
  assert.deepEqual(memory['devkits.run-commands'], { '/other': 'npm run ios', '/p': 'bun run duo' });
  assert.deepEqual(memory['devkits.run-history']['/p'], ['bun run duo', 'bun run iphone']);
  assert.deepEqual(closed, ['menu', 'menu']);
});

test('recent commands are scoped to the project, deduplicated, bounded and kept in last-used order', async () => {
  const memory = { 'devkits.run-commands': { '/p': 'legacy command' },
    'devkits.run-history': { '/other': ['other command'] } };
  const { RunMenu, recentRuns } = await load({ props: () => ({}), closeOverlay() {},
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
  const menu = new RunMenu(); menu.folder = '/p';
  assert.deepEqual(recentRuns('/p'), [], 'Saved selection does not synthesize a history entry');
  menu.choose('new command'); menu.choose('legacy command');
  assert.deepEqual(recentRuns('/p'), ['legacy command', 'new command']);
  for (let i = 0; i < 12; i++) menu.choose(`command ${i}`);
  assert.deepEqual(recentRuns('/p'), Array.from({ length: 10 }, (_, i) => `command ${11 - i}`));
  assert.deepEqual(recentRuns('/other'), ['other command']);
});

test('the Recent remove button keeps the menu open and selection intact, including after removing the final record', async () => {
  const memory = { 'devkits.run-commands': { '/p': 'npm run dev' }, 'devkits.run-history': { '/p': ['npm run dev'] } }, nodes = new Map(), texts = [];
  const element = () => {
    const data = {};
    const el = new Proxy(data, { get(_target, key) {
      if (key === 'when') return (condition, render) => { if (condition) render(el); return el; };
      return (...args) => {
        if (key === 'id') nodes.set(args[0], data);
        if (key === 'on_click') data.click = args[0];
        if (key === 'child' && typeof args[0] === 'string') texts.push(args[0]);
        return el;
      };
    } });
    return el;
  };
  const { RunMenu, recentRuns } = await load({ props: () => ({}),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    closeOverlay: () => assert.fail('removal must keep the menu open'), div: element, h_flex: element, v_flex: element,
    DropdownMenuContent: id => element().id(id), DropdownMenuItem: id => element().id(id),
    DropdownMenuLabel: element, DropdownMenuSeparator: element, Button: id => element().id(id), glyph: element,
    Input: { new: element } });
  const menu = new RunMenu(); menu.folder = '/p'; menu.scripts = ['npm run dev'];
  menu.render({});
  assert.ok(texts.indexOf('RECENT') < texts.indexOf('SCRIPTS'));
  assert.ok(!texts.includes('DEFAULT'));
  let stopped = false, notified = false;
  nodes.get('remove-run-recent-0').click({}, { stop_propagation() { stopped = true; }, notify() { notified = true; } });
  assert.ok(stopped && notified);
  assert.deepEqual(recentRuns('/p'), []);
  assert.equal(memory['devkits.run-commands']['/p'], 'npm run dev');
  menu.render({});
  assert.ok(texts.includes('No recent commands'));
  assert.ok(nodes.has('run-command-0'), 'package scripts remain available after removing history');
});
