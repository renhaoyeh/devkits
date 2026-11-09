import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateNative } from './source-harness.js';

function nesting(value) {
  return value && typeof value === 'object' ? 1 + Math.max(0, ...Object.values(value).map(nesting)) : 0;
}

async function fixture(options = {}) {
  let target = { overlay: 'confirm' }, projects = [], confirmation = '';
  let autoClose = true, closeError = null, now = Date.now();
  const nodes = new Map(), calls = [], commands = [], closed = [], queue = [], timers = [];
  const memory = { layout: 'devkits', 'devkits.calendar-events': ['private'], 'other-mod': 'keep' };
  const layout = options.layout || { id: 'root', type: 'block', content: { mod: 'devkits' } }, source = JSON.stringify(layout);
  const element = (id = '') => {
    const node = { id, children: [] };
    const el = new Proxy({}, { get: (_target, key) => (...args) => {
      if (key === 'id') { node.id = args[0]; nodes.set(args[0], node); }
      else if (key === 'child') node.children.push(args[0]);
      else if (key === 'when') { if (args[0]) args[1](el); }
      else if (key === 'on_click') node.click = args[0];
      else if (key === 'disabled') node.disabled = args[0];
      return el;
    } });
    if (id) nodes.set(id, node);
    return el;
  };
  let clearError = null;
  const host = { div: element, v_flex: element, Button: element,
    AlertDialogContent: element, AlertDialogTitle: element, AlertDialogDescription: element,
    AlertDialogFooter: element, AlertDialogCancel: element, Input: { new: element },
    InputState: { new: () => ({ on() {}, value: () => confirmation }) },
    props: () => target, appHome: () => '/herdr', spaces: () => projects,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    readTextFile: async () => source, run: (...args) => {
      if (nesting(args[1]) > 16) throw new Error('a host argument may not nest more than 16 levels deep');
      commands.push(args);
    },
    closeOverlay: id => closed.push(id), openOverlay: spec => spec, window: () => ({ platform: 'macos' }),
    exec: async (command, args) => {
      calls.push([command, args]);
      if (command === 'herdr-app' && args[0] === 'do') {
        if (closeError) return { code: 1, stderr: closeError };
        if (autoClose) projects = projects.filter(project => project.id !== args[3]);
        return { code: 0, stdout: '{}' };
      }
      if (command === 'herdr-app') return { code: 0, stdout: JSON.stringify({ overlays: ['devkits', 'devkits'] }) };
      if (args[1] === 'inspect') return { code: 0, stdout: JSON.stringify({ accounts: 2 }) };
      return clearError ? { code: 1, stderr: clearError } : { code: 0, stdout: JSON.stringify({ sharedKeys: ['devkits.calendar-events'] }) };
    }, Date: { now: () => now },
  };
  const { ResetDevkits, openDevkitsReset } = await evaluateNative('../mods/devkits/reset-devkits.js', host, 'ResetDevkits, openDevkitsReset');
  const cx = { focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {},
    spawn(fn) { queue.push(fn(cx)); }, timer: { after(ms, callback) { timers.push({ ms, callback }); } } };
  const drain = async () => { while (queue.length) await Promise.all(queue.splice(0)); };
  return { ResetDevkits, openDevkitsReset, cx, drain, nodes, calls, commands, closed, timers, memory, layout, host, element,
    target: value => { target = value; }, projects: value => { projects = value; }, confirmation: value => { confirmation = value; },
    fail: value => { clearError = value; }, deferClose: () => { autoClose = false; },
    closeError: value => { closeError = value; }, advance: ms => { now += ms; } };
}

test('Interface settings exposes the reset under Data without clearing anything on navigation', async () => {
  const h = await fixture(); let opened = 0;
  const { InterfaceSettings } = await evaluateNative('../mods/devkits/ui-settings.js', {
    ...h.host, h_flex: h.element, DialogContent: h.element, DialogTitle: h.element,
    DialogDescription: h.element, DialogFooter: h.element, SelectState: class {},
    props: () => ({ page: 'data' }), openDevkitsReset: () => { opened++; },
    systemDisplayConfig: () => ({ enabled: false, sidebar: { visible: true }, status: { visible: false } }),
  }, 'InterfaceSettings');
  const view = new InterfaceSettings(); view.init(h.cx); view.render({});
  assert.ok(h.nodes.has('interface-page-data'));
  assert.ok(h.nodes.has('interface-clear-devkits-data'));
  assert.deepEqual(h.calls, []);
  h.nodes.get('interface-clear-devkits-data').click();
  assert.equal(opened, 1);
  assert.deepEqual(h.calls, []);
});

test('typing DEVKITS enables the button with open projects; opening, typing and Cancel never close or clear anything', async () => {
  const h = await fixture(), view = new h.ResetDevkits();
  assert.deepEqual(h.openDevkitsReset(), { mod: 'devkits', kind: 'dialog', frame: 'none', modal: true,
    width: 620, height: 560, props: { view: 'reset-devkits' } });
  view.init(h.cx); await h.drain(); view.render({});
  assert.equal(h.nodes.get('reset-devkits-clear').disabled, true);
  h.confirmation('devkits'); view.begin(h.cx); await h.drain();
  assert.deepEqual(h.commands, []);
  h.confirmation('DEVKITS'); h.projects([{ id: 'open-project' }]); view.render({});
  assert.equal(h.nodes.get('reset-devkits-clear').disabled, false);
  assert.deepEqual(h.commands, []);
  h.nodes.get('reset-devkits-cancel').click();
  assert.deepEqual(h.closed, ['confirm']);
  assert.equal(h.calls.filter(([, args]) => args[1] === 'clear').length, 0);
});

test('confirmed reset closes all projects with explicit confirmation before account deletion', async () => {
  const h = await fixture(), preview = new h.ResetDevkits();
  h.projects([{ id: 'local', name: 'Local' }, { id: 'machine/remote', name: 'Remote' }]);
  preview.init(h.cx); await h.drain(); h.confirmation('DEVKITS');
  preview.begin(h.cx); await h.drain();
  assert.equal(h.calls.filter(([, args]) => args[0] === 'do').length, 0, 'Project closing starts only after the old views are removed');
  h.target(h.commands[0][1].layout.content.props);
  const view = new h.ResetDevkits(); view.init(h.cx); h.timers[0].callback(h.cx); await h.drain();
  const closeCalls = h.calls.filter(([, args]) => args[0] === 'do');
  assert.deepEqual(closeCalls, [
    ['herdr-app', ['do', 'space.close', '--id', 'local', '--confirmed', 'true']],
    ['herdr-app', ['do', 'space.close', '--id', 'machine/remote', '--confirmed', 'true']],
  ]);
  assert.ok(h.calls.indexOf(closeCalls[1]) < h.calls.findIndex(([, args]) => args[1] === 'clear'));
  assert.equal(view.complete, true);
});

test('deletion waits for native project closure and reports failures without clearing account data', async () => {
  const h = await fixture(); h.projects([{ id: 'one' }]); h.deferClose();
  h.target({ phase: 'execute', token: 'one', originalSource: JSON.stringify(h.layout) });
  h.memory['devkits.reset-authorization'] = { token: 'one', expiresAt: Date.now() + 10000 };
  const view = new h.ResetDevkits(); view.init(h.cx); h.timers[0].callback(h.cx);
  // Allow the mocked close command to resolve while the native model still has the project.
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.calls.filter(([, args]) => args[1] === 'clear').length, 0);
  h.advance(16000); h.timers.at(-1).callback(h.cx); await h.drain();
  assert.match(view.error, /still closing/);
  assert.deepEqual(h.memory['devkits.calendar-events'], ['private']);
  h.closeError('unreachable'); view.clear(h.cx); await h.drain();
  assert.match(view.error, /Could not close project/);
  assert.equal(h.calls.filter(([, args]) => args[1] === 'clear').length, 0);
  h.projects([]); h.closeError(null); view.clear(h.cx); await h.drain();
  assert.equal(view.complete, true);
});

test('confirmed reset removes provider mounts before clearing and clears shared data only through native APIs', async () => {
  const h = await fixture(), preview = new h.ResetDevkits();
  preview.init(h.cx); await h.drain(); h.confirmation('DEVKITS');
  preview.begin(h.cx); preview.begin(h.cx); await h.drain();
  assert.deepEqual(h.commands.map(([name]) => name), ['layout.set', 'overlay.close', 'overlay.close']);
  const neutral = h.commands[0][1].layout;
  assert.equal(neutral.content.props.view, 'reset-devkits');
  assert.equal(neutral.children, undefined, 'The reset layout mounts no old services');
  assert.equal(h.calls.filter(([, args]) => args[1] === 'clear').length, 0);
  h.target(neutral.content.props);
  const execution = new h.ResetDevkits(); execution.init(h.cx);
  assert.equal(h.memory['devkits.reset-authorization'], null, 'Authorization is consumed once');
  assert.equal(h.timers[0].ms, 350);
  h.timers[0].callback(h.cx); await h.drain();
  assert.equal(execution.complete, true);
  assert.equal(h.memory['devkits.calendar-events'], null);
  assert.equal(h.memory['other-mod'], 'keep');
  assert.equal(h.memory.layout, 'devkits');
  execution.restore();
  assert.deepEqual(h.commands.slice(-2), [['layout.set', { layout: h.layout }], ['app.quit']]);
});

test('failures show incomplete state, keep saved records and permit an explicit retry', async () => {
  const h = await fixture();
  h.target({ phase: 'execute', token: 'one', originalSource: JSON.stringify(h.layout) });
  h.memory['devkits.reset-authorization'] = { token: 'one', expiresAt: Date.now() + 10000 };
  const view = new h.ResetDevkits(); h.fail('Sign-out failed'); view.init(h.cx);
  h.timers[0].callback(h.cx); await h.drain(); view.render({});
  assert.equal(view.complete, undefined);
  assert.match(view.error, /Sign-out failed/);
  assert.deepEqual(h.memory['devkits.calendar-events'], ['private']);
  h.fail(null); view.clear(h.cx); view.clear(h.cx); await h.drain();
  assert.equal(view.complete, true);
  assert.equal(h.calls.filter(([, args]) => args[1] === 'clear').length, 2);
});

test('a reload or expired authorization never replays a destructive reset', async () => {
  const h = await fixture();
  h.target({ phase: 'execute', token: 'expired', originalSource: JSON.stringify(h.layout) });
  h.memory['devkits.reset-authorization'] = { token: 'expired', expiresAt: Date.now() - 1 };
  const view = new h.ResetDevkits(); view.init(h.cx); view.clear(h.cx); await h.drain();
  assert.match(view.error, /interrupted/);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.timers, []);
});

test('the real Devkits layout stays below the host nesting limit when starting and restoring reset', async () => {
  const layout = JSON.parse(await readFile(new URL('../layouts/devkits.json', import.meta.url), 'utf8'));
  const h = await fixture({ layout }), view = new h.ResetDevkits();
  assert.ok(nesting({ layout: { content: { props: { original: layout } } } }) > 16, 'The fixture reproduces the reported host limit');
  view.init(h.cx); await h.drain(); h.confirmation('DEVKITS'); view.begin(h.cx); await h.drain();
  assert.equal(view.error, undefined);
  const request = h.commands[0][1];
  assert.ok(nesting(request) <= 16);
  assert.equal(typeof request.layout.content.props.originalSource, 'string');
  assert.deepEqual(JSON.parse(request.layout.content.props.originalSource), layout);
  h.target(request.layout.content.props);
  const execution = new h.ResetDevkits(); execution.init(h.cx); h.timers[0].callback(h.cx); await h.drain();
  assert.equal(execution.complete, true);
  execution.restore();
  assert.deepEqual(h.commands.at(-2), ['layout.set', { layout }]);
  assert.ok(nesting(h.commands.at(-2)[1]) <= 16);
});
