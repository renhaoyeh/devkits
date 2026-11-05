import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { threadTitle, projectGroups, projectCatalog, folderKey, launcherChoices } from '../mods/devkits/model.js';
import { install } from '../install.js';

const agents = [
  { address: 't1', title: '✳ Fix login', space_name: 'api', status: 'working', program: { name: 'Claude Code' } },
  { address: 't2', title: 'Review tests', space_name: 'app', status: 'blocked', program: { name: 'Codex' } },
  { address: 'remote/t1', title: 'Deploy', space_name: 'api', status: 'done', pinned: true },
  { address: 't4', title: 'Plan', space_name: 'app', status: 'idle' },
];
agents.forEach((agent, index) => { agent.space = index % 2 ? 'app' : 'api'; agent.tab = `tab-${index}`; });
const projects = [
  { id: 'api', name: 'API', folder: '/Code/api', active: true, tabs: [
    { id: 'tab-0', name: '1', active: true, status: 'working' },
    { id: 'tab-2', name: 'Deploy API', named: true, status: 'done' },
    { id: 'shell', name: '3' },
  ] },
  { id: 'app', name: 'App', folder: '/Code/app', tabs: [
    { id: 'tab-1', name: '2', status: 'blocked' }, { id: 'tab-3', name: 'Plan', named: true },
  ] },
];
async function loadView(host) {
  const source = await readFile(new URL('../mods/devkits/main.js', import.meta.url), 'utf8');
  const components = await Promise.all(['button', 'checkbox', 'alert-dialog', 'dialog', 'empty', 'sidebar', 'dropdown-menu']
    .map(name => readFile(new URL(`../mods/devkits/components/${name}.js`, import.meta.url), 'utf8')));
  // Run native actions with a fake host; no real Herdr session is touched.
  return new Function('View', ...Object.keys(host), components.join('\n')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '') + '\n' + source
    .replace(/^import .*;\n/gm, '').replace('export default class', 'return class'));
}
async function viewFor(host) {
  const memory = {};
  host = { projectCatalog, projectGroups, folderKey, launcherChoices, props: () => ({}), shared: key => memory[key],
    setShared: (key, value) => { memory[key] = value; }, ...host };
  const factory = await loadView(host);
  return factory(class {}, ...Object.values(host));
}
function fakeElements() {
  const nodes = new Map();
  const texts = [];
  const assets = [];
  const element = () => {
    const data = { children: [] };
    const el = new Proxy(data, { get(target, key) {
      if (key === 'when') return (condition, render) => { if (condition) render(el); return el; };
      return (...args) => {
        if (key === 'id') nodes.set(args[0], data);
        if (key === 'on_click') data.click = args[0];
        if (key === 'on_change') data.change = args[0];
        if (key === 'disabled') data.disabled = args[0];
        if (key === 'on_key_down') data.keyDown = args[0];
        if (key === 'on_mouse_down') data.mouseDown = args[1];
        if (key === 'on_mouse_up') data.mouseUp = args[1];
        if (key === 'on_mouse_move') data.mouseMove = args[0];
        if (key === 'overflow_y_scrollbar') data.scrollbar = true;
        if (key === 'on_hover') data.hover = args[0];
        if (key === 'h') data.height = args[0];
        if (key === 'h_auto') data.height = 'auto';
        if (key === 'opacity') data.opacity = args[0];
        if (key === 'checked') data.checked = args[0];
        if (key === 'child') data.children.push(args[0]);
        if (key === 'child' && typeof args[0] === 'string') texts.push(args[0]);
        if (key === 'children') data.children.push(...args[0]);
        return el;
      };
    } });
    data.element = el;
    return el;
  };
  const asset = path => { assets.push(path); return element(); };
  return { nodes, texts, assets, element, div: element, svg: asset, image: asset, h_flex: element, v_flex: element,
    NativeButton: { new: id => element().id(id) }, NativeCheckbox: { new: id => element().id(id) } };
}
test('closing an empty project only removes its saved folder', async () => {
  const commands = [], memory = { 'devkits.projects': ['/Code/one', '/Code/two'], 'devkits.selected-project': 'project:/Code/one' };
  const View = await viewFor({ shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run: (...args) => commands.push(args) });
  new View().closeProject({ id: 'project:/Code/one', folder: '/Code/one', pending: true });
  assert.deepEqual(memory['devkits.projects'], ['/Code/two']);
  assert.equal(memory['devkits.selected-project'], null);
  assert.deepEqual(commands, []);
});
test('button input stays inside its action instead of reaching a parent row or dialog', async () => {
  const ui = fakeElements(), commands = [];
  const View = await viewFor({ ...ui, props: () => ({ pane: 'pane-1' }),
    panes: () => [{ pane: 'pane-1' }], run: (...args) => commands.push(args) });
  new View().paneHeader({});
  const button = ui.nodes.get('close-pane-1');
  let stopped = 0;
  const cx = { stop_propagation() { stopped++; } };
  button.mouseDown({}, cx);
  for (const key of ['enter', 'space', 'escape']) button.keyDown({ key }, cx);
  assert.equal(stopped, 3);
  assert.deepEqual(commands, []);
  button.click();
  assert.deepEqual(commands, [['pane.close', { pane: 'pane-1' }]]);
});
test('closing a live workspace requires confirmation; cancel leaves all sessions and saved projects intact', async () => {
  const ui = fakeElements(), commands = [], overlays = [], closed = [];
  const memory = { 'devkits.projects': ['/Code/api'] };
  let target;
  const View = await viewFor({ ...ui, shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    props: () => target, closeOverlay: id => closed.push(id), run: (...args) => commands.push(args),
    openOverlay: value => overlays.push(value) });
  const view = new View();
  target = { project: projects[0], overlay: 'project-menu' };
  view.projectMenu({});
  assert.ok(ui.nodes.has('menu-close-project'));
  ui.nodes.get('menu-close-project').click();
  assert.deepEqual(closed, ['project-menu']);
  assert.deepEqual(commands, []);
  target = { ...overlays[0].props, overlay: 'confirmation' };
  view.closePrompt({});
  ui.nodes.get('cancel-close-project').click();
  assert.deepEqual(commands, []);
  assert.deepEqual(memory['devkits.projects'], ['/Code/api']);
  ui.nodes.get('confirm-close-project').click();
  assert.deepEqual(commands, [['space.close', { id: 'api', confirmed: true }]]);
  assert.deepEqual(memory['devkits.projects'], []);
});
test('launcher shows installed agents at content height without a scroll container', async () => {
  const ui = fakeElements(), commands = [];
  let pending, options;
  const choices = [{ key: 'codex-work', name: 'Codex · work', installed: true, run: ['codex'] },
    { key: 'claude', name: 'Claude Code', installed: false, run: ['claude'] }];
  const View = await viewFor({ ...ui, props: () => ({ view: 'launcher', space: 'api', folder: '/Code/api', overlay: 'menu' }),
    spaces: () => projects, knownAgents: async opts => { options = opts; return choices; },
    theme: () => ({}), run: (...args) => commands.push(args), closeOverlay() {} });
  const cx = { focus_handle: () => ({ focus() {} }), notify() {}, spawn(task) { pending = task(cx); } };
  const view = new View(); view.init({}, cx); await pending; view.render();
  assert.deepEqual(options, { on: undefined });
  assert.equal(ui.nodes.get('thread-launcher').height, 'auto');
  assert.ok(!ui.nodes.get('thread-launchers').scrollbar);
  assert.ok(ui.nodes.has('start-codex-work'));
  assert.ok(!ui.nodes.has('start-claude'));
  assert.equal(view.launchers.length, 1);
  assert.deepEqual(commands, []);
  ui.nodes.get('start-codex-work').click();
  assert.ok(commands.some(([name, args]) => name === 'tab.new' && args.argv[0] === 'codex'));
  ui.nodes.clear();
  view.launchers = Array.from({ length: 20 }, (_, index) => ({ key: `account-${index}`, name: `Account ${index}`, installed: true }));
  view.render();
  assert.equal(ui.nodes.get('thread-launcher').height, 'auto');
  assert.ok(!ui.nodes.get('thread-launchers').scrollbar);
  assert.ok(ui.nodes.has('start-account-19'));
  assert.equal(ui.nodes.get('thread-launcher').children.at(-1), ui.nodes.get('manage-launchers-open').element);
});
test('Manage persists visibility, retains hidden choices, and numbers only visible launchers', async () => {
  const ui = fakeElements(), memory = {}, commands = [], overlays = [], closed = [];
  let target = { view: 'launcher', space: 'api', overlay: 'menu' }, pending;
  const choices = [{ key: 'codex-work', name: 'Codex · work', installed: true, run: ['codex'] },
    { key: 'claude', name: 'Claude', installed: true, run: ['claude'] }];
  const View = await viewFor({ ...ui, props: () => target, knownAgents: async () => choices,
    spaces: () => projects, theme: () => ({}), shared: key => memory[key],
    setShared: (key, value) => { memory[key] = value; }, run: (...args) => commands.push(args),
    closeOverlay: id => closed.push(id), openOverlay: value => overlays.push(value) });
  const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }),
    spawn(task) { pending = task(cx); } };
  const view = new View(); view.launchers = choices; view.render();
  assert.equal(ui.nodes.get('thread-launcher').children.at(-1), ui.nodes.get('manage-launchers-open').element);
  ui.nodes.get('manage-launchers-open').click({}, cx);
  assert.deepEqual(closed, ['menu']);
  assert.equal(overlays[0].kind, 'dialog');
  assert.equal(overlays[0].width, 680);
  assert.equal(overlays[0].height, 0.8);
  assert.equal(overlays[0].modal, true);
  assert.deepEqual(overlays[0].props, { view: 'manage-launchers', space: 'api' });
  target = { ...overlays[0].props, overlay: 'manage-dialog' };
  const dialog = new View(); dialog.init({}, cx); await pending; dialog.render();
  assert.equal(ui.nodes.get('show-agent:codex-work').checked, true);
  ui.nodes.get('show-agent:codex-work').change(false, cx);
  ui.nodes.get('show-terminal').change(false, cx);
  assert.deepEqual(commands, []);
  ui.nodes.get('manage-launchers-done').click({}, cx);
  assert.equal(closed.at(-1), 'manage-dialog');
  target = { view: 'launcher', space: 'api', overlay: 'menu' };
  ui.nodes.clear(); view.render();
  assert.ok(!ui.nodes.has('start-codex-work'));
  assert.ok(!ui.nodes.has('new-terminal'));
  assert.ok(ui.nodes.has('start-claude'));
  ui.nodes.get('thread-launcher').keyDown({ key: '1', modifiers: {} });
  assert.equal(commands.find(([name]) => name === 'tab.new')[1].argv[0], 'claude');
  commands.length = 0;
  const reopened = new View(); reopened.launchers = choices; reopened.render();
  ui.nodes.get('manage-launchers-open').click({}, cx);
  target = { ...overlays.at(-1).props, overlay: 'manage-dialog-2' };
  const reopenedDialog = new View(); reopenedDialog.init({}, cx); await pending; reopenedDialog.render();
  assert.equal(ui.nodes.get('show-agent:codex-work').checked, false);
  assert.equal(ui.nodes.get('show-terminal').checked, false);
  ui.nodes.get('manage-launchers').keyDown({ key: 'space' }, cx);
  ui.nodes.get('manage-launchers').keyDown({ key: 'down' }, cx);
  ui.nodes.get('manage-launchers').keyDown({ key: 'enter' }, cx);
  ui.nodes.get('manage-launchers').keyDown({ key: 'escape' }, cx);
  assert.equal(closed.at(-1), 'manage-dialog-2');
  target = { view: 'launcher', space: 'api', overlay: 'menu' };
  ui.nodes.clear(); reopened.render();
  assert.ok(ui.nodes.has('start-codex-work'));
  assert.ok(ui.nodes.has('new-terminal'));
  assert.deepEqual(memory['devkits.hidden-launchers'], []);
  assert.deepEqual(commands, []);
});
test('saved launcher order tolerates unavailable agents and appends new entries without mutating inputs', () => {
  const agents = [{ key: 'codex', name: 'Codex' }, { key: 'claude', name: 'Claude' }];
  const saved = ['agent:claude', 'agent:missing', 'terminal', 'agent:codex'];
  assert.deepEqual(launcherChoices(agents).map(choice => choice.key), ['terminal', 'agent:codex', 'agent:claude']);
  assert.deepEqual(launcherChoices(agents, saved).map(choice => choice.key), ['terminal', 'agent:claude', 'agent:codex']);
  assert.deepEqual(launcherChoices([...agents, { key: 'new', name: 'New' }], saved).map(choice => choice.key),
    ['terminal', 'agent:claude', 'agent:codex', 'agent:new']);
  assert.deepEqual(agents.map(agent => agent.key), ['codex', 'claude']);
  assert.deepEqual(saved, ['agent:claude', 'agent:missing', 'terminal', 'agent:codex']);
});
test('Manage groups Terminal, agents and accounts; dragging stays within each section', async () => {
  const ui = fakeElements(), commands = [], memory = {
    'devkits.hidden-launchers': ['agent:claude'],
    'devkits.launcher-order': ['agent:missing', 'terminal', 'agent:codex', 'agent:claude', 'agent:pi',
      'agent:devkits-codex-one', 'agent:devkits-codex-two'],
  };
  let target = { view: 'manage-launchers', overlay: 'dialog' };
  const choices = [{ key: 'codex', name: 'Codex', installed: true, run: ['codex'], icon: 'icons/codex.svg' },
    { key: 'claude', name: 'Claude', installed: true, run: ['claude'], icon: 'icons/claude.svg', tint: true },
    { key: 'pi', name: 'Pi', installed: true, run: ['pi'] },
    { key: 'devkits-codex-one', name: 'Codex · one', installed: true, run: ['one'] },
    { key: 'devkits-codex-two', name: 'Codex · two', installed: true, run: ['two'] }];
  const View = await viewFor({ ...ui, props: () => target, spaces: () => [], theme: () => ({}),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run: (...args) => commands.push(args), closeOverlay() {} });
  const cx = { notify() {}, stop_propagation() {} };
  const view = new View(); view.launchers = choices; view.manageIndex = 0; view.render();
  assert.ok(ui.assets.includes('icons/codex.svg')); assert.ok(ui.assets.includes('icons/claude.svg'));
  assert.ok(ui.assets.includes('mods/devkits/assets/icons/terminal.svg'));
  for (const group of [0, 1, 2]) assert.ok(ui.nodes.has(`manage-section-${group}`));
  assert.ok(!ui.nodes.has('drag-terminal'));
  assert.ok(!ui.nodes.get('manage-launchers-list').scrollbar);
  const original = [...memory['devkits.launcher-order']];
  ui.nodes.get('drag-agent:codex').mouseDown({}, cx);
  ui.nodes.get('manage-terminal').mouseUp({}, cx); view.render();
  assert.deepEqual(memory['devkits.launcher-order'], original);
  ui.nodes.get('drag-agent:codex').mouseDown({}, cx);
  ui.nodes.get('manage-agent:devkits-codex-one').mouseUp({}, cx); view.render();
  assert.deepEqual(memory['devkits.launcher-order'], original);
  ui.nodes.get('drag-agent:codex').mouseDown({}, cx);
  ui.nodes.get('manage-agent:pi').mouseMove({}, cx); view.render();
  assert.deepEqual(memory['devkits.launcher-order'], original);
  ui.nodes.get('manage-agent:pi').mouseUp({}, cx); view.render();
  assert.deepEqual(memory['devkits.launcher-order'].slice(0, 5),
    ['agent:missing', 'terminal', 'agent:claude', 'agent:pi', 'agent:codex']);
  assert.equal(view.dragKey, null);
  ui.nodes.get('drag-agent:devkits-codex-two').mouseDown({}, cx);
  ui.nodes.get('manage-agent:devkits-codex-one').mouseUp({}, cx); view.render();
  assert.deepEqual(memory['devkits.launcher-order'].slice(-2), ['agent:devkits-codex-two', 'agent:devkits-codex-one']);
  const saved = [...memory['devkits.launcher-order']];
  ui.nodes.get('drag-agent:pi').mouseDown({}, cx);
  ui.nodes.get('manage-agent:codex').mouseMove({}, cx);
  ui.nodes.get('manage-launchers').keyDown({ key: 'escape' }, cx);
  assert.equal(view.dragKey, null);
  ui.nodes.get('manage-agent:codex').mouseUp({}, cx);
  assert.deepEqual(memory['devkits.launcher-order'], saved);
  ui.nodes.get('drag-agent:pi').mouseDown({}, cx);
  ui.nodes.get('manage-launchers').hover(false, cx);
  ui.nodes.get('manage-agent:codex').mouseUp({}, cx);
  assert.deepEqual(memory['devkits.launcher-order'], saved);
  assert.deepEqual(memory['devkits.hidden-launchers'], ['agent:claude']);
  assert.equal(ui.nodes.get('show-agent:claude').checked, false);
  assert.deepEqual(commands, []);
  target = { view: 'launcher', overlay: 'menu', space: 'api' };
  const reopened = new View(); reopened.launchers = choices; ui.nodes.clear(); reopened.render();
  const rows = ui.nodes.get('thread-launchers').children;
  assert.equal(rows[0], ui.nodes.get('new-terminal').element);
  assert.ok(rows.indexOf(ui.nodes.get('start-pi').element) < rows.indexOf(ui.nodes.get('start-codex').element));
  assert.ok(rows.indexOf(ui.nodes.get('start-codex').element) < rows.indexOf(ui.nodes.get('launcher-section-2').element));
  assert.ok(!ui.nodes.has('start-claude'));
  ui.nodes.get('thread-launcher').keyDown({ key: '1', modifiers: {} });
  assert.equal(commands.find(([name]) => name === 'tab.new')[1].argv[0], 'pi');
});
test('account removal requires confirmation, blocks duplicate requests, and cleans only the removed preferences', async () => {
  const ui = fakeElements(), overlays = [], closed = [], removed = [], memory = {
    'devkits.hidden-launchers': ['agent:devkits-codex-work', 'agent:codex'],
    'devkits.launcher-order': ['terminal', 'agent:devkits-codex-work', 'agent:devkits-codex-personal'],
  };
  let target = { view: 'manage-launchers', space: 'api', overlay: 'manage' }, release, pending;
  const View = await viewFor({ ...ui, props: () => target, theme: () => ({}), spaces: () => [],
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    openOverlay: value => overlays.push(value), closeOverlay: id => closed.push(id),
    removeCodexAccount: async key => { removed.push(key); await new Promise(resolve => { release = resolve; }); } });
  const cx = { notify() {}, stop_propagation() {}, spawn(fn) { pending = fn(cx); } };
  const view = new View(); view.launchers = [{ key: 'codex', name: 'Codex' }, { key: 'devkits-codex-work', name: 'Codex · Work' }];
  view.manageIndex = 0; view.render();
  assert.ok(!ui.nodes.has('remove-codex'));
  ui.nodes.get('remove-devkits-codex-work').click();
  assert.deepEqual(removed, []);
  assert.equal(overlays[0].props.view, 'remove-account');
  target = { ...overlays[0].props, overlay: 'confirm' };
  const prompt = new View(); prompt.render();
  ui.nodes.get('cancel-remove-account').click();
  assert.deepEqual(removed, []); assert.equal(overlays.at(-1).props.view, 'manage-launchers');
  ui.nodes.get('confirm-remove-account').click({}, cx); prompt.render();
  ui.nodes.get('confirm-remove-account').click({}, cx);
  ui.nodes.get('cancel-remove-account').click();
  assert.deepEqual(removed, ['devkits-codex-work']);
  assert.equal(ui.nodes.get('confirm-remove-account').disabled, true);
  release(); await pending;
  assert.deepEqual(memory['devkits.hidden-launchers'], ['agent:codex']);
  assert.deepEqual(memory['devkits.launcher-order'], ['terminal', 'agent:devkits-codex-personal']);
  assert.equal(overlays.at(-1).props.view, 'manage-launchers');
});
test('failed account removal stays in the confirmation dialog and preserves preferences for retry', async () => {
  const ui = fakeElements(); let pending;
  const View = await viewFor({ ...ui, props: () => ({ view: 'remove-account', account: { key: 'devkits-codex-work', name: 'Work' } }),
    theme: () => ({}), setShared: () => assert.fail('must not clean preferences'),
    closeOverlay: () => assert.fail('must not close'),
    removeCodexAccount: async () => { throw Error('Could not sign out'); } });
  const view = new View(); view.render();
  const cx = { notify() {}, spawn(fn) { pending = fn(cx); } };
  ui.nodes.get('confirm-remove-account').click({}, cx); await pending; view.render();
  assert.equal(view.removeError, 'Could not sign out');
  assert.equal(ui.nodes.get('confirm-remove-account').disabled, false);
  assert.ok(ui.nodes.has('remove-account-error'));
});
test('hiding every agent keeps Manage available so the menu can be restored', async () => {
  const ui = fakeElements();
  const View = await viewFor({ ...ui, props: () => ({ view: 'launcher' }), spaces: () => [], theme: () => ({}),
    shared: () => ['terminal', 'agent:codex'] });
  const view = new View(); view.launchers = [{ key: 'codex', name: 'Codex', installed: true }]; view.render();
  assert.ok(!ui.nodes.has('new-terminal'));
  assert.ok(!ui.nodes.has('start-codex'));
  assert.ok(ui.nodes.has('manage-launchers-open'));
  assert.ok(ui.texts.includes('All agents are hidden. Use Manage to show them.'));
});
test('header anchors the project picker below its actual trigger', async () => {
  const ui = fakeElements(), overlays = [];
  const View = await viewFor({ ...ui, spaces: () => projects,
    openOverlay: value => overlays.push(value),
    settings: () => ({ zoom: 1.5 }),
    window: () => ({ platform: 'macos' }), layout: () => ({ children: [], traffic_lights: [12, 21] }) });
  new View().header({});
  assert.ok(!ui.nodes.has('new-tab'));
  assert.ok(!ui.nodes.has('tab-strip'));
  const cx = { stop_propagation() {} };
  ui.nodes.get('project-switcher').mouseDown({ bounds: { x: 453, y: 18, width: 150, height: 48 } }, cx);
  ui.nodes.get('project-switcher').click({}, cx);
  assert.equal(overlays[0].props.view, 'project-picker');
  assert.deepEqual(overlays[0].at, { x: 453, y: 72 });
  assert.equal(overlays[0].frame, 'none');
  ui.nodes.get('project-switcher').click({}, cx);
  assert.equal(overlays[1].at, undefined);
});
test('sidebar menus align below the right edge of each button at the current zoom', async () => {
  const ui = fakeElements(), overlays = [];
  const View = await viewFor({ ...ui, spaces: () => projects, agents: () => [], theme: () => ({}),
    settings: () => ({ zoom: 1.5 }), setAgentOrder() {}, run() {},
    openOverlay: value => overlays.push(value) });
  const view = new View(); view.init(); view.render();
  const cx = { stop_propagation() {} };
  for (const [id, width] of [['new-thread-api', 280], ['project-menu-api', 200]]) {
    const button = ui.nodes.get(id);
    button.mouseDown({ bounds: { x: 350, y: 105, width: 42, height: 42 } }, cx);
    button.click({}, cx);
    assert.deepEqual(overlays.at(-1).at, { x: 392 - width * 1.5, y: 153 });
  }
  assert.equal(overlays[0].props.view, 'launcher');
  assert.equal(overlays[1].props.view, 'project-menu');
});
test('only the base Codex row offers Add account, including when Codex is hidden from the launcher', async () => {
  const ui = fakeElements(), overlays = [], closed = [];
  const target = { view: 'manage-launchers', space: 'api', overlay: 'manage-dialog' };
  const View = await viewFor({ ...ui, props: () => target, spaces: () => projects,
    theme: () => ({}), shared: key => key === 'devkits.hidden-launchers' ? ['agent:codex'] : undefined,
    closeOverlay: id => closed.push(id), openOverlay: value => overlays.push(value) });
  const view = new View(); view.launchers = [{ key: 'codex', name: 'Codex' }, { key: 'devkits-codex-work', name: 'Codex · work' }];
  view.manageIndex = 0; view.render();
  const codexRow = ui.nodes.get('manage-agent:codex'), accountRow = ui.nodes.get('manage-agent:devkits-codex-work');
  assert.ok(codexRow.children.includes(ui.nodes.get('add-codex-account').element));
  assert.ok(!accountRow.children.includes(ui.nodes.get('add-codex-account').element));
  ui.nodes.get('add-codex-account').click();
  assert.deepEqual(closed, ['manage-dialog']);
  assert.equal(overlays[0].props.view, 'codex-login');
  assert.equal(overlays[0].modal, true);
  assert.deepEqual(overlays[0].props.returnTo, { view: 'manage-launchers', space: 'api' });
  ui.nodes.clear(); view.launcher({});
  assert.ok(!ui.nodes.has('add-codex-account'));
});
test('local account profiles and their login action stay out of remote project menus', async () => {
  const ui = fakeElements(); let pending;
  const View = await viewFor({ ...ui, props: () => ({ view: 'manage-launchers', space: 'remote' }),
    spaces: () => [{ id: 'remote', machine: 'server' }], theme: () => ({}), knownAgents: async () => [
      { key: 'devkits-codex-work', installed: true }, { key: 'codex', name: 'Codex', installed: true },
    ] });
  const cx = { notify() {}, focus_handle: () => ({ focus() {} }), spawn(task) { pending = task(cx); } };
  const view = new View(); view.init({}, cx); await pending; view.render();
  assert.deepEqual(view.launchers.map(agent => agent.key), ['codex']);
  assert.ok(!ui.nodes.has('add-codex-account'));
});
test('project dropdown switches projects and opens the native folder chooser without starting a session', async () => {
  const ui = fakeElements(), commands = [], closed = [], memory = {};
  let pending, picks = 0;
  const View = await viewFor({ ...ui, props: () => ({ view: 'project-picker', overlay: 'picker' }),
    spaces: () => projects, theme: () => ({}),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    closeOverlay: id => closed.push(id), run: (...args) => commands.push(args),
    pickFolder: async () => { picks++; return '/Code/new project'; }, notify: error => assert.fail(error.body) });
  const cx = { focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {}, spawn(task) { pending = task(cx); } };
  const view = new View(); view.init({}, cx); view.render();
  assert.ok(ui.nodes.has('picker-project-api')); assert.ok(ui.nodes.has('picker-project-app'));
  ui.nodes.get('project-picker').keyDown({ key: 'enter' }, cx);
  assert.deepEqual(commands, []);
  ui.nodes.get('project-picker').keyDown({ key: 'up' }, cx);
  assert.equal(view.projectIndex, projects.length);
  ui.nodes.get('project-picker').keyDown({ key: 'down' }, cx);
  ui.nodes.get('project-picker').keyDown({ key: 'down' }, cx);
  ui.nodes.get('project-picker').keyDown({ key: 'enter' }, cx);
  assert.ok(commands.some(([name, args]) => name === 'space.select' && args.id === 'app'));
  assert.equal(closed[0], 'picker');
  const beforePicker = closed.length;
  ui.nodes.get('picker-open-folder').click({}, cx);
  assert.equal(closed.length, beforePicker);
  await pending;
  assert.equal(closed.length, beforePicker + 1);
  assert.equal(picks, 1);
  assert.deepEqual(memory['devkits.projects'], ['/Code/new project']);
  assert.ok(!commands.some(([name]) => name === 'space.new' || name === 'tab.new'));
});
test('pane header identifies the agent by its icon and keeps the path without repeating its name', async () => {
  const ui = fakeElements();
  const View = await viewFor({ ...ui, props: () => ({ pane: 'pane-1' }),
    panes: () => [{ pane: 'pane-1', cwd: '/Code/project', program: { name: 'Codex', icon: 'icons/codex.svg', tint: false } }] });
  new View().paneHeader({});
  assert.ok(ui.texts.includes('/Code/project'));
  assert.ok(!ui.texts.includes('Codex'));
  assert.ok(ui.nodes.has('split-right-pane-1'));
  assert.ok(ui.nodes.has('close-pane-1'));
});
test('New thread targets the chosen project and its saved root, not the current directory', async () => {
  const overlays = [];
  const View = await viewFor({ spaces: () => projects, shared: key => key === 'devkits.project-roots' ? { app: '/original/app' } : undefined, openOverlay: value => overlays.push(value) });
  const view = new View();
  view.newThread({}, 'app');
  assert.equal(overlays[0].frame, 'none');
  assert.equal(overlays[0].height, undefined);
  assert.deepEqual(overlays[0].props, { view: 'launcher', space: 'app', folder: '/original/app', projectName: 'App' });
  view.newThread({});
  assert.equal(overlays[1].props.space, 'api');
});
test('native folder picker opens a project, reuses an existing root, and cancel does nothing', async () => {
  let folder = '/Code/new project', pending, picks = 0;
  const commands = [];
  const memory = { 'devkits.project-roots': { api: '/original/api' } };
  const View = await viewFor({ spaces: () => projects, shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    pickFolder: async () => { picks++; return folder; }, run: (...args) => commands.push(args), notify: error => assert.fail(error.body) });
  const view = new View(), cx = { notify() {}, spawn(task) { pending = task(cx); } };
  view.openProject(cx); await pending;
  assert.deepEqual(memory['devkits.projects'], [folder]);
  assert.equal(memory['devkits.selected-project'], `project:${folder}`);
  assert.ok(!commands.some(([name]) => name === 'space.new' || name === 'tab.new'));
  commands.length = 0;
  folder = '/original/api/'; view.openProject(cx); await pending;
  assert.ok(commands.some(([name, args]) => name === 'space.select' && args.id === 'api'));
  commands.length = 0;
  folder = null; view.openProject(cx); await pending;
  assert.deepEqual(commands, []);
  assert.equal(picks, 3);
});
test('New thread without a project opens the native folder picker; launcher passes root and argv', async () => {
  let pending, folder = null; const commands = [], closed = [];
  const View = await viewFor({ spaces: () => [], pickFolder: async () => folder,
    run: (...args) => commands.push(args), props: () => ({ space: 'api', folder: '/Code/project name', overlay: 'popup' }),
    closeOverlay: id => closed.push(id), notify: error => assert.fail(error.body) });
  const view = new View(), cx = { notify() {}, spawn(task) { pending = task(cx); } };
  view.newThread(cx); await pending; assert.deepEqual(commands, []);
  view.startThread({ name: 'Codex', run: ['codex', '--profile', 'work'] });
  assert.deepEqual(commands.find(([name]) => name === 'tab.new'), ['tab.new', { space: 'api', folder: '/Code/project name', name: 'Codex', argv: ['codex', '--profile', 'work'] }]);
  assert.deepEqual(closed, ['popup']);
});
test('empty projects stay empty until an agent is explicitly chosen', async () => {
  const saved = ['/Code/new'];
  let catalog = projectCatalog([], saved, {}, 'project:/Code/new');
  assert.equal(catalog[0].pending, true);
  assert.deepEqual(catalog[0].tabs, []);
  const commands = [], overlays = [];
  const View = await viewFor({ spaces: () => [], shared: key => key === 'devkits.projects' ? saved : key === 'devkits.selected-project' ? 'project:/Code/new' : undefined,
    props: () => ({ space: null, folder: '/Code/new', projectName: 'new', overlay: 'popup' }),
    run: (...args) => commands.push(args), openOverlay: value => overlays.push(value), closeOverlay() {} });
  const view = new View();
  view.newThread({});
  assert.deepEqual(commands, []);
  assert.equal(overlays[0].props.space, null);
  view.startThread({ name: 'Codex', run: ['codex'] });
  assert.deepEqual(commands.find(([name]) => name === 'space.new'), ['space.new', { name: 'new', folder: '/Code/new', machine: '', tab: 'Codex', argv: ['codex'] }]);
  assert.ok(!commands.some(([name]) => name === 'tab.new'));
  catalog = projectCatalog([{ id: 's1', folder: '/Code/new', tabs: [{ id: 't1' }], active: true }], saved);
  assert.equal(catalog.length, 1); assert.equal(catalog[0].id, 's1');
  assert.equal(projectCatalog([], saved)[0].tabs.length, 0);
  assert.equal(projectCatalog([], saved)[0].active, true);
  assert.equal(projectGroups(projectCatalog([], saved), []).length, 1);
});
test('projects own their threads and keep native tab order even if an agent was previously pinned', () => {
  const splitAgent = { ...agents[0], address: 't5' };
  const groups = projectGroups(projects, [...agents, splitAgent]);
  assert.deepEqual(groups.map(g => g.space.id), ['api', 'app']);
  assert.deepEqual(groups[0].threads.map(t => t.tab.id), ['tab-0', 'tab-2', 'shell']);
  assert.equal(groups[0].threads[0].agents.length, 2);
  assert.equal(groups[0].threads[1].title, 'Deploy API');
  assert.equal(groups[0].threads[2].title, 'Terminal');
  assert.ok(groups[0].threads[0].active);
  assert.equal(projects[0].tabs[0].id, 'tab-0');
});
test('agent and terminal threads have close buttons that close only the clicked tab without selecting it', async () => {
  const ui = fakeElements(), commands = [];
  let stopped = 0;
  const View = await viewFor({ ...ui, run: (...args) => commands.push(args) });
  const view = new View(); view.init();
  const threads = projectGroups(projects, agents)[0].threads;
  for (const thread of [threads[0], threads[2]]) {
    view.threadRow(thread, {});
    assert.ok(!ui.nodes.has(`pin-${thread.tab.id}`));
    ui.nodes.get(`close-thread-${thread.tab.id}`).click({}, { stop_propagation() { stopped++; } });
  }
  assert.deepEqual(commands, [['tab.close', { id: 'tab-0' }], ['tab.close', { id: 'shell' }]]);
  assert.equal(stopped, 2);
});
test('all projects and thread states remain visible without search or filters', () => {
  const groups = projectGroups(projects, agents);
  assert.deepEqual(groups.map(g => g.space.id), ['api', 'app']);
  assert.equal(groups.flatMap(g => g.threads).length, 5);
  assert.deepEqual(projectGroups([], []), []);
});
test('native sidebar renders project/thread nesting and a shell row can be selected', async () => {
  const ui = fakeElements(), { nodes } = ui, commands = [], memory = {};
  const View = await viewFor({ ...ui,
    props: () => ({}), window: () => ({ platform: 'macos' }),
    spaces: () => projects, agents: () => agents, projectGroups,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    theme: () => ({ foreground: '#fafafa', background: '#0a0a0a' }), setAgentOrder() {},
    run: (...args) => commands.push(args) });
  const view = new View(); view.init(); view.render();
  assert.ok(nodes.has('project-api')); assert.ok(nodes.has('project-app'));
  assert.ok(nodes.has('thread-shell')); assert.ok(nodes.has('new-thread-app'));
  assert.ok(nodes.has('project-menu-api'));
  assert.ok(!nodes.has('close-project-api'));
  assert.ok(!nodes.has('filter-all'));
  const project = nodes.get('project-api');
  assert.ok(project.children.indexOf(nodes.get('new-thread-api').element) > 0);
  assert.ok(project.children.indexOf(nodes.get('project-menu-api').element) > project.children.indexOf(nodes.get('new-thread-api').element));
  assert.equal(nodes.get('new-thread-api').opacity, 0);
  project.hover(true, { notify() {} }); view.render();
  assert.equal(nodes.get('new-thread-api').opacity, 1);
  const bar = nodes.get('sidebar-bottom-bar');
  assert.equal(bar.children[0], nodes.get('settings').element);
  assert.ok(!nodes.has('toggle-sidebar'));
  assert.ok(!nodes.has('show-sidebar'));
  assert.ok(!nodes.has('open-project'));
  const cx = { notify() {} };
  nodes.get('project-api').click({}, cx); assert.ok(view.folded.has('api'));
  nodes.get('project-api').click({ modifiers: { platform: true } }, cx);
  assert.ok(commands.some(([name, args]) => name === 'space.select' && args.id === 'api'));
  nodes.get('thread-shell').click();
  assert.deepEqual(commands.pop(), ['tab.select', { id: 'shell' }]);
  assert.equal(memory['devkits.project-roots'].api, '/Code/api');
});
test('sidebar thread names omit redundant agent labels while preserving tasks and account names', () => {
  const codex = { title: 'Codex', program: { name: 'Codex' } };
  assert.equal(threadTitle({ name: '1' }, agents[0]), 'Fix login');
  assert.equal(threadTitle({ name: 'Codex', named: true }, codex), 'New thread');
  assert.equal(threadTitle({ name: 'Codex', named: true }, { ...codex, tab_name: '1' }), 'New thread');
  assert.equal(threadTitle({ name: 'Codex · rickyeh', named: true }, codex), 'rickyeh');
  assert.equal(threadTitle({ name: 'Codex · rickyeh', named: true }, { program: { name: 'Codex · rickyeh' } }), 'rickyeh');
  assert.equal(threadTitle({ name: 'Codex', named: true }, { ...codex, title: 'Fix authentication' }), 'Fix authentication');
  assert.equal(threadTitle({ name: 'Fix Codex login', named: true }, codex), 'Fix Codex login');
  assert.equal(threadTitle({ name: 'Auth review', named: true }, codex), 'Auth review');
  assert.equal(threadTitle({ name: '123', named: true }, codex), '123');
  assert.equal(threadTitle({ name: '1' }), 'Terminal');
  assert.equal(threadTitle({ name: 'Codex', named: true }), 'Codex');
});
test('automatic terminal folder titles are never used as conversation titles', () => {
  const tab = { name: 'Codex', named: true };
  const space = { name: 'My project', folder: '/Users/rick/Code/devkits' };
  const agent = { app: 'codex', program: { name: 'Codex' }, space_name: 'devkits', tab_name: 'Codex' };
  for (const title of ['devkits', 'My project', '/Users/rick/Code/devkits', '~/Code/devkits', 'C:\\Code\\devkits']) {
    assert.equal(threadTitle(tab, { ...agent, title }, space), 'New thread');
  }
  assert.equal(threadTitle(tab, { ...agent, title: 'Fix session restoration' }, space), 'Fix session restoration');
  assert.equal(threadTitle({ name: 'devkits', named: true }, agent, space), 'devkits');
  const groups = projectGroups([{ ...space, id: 's1', tabs: [{ ...tab, id: 't1' }] }], [{ ...agent, space: 's1', tab: 't1', title: 'devkits' }]);
  assert.equal(groups[0].threads[0].title, 'New thread');
});
test('installer adds only its own files and refuses to overwrite an existing installation', async t => {
  const home = await mkdtemp(join(tmpdir(), 'devkits-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await install(home);
  const layout = JSON.parse(await readFile(join(home, 'layouts', 'devkits.json'), 'utf8'));
  assert.equal(layout.children[0].id, 'sidebar');
  assert.match(await readFile(join(home, layout.preview), 'utf8'), /<svg/);
  const mod = join(home, 'mods', 'devkits');
  for (const name of (await readdir(new URL('../mods/devkits/components/', import.meta.url))).filter(name => name.endsWith('.js'))) {
    assert.equal(await readFile(join(mod, 'components', name), 'utf8'),
      await readFile(new URL(`../mods/devkits/components/${name}`, import.meta.url), 'utf8'));
  }
  assert.ok(!(await readdir(mod)).some(name => name.endsWith('.svg')));
  assert.ok((await readdir(join(mod, 'assets', 'icons'))).includes('close.svg'));
  assert.ok(!(await readdir(join(mod, 'assets', 'icons'))).includes('pin.svg'));
  const ids = new Set();
  function visit(node) { assert.ok(!ids.has(node.id)); ids.add(node.id); for (const child of node.children || []) visit(child); }
  visit(layout);
  const stack = layout.children[1].children[1];
  assert.equal(stack.id, 'workspace-view');
  assert.equal(stack.children.find(node => node.id === 'main').content.tab, 'active');
  assert.deepEqual((await readdir(home)).sort(), ['layouts', 'mods', 'themes']);
  for (const name of Object.values(layout.theme)) {
    const theme = JSON.parse(await readFile(join(home, 'themes', `${name}.json`), 'utf8'));
    assert.equal(theme.ansi.length, 16);
    assert.ok(Object.values(theme.colors).every(color => /^#[0-9a-f]{6}$/i.test(color)));
  }
  const before = await readFile(join(home, 'mods', 'devkits', 'main.js'), 'utf8');
  await assert.rejects(install(home), /Refusing to overwrite/);
  assert.equal(await readFile(join(home, 'mods', 'devkits', 'main.js'), 'utf8'), before);
});
