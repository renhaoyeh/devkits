import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { threadTitle, projectGroups, projectCatalog, folderKey, launcherChoices, codexPermissionModes, isAccountLauncher, permissionModes, launcherArgv, quotaResetLabel, quotaElapsedPercent, resolveThreadProfiles, threadProfile } from '../mods/devkits/model.js';
import { install } from '../install.js';

const renderContext = { focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {} };

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

test('only the recorded default terminal is hidden, even after renaming; agent sessions stay visible', () => {
  const spaces = [{ id: 'one', tabs: [{ id: 'default', name: 'Renamed' },
    { id: 'manual', name: 'Terminal' }] }];
  const defaults = { one: 'default' };
  assert.deepEqual(projectGroups(spaces, [], defaults)[0].threads.map(thread => thread.tab.id), ['manual']);
  assert.equal(projectGroups(spaces, [], { one: 'deleted' })[0].threads.length, 2);
  assert.equal(projectGroups(spaces, [{ space: 'one', tab: 'default' }], defaults)[0].threads.length, 2);
  assert.equal(spaces[0].tabs.length, 2);
});

test('sidebar records the internal terminal ID, hides its row and shows the empty content', async () => {
  const ui = fakeElements(), commands = [], memory = {};
  const View = await viewFor({ ...ui, props: () => ({}), theme: () => ({}), agents: () => [],
    spaces: () => [{ id: 'one', active: true, tabs: [
      { id: 'default', name: '__devkits_default_terminal__', active: true },
      { id: 'manual', name: 'Terminal' }] }],
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run: (...args) => commands.push(args), setAgentOrder() {} });
  const view = new View(); view.folded = new Set(); view.render();
  assert.deepEqual(memory['devkits.default-terminals'], { one: 'default' });
  assert.ok(!ui.nodes.has('thread-default'));
  assert.ok(ui.nodes.has('thread-manual'));
  assert.ok(commands.some(([name, args]) => name === 'layout.select' && args.child === 'project-empty'));
  assert.ok(!commands.some(([name]) => name === 'tab.close' || name === 'terminal.kill'));
});
test('working threads rise within their project and return to tab order when finished', () => {
  const spaces = [{ id: 'one', tabs: [
    { id: 'idle', status: 'idle' }, { id: 'busy', status: 'working' },
    { id: 'blocked', status: 'blocked' }, { id: 'busy-split', status: 'blocked' },
  ] }, { id: 'two', tabs: [{ id: 'other', status: 'working' }] }];
  const members = [{ space: 'one', tab: 'busy-split', status: 'working' }];
  const ordered = projectGroups(spaces, members);
  assert.deepEqual(ordered.map(group => group.space.id), ['one', 'two']);
  assert.deepEqual(ordered[0].threads.map(thread => thread.tab.id), ['busy', 'busy-split', 'idle', 'blocked']);
  assert.deepEqual(spaces[0].tabs.map(tab => tab.id), ['idle', 'busy', 'blocked', 'busy-split']);
  spaces[0].tabs[1].status = 'done';
  members[0].status = 'idle';
  assert.deepEqual(projectGroups(spaces, members)[0].threads.map(thread => thread.tab.id),
    ['idle', 'busy', 'blocked', 'busy-split']);
});

async function loadView(host) {
  const source = await readFile(new URL('../mods/devkits/main.js', import.meta.url), 'utf8');
  const components = await Promise.all(['button', 'checkbox', 'select', 'alert-dialog', 'dialog', 'empty', 'sidebar', 'dropdown-menu', 'progress']
    .map(name => readFile(new URL(`../mods/devkits/components/${name}.js`, import.meta.url), 'utf8')));
  // Run native actions with a fake host; no real Herdr session is touched.
  return new Function('View', ...Object.keys(host), components.join('\n')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '') + '\n' + source
    .replace(/^import .*;\n/gm, '').replace('export default class', 'return class'));
}
async function viewFor(host) {
  const memory = {};
  host = { projectCatalog, projectGroups, folderKey, launcherChoices, isAccountLauncher, permissionModes, launcherArgv, quotaResetLabel, quotaElapsedPercent, resolveThreadProfiles, threadProfile, accountLabel: name => name.replace(/^(?:Codex|Claude) · /, ''), readTextFile: async () => null, appHome: () => '/herdr', props: () => ({}), shared: key => memory[key],
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
        if (key === 'tooltip') data.tooltip = args[0];
        if (key === 'on_change') data.change = args[0];
        if (key === 'on_open_change') data.openChange = args[0];
        if (key === 'text_color') data.textColor = args[0];
        if (key === 'disabled') data.disabled = args[0];
        if (key === 'on_key_down') data.keyDown = args[0];
        if (key === 'on_mouse_down') data.mouseDown = args[1];
        if (key === 'on_mouse_down_out') data.mouseDownOut = args[0];
        if (key === 'on_mouse_up') data.mouseUp = args[1];
        if (key === 'on_mouse_move') data.mouseMove = args[0];
        if (key === 'overflow_y_scrollbar') data.scrollbar = true;
        if (key === 'on_hover') data.hover = args[0];
        if (key === 'h') data.height = args[0];
        if (key === 'w') data.width = args[0];
        if (key === 'bg') data.background = args[0];
        if (key === 'value') data.value = args[0];
        if (key === 'indeterminate') data.indeterminate = args[0];
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
    NativeSelect: { new: id => element().id(id) }, NativePopup: { new: (_id, trigger) => element().child(trigger) },
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
  const View = await viewFor({ ...ui, run: (...args) => commands.push(args) });
  new View().threadRow({ tab: { id: 'tab-1' }, agents: [], title: 'Task' }, {});
  const button = ui.nodes.get('close-thread-tab-1');
  let stopped = 0;
  const cx = { stop_propagation() { stopped++; } };
  button.mouseDown({}, cx);
  for (const key of ['enter', 'space', 'escape']) button.keyDown({ key }, cx);
  assert.equal(stopped, 3);
  assert.deepEqual(commands, []);
  button.click({}, cx);
  assert.deepEqual(commands, [['tab.close', { id: 'tab-1' }]]);
});
test('closing a live workspace requires confirmation; cancel leaves all sessions and saved projects intact', async () => {
  const ui = fakeElements(), commands = [], overlays = [], closed = [];
  const memory = { 'devkits.projects': ['/Code/api'] };
  let target;
  const View = await viewFor({ ...ui, spaces: () => projects, shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
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
test('agent discovery shares pending work, caches empty results, and separates machines', async () => {
  const calls = [];
  let resolve;
  const View = await viewFor({ knownAgents: ({ on }) => {
    calls.push(on);
    return new Promise(done => { resolve = done; });
  } });
  const first = new View().cachedAgents();
  const second = new View().cachedAgents(null);
  assert.equal(calls.length, 1);
  resolve([]);
  assert.deepEqual(await first, []);
  assert.deepEqual(await second, []);
  assert.deepEqual(await new View().cachedAgents(), []);
  assert.equal(calls.length, 1);
  const remote = new View().cachedAgents('server');
  resolve([{ key: 'codex', installed: true }, { key: 'devkits-codex-work', installed: true }]);
  assert.deepEqual((await remote).map(agent => agent.key), ['codex']);
  assert.deepEqual(calls, [undefined, 'server']);
});

test('reopening Add Agent uses cached rows immediately and account changes refresh them', async () => {
  let target = { view: 'launcher', space: 'api' }, pending, calls = 0;
  const View = await viewFor({ props: () => target, spaces: () => projects,
    knownAgents: async () => { calls++; return [{ key: 'claude', installed: true }]; } });
  const cx = { ...renderContext, spawn(task) { pending = task(cx); } };
  new View().init({}, cx); await pending;
  const reopened = new View(); reopened.init({}, cx);
  assert.equal(reopened.loading, false);
  assert.equal(reopened.launchers[0].key, 'claude');
  assert.equal(calls, 1);
  target = { ...target, refreshAgents: true };
  new View().init({}, cx); await pending;
  assert.equal(calls, 2);
});

test('failed discovery can retry instead of caching the rejection', async () => {
  let calls = 0;
  const View = await viewFor({ knownAgents: async () => {
    if (++calls === 1) throw Error('offline');
    return [];
  } });
  const view = new View();
  await assert.rejects(view.cachedAgents(), /offline/);
  assert.deepEqual(await view.cachedAgents(), []);
  assert.equal(calls, 2);
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
  const view = new View(); view.launchers = choices; view.render(renderContext);
  assert.equal(ui.nodes.get('thread-launcher').children.at(-1), ui.nodes.get('manage-launchers-open').element);
  ui.nodes.get('manage-launchers-open').click({}, cx);
  assert.deepEqual(closed, ['menu']);
  assert.equal(overlays[0].kind, 'dialog');
  assert.equal(overlays[0].width, 680);
  assert.equal(overlays[0].height, 0.8);
  assert.equal(overlays[0].modal, false);
  assert.deepEqual(overlays[0].props, { view: 'manage-launchers', space: 'api' });
  target = { ...overlays[0].props, overlay: 'manage-dialog' };
  const dialog = new View(); dialog.init({}, cx); await pending; dialog.render(renderContext);
  assert.equal(ui.nodes.get('show-agent:codex-work').checked, true);
  ui.nodes.get('show-agent:codex-work').change(false, cx);
  ui.nodes.get('show-terminal').change(false, cx);
  assert.deepEqual(commands, []);
  ui.nodes.get('manage-launchers-done').click({}, cx);
  assert.equal(closed.at(-1), 'manage-dialog');
  target = { view: 'launcher', space: 'api', overlay: 'menu' };
  ui.nodes.clear(); view.render(renderContext);
  assert.ok(!ui.nodes.has('start-codex-work'));
  assert.ok(!ui.nodes.has('new-terminal'));
  assert.ok(ui.nodes.has('start-claude'));
  ui.nodes.get('thread-launcher').keyDown({ key: '1', modifiers: {} });
  assert.equal(commands.find(([name]) => name === 'tab.new')[1].argv[0], 'claude');
  commands.length = 0;
  const reopened = new View(); reopened.launchers = choices; reopened.render(renderContext);
  ui.nodes.get('manage-launchers-open').click({}, cx);
  target = { ...overlays.at(-1).props, overlay: 'manage-dialog-2' };
  const reopenedDialog = new View(); reopenedDialog.init({}, cx); await pending; reopenedDialog.render(renderContext);
  assert.equal(ui.nodes.get('show-agent:codex-work').checked, false);
  assert.equal(ui.nodes.get('show-terminal').checked, false);
  ui.nodes.get('manage-launchers').keyDown({ key: 'space' }, cx);
  ui.nodes.get('manage-launchers').keyDown({ key: 'down' }, cx);
  ui.nodes.get('manage-launchers').keyDown({ key: 'enter' }, cx);
  ui.nodes.get('manage-launchers').keyDown({ key: 'escape' }, cx);
  assert.equal(closed.at(-1), 'manage-dialog-2');
  target = { view: 'launcher', space: 'api', overlay: 'menu' };
  ui.nodes.clear(); reopened.render(renderContext);
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
  const view = new View(); view.launchers = choices; view.manageIndex = 0; view.preparePermissionSelects(renderContext); view.render(renderContext);
  assert.ok(ui.assets.includes('icons/codex.svg')); assert.ok(ui.assets.includes('icons/claude.svg'));
  assert.ok(ui.assets.includes('mods/devkits/assets/icons/terminal.svg'));
  for (const group of [0, 1, 2]) assert.ok(ui.nodes.has(`manage-section-${group}`));
  assert.ok(!ui.nodes.has('drag-terminal'));
  assert.ok(!ui.nodes.get('manage-launchers-list').scrollbar);
  const original = [...memory['devkits.launcher-order']];
  ui.nodes.get('drag-agent:codex').mouseDown({}, cx);
  ui.nodes.get('manage-terminal').mouseUp({}, cx); view.render(renderContext);
  assert.deepEqual(memory['devkits.launcher-order'], original);
  ui.nodes.get('drag-agent:codex').mouseDown({}, cx);
  ui.nodes.get('manage-agent:devkits-codex-one').mouseUp({}, cx); view.render(renderContext);
  assert.deepEqual(memory['devkits.launcher-order'], original);
  ui.nodes.get('drag-agent:codex').mouseDown({}, cx);
  ui.nodes.get('manage-agent:pi').mouseMove({}, cx); view.render(renderContext);
  assert.deepEqual(memory['devkits.launcher-order'], original);
  ui.nodes.get('manage-agent:pi').mouseUp({}, cx); view.render(renderContext);
  assert.deepEqual(memory['devkits.launcher-order'].slice(0, 5),
    ['agent:missing', 'terminal', 'agent:claude', 'agent:pi', 'agent:codex']);
  assert.equal(view.dragKey, null);
  ui.nodes.get('drag-agent:devkits-codex-two').mouseDown({}, cx);
  ui.nodes.get('manage-agent:devkits-codex-one').mouseUp({}, cx); view.render(renderContext);
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
  const reopened = new View(); reopened.launchers = choices; ui.nodes.clear(); reopened.render(renderContext);
  const rows = ui.nodes.get('thread-launchers').children;
  assert.equal(rows[0], ui.nodes.get('new-terminal').element);
  assert.ok(rows.indexOf(ui.nodes.get('start-pi').element) < rows.indexOf(ui.nodes.get('start-codex').element));
  assert.ok(rows.indexOf(ui.nodes.get('start-codex').element) < rows.indexOf(ui.nodes.get('launcher-section-2').element));
  assert.ok(!ui.nodes.has('start-claude'));
  ui.nodes.get('thread-launcher').keyDown({ key: '1', modifiers: {} });
  assert.equal(commands.find(([name]) => name === 'tab.new')[1].argv[0], 'pi');
});
test('profile rename blocks duplicate saves, refreshes labels, and returns to Manage', async () => {
  const ui = fakeElements(), overlays = [], memory = { 'devkits.agent-cache': { old: [] } };
  let pending, resolve, calls = 0;
  const View = await viewFor({ ...ui, theme: () => ({}),
    props: () => ({ view: 'rename-account', overlay: 'rename', space: 'project', account: { key: 'devkits-codex-work', name: 'Codex · Work' } }),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    closeOverlay() {}, openOverlay: value => overlays.push(value),
    renameAccountProfile: async (key, name) => {
      calls++; assert.equal(key, 'devkits-codex-work'); assert.equal(name, '工作');
      await new Promise(done => { resolve = done; });
    } });
  const view = new View(); view.renameInput = { value: () => '工作' };
  const cx = { notify() {}, spawn: fn => { pending = fn(cx); } };
  view.saveAccountName(cx); view.saveAccountName(cx); view.finishRename();
  assert.equal(calls, 1); assert.equal(overlays.length, 0);
  resolve(); await pending;
  assert.deepEqual(memory['devkits.agent-cache'], {});
  assert.equal(overlays[0].props.view, 'manage-launchers');
  assert.equal(overlays[0].props.space, 'project');
});

test('account removal requires confirmation, blocks duplicate requests, and cleans only the removed preferences', async () => {
  const ui = fakeElements(), overlays = [], closed = [], removed = [], memory = {
    'devkits.hidden-launchers': ['agent:devkits-codex-work', 'agent:codex'],
    'devkits.launcher-order': ['terminal', 'agent:devkits-codex-work', 'agent:devkits-codex-personal'],
    'devkits.codex-permissions': { 'devkits-codex-work': 'workspace-write', 'devkits-codex-personal': 'read-only' },
  };
  let target = { view: 'manage-launchers', space: 'api', overlay: 'manage' }, release, pending;
  const View = await viewFor({ ...ui, props: () => target, theme: () => ({}), spaces: () => [],
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    openOverlay: value => overlays.push(value), closeOverlay: id => closed.push(id),
    removeAccountProfile: async key => { removed.push(key); await new Promise(resolve => { release = resolve; }); } });
  const cx = { notify() {}, stop_propagation() {}, spawn(fn) { pending = fn(cx); } };
  const view = new View(); view.launchers = [{ key: 'codex', name: 'Codex' }, { key: 'devkits-codex-work', name: 'Codex · Work' }];
  view.manageIndex = 0; view.preparePermissionSelects(renderContext); view.render(renderContext);
  assert.ok(!ui.nodes.has('remove-codex'));
  ui.nodes.get('remove-devkits-codex-work').click();
  assert.deepEqual(removed, []);
  assert.equal(overlays[0].props.view, 'remove-account');
  target = { ...overlays[0].props, overlay: 'confirm' };
  const prompt = new View(); prompt.render(renderContext);
  ui.nodes.get('cancel-remove-account').click();
  assert.deepEqual(removed, []); assert.equal(overlays.at(-1).props.view, 'manage-launchers');
  assert.equal(overlays.at(-1).modal, false);
  ui.nodes.get('confirm-remove-account').click({}, cx); prompt.render(renderContext);
  ui.nodes.get('confirm-remove-account').click({}, cx);
  ui.nodes.get('cancel-remove-account').click();
  assert.deepEqual(removed, ['devkits-codex-work']);
  assert.equal(ui.nodes.get('confirm-remove-account').disabled, true);
  release(); await pending;
  assert.deepEqual(memory['devkits.hidden-launchers'], ['agent:codex']);
  assert.deepEqual(memory['devkits.launcher-order'], ['terminal', 'agent:devkits-codex-personal']);
  assert.deepEqual(memory['devkits.codex-permissions'], { 'devkits-codex-personal': 'read-only' });
  assert.equal(overlays.at(-1).props.view, 'manage-launchers');
});
test('Manage saves Codex permissions per launcher and applies them to new tabs and projects only', async () => {
  const ui = fakeElements(), memory = {}, overlays = [], commands = [];
  let target = { view: 'manage-launchers', overlay: 'manage', space: 'api' };
  const codex = { key: 'codex', name: 'Codex', run: ['codex'] };
  const work = { key: 'devkits-codex-work', name: 'Codex · Work', run: ['env', 'CODEX_HOME=/accounts/work', 'codex', '--no-daemon'] };
  const View = await viewFor({ ...ui, props: () => target, theme: () => ({ muted: '#888888', done: '#0000ff', working: '#008000', ansi1: '#ff0000' }), spaces: () => [],
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    openOverlay: value => overlays.push(value), closeOverlay() {}, run: (...args) => commands.push(args) });
  const view = new View(); view.launchers = [codex, work, { key: 'claude', name: 'Claude' }];
  view.manageIndex = 0; view.preparePermissionSelects(renderContext); view.render(renderContext);
  assert.ok(ui.nodes.has('permissions-codex')); assert.ok(ui.nodes.has('permissions-devkits-codex-work'));
  assert.ok(ui.nodes.has('permissions-claude')); assert.ok(!ui.nodes.has('permissions-terminal'));
  const cx = renderContext;
  ui.nodes.get('permissions-codex').mouseDown({}, cx);
  ui.nodes.get('permissions-codex').click({}, cx); view.render(cx);
  assert.equal(view.permissionSelects.get('codex').open, true);
  ui.nodes.get('permissions-codex-options').mouseDownOut({}, cx); view.render(cx);
  assert.equal(view.permissionSelects.get('codex').open, false);
  assert.deepEqual(memory['devkits.codex-permissions'], undefined);
  ui.nodes.get('permissions-codex').click({}, cx); view.render(cx);
  ui.nodes.get('permissions-codex-option-read-only').click({}, cx); view.render(cx);
  assert.equal(view.permissionSelects.get('codex').open, false);
  assert.deepEqual(memory['devkits.codex-permissions'], { codex: 'read-only' });
  assert.ok(ui.nodes.get('permissions-codex').children.includes('Read only'));
  assert.equal(ui.nodes.get('permissions-codex').textColor, '#0000ff');
  assert.ok(ui.nodes.get('permissions-devkits-codex-work').children.includes('Default'));
  ui.nodes.get('permissions-devkits-codex-work').click({}, cx); view.render(cx);
  assert.equal(view.permissionSelects.get('devkits-codex-work').open, true);
  ui.nodes.get('permissions-devkits-codex-work').click({}, cx); view.render(cx);
  assert.equal(view.permissionSelects.get('devkits-codex-work').open, false);
  ui.nodes.get('permissions-devkits-codex-work').click({}, cx); view.render(cx);
  ui.nodes.get('permissions-devkits-codex-work-options').keyDown({ key: 'escape' }, cx); view.render(cx);
  assert.deepEqual(memory['devkits.codex-permissions'], { codex: 'read-only' });
  ui.nodes.get('permissions-devkits-codex-work-select').openChange(true, cx); view.render(cx);
  ui.nodes.get('permissions-devkits-codex-work-options').keyDown({ key: 'down' }, cx); view.render(cx);
  ui.nodes.get('permissions-devkits-codex-work-options').keyDown({ key: 'down' }, cx); view.render(cx);
  ui.nodes.get('permissions-devkits-codex-work-options').keyDown({ key: 'enter' }, cx); view.render(cx);
  assert.deepEqual(memory['devkits.codex-permissions'], { codex: 'read-only', 'devkits-codex-work': 'workspace-write' });
  assert.equal(ui.nodes.get('permissions-devkits-codex-work').textColor, '#008000');
  assert.deepEqual(overlays, []);
  assert.ok(!ui.texts.includes('Applies to new sessions only. Existing sessions keep their permissions.'));
  assert.deepEqual(commands, []);
  target = { view: 'launcher', overlay: 'menu', space: 'api', folder: '/Code/api' }; view.startThread(codex);
  assert.deepEqual(commands.find(([name]) => name === 'tab.new')[1].argv,
    ['codex', '--sandbox', 'read-only', '--ask-for-approval', 'on-request']);
  target = { ...target, space: null, projectName: 'New project' }; view.startThread(work);
  assert.deepEqual(commands.find(([name]) => name === 'space.new')[1].argv,
    ['env', 'CODEX_HOME=/accounts/work', 'codex', '--sandbox', 'workspace-write', '--ask-for-approval', 'on-request', '--no-daemon']);
  commands.length = 0;
  target = { view: 'manage-launchers', overlay: 'manage', space: 'api' }; view.render(cx);
  ui.nodes.get('permissions-codex-select').openChange(true, cx); view.render(cx);
  ui.nodes.get('permissions-codex-option-danger-full-access').click({}, cx); view.render(cx);
  assert.equal(ui.nodes.get('permissions-codex').textColor, '#ff0000');
  assert.ok(codexPermissionModes.every(mode => !ui.texts.includes(mode.description)));
  ui.nodes.get('permissions-codex-select').openChange(true, cx); view.render(cx);
  ui.nodes.get('permissions-codex-option-default').click({}, cx); view.render(cx);
  assert.equal(ui.nodes.get('permissions-codex').textColor, '#888888');
  assert.deepEqual(memory['devkits.codex-permissions'], { 'devkits-codex-work': 'workspace-write' });
  assert.deepEqual(commands, []);
});
test('an old permissions dialog returns to Manage after a live update', async () => {
  const ui = fakeElements(), closed = [], overlays = [];
  const View = await viewFor({ ...ui, props: () => ({ view: 'codex-permissions', overlay: 'old-dialog', space: 'api' }),
    closeOverlay: id => closed.push(id), openOverlay: value => overlays.push(value) });
  new View().init({}, renderContext);
  assert.deepEqual(closed, ['old-dialog']);
  assert.equal(overlays[0].modal, false);
  assert.deepEqual(overlays[0].props, { view: 'manage-launchers', space: 'api' });
});
test('failed account removal stays in the confirmation dialog and preserves preferences for retry', async () => {
  const ui = fakeElements(); let pending;
  const View = await viewFor({ ...ui, props: () => ({ view: 'remove-account', account: { key: 'devkits-codex-work', name: 'Work' } }),
    theme: () => ({}), setShared: () => assert.fail('must not clean preferences'),
    closeOverlay: () => assert.fail('must not close'),
    removeAccountProfile: async () => { throw Error('Could not sign out'); } });
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
test('usage follows Add session visibility and order, shows actual quota windows, always has meters, and opens details', async () => {
  const ui = fakeElements(), overlays = [];
  const now = Date.UTC(2026, 0, 1);
  const memory = { 'devkits.hidden-launchers': ['terminal', 'agent:work'],
    'devkits.launcher-order': ['agent:pi', 'agent:codex'] };
  const View = await viewFor({ ...ui, spaces: () => projects, shared: key => memory[key],
    openOverlay: overlay => overlays.push(overlay), settings: () => ({ zoom: 1 }),
    window: () => ({}), layout: () => ({ children: [] }),
    quotaResetLabel: window => quotaResetLabel(window, now) });
  const view = new View(); view.usageMachine = null;
  view.header({});
  assert.ok(!ui.nodes.has('account-usage'));
  view.usageAgents = [{ key: 'codex', name: 'Codex', run: ['codex'] },
    { key: 'work', name: 'Codex · 工作', run: ['codex'] },
    { key: 'pi', name: 'Pi', run: ['pi'] }];
  view.usage = [{ key: 'codex', name: 'Codex', windows: [
    { bucket: 'codex', minutes: 300, usedPercent: 0, resetsAt: now / 1000 + 83 * 60 },
    { bucket: 'codex', minutes: 10080, usedPercent: 42 }], fetchedAt: 5678 }];
  view.accountUsage({});
  assert.ok(ui.nodes.has('usage-meter-agent:codex-300'));
  assert.ok(ui.nodes.has('usage-meter-agent:codex-10080'));
  assert.equal(ui.nodes.get('usage-meter-agent:codex-300-fill').width, '0%');
  assert.equal(ui.nodes.get('usage-meter-agent:codex-10080-fill').width, '42%');
  assert.ok(ui.nodes.has('usage-reset-agent:codex-300'));
  assert.ok(ui.nodes.has('usage-reset-agent:codex-10080'));
  assert.equal(ui.nodes.get('usage-agent:codex').tooltip, undefined);
  assert.equal(ui.nodes.get('usage-reset-agent:codex-300').tooltip, undefined);
  assert.equal(ui.nodes.get('usage-reset-agent:codex-10080').tooltip, undefined);
  assert.ok(ui.texts.includes('01h 23m'));
  assert.ok(ui.texts.includes('Week'));
  assert.ok(ui.nodes.has('usage-meter-agent:pi'));
  assert.ok(!ui.nodes.has('usage-agent:work'));
  assert.ok(!ui.nodes.has('usage-terminal'));
  assert.ok(ui.texts.includes('Not supported'));
  assert.ok(ui.texts.includes('0%'));
  assert.deepEqual([...ui.nodes.keys()].filter(key => key.startsWith('usage-agent:')), ['usage-agent:pi', 'usage-agent:codex']);
  ui.nodes.get('usage-agent:codex').click();
  assert.equal(overlays[0].props.view, 'usage-details');
  assert.equal(overlays[0].height, 480);
  assert.equal(overlays[0].modal, false);
  assert.equal(overlays[0].props.account.windows.length, 2);
  assert.equal(overlays[0].props.account.fetchedAt, 5678);
  view.usage[0].windows = view.usage[0].windows.filter(window => window.minutes !== 300);
  ui.nodes.clear(); ui.texts.length = 0; view.accountUsage({});
  assert.ok(ui.nodes.has('usage-meter-agent:codex-10080'));
  assert.ok(!ui.nodes.has('usage-meter-agent:codex-300'));
  assert.ok(!ui.nodes.has('usage-reset-agent:codex-300'));
  assert.ok(!ui.texts.includes('5h'));
  assert.ok(!ui.texts.includes('5h —'));
  assert.ok(ui.texts.includes('Week'));
  ui.nodes.get('usage-agent:pi').click();
  assert.equal(overlays[1].props.account.supported, false);
  assert.ok(!ui.nodes.has('usage-settings'));
  memory['devkits.hidden-launchers'] = ['agent:codex'];
  ui.nodes.clear(); view.accountUsage({});
  assert.ok(ui.nodes.has('usage-agent:work'));
  assert.ok(ui.nodes.has('usage-meter-agent:work'));
  assert.ok(!ui.nodes.has('usage-terminal'));
  assert.ok(!ui.nodes.has('usage-agent:codex'));
  assert.ok(ui.texts.includes('AGENT PROFILES'));
  ui.nodes.get('manage-agent-profiles').click();
  assert.deepEqual(overlays.at(-1).props, { view: 'manage-launchers', space: 'api' });
  assert.equal(overlays.at(-1).width, 680);
  assert.equal(overlays.at(-1).height, 0.8);
});
test('quota time progress uses each actual window and hides missing, inconsistent or expired resets', () => {
  const now = Date.UTC(2026, 10, 6);
  for (const minutes of [300, 10080, 60]) {
    const window = { minutes, resetsAt: now / 1000 + minutes * 60 };
    assert.equal(quotaElapsedPercent(window, now), 0);
    assert.equal(quotaElapsedPercent(window, now + minutes * 30000), 50);
    assert.equal(quotaElapsedPercent(window, now + minutes * 60000), null);
    assert.equal(quotaElapsedPercent(window, now - 1000), null);
  }
  for (const window of [{}, { minutes: null, resetsAt: now / 1000 + 60 },
    { minutes: 0, resetsAt: now / 1000 + 60 }, { minutes: 300 },
    { minutes: 300, resetsAt: 0 }, { minutes: 300, resetsAt: NaN },
    { minutes: 300, resetsAt: now / 1000 - 60 }]) {
    assert.equal(quotaElapsedPercent(window, now), null);
  }
});

test('sidebar and details compare quota usage with the same elapsed background and remove stale time progress', async () => {
  const ui = fakeElements(), now = Date.UTC(2026, 10, 6);
  const colors = { border: '#111111', muted: '#999999', foreground: '#ffffff', working: '#008800' };
  const window = { bucket: 'codex', name: 'codex', minutes: 300, usedPercent: 60, resetsAt: now / 1000 + 150 * 60 };
  const account = { key: 'codex', name: 'Codex', supported: true, windows: [window] };
  let time = now;
  const View = await viewFor({ ...ui, props: () => ({ account }), spaces: () => projects,
    quotaElapsedPercent: window => quotaElapsedPercent(window, time) });
  const view = new View(); view.usageMachine = null;
  view.usageAgents = [{ key: 'codex', name: 'Codex', run: ['codex'] }]; view.usage = [account];
  const ids = ['usage-meter-agent:codex-300', 'usage-detail-meter-0'];
  const render = () => { ui.nodes.clear(); view.accountUsage(colors); view.usageDetails(colors); };
  render();
  for (const id of ids) {
    assert.equal(ui.nodes.get(id).height, 10);
    assert.equal(ui.nodes.get(`${id}-elapsed`).width, '50%');
    assert.equal(ui.nodes.get(`${id}-elapsed`).background, colors.muted);
    assert.equal(ui.nodes.get(`${id}-elapsed`).height, '50%');
    assert.equal(ui.nodes.get(`${id}-fill`).width, '60%');
    assert.equal(ui.nodes.get(`${id}-fill`).height, '50%');
    assert.ok(ui.nodes.has(`${id}-time-marker`));
  }
  assert.ok(ui.texts.includes('Top: 50% of window elapsed · Bottom: quota used'));
  time += 75 * 60000; render();
  for (const id of ids) assert.equal(ui.nodes.get(`${id}-elapsed`).width, '75%');
  time += 75 * 60000; render();
  for (const id of ids) {
    assert.ok(!ui.nodes.has(`${id}-elapsed`));
    assert.ok(!ui.nodes.has(`${id}-time-marker`));
    assert.equal(ui.nodes.get(`${id}-fill`).width, '60%');
  }
});

test('usage meters use the percentage for fill and color at both warning thresholds in sidebar and details', async () => {
  const ui = fakeElements(), colors = { border: '#111111', working: '#008800', blocked: '#aa8800', ansi1: '#cc0000' };
  const account = { key: 'codex', name: 'Codex', supported: true, windows: [] };
  const View = await viewFor({ ...ui, props: () => ({ account }), spaces: () => projects,
    settings: () => ({ zoom: 1 }), window: () => ({}), layout: () => ({ children: [] }) });
  const view = new View(); view.usageMachine = null;
  view.usageAgents = [{ key: 'codex', name: 'Codex', run: ['codex'] }]; view.usage = [account];
  for (const [value, color] of [[0, colors.working], [69, colors.working], [70, colors.blocked],
    [89, colors.blocked], [90, colors.ansi1], [100, colors.ansi1]]) {
    account.windows = [{ bucket: 'codex', name: 'codex', minutes: 10080, usedPercent: value }];
    view.accountUsage(colors); view.usageDetails(colors);
    for (const id of ['usage-meter-agent:codex-10080', 'usage-detail-meter-0']) {
      assert.equal(ui.nodes.get(id).value, value);
      assert.equal(ui.nodes.get(`${id}-fill`).width, `${value}%`);
      assert.equal(ui.nodes.get(`${id}-fill`).background, color);
    }
  }
  assert.ok(!ui.nodes.has('usage-meter-terminal'));
});
test('usage details show all durations and errors, and Done or Escape close only the dialog', async () => {
  const ui = fakeElements(), closed = [];
  const account = { name: '工作', supported: true, fetchedAt: 5678, windows: [
    { name: 'codex', minutes: 300, usedPercent: 0, resetsAt: Date.now() / 1000 + 83 * 60 },
    { name: 'codex', minutes: 10080, usedPercent: 42, resetsAt: Date.now() / 1000 + (6 * 24 + 21) * 3600 },
    { name: 'custom', minutes: null, usedPercent: 20 },
  ] };
  const View = await viewFor({ ...ui, props: () => ({ account, overlay: 'details' }), closeOverlay: id => closed.push(id) });
  const view = new View(); view.usageDetails({});
  assert.ok(ui.texts.includes('codex · 5h'));
  assert.ok(ui.texts.includes('codex · 7d'));
  assert.ok(ui.texts.includes('custom · Unknown duration'));
  assert.ok(ui.texts.includes('42% used · 58% remaining'));
  assert.ok(ui.texts.includes('Resets in 1h 23m'));
  assert.ok(ui.texts.includes('Resets in 6d 21h'));
  account.windows[0].resetsAt = Date.now() / 1000 - 60;
  view.usageDetails({});
  assert.ok(ui.texts.includes('Reset due · awaiting refresh'));
  ui.nodes.get('usage-details-done').click();
  ui.nodes.get('usage-details').keyDown({ key: 'escape' }, { stop_propagation() {} });
  assert.deepEqual(closed, ['details', 'details']);
  account.error = 'Not signed in'; view.usageDetails({});
  assert.ok(ui.texts.includes('Not signed in'));
  account.supported = false; account.windows = []; view.usageDetails({});
  assert.ok(ui.texts.includes('Not supported'));
});
test('usage details refresh the reset countdown every minute while open', async () => {
  let tick, notified = 0;
  const View = await viewFor({ props: () => ({ view: 'usage-details' }) });
  const cx = { timer: { every(ms, callback) { assert.equal(ms, 60000); tick = callback; } },
    focus_handle: () => ({ focus() {} }), notify() { notified++; } };
  new View().init({}, cx);
  assert.equal(typeof tick, 'function');
  tick(cx);
  assert.equal(notified, 1);
});
test('case-only profile renames refresh sidebar labels even while native discovery has the old name', async () => {
  const key = 'devkits-codex-work';
  const memory = {};
  let label = 'Codex · work', pending;
  const View = await viewFor({ spaces: () => projects,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    knownAgents: async () => [{ key, name: 'Codex · work', installed: true, run: ['codex'] }],
    readTextFile: async () => JSON.stringify({ programs: { [key]: { name: label } } }),
    exec: async () => ({ code: 0, stdout: '[]' }) });
  const cx = { spawn(task) { pending = task(cx); }, notify() {} };
  const view = new View();
  view.refreshUsage(cx, false); await pending;
  assert.equal(view.usageAgents[0].name, 'Codex · work');
  label = 'Codex · WORK';
  memory['devkits.agent-cache'] = {};
  memory['devkits.profile-revision'] = 1;
  view.refreshUsage(cx, false); await pending;
  assert.equal(view.usageAgents[0].name, 'Codex · WORK');
  assert.equal((await view.cachedAgents(null))[0].name, 'Codex · WORK');
});

test('Codex usage is cached across reloads while Devkits Claude accounts reread their local status-line file', async () => {
  let pending, failed = false, calls = [], discovered = 0;
  const statusLines = [];
  const memory = { 'devkits.hidden-launchers': ['agent:work'] };
  const claude = { key: 'devkits-claude-me', installed: true, run: ['env', 'CLAUDE_CONFIG_DIR=/accounts/me', 'claude'] };
  const View = await viewFor({ spaces: () => projects, shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    home: () => '/home/me', ensureClaudeStatusLine: async (directory, options) => statusLines.push([directory, options.chain]),
    knownAgents: async () => {
      discovered++;
      return [{ key: 'codex', installed: true, run: ['codex'] },
        { key: 'work', installed: true, run: ['env', 'CODEX_HOME=/accounts/work', 'codex', '--no-daemon'] },
        { key: 'claude', installed: true, run: ['claude'] }, claude, { key: 'pi', installed: true, run: ['pi'] }];
    }, appHome: () => '/herdr', exec: async (...args) => {
      const keys = JSON.parse(args[1][1]).map(account => account.key);
      calls.push(keys);
      return failed ? { code: 0, stdout: JSON.stringify(keys.map(key => ({ key, error: 'Rate limited' }))) }
        : { code: 0, stdout: JSON.stringify(keys.map(key => ({ key, windows: [{ usedPercent: 42 }], fetchedAt: 1 }))) };
    } });
  const cx = { spawn(task) { pending = task(cx); }, notify() {} };
  const view = new View();
  view.refreshUsage(cx); view.refreshUsage(cx); await pending;
  assert.deepEqual(calls, [['codex', 'claude', 'devkits-claude-me']]);
  // Only the built-in profile chains a status line another tool already set.
  assert.deepEqual(statusLines, [['/home/me/.claude', true], ['/accounts/me', false]]);
  assert.equal(view.usage[0].windows[0].usedPercent, 42);
  view.refreshUsage(cx, false); assert.equal(discovered, 1);
  // A reload or restart starts a new view; Codex reuses fresh cached results.
  const reloaded = new View(); reloaded.refreshUsage(cx); await pending;
  assert.deepEqual(calls.at(-1), ['claude', 'devkits-claude-me']);
  assert.deepEqual(reloaded.usage.map(account => account.key), ['codex', 'claude', 'devkits-claude-me']);
  memory['devkits.hidden-launchers'] = [];
  view.refreshUsage(cx, false); await pending;
  assert.deepEqual(calls.at(-1), ['work', 'claude', 'devkits-claude-me']);
  assert.equal(statusLines.length, 4);
  for (const entry of Object.values(memory['devkits.usage-cache'])) entry.checkedAt -= 5 * 60000;
  failed = true; view.refreshUsage(cx); await pending;
  assert.deepEqual(calls.at(-1), ['codex', 'work', 'claude', 'devkits-claude-me']);
  assert.equal(view.usage[0].windows[0].usedPercent, 42);
  assert.equal(view.usage[0].error, 'Rate limited');
  const count = calls.length;
  view.refreshUsage(cx); await pending;
  assert.deepEqual(calls.slice(count), [['claude', 'devkits-claude-me']]);
  assert.equal(view.usageLoading, false);
});
test('remote usage never queries local credentials or shows local account entries', async () => {
  let pending;
  const View = await viewFor({ spaces: () => [{ ...projects[0], machine: 'remote' }],
    knownAgents: async options => {
      assert.equal(options.on, 'remote');
      return [{ key: 'codex', installed: true, run: ['codex'] },
        { key: 'devkits-codex-work', installed: true, run: ['codex'] }];
    }, exec: () => assert.fail('Must not query a local account for a remote project') });
  const cx = { spawn(task) { pending = task(cx); }, notify() {} };
  const view = new View(); view.refreshUsage(cx); await pending;
  assert.deepEqual(view.usageAgents.map(agent => agent.key), ['codex']);
  assert.deepEqual(view.usage, []);
});
test('status bar Files toggles an empty project browser without creating sessions; header has no file action', async () => {
  const ui = fakeElements(), commands = [];
  const memory = { 'devkits.projects': ['/Code/new'], 'devkits.selected-project': 'project:/Code/new' };
  let target = {};
  const View = await viewFor({ ...ui, props: () => target, spaces: () => [], agents: () => [], theme: () => ({}),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    window: () => ({ platform: 'macos' }), settings: () => ({ zoom: 1 }), layout: () => ({ children: [] }),
    setAgentOrder() {}, run: (...args) => commands.push(args) });
  const sidebar = new View(); sidebar.init(); sidebar.render();
  target = { view: 'header' };
  const header = new View(); header.render();
  assert.ok(!ui.nodes.has('open-files'));
  target = { view: 'status' };
  const status = new View(); status.render();
  assert.ok(!ui.nodes.has('commands'));
  ui.nodes.get('open-files').click();
  target = {}; sidebar.render();
  assert.deepEqual(commands.at(-1), ['layout.select', { stack: 'workspace-view', child: 'files' }]);
  target = { view: 'status' }; status.render(); ui.nodes.get('open-files').click();
  target = {}; sidebar.render();
  assert.deepEqual(commands.at(-1), ['layout.select', { stack: 'workspace-view', child: 'project-empty' }]);
  target = { view: 'status' }; status.render(); ui.nodes.get('open-diff').click();
  target = {}; sidebar.render();
  assert.deepEqual(commands.at(-1), ['layout.select', { stack: 'workspace-view', child: 'diff' }]);
  target = { view: 'status' }; status.render(); ui.nodes.get('open-files').click();
  assert.equal(memory['devkits.diff'], null);
  target = {}; sidebar.render();
  assert.deepEqual(commands.at(-1), ['layout.select', { stack: 'workspace-view', child: 'files' }]);
  assert.ok(!commands.some(([name]) => name === 'space.new' || name === 'tab.new' || name === 'terminal.kill'));
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
  view.manageIndex = 0; view.preparePermissionSelects(renderContext); view.render(renderContext);
  const codexRow = ui.nodes.get('manage-agent:codex'), accountRow = ui.nodes.get('manage-agent:devkits-codex-work');
  assert.ok(codexRow.children.includes(ui.nodes.get('add-codex-account').element));
  assert.ok(!accountRow.children.includes(ui.nodes.get('add-codex-account').element));
  ui.nodes.get('add-codex-account').click();
  assert.deepEqual(closed, ['manage-dialog']);
  assert.equal(overlays[0].props.view, 'account-login');
  assert.equal(overlays[0].props.provider, 'codex');
  assert.equal(overlays[0].modal, true);
  assert.deepEqual(overlays[0].props.returnTo, { view: 'manage-launchers', space: 'api' });
  ui.nodes.clear(); view.launcher({});
  assert.ok(!ui.nodes.has('add-codex-account'));
});
test('the base Claude row offers Add account and Claude accounts join Your accounts with Claude permissions', async () => {
  const ui = fakeElements(), overlays = [], memory = {};
  const target = { view: 'manage-launchers', space: 'api', overlay: 'manage-dialog' };
  const View = await viewFor({ ...ui, props: () => target, spaces: () => projects, theme: () => ({}),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    closeOverlay() {}, openOverlay: value => overlays.push(value) });
  const view = new View(); view.launchers = [{ key: 'claude', name: 'Claude' }, { key: 'devkits-claude-work', name: 'Claude · work' }];
  view.manageIndex = 0; view.preparePermissionSelects(renderContext); view.render(renderContext);
  assert.ok(ui.nodes.get('manage-agent:claude').children.includes(ui.nodes.get('add-claude-account').element));
  assert.ok(ui.nodes.has('manage-section-2'));
  assert.ok(ui.nodes.has('rename-devkits-claude-work')); assert.ok(ui.nodes.has('remove-devkits-claude-work'));
  assert.ok(ui.nodes.has('permissions-devkits-claude-work')); assert.ok(ui.nodes.has('permissions-claude'));
  ui.nodes.get('permissions-claude-select').openChange(true, renderContext); view.render(renderContext);
  ui.nodes.get('permissions-claude-option-acceptEdits').click({}, renderContext);
  assert.deepEqual(memory['devkits.codex-permissions'], { claude: 'acceptEdits' });
  ui.nodes.get('add-claude-account').click();
  assert.equal(overlays[0].props.view, 'account-login');
  assert.equal(overlays[0].props.provider, 'claude');
});
test('local account profiles and their login action stay out of remote project menus', async () => {
  const ui = fakeElements(); let pending;
  const View = await viewFor({ ...ui, props: () => ({ view: 'manage-launchers', space: 'remote' }),
    spaces: () => [{ id: 'remote', machine: 'server' }], theme: () => ({}), knownAgents: async () => [
      { key: 'devkits-codex-work', installed: true }, { key: 'codex', name: 'Codex', installed: true },
    ] });
  const cx = { notify() {}, focus_handle: () => ({ focus() {} }), spawn(task) { pending = task(cx); } };
  const view = new View(); view.init({}, cx); await pending; view.render(renderContext);
  assert.deepEqual(view.launchers.map(agent => agent.key), ['codex']);
  assert.ok(!ui.nodes.has('add-codex-account'));
});
test('project dropdown switches projects and creates a default terminal for a new folder', async () => {
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
  assert.deepEqual(commands.find(([name]) => name === 'space.new'),
    ['space.new', { name: 'new project', folder: '/Code/new project', machine: '', tab: '__devkits_default_terminal__' }]);
  assert.ok(!commands.some(([name]) => name === 'tab.new'));
});
test('pane header uses the sidebar thread title without split, zoom, or close controls', async () => {
  const ui = fakeElements();
  const View = await viewFor({ ...ui, props: () => ({ pane: 'pane-1' }),
    spaces: () => projects, agents: () => agents,
    panes: () => [{ pane: 'pane-1', tab: 'tab-1', cwd: '/Code/project', program: { name: 'Codex', icon: 'icons/codex.svg', tint: false } }] });
  new View().paneHeader({});
  assert.ok(ui.texts.includes(projectGroups(projects, agents)[1].threads.find(thread => thread.tab.id === 'tab-1').title));
  assert.ok(!ui.texts.includes('/Code/project'));
  assert.ok(!ui.texts.includes('Codex'));
  for (const name of ['split-right', 'split-down', 'zoom', 'close']) assert.ok(!ui.nodes.has(`${name}-pane-1`));
});
test('pane header names the agent profile that started the thread', async () => {
  const ui = fakeElements();
  const launchers = [{ key: 'devkits-claude-work', name: 'Claude · Work' }];
  const View = await viewFor({ ...ui, props: () => ({ pane: 'pane-1' }), spaces: () => projects, agents: () => agents,
    shared: key => ({ 'devkits.agent-cache': { null: launchers }, 'devkits.thread-profiles': { 'tab-1': 'devkits-claude-work' } })[key],
    panes: () => [{ pane: 'pane-1', tab: 'tab-1', program: { name: 'Codex' } }] });
  new View().paneHeader({});
  assert.ok(ui.texts.includes('Review tests'));
  assert.ok(ui.texts.includes('Claude · Work'));
});
test('started sessions remember their profile once the new tab appears', () => {
  const pending = [{ key: 'codex', space: 'app', before: ['tab-1', 'tab-3'], at: 1000 },
    { key: 'claude', space: null, folder: '/Code/new/', before: [], at: 1000 },
    { key: 'pi', space: 'missing', before: [], at: 1000 }];
  const spaces = [...projects.map(space => space.id === 'app' ? { ...space, tabs: [...space.tabs, { id: 'tab-9' }] } : space),
    { id: 'new', folder: '/Code/new', tabs: [{ id: 'tab-new' }] }];
  assert.deepEqual(resolveThreadProfiles(spaces, pending, {}, 2000),
    { pending: [pending[2]], profiles: { 'tab-9': 'codex', 'tab-new': 'claude' } });
  assert.deepEqual(resolveThreadProfiles(spaces, [pending[2]], {}, 70000).pending, []);
  const launchers = [{ key: 'codex', name: 'Codex' }, { key: 'devkits-codex-work', name: 'Codex · work' }];
  assert.equal(threadProfile({ id: 'a', name: 'Fix login', named: true }, launchers, { a: 'devkits-codex-work' }), 'Codex · work');
  assert.equal(threadProfile({ id: 'b', name: 'Codex · work', named: true }, launchers), 'Codex · work');
  assert.equal(threadProfile({ id: 'c', name: 'Fix login', named: true }, launchers), null);
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
  assert.equal(memory['devkits.selected-project'], null);
  assert.deepEqual(commands.find(([name]) => name === 'space.new'),
    ['space.new', { name: 'new project', folder, machine: '', tab: '__devkits_default_terminal__' }]);
  assert.ok(!commands.some(([name]) => name === 'tab.new'));
  commands.length = 0;
  folder = '/original/api/'; view.openProject(cx); await pending;
  assert.ok(commands.some(([name, args]) => name === 'space.select' && args.id === 'api'));
  assert.ok(!commands.some(([name]) => name === 'space.new' || name === 'tab.new'));
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
test('each project gets its open panel back when selected again, until a thread is chosen there', async () => {
  const ui = fakeElements(), commands = [], memory = {};
  let active = 'one';
  const spaces = () => ['one', 'two'].map(id => ({ id, name: id, folder: `/Code/${id}`, active: id === active,
    tabs: [{ id: `${id}-a`, name: 'A', active: true }, { id: `${id}-b`, name: 'B' }] }));
  let target = {};
  const View = await viewFor({ ...ui, props: () => target, agents: () => [], theme: () => ({}), spaces,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, setAgentOrder() {}, run: (...args) => commands.push(args) });
  const sidebar = new View(); sidebar.folded = new Set(); sidebar.render();
  target = { view: 'status' }; new View().render(); ui.nodes.get('open-files').click();
  assert.equal(memory['devkits.files'], 'one');
  target = {}; active = 'two'; sidebar.render();
  assert.equal(memory['devkits.files'], null);
  active = 'one'; sidebar.render();
  assert.equal(memory['devkits.files'], 'one');
  assert.deepEqual(commands.at(-1), ['layout.select', { stack: 'workspace-view', child: 'files' }]);
  ui.nodes.get('thread-one-b').click();
  assert.equal(memory['devkits.files'], null);
  active = 'two'; sidebar.render(); active = 'one'; sidebar.render();
  assert.equal(memory['devkits.files'], null);
});
test('Start session from an Asana preview offers only agents, names the thread, prompts with the task and unsaves it', async () => {
  const ui = fakeElements(), commands = [], unsaved = [];
  const target = { view: 'launcher', space: 'api', folder: '/Code/api', projectName: 'API', overlay: 'menu', task: { gid: 't1', name: 'Fix login' } };
  const View = await viewFor({ ...ui, props: () => target, theme: () => ({}), spaces: () => projects,
    taskPrompt: task => `prompt:${task.name}`, unsaveTask: (...args) => unsaved.push(args), run: (...args) => commands.push(args),
    closeOverlay() {}, notify: error => assert.fail(error.body) });
  const view = new View(); view.launchers = [{ key: 'codex', name: 'Codex', installed: true, run: ['codex'] }]; view.render();
  assert.ok(!ui.nodes.has('new-terminal'));
  assert.ok(!ui.nodes.has('manage-launchers-open'));
  ui.nodes.get('start-codex').click();
  assert.deepEqual(commands.find(([name]) => name === 'tab.new'),
    ['tab.new', { space: 'api', folder: '/Code/api', name: 'Fix login', argv: ['codex', 'prompt:Fix login'] }]);
  assert.deepEqual(unsaved, [['/Code/api', 't1']]);
});
test('Asana tasks opens from a local project menu, replaces Files and Changes, and is absent for remote projects', async () => {
  const ui = fakeElements(), commands = [], memory = {};
  const project = { id: 'one', name: 'One', folder: '/Code/one', machine: null, active: true, tabs: [] };
  let target = { view: 'project-menu', overlay: 'menu', project };
  const View = await viewFor({ ...ui, props: () => target, agents: () => [], theme: () => ({}), spaces: () => [project],
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, setAgentOrder() {},
    run: (...args) => commands.push(args), closeOverlay() {} });
  const menu = new View(); menu.handle = { focus() {} }; menu.render();
  ui.nodes.get('menu-asana-tasks').click();
  assert.equal(memory['devkits.asana'], 'one');
  target = {}; const sidebar = new View(); sidebar.folded = new Set(); sidebar.render();
  assert.deepEqual(commands.at(-1), ['layout.select', { stack: 'workspace-view', child: 'asana' }]);
  target = { view: 'status' }; new View().render();
  assert.ok(!ui.nodes.has('open-asana'));
  ui.nodes.get('open-files').click();
  assert.equal(memory['devkits.asana'], null);
  ui.nodes.clear(); target = { view: 'project-menu', overlay: 'menu', project: { ...project, machine: 'vps' } };
  const remote = new View(); remote.handle = { focus() {} }; remote.render();
  assert.ok(!ui.nodes.has('menu-asana-tasks'));
  assert.ok(ui.nodes.has('menu-close-project'));
});
test('empty projects stay empty until an agent is explicitly chosen', async () => {
  const ui = fakeElements();
  const saved = ['/Code/new'];
  let catalog = projectCatalog([], saved, {}, 'project:/Code/new');
  assert.equal(catalog[0].pending, true);
  assert.deepEqual(catalog[0].tabs, []);
  const commands = [], overlays = [];
  const View = await viewFor({ ...ui, spaces: () => [], shared: key => key === 'devkits.projects' ? saved : key === 'devkits.selected-project' ? 'project:/Code/new' : undefined,
    props: () => ({ view: 'project-empty', space: null, folder: '/Code/new', projectName: 'new', overlay: 'popup' }), theme: () => ({}),
    run: (...args) => commands.push(args), openOverlay: value => overlays.push(value), closeOverlay() {} });
  const view = new View();
  view.render();
  assert.deepEqual(ui.texts, []);
  assert.deepEqual(ui.assets, []);
  assert.equal(ui.nodes.size, 0);
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
test('sidebar leaves the project list blank when no workspace is open', async () => {
  const ui = fakeElements();
  const View = await viewFor({ ...ui, spaces: () => [], agents: () => [],
    theme: () => ({}), setAgentOrder() {}, run() {} });
  const view = new View(); view.init(); view.render();
  assert.ok(!ui.nodes.has('open-first-project'));
  assert.ok(!ui.texts.includes('Open a project'));
  assert.ok(!ui.texts.includes('Open folder…'));
  assert.ok(ui.nodes.has('settings'));
});
test('project menu moves persist and boundary actions leave order unchanged', async () => {
  const ui = fakeElements(), memory = {}, commands = [], closed = [];
  let target = { view: 'project-menu', project: projects[0], overlay: 'menu' };
  const View = await viewFor({ ...ui, props: () => target, spaces: () => projects, agents: () => [],
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    theme: () => ({}), closeOverlay: id => closed.push(id), run: (...args) => commands.push(args) });
  const view = new View();
  const selected = view.projects().find(project => project.active).id;
  view.projectMenu({});
  assert.equal(ui.nodes.get('menu-project-up').opacity, 0.4);
  ui.nodes.get('menu-project-up').click();
  assert.equal(memory['devkits.project-order'], undefined);
  assert.equal(closed.length, 0);
  ui.nodes.get('menu-project-down').click();
  assert.deepEqual(view.projects().map(project => project.id), ['app', 'api']);
  assert.equal(view.projects().find(project => project.active).id, selected);
  assert.deepEqual(closed, ['menu']);
  assert.equal(commands.length, 0);
  const restored = new View();
  assert.deepEqual(restored.projects().map(project => project.id), ['app', 'api']);
  view.projectMenu({});
  assert.equal(ui.nodes.get('menu-project-down').opacity, 0.4);
  const saved = memory['devkits.project-order'];
  ui.nodes.get('menu-project-down').click();
  assert.equal(memory['devkits.project-order'], saved);
  ui.nodes.get('menu-project-up').click();
  assert.deepEqual(view.projects().map(project => project.id), ['api', 'app']);
  view.moveProject('missing', -1);
  assert.deepEqual(view.projects().map(project => project.id), ['api', 'app']);
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
  assert.equal(threadTitle({ name: 'Codex · rickyeh', named: true },
    { ...codex, title: 'Fix thread names' }), 'Fix thread names');
  assert.equal(threadTitle({ name: 'Codex · rickyeh', named: true },
    { title: 'Fix thread names', program: { name: 'Codex · rickyeh' } }), 'Fix thread names');
  assert.equal(threadTitle({ name: 'Custom thread', named: true },
    { ...codex, title: 'Terminal title' }), 'Custom thread');
  assert.equal(threadTitle({ name: 'Codex · rickyeh', named: true }, { program: { name: 'Codex · rickyeh' } }), 'rickyeh');
  assert.equal(threadTitle({ name: 'Codex', named: true }, { ...codex, title: 'Fix authentication' }), 'Fix authentication');
  assert.equal(threadTitle({ name: 'Fix Codex login', named: true }, codex), 'Fix Codex login');
  assert.equal(threadTitle({ name: 'Auth review', named: true }, codex), 'Auth review');
  assert.equal(threadTitle({ name: '123', named: true }, codex), '123');
  assert.equal(threadTitle({ name: '1' }), 'Terminal');
  assert.equal(threadTitle({ name: 'Codex', named: true }), 'Codex');
  assert.equal(threadTitle({ name: 'Codex · rickyeh', named: true },
    { ...codex, app: 'codex', title: '⠙ 串接 rl-vs-mcp | reallusion-mcp' }), '串接 rl-vs-mcp');
  const claude = { title: '✳ Claude Code', app: 'claude-code', program: { name: 'Claude Code' } };
  assert.equal(threadTitle({ name: 'Claude · PPDShare', named: true }, claude), 'PPDShare');
  assert.equal(threadTitle({ name: 'Claude · PPDShare', named: true },
    { ...claude, title: '✳ Fix permission modes' }), 'Fix permission modes');
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
