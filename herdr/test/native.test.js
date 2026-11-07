import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { threadTitle, projectGroups, projectCatalog, folderKey, launcherChoices, codexPermissionModes, isAccountLauncher, permissionModes, launcherArgv, sessionArgv, sessionKind, claudeModels, claudeEfforts, codexHome, codexModels, mergeModels, orderedOptions, moveOption, effortLabel, sessionChoices, quotaResetLabel, quotaElapsedPercent, resolveThreadProfiles, threadProfile, threadProgram, archivable, agentCommand, commandKind, resumeArgv, codexSessionId, archivedAge, rulesArgv, childTerminals, terminalLabel, settingsKey, rootSettings } from '../mods/devkits/model.js';
import { install } from '../install.js';
import { syncShared } from '../sync-shared.js';
import { terminalArgv } from '../mods/devkits/shell-command.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
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
  const components = await Promise.all(['button', 'checkbox', 'select', 'alert-dialog', 'dialog', 'empty', 'sidebar', 'dropdown-menu', 'progress', 'switch', 'toggle-group', 'icon']
    .map(name => readFile(new URL(`../mods/devkits/components/${name}.js`, import.meta.url), 'utf8')));
  // The feature views main.js mixes into its view.
  const features = await Promise.all(['shell-command', 'global-rules', 'session-menu', 'account-actions', 'usage', 'run-app', 'thread-archive', 'branch-menu', 'project-layout', 'agent-board-model', 'agent-task-evidence', 'agent-board-state']
    .map(name => readFile(new URL(`../mods/devkits/${name}.js`, import.meta.url), 'utf8')));
  // Run native actions with a fake host; no real Herdr session is touched.
  return new Function('View', ...Object.keys(host), [...components, ...features].join('\n')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\n' + source
    .replace(/^import .*;\r?\n/gm, '').replace('export default class', 'class') + '\nreturn Devkits;');
}
async function viewFor(host) {
  const memory = {};
  host = { savedTasks: () => [], agents: () => [], spaces: () => [], projectCatalog, projectGroups, threadTitle, folderKey, launcherChoices, isAccountLauncher, permissionModes, launcherArgv, sessionArgv, sessionKind, claudeModels, claudeEfforts, codexHome, codexModels, mergeModels, orderedOptions, moveOption, effortLabel, sessionChoices, home: () => '/home', quotaResetLabel, quotaElapsedPercent, resolveThreadProfiles, threadProfile, threadProgram, archivable, agentCommand, commandKind, resumeArgv, codexSessionId, archivedAge, rulesArgv, childTerminals, terminalLabel, settingsKey, rootSettings, terminals: () => [], panes: () => [], focused: () => null, writeTextFile: async () => null, notify() {}, accountLabel: name => name.replace(/^(?:Codex|Claude) · /, ''), readTextFile: async () => null, window: () => ({}), layout: () => null, keys: () => [], appHome: () => '/herdr', props: () => ({}), shared: key => memory[key],
    setShared: (key, value) => { memory[key] = value; }, exec: async () => ({ code: 0 }), nextCommand: () => new Promise(() => {}), ...host };
  const factory = await loadView(host);
  return factory(class {}, ...Object.values(host));
}

test('Windows starts legacy account launchers locally and preserves commands on remote machines', async () => {
  const agent = { key: 'devkits-codex-work', name: 'Work', run: ['env', 'CODEX_HOME=C:/Account', 'codex'] };
  for (const machine of [null, 'linux-server']) {
    const commands = [];
    const View = await viewFor({ window: () => ({ platform: 'windows' }),
      spaces: () => [{ id: 'api', machine, tabs: [] }], run: (...args) => commands.push(args) });
    await new View().launchThread(agent, { space: 'api', folder: 'C:/Project' }, {});
    const argv = commands.find(([name]) => name === 'tab.new')[1].argv;
    assert.equal(argv[0], machine ? 'env' : 'git');
    assert.deepEqual(argv, machine ? agent.run : terminalArgv(agent.run, 'windows'));
  }
  assert.deepEqual(launcherArgv({ key: 'codex', run: ['C:\\bin\\codex.cmd'] }, 'read-only').slice(1),
    ['--sandbox', 'read-only', '--ask-for-approval', 'on-request']);
});
function fakeElements() {
  const nodes = new Map(), owners = new WeakMap();
  // Every string drawn inside an element, however deeply it is nested.
  const textOf = id => { const walk = data => data.children.flatMap(child => typeof child === 'string' ? [child] : owners.has(child) ? walk(owners.get(child)) : []); return walk(nodes.get(id)); };
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
        if (key === 'on_size_change') data.sizeChange = args[0];
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
    owners.set(el, data);
    return el;
  };
  const asset = path => { assets.push(path); return element(); };
  return { nodes, texts, textOf, assets, element, div: element, svg: asset, image: asset, h_flex: element, v_flex: element,
    NativeSelect: { new: id => element().id(id) }, NativePopup: { new: (_id, trigger) => element().child(trigger) }, Popup: { new: (_id, trigger) => element().child(trigger) },
    NativeButton: { new: id => element().id(id) }, NativeCheckbox: { new: id => element().id(id) },
    NativeSwitch: { new: id => element().id(id) }, NativeToggleGroup: { new: id => element().id(id) }, NativeToggle: { new: id => element().id(id) } };
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
test('thread close appears only on hover and another row leaving cannot hide it', async () => {
  const ui = fakeElements();
  const View = await viewFor(ui);
  const view = new View();
  const first = { tab: { id: 'first' }, agents: [], active: true, title: 'First' };
  const second = { tab: { id: 'second' }, agents: [], title: 'Second' };
  const render = () => { view.threadRow(first, {}); view.threadRow(second, {}); };
  const cx = { notify() {} };
  render();
  assert.equal(ui.nodes.get('close-thread-first').opacity, 0);
  ui.nodes.get('thread-first').hover(true, cx);
  render();
  assert.equal(ui.nodes.get('close-thread-first').opacity, 1);
  ui.nodes.get('thread-second').hover(true, cx);
  ui.nodes.get('thread-first').hover(false, cx);
  render();
  assert.equal(ui.nodes.get('close-thread-first').opacity, 0);
  assert.equal(ui.nodes.get('close-thread-second').opacity, 1);
  ui.nodes.get('thread-second').hover(false, cx);
  render();
  assert.equal(ui.nodes.get('close-thread-second').opacity, 0);
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
  await settle();
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
    spawn(task) { pending ??= task(cx); }, timer: { every() {} } };
  const view = new View(); view.launchers = choices; view.render(renderContext);
  assert.equal(ui.nodes.get('thread-launcher').children.at(-1), ui.nodes.get('manage-launchers-open').element);
  ui.nodes.get('manage-launchers-open').click({}, cx);
  assert.deepEqual(closed, ['menu']);
  assert.equal(overlays[0].kind, 'dialog');
  assert.equal(overlays[0].width, 820);
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
  await settle();
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
  const view = new View(); view.launchers = choices; view.manageIndex = 0; view.prepareAccountMenus(renderContext); view.render(renderContext);
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
  await settle();
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
    'devkits.profile-sessions': { 'devkits-codex-work': { model: 'a', effort: 'high' }, 'devkits-codex-personal': { model: 'b' } },
  };
  let target = { view: 'manage-launchers', space: 'api', overlay: 'manage' }, release, pending;
  const View = await viewFor({ ...ui, props: () => target, theme: () => ({}), spaces: () => [],
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    openOverlay: value => overlays.push(value), closeOverlay: id => closed.push(id),
    removeAccountProfile: async key => { removed.push(key); await new Promise(resolve => { release = resolve; }); } });
  const cx = { notify() {}, stop_propagation() {}, spawn(fn) { pending = fn(cx); } };
  const view = new View(); view.launchers = [{ key: 'codex', name: 'Codex' }, { key: 'devkits-codex-work', name: 'Codex · Work' }];
  view.manageIndex = 0; view.prepareAccountMenus(renderContext); view.render(renderContext);
  assert.ok(!ui.nodes.has('account-menu-codex'));
  ui.nodes.get('account-actions-devkits-codex-work-remove').click({}, renderContext);
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
  assert.deepEqual(memory['devkits.profile-sessions'], { 'devkits-codex-personal': { model: 'b' } });
  assert.equal(overlays.at(-1).props.view, 'manage-launchers');
});
test('Claude and Codex permissions are set once per provider in Settings and apply to every account', async () => {
  const ui = fakeElements(), memory = {}, overlays = [], commands = [], closed = [];
  const codex = { key: 'codex', name: 'Codex', run: ['codex'] };
  const work = { key: 'devkits-codex-work', name: 'Codex · Work', run: ['env', 'CODEX_HOME=/accounts/work', 'codex', '--no-daemon'] };
  const launchers = [codex, work, { key: 'claude', name: 'Claude' }];
  memory['devkits.agent-cache'] = { null: launchers };
  let target = {};
  const View = await viewFor({ ...ui, props: () => target, theme: () => ({}), spaces: () => [],
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    openOverlay: value => overlays.push(value), closeOverlay: id => closed.push(id), run: (...args) => commands.push(args) });
  const view = new View(), cx = renderContext;
  const settings = page => { target = { view: 'manage-launchers', overlay: 'settings', space: 'api', page };
    view.initSessionMenu({ ...cx, spawn() {}, timer: { every() {} } }); view.launchers = launchers; ui.nodes.clear(); view.render(cx); };
  const pick = (section, key) => { ui.nodes.get(`defaults-${section}-select`).openChange(true, cx); view.render(cx);
    ui.nodes.get(`defaults-${section}-option-${key}`).click({}, cx); view.render(cx); };
  settings('agents');
  assert.ok(['agents', 'claude', 'codex', 'rules'].every(page => ui.nodes.has(`settings-page-${page}`)));
  assert.ok(![...ui.nodes.keys()].some(id => id.startsWith('defaults-') || id.startsWith('permissions-')));
  settings('codex');
  assert.ok(ui.texts.includes('Every new Codex session uses these, whichever Codex account starts it.'));
  pick('permissions', 'read-only');
  assert.deepEqual(memory['devkits.codex-permissions'], { codex: 'read-only' });
  assert.ok(ui.textOf('defaults-permissions').includes('Read only'));
  commands.length = 0;
  target = { view: 'launcher', overlay: 'menu', space: 'api', folder: '/Code/api' }; view.startThread(codex);
  await settle();
  assert.deepEqual(commands.find(([name]) => name === 'tab.new')[1].argv,
    ['codex', '--sandbox', 'read-only', '--ask-for-approval', 'on-request']);
  // An account uses its provider's permissions.
  target = { ...target, space: null, projectName: 'New project' }; await view.startThread(work);
  assert.deepEqual(commands.find(([name]) => name === 'space.new')[1].argv,
    ['env', 'CODEX_HOME=/accounts/work', 'codex', '--sandbox', 'read-only', '--ask-for-approval', 'on-request', '--no-daemon']);
  settings('codex');
  pick('permissions', 'default');
  assert.deepEqual(memory['devkits.codex-permissions'], {});
  ui.nodes.get('settings-page-claude').click({}, cx); view.render(cx);
  assert.ok(ui.texts.includes('Every new Claude session uses these, whichever Claude account starts it.'));
  ui.nodes.get('manage-launchers-done').click();
  assert.equal(closed.at(-1), 'settings');
});
test('Codex sharing is manual, scoped to a local saved account, reports results and ignores duplicate clicks', async () => {
  const ui = fakeElements(), calls = [], notices = [], overlays = [];
  let finish, pending;
  let target = { view: 'manage-launchers', overlay: 'manage' };
  const work = { key: 'devkits-codex-work', name: 'Codex · Work', run: ['env', 'CODEX_HOME=/accounts/work', 'codex'] };
  const View = await viewFor({ ...ui, props: () => target, theme: () => ({}), spaces: () => [],
    openOverlay: value => overlays.push(value), closeOverlay() {}, notify: value => notices.push(value),
    exec: async (...args) => { calls.push(args); return new Promise(resolve => { finish = resolve; }); } });
  const view = new View(); view.launchers = [{ key: 'codex', name: 'Codex', run: ['codex'] }, work,
    { key: 'devkits-claude-work', name: 'Claude · Work', run: ['claude'] }];
  view.manageIndex = 0;
  const cx = { ...renderContext, spawn: task => {
    const before = calls.length, running = task(cx);
    // Background folder watches do not replace the helper request this test awaits.
    if (calls.length !== before) pending = running;
    return running;
  } };
  view.prepareAccountMenus(cx); view.render(cx);
  assert.deepEqual(calls, []);
  assert.ok(!ui.nodes.has('account-actions-codex-sync'));
  assert.ok(!ui.nodes.has('account-actions-devkits-claude-work-sync'));
  ui.nodes.get(`account-actions-${work.key}-sync`).click({}, cx);
  assert.deepEqual(calls, []);
  target = { ...overlays.at(-1).props, overlay: 'picker' };
  const picker = new View(); picker.init(null, cx);
  assert.deepEqual(calls, [['node', ['/herdr/mods/devkits/codex-sharing.js', '/herdr', work.key, '--list']]]);
  picker.render(cx);
  assert.ok(ui.textOf('codex-sharing').includes('Checking shared settings…'));
  finish({ code: 0, stdout: JSON.stringify({ items: [{ kind: 'plugins', key: 'one@local', label: 'One', selected: false, status: 'not-shared' },
    { kind: 'skills', key: 'Writing', label: 'Writing', selected: true, status: 'pending' }] }) });
  await pending; picker.render(cx);
  assert.ok(ui.textOf('codex-sharing').includes('Not shared'));
  assert.ok(ui.textOf('codex-sharing').includes('Update needed'));
  ui.nodes.get('share-all').change(true, cx); picker.render(cx);
  assert.ok(picker.sharingItems.every(item => item.selected));
  ui.nodes.get('share-all').change(false, cx); picker.render(cx);
  assert.ok(picker.sharingItems.every(item => !item.selected));
  ui.nodes.get('share-all').change(true, cx); picker.render(cx);
  ui.nodes.get('sharing-apply').click({}, cx);
  ui.nodes.get('sharing-apply').click({}, cx);
  picker.render(cx);
  assert.equal(ui.nodes.get('sharing-apply').disabled, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1][1][3]), { plugins: ['one@local'], skills: ['Writing'] });
  finish({ code: 0, stdout: JSON.stringify({ message: 'Synced 2 plugins. Use a new session.' }) });
  await pending;
  assert.equal(notices[0].body, 'Synced 2 plugins. Use a new session.');
  assert.equal(overlays.at(-1).props.view, 'manage-launchers');
  picker.render(cx);
  ui.nodes.get('sharing-apply').click({}, cx);
  finish({ code: 1, stdout: JSON.stringify({ error: 'Existing files were kept.' }) });
  await pending; picker.render(cx);
  assert.ok(ui.textOf('codex-sharing').includes('Existing files were kept.'));
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
test('hiding every agent keeps Settings available so the menu can be restored', async () => {
  const ui = fakeElements();
  const View = await viewFor({ ...ui, props: () => ({ view: 'launcher' }), spaces: () => [], theme: () => ({}),
    shared: () => ['terminal', 'agent:codex'] });
  const view = new View(); view.launchers = [{ key: 'codex', name: 'Codex', installed: true }]; view.render();
  assert.ok(!ui.nodes.has('new-terminal'));
  assert.ok(!ui.nodes.has('start-codex'));
  assert.ok(ui.nodes.has('manage-launchers-open'));
  assert.ok(ui.texts.includes('All agents are hidden. Use Settings to show them.'));
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
  assert.ok(ui.texts.includes('USAGE'));
  // Settings opens only from Add session.
  assert.ok(!ui.nodes.has('manage-agent-profiles'));
  ui.nodes.get('open-token-statistics').click();
  assert.equal(overlays.at(-1).props.view, 'token-statistics');
  assert.equal(overlays.at(-1).modal, false);
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
  assert.equal(view.usageLoading, false);  // Manual refresh rediscovers profiles and bypasses fresh cached results.
  const found = discovered;
  view.refreshUsage(cx, true, true); await pending;
  assert.equal(discovered, found + 1);
  assert.deepEqual(calls.at(-1), ['codex', 'work', 'claude', 'devkits-claude-me']);
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
test('status bar Files shows the editor and tree beside the thread without creating sessions; header has no file action', async () => {
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
  assert.equal(memory['devkits.right-panel'], null);
  ui.nodes.get('open-files').click();
  assert.equal(memory['devkits.right-panel'], 'files');
  assert.ok(!commands.some(([name, args]) => name === 'layout.hide' && args.id === 'editor'));
  target = {}; sidebar.render();
  assert.ok(!commands.some(([name, args]) => name === 'layout.select' && args.stack === 'workspace-view' && args.child !== 'project-empty'));
  assert.ok(!commands.some(([name]) => name === 'space.new' || name === 'tab.new' || name === 'terminal.kill'));
});
test('sidebar menus align with the right edge of each button, 8px below its row, at the current zoom', async () => {
  const ui = fakeElements(), overlays = [];
  const View = await viewFor({ ...ui, spaces: () => projects, agents: () => [], theme: () => ({}),
    settings: () => ({ zoom: 1.5 }), setAgentOrder() {}, run() {},
    openOverlay: value => overlays.push(value) });
  const view = new View(); view.init(); view.render();
  const cx = { stop_propagation() {} };
  for (const [id, width] of [['project-menu-api', 200]]) {
    const button = ui.nodes.get(id);
    button.mouseDown({ bounds: { x: 350, y: 105, width: 42, height: 42 } }, cx);
    button.click({}, cx);
    assert.deepEqual(overlays.at(-1).at, { x: 392 - width * 1.5, y: 147 + 10 * 1.5 });
  }
  assert.equal(overlays[0].props.view, 'project-menu');
});
test('only the base Codex row offers Add account, including when Codex is hidden from the launcher', async () => {
  const ui = fakeElements(), overlays = [], closed = [];
  const target = { view: 'manage-launchers', space: 'api', overlay: 'manage-dialog' };
  const View = await viewFor({ ...ui, props: () => target, spaces: () => projects,
    theme: () => ({}), shared: key => key === 'devkits.hidden-launchers' ? ['agent:codex'] : undefined,
    closeOverlay: id => closed.push(id), openOverlay: value => overlays.push(value) });
  const view = new View(); view.launchers = [{ key: 'codex', name: 'Codex' }, { key: 'devkits-codex-work', name: 'Codex · work' }];
  view.manageIndex = 0; view.prepareAccountMenus(renderContext); view.render(renderContext);
  assert.ok(ui.textOf('manage-agent:codex').includes('Add account'));
  assert.ok(!ui.textOf('manage-agent:devkits-codex-work').includes('Add account'));
  ui.nodes.get('add-codex-account').click();
  assert.deepEqual(closed, ['manage-dialog']);
  assert.equal(overlays[0].props.view, 'account-login');
  assert.equal(overlays[0].props.provider, 'codex');
  assert.equal(overlays[0].modal, true);
  assert.deepEqual(overlays[0].props.returnTo, { view: 'manage-launchers', space: 'api' });
  ui.nodes.clear(); view.launcher({});
  assert.ok(!ui.nodes.has('add-codex-account'));
});
test('the base Claude row offers Add account and Claude accounts join Your accounts', async () => {
  const ui = fakeElements(), overlays = [], memory = {};
  const target = { view: 'manage-launchers', space: 'api', overlay: 'manage-dialog' };
  const View = await viewFor({ ...ui, props: () => target, spaces: () => projects, theme: () => ({}),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    closeOverlay() {}, openOverlay: value => overlays.push(value) });
  const view = new View(); view.launchers = [{ key: 'claude', name: 'Claude' }, { key: 'devkits-claude-work', name: 'Claude · work' }];
  view.manageIndex = 0; view.prepareAccountMenus(renderContext); view.render(renderContext);
  assert.ok(ui.textOf('manage-agent:claude').includes('Add account'));
  assert.ok(ui.nodes.has('manage-section-2'));
  assert.ok(ui.nodes.has('account-actions-devkits-claude-work-rename')); assert.ok(ui.nodes.has('account-actions-devkits-claude-work-remove'));
  assert.ok(!ui.nodes.has('permissions-devkits-claude-work') && !ui.nodes.has('permissions-claude'));
  ui.nodes.get('add-claude-account').click();
  assert.equal(overlays[0].props.view, 'account-login');
  assert.equal(overlays[0].props.provider, 'claude');
});
test('each provider page of Settings chooses which of its models and efforts are offered', async () => {
  const ui = fakeElements(), memory = {};
  const launchers = [{ key: 'claude', name: 'Claude', run: ['claude'] }, { key: 'codex', name: 'Codex', run: ['codex'] }, { key: 'aider', name: 'Aider', run: ['aider'] }];
  let target = {};
  const View = await viewFor({ ...ui, props: () => target, spaces: () => projects, theme: () => ({}),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, closeOverlay() {}, openOverlay() {} });
  const view = new View(), cx = renderContext;
  const settings = page => { target = { view: 'manage-launchers', overlay: 'settings', space: 'api', page };
    view.initSessionMenu({ ...cx, spawn() {}, timer: { every() {} } }); view.launchers = launchers; ui.nodes.clear(); view.render(cx); };
  const pick = (section, key) => { ui.nodes.get(`defaults-${section}-select`).openChange(true, cx); view.render(cx);
    ui.nodes.get(`defaults-${section}-option-${key}`).click({}, cx); view.render(cx); };
  settings('agents');
  assert.ok(![...ui.nodes.keys()].some(id => id.startsWith('session-')));
  settings('claude');
  assert.ok(ui.texts.includes('MODELS AND EFFORT'));
  assert.ok(ui.nodes.has('session-claude-models-haiku') && ui.nodes.has('session-claude-efforts-max'));
  assert.ok(![...ui.nodes.keys()].some(id => id.startsWith('session-codex-')));
  ui.nodes.get('session-claude-models-haiku').change(false, cx);
  assert.deepEqual(memory['devkits.session-options'], { claude: { models: ['haiku'] } });
  ui.nodes.get('session-claude-models-haiku').change(true, cx);
  assert.deepEqual(memory['devkits.session-options'].claude.models, []);
  ui.nodes.get('drag-session-claude-sonnet').mouseDown({}, cx); view.render(cx);
  ui.nodes.get('session-claude-model-fable').mouseMove({}, cx);
  ui.nodes.get('session-claude-model-fable').mouseUp({}, cx);
  assert.deepEqual(memory['devkits.session-options'].claude.order, ['sonnet', 'fable', 'opus', 'haiku']);
  assert.equal(view.modelDrag, null);
  settings('codex');
  view.codexModelList = [{ key: 'gpt-6-luna', label: 'GPT-6 Luna', efforts: ['low', 'high'] }]; view.render(cx);
  assert.ok(ui.nodes.has('session-codex-models-gpt-6-luna') && !ui.nodes.has('session-claude-models-haiku'));
  ui.nodes.get('session-codex-efforts-low').change(false, cx);
  assert.deepEqual(memory['devkits.session-options'].codex, { efforts: ['low'] });
});
test('a provider default model and effort apply to every account of it unless a session chooses its own', async () => {
  const ui = fakeElements(), memory = {}, commands = [];
  const claude = { key: 'claude', name: 'Claude', run: ['claude'] };
  const work = { key: 'devkits-claude-work', name: 'Claude · work', run: ['env', 'CLAUDE_CONFIG_DIR=/work', 'claude'] };
  const codex = { key: 'devkits-codex-work', name: 'Codex · work', run: ['env', 'CODEX_HOME=/work', 'codex'] };
  const launchers = [claude, work, codex];
  let target = {};
  const View = await viewFor({ ...ui, props: () => target, spaces: () => projects, theme: () => ({}),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, closeOverlay() {}, openOverlay() {},
    run: (...args) => commands.push(args), notify: error => assert.fail(error.body) });
  const view = new View(), cx = renderContext;
  const settings = page => { target = { view: 'manage-launchers', overlay: 'settings', space: 'api', page };
    view.initSessionMenu({ ...cx, spawn() {}, timer: { every() {} } }); view.launchers = launchers; ui.nodes.clear(); view.render(cx); };
  const pick = (section, key) => { ui.nodes.get(`defaults-${section}-select`).openChange(true, cx); view.render(cx);
    ui.nodes.get(`defaults-${section}-option-${key}`).click({}, cx); view.render(cx); };
  settings('claude');
  pick('model', 'opus');
  pick('effort', 'high');
  assert.deepEqual(memory['devkits.profile-sessions'], { claude: { model: 'opus', effort: 'high' } });
  const space = { space: 'api', folder: '/Code/api' };
  await view.startThread(work, space);
  assert.deepEqual(commands.at(-1)[1].argv, ['env', 'CLAUDE_CONFIG_DIR=/work', 'claude', '--model', 'opus', '--effort', 'high']);
  await view.startThread(claude, space, { model: 'sonnet' });
  assert.deepEqual(commands.at(-1)[1].argv, ['claude', '--model', 'sonnet', '--effort', 'high']);
  await view.startThread(claude, space, { model: 'sonnet', effort: null });
  assert.deepEqual(commands.at(-1)[1].argv, ['claude', '--model', 'sonnet']);
  memory['devkits.profile-sessions'].codex = { model: 'a', effort: 'high' };
  memory['devkits.session-options'] = { codex: { models: ['a'] } };
  settings('codex');
  view.codexModelList = [{ key: 'a', label: 'A', efforts: ['high'] }, { key: 'b', label: 'B', efforts: ['low'] }]; view.render(cx);
  // A model hidden below is no longer offered, and the default falls back to Default.
  assert.ok(ui.textOf('defaults-model').includes('Default'));
  ui.nodes.get('defaults-model-select').openChange(true, cx); view.render(cx);
  assert.ok(!ui.nodes.has('defaults-model-option-a'));
  ui.nodes.get('defaults-model-option-b').click({}, cx);
  assert.deepEqual(memory['devkits.profile-sessions'].codex, { model: 'b', effort: null });
  await view.startThread(codex, space);
  assert.deepEqual(commands.at(-1)[1].argv, ['env', 'CODEX_HOME=/work', 'codex', '-m', 'b']);
  view.render(cx); pick('model', 'default');
  await view.startThread(codex, space);
  assert.deepEqual(commands.at(-1)[1].argv, codex.run);
});

test('settings saved per account move once to their provider, keeping the provider and the first set value', () => {
  assert.deepEqual(rootSettings({ 'devkits-codex-a': 'danger-full-access', 'devkits-codex-b': 'read-only', 'devkits-claude-c': 'bypassPermissions', pi: 'x' }),
    { codex: 'danger-full-access', claude: 'bypassPermissions', pi: 'x' });
  assert.deepEqual(rootSettings({ codex: 'read-only', 'devkits-codex-a': 'danger-full-access' }), { codex: 'read-only' });
  const merge = (kept = {}, value = {}) => ({ model: kept.model ?? value.model ?? null, effort: kept.effort ?? value.effort ?? null });
  assert.deepEqual(rootSettings({ 'devkits-codex-a': { model: null, effort: 'low' }, 'devkits-codex-b': { model: 'gpt', effort: 'high' } }, merge),
    { codex: { model: 'gpt', effort: 'low' } });
  const untouched = { codex: 'read-only' };
  assert.equal(rootSettings(untouched), untouched);
});
test('local account profiles and their login action stay out of remote project menus', async () => {
  const ui = fakeElements(); let pending;
  const View = await viewFor({ ...ui, props: () => ({ view: 'manage-launchers', space: 'remote' }),
    spaces: () => [{ id: 'remote', machine: 'server' }], theme: () => ({}), knownAgents: async () => [
      { key: 'devkits-codex-work', installed: true }, { key: 'codex', name: 'Codex', installed: true },
    ] });
  const cx = { notify() {}, focus_handle: () => ({ focus() {} }), spawn(task) { pending ??= task(cx); }, timer: { every() {} } };
  const view = new View(); view.init({}, cx); await pending; view.render(renderContext);
  assert.deepEqual(view.launchers.map(agent => agent.key), ['codex']);
  // A remote project's Settings has no Claude or Codex page; their defaults and models are local.
  assert.ok(!ui.nodes.has('settings-page-codex') && ui.nodes.has('settings-page-agents') && ui.nodes.has('settings-page-rules'));
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
test('pane header uses the sidebar thread title without split or close controls', async () => {
  const ui = fakeElements();
  const View = await viewFor({ ...ui, props: () => ({ pane: 'pane-1' }),
    spaces: () => projects, agents: () => agents,
    panes: () => [{ pane: 'pane-1', tab: 'tab-1', cwd: '/Code/project', program: { name: 'Codex', icon: 'icons/codex.svg', tint: false } }] });
  const view = new View(), opened = [];
  view.newThread = (...args) => opened.push(args);
  view.paneHeader({});
  ui.nodes.get('new-thread-pane-1').click({}, { stop_propagation() {} });
  assert.equal(opened.length, 1);
  assert.equal(opened[0][1], 'app');
  assert.ok(ui.texts.includes(projectGroups(projects, agents)[1].threads.find(thread => thread.tab.id === 'tab-1').title));
  assert.ok(!ui.texts.includes('/Code/project'));
  assert.ok(!ui.texts.includes('Codex'));
  for (const name of ['split-right', 'split-down', 'zoom', 'close']) assert.ok(!ui.nodes.has(`${name}-pane-1`));
});
test('thread maximize restores panels and exits when opening workspace controls', async () => {
  const ui = fakeElements(), commands = [], memory = {};
  const root = { children: [
    { id: 'workspace-view', hidden: false, size: { weight: 1 } },
    { id: 'editor', hidden: false, size: { px: 630 } },
    { id: 'simulator', hidden: false, size: { px: 400 } },
  ] };
  const View = await viewFor({ ...ui, spaces: () => projects, agents: () => agents,
    props: () => ({ pane: 'p1' }), layout: () => root,
    panes: () => [{ pane: 'p1', tab: 'tab-0' }],
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run: (name, args) => {
      commands.push([name, args]);
      const node = root.children.find(node => node.id === args?.id);
      if (node && ['layout.show', 'layout.hide'].includes(name)) node.hidden = name === 'layout.hide';
    } });
  const view = new View();
  const clickMaximize = () => { view.paneHeader({}); ui.nodes.get('maximize-thread-p1').click({}, renderContext); };
  clickMaximize();
  assert.ok(root.children.slice(1).every(node => node.hidden));
  view.paneHeader({}); assert.ok(ui.assets.includes('mods/devkits/assets/icons/minimize.svg'));
  clickMaximize();
  assert.ok(root.children.slice(1).every(node => !node.hidden));
  assert.deepEqual(root.children[1].size, { px: 630 });
  for (const control of ['open-files', 'open-diff', 'open-simulator', 'open-conversation', 'open-tasks']) {
    memory['devkits.conversation-visible'] = { '["","/Code/api"]': true };
    memory['devkits.right-panel'] = 'files';
    clickMaximize(); view.statusBar({}); ui.nodes.get(control).click();
    assert.equal(memory['devkits.conversation-maximized'], null, control);
    assert.equal(root.children[1].hidden, false, control);
    if (control === 'open-files') assert.equal(memory['devkits.right-panel'], 'files');
    if (control === 'open-simulator') assert.equal(root.children[2].hidden, false);
  }
  assert.ok(!commands.some(([name]) => ['tab.close', 'pane.close', 'terminal.kill', 'pane.zoom'].includes(name)));
});
test('a linked Asana thread returns to its task in Tasks rather than opening another Asana panel', async () => {
  const ui = fakeElements(), commands = [], overlays = [], memory = { 'devkits.thread-tasks': { 'tab-1': { gid: 't1', name: 'Fix login', folder: '/Code/app' } } };
  const View = await viewFor({ ...ui, props: () => ({ pane: 'pane-1' }), spaces: () => projects, agents: () => agents,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, run: (...args) => commands.push(args),
    openOverlay: spec => overlays.push(spec), panes: () => [{ pane: 'pane-1', tab: 'tab-1', program: { name: 'Codex' } }, { pane: 'pane-2', tab: 'tab-3', program: { name: 'Codex' } }] });
  new View().paneHeader({});
  ui.nodes.get('asana-link-tab-1').click({}, { stop_propagation() {} });
  assert.equal(memory['devkits.board-project'], 'app');
  assert.equal(memory['devkits.board-focus'], 't1');
  assert.deepEqual(overlays, []);
  assert.ok(!ui.nodes.has('asana-link-tab-3'));
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
    { pending: [pending[2]], profiles: { 'tab-9': 'codex', 'tab-new': 'claude' }, tasks: {} });
  const task = { gid: 't1', name: 'Fix login', folder: '/Code/app' };
  assert.deepEqual(resolveThreadProfiles(spaces, [{ ...pending[0], task }], {}, 2000, { old: task }).tasks, { old: task, 'tab-9': task });
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
  await settle();
  assert.deepEqual(commands.find(([name]) => name === 'tab.new'), ['tab.new', { space: 'api', folder: '/Code/project name', name: 'Codex', argv: ['codex', '--profile', 'work'] }]);
  assert.deepEqual(closed, ['popup']);
});
test('Codex account sessions start immediately with existing plugins and no synchronization', async () => {
  const commands = [], closed = [], ui = fakeElements();
  const View = await viewFor({ ...ui, spaces: () => [], run: (...args) => commands.push(args),
    shared: key => key === 'devkits.plugin-syncs' ? { '/account': 1 } : undefined,
    closeOverlay: id => closed.push(id), notify: error => assert.fail(error.body),
    exec: () => assert.fail('Starting a session must not run a plugin helper') });
  const view = new View();
  const pending = view.startThread({ key: 'devkits-codex-work', name: 'Work',
    run: ['env', 'CODEX_HOME=/account', 'codex'] }, { space: 'one', folder: '/project', overlay: 'launcher' });
  assert.deepEqual(closed, []);
  await settle();
  assert.deepEqual(commands.find(([name]) => name === 'tab.new'), ['tab.new', {
    space: 'one', folder: '/project', name: 'Work', argv: ['env', 'CODEX_HOME=/account', 'codex'],
  }]);
  await pending;
  assert.deepEqual(closed, ['launcher']);
  view.statusBar({});
  assert.equal(ui.nodes.has('plugin-sync-progress'), false);
});

test('the launcher stays alive until rules are read and suppresses duplicate starts', async () => {
  for (const key of ['codex', 'claude']) {
    const commands = [], closed = [];
    let finishRead;
    const View = await viewFor({ spaces: () => [], run: (...args) => commands.push(args),
      closeOverlay: id => closed.push(id),
      readTextFile: () => new Promise(resolve => { finishRead = resolve; }) });
    const view = new View(), agent = { key, name: key, run: [key] };
    const target = { space: 'one', folder: '/project', overlay: 'launcher' };
    const pending = view.startThread(agent, target);
    await view.startThread(agent, target);
    assert.deepEqual(closed, []);
    assert.deepEqual(commands, []);
    finishRead('Use hc run.');
    await pending;
    assert.deepEqual(closed, ['launcher']);
    const starts = commands.filter(([name]) => name === 'tab.new');
    assert.equal(starts.length, 1);
    assert.ok(starts[0][1].argv.includes(key === 'codex' ? 'developer_instructions="Use hc run."' : '--append-system-prompt-file'));
  }
});

test('Asana import opens from Tasks and stays bound to its originating project', async () => {
  const overlays = [], memory = {}, project = { id: 'one', name: 'One', folder: '/Code/one', active: true, tabs: [] };
  const View = await viewFor({ spaces: () => [project], openOverlay: spec => overlays.push(spec),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
  const view = new View(); view.agentBoard = { render: (_p, _a, _l, actions) => actions };
  view.boardPanel(project, {}).asana();
  assert.equal(overlays[0].kind, 'dialog'); assert.equal(overlays[0].modal, true);
  assert.equal(overlays[0].props.project.folder, '/Code/one');
});
test('starting a task from Tasks names the thread, adds the model, effort and task prompt, without a bookmark step', async () => {
  const ui = fakeElements(), commands = [];
  const View = await viewFor({ ...ui, props: () => ({}), theme: () => ({}), spaces: () => projects,
    taskPrompt: task => `prompt:${task.name}`, run: (...args) => commands.push(args),
    closeOverlay: () => assert.fail('no overlay to close'), notify: error => assert.fail(error.body) });
  const view = new View();
  view.startThread({ key: 'claude', name: 'Claude', run: ['claude'] }, { space: 'api', folder: '/Code/api', projectName: 'API', task: { gid: 't1', name: 'Fix login' } },
    { model: 'opus', effort: 'max' });
  await settle();
  assert.deepEqual(commands.find(([name]) => name === 'tab.new'),
    ['tab.new', { space: 'api', folder: '/Code/api', name: 'Fix login', argv: ['claude', '--model', 'opus', '--effort', 'max', 'prompt:Fix login'] }]);
});
test('project menus have no separate Asana entry; Tasks remains available in the status bar', async () => {
  const ui = fakeElements();
  const project = { id: 'one', name: 'One', folder: '/Code/one', active: true, tabs: [] };
  let target = { view: 'project-menu', overlay: 'menu', project };
  const View = await viewFor({ ...ui, props: () => target, spaces: () => [project], theme: () => ({}) });
  for (const machine of [null, 'vps']) {
    ui.nodes.clear(); target = { view: 'project-menu', overlay: 'menu', project: { ...project, machine } };
    const view = new View(); view.handle = { focus() {} }; view.render();
    assert.ok(!ui.nodes.has('menu-asana-tasks')); assert.ok(ui.nodes.has('menu-close-project'));
  }
  target = { view: 'status' }; new View().render();
  assert.ok(ui.nodes.has('open-tasks')); assert.ok(!ui.nodes.has('open-asana'));
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
  await settle();
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
  assert.ok(!ui.nodes.has('settings'));
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
  assert.equal(bar.children[0], nodes.get('archived-threads').element);
  assert.ok(!nodes.has('settings'));
  assert.ok(!nodes.has('toggle-sidebar'));
  assert.ok(!nodes.has('show-sidebar'));
  assert.ok(!nodes.has('open-project'));
  const cx = { notify() {} };
  nodes.get('project-api').click({}, cx); assert.ok(view.folded.has('api'));
  nodes.get('project-api').click({ modifiers: { platform: true } }, cx);
  assert.ok(commands.some(([name, args]) => name === 'space.select' && args.id === 'api'));
  nodes.get('thread-shell').click();
  assert.ok(commands.some(([name, args]) => name === 'tab.select' && args.id === 'shell'));
  assert.deepEqual(commands.at(-1), ['layout.show', { id: 'workspace-view' }]);
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
  // The thread, then the editor (Files or Changes, each with its list at the right), then the simulator at the window's edge.
  const row = layout.children[1].children[1], [stack, editor, simulator] = row.children;
  assert.equal(stack.id, 'workspace-view');
  assert.ok(!stack.children.some(child => ['files', 'diff'].includes(child.id)));
  assert.equal(editor.id, 'editor');
  assert.equal(editor.hidden, false);
  assert.equal(stack.hidden, true);
  assert.equal(editor.type, 'block');
  assert.equal(editor.content.props.view, 'editor');
  assert.equal(simulator.id, 'simulator');
  assert.equal(simulator.hidden, true);
  assert.equal(simulator.content.mod, 'devkits-simulator');
  assert.equal(simulator.content.props.view, 'simulator');
  for (const name of ['mod.json', 'main.js', 'simulator.js', 'components/button.js', 'components/dropdown-menu.js'])
    assert.equal(await readFile(join(home, 'mods', 'devkits-simulator', name), 'utf8'),
      await readFile(new URL(`../mods/devkits-simulator/${name}`, import.meta.url), 'utf8'));
  assert.ok(!(await readdir(mod)).includes('simulator.js'));
  // Herdr docks a folder without place "none" into the shown layout.
  assert.equal(JSON.parse(await readFile(join(home, 'mods', 'devkits-sim-frames', 'mod.json'), 'utf8')).place, 'none');
  assert.equal(await readFile(join(home, 'mods', 'devkits-sim-frames', 'main.js'), 'utf8'),
    await readFile(new URL('../mods/devkits-sim-frames/main.js', import.meta.url), 'utf8'));
  assert.equal(stack.children.find(node => node.id === 'main').content.tab, 'active');
  assert.deepEqual((await readdir(home)).sort(), ['keys.json', 'layouts', 'mods', 'themes']);
  for (const name of Object.values(layout.theme)) {
    const theme = JSON.parse(await readFile(join(home, 'themes', `${name}.json`), 'utf8'));
    assert.equal(theme.ansi.length, 16);
    assert.ok(Object.values(theme.colors).every(color => /^#[0-9a-f]{6}$/i.test(color)));
  }
  assert.deepEqual(JSON.parse(await readFile(join(home, 'keys.json'), 'utf8')), { 'layout:devkits': { f5: 'devkits.run', 'cmd-n': 'devkits.new-thread', 'cmd-w': 'devkits.close-file' } });
  const before = await readFile(join(home, 'mods', 'devkits', 'main.js'), 'utf8');
  await assert.rejects(install(home), /Refusing to overwrite/);
  assert.equal(await readFile(join(home, 'mods', 'devkits', 'main.js'), 'utf8'), before);
});

test('installer keeps the person\'s keys and an F5 they already bound', async t => {
  const home = await mkdtemp(join(tmpdir(), 'devkits-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const keys = { global: { 'cmd-t': 'tab.new' }, 'layout:devkits': { f5: 'app.help', 'cmd-n': 'custom.action', 'cmd-w': 'custom.close' } };
  await writeFile(join(home, 'keys.json'), JSON.stringify(keys));
  await install(home);
  assert.deepEqual(JSON.parse(await readFile(join(home, 'keys.json'), 'utf8')), keys);
});

test('status bar toggles the simulator panel, with a selected background while it shows', async () => {
  const ui = fakeElements(), commands = [], colors = { selected: 'selected', background: 'background' };
  const simulator = { id: 'simulator', hidden: false };
  let root = { id: 'root', children: [{ id: 'work', children: [simulator] }] };
  const host = platform => ({ ...ui, spaces: () => [], window: () => ({ platform }), layout: () => root,
    run: (...args) => commands.push(args) });
  let View = await viewFor(host('macos'));
  new View().statusBar(colors);
  assert.equal(ui.nodes.get('open-simulator').background, 'selected');
  ui.nodes.get('open-simulator').click();
  assert.deepEqual(commands, [['layout.toggle', { id: 'simulator' }]]);
  simulator.hidden = true; ui.nodes.clear();
  new View().statusBar(colors);
  assert.equal(ui.nodes.get('open-simulator').background, 'background');
  // A layout without the simulator block leaves the panel out, and its button with it.
  root = { id: 'root', children: [] }; ui.nodes.clear();
  new View().statusBar(colors);
  assert.ok(!ui.nodes.has('open-simulator'));
  root = { id: 'root', children: [simulator] }; ui.nodes.clear();
  View = await viewFor(host('windows'));
  new View().statusBar(colors);
  assert.ok(ui.nodes.has('open-simulator'));
});

test('mods that use devkits components carry copies equal to the source', async () => {
  assert.deepEqual((await syncShared({ check: true })).bad, []);
});

const claudeTerminal = { argv: ['/bin/zsh', '-lic', '"$@"; exec "$0" -li', '/bin/zsh', 'env', 'CLAUDE_CONFIG_DIR=/acct', 'claude', '--permission-mode', 'bypassPermissions'],
  cwd: '/Code/api', foreground: { pid: 42 } };
const claudeAgent = { address: 't1', app: 'claude-code', program: { icon: 'icons/claude.svg', tint: false } };
const claudeThread = { space: 'api', tab: { id: 'tab-0' }, title: 'Fix login', agent: claudeAgent,
  agents: [{ address: 'child', app: 'claude-code' }, claudeAgent] };

test('archived sessions resume with the same account and flags, without resending a task prompt', () => {
  const command = agentCommand(claudeTerminal.argv);
  assert.deepEqual(command, claudeTerminal.argv.slice(4));
  assert.equal(commandKind(command), 'claude');
  assert.deepEqual(resumeArgv(command, 'abc'), [...command, '--resume', 'abc']);
  assert.deepEqual(resumeArgv([...command, 'Task prompt'], 'abc', true), [...command, '--resume', 'abc']);
  const codex = ['env', 'CODEX_HOME=/c', 'codex', '-m', 'gpt', '--sandbox', 'read-only'];
  assert.equal(commandKind(codex), 'codex');
  assert.deepEqual(resumeArgv(codex, 'id'), ['env', 'CODEX_HOME=/c', 'codex', 'resume', '-m', 'gpt', '--sandbox', 'read-only', 'id']);
  assert.equal(agentCommand(['/bin/zsh', '-li']), null);
  assert.equal(codexSessionId('p1\nn/c/sessions/2026/11/07/rollout-2026-11-07T02-20-27-01a1b217-3369-7e92-bee6-1a5e5a262e73.jsonl\n'),
    '01a1b217-3369-7e92-bee6-1a5e5a262e73');
  assert.equal(codexSessionId('n/dev/null'), null);
  assert.ok(archivable(claudeThread));
  assert.ok(!archivable({ ...claudeThread, space: 'remote/api' }));
  assert.ok(!archivable({ ...claudeThread, agents: [] }));
  // Codex sub-agents keep later rollouts open in the same process; the thread's own is the earliest.
  assert.equal(codexSessionId('n/s/rollout-2026-11-07T05-00-00-22222222-2222-2222-2222-222222222222.jsonl\nn/s/rollout-2026-11-07T02-20-27-11111111-1111-1111-1111-111111111111.jsonl'),
    '11111111-1111-1111-1111-111111111111');
  assert.equal(archivedAge(0, 90 * 60000), '1h');
});

test('archiving a Claude thread keeps its conversation, then ends the tab', async () => {
  const commands = [], memory = { 'devkits.thread-profiles': { 'tab-0': 'devkits-claude-work' } }, reads = [];
  const View = await viewFor({ spaces: () => projects, shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run: (...args) => commands.push(args), hc: async ([, address]) => ({ code: 0, stdout: JSON.stringify(address === 'child'
      ? { argv: ['sh', '-c', 'bun run ios'], parent: 't1', foreground: { pid: 7 } } : claudeTerminal) }),
    readTextFile: async path => { reads.push(path); return JSON.stringify({ sessionId: 'abc' }); }, exec: async () => ({ code: 0 }) });
  await new View().archiveThread(claudeThread);
  assert.deepEqual(reads, ['/acct/sessions/42.json']);
  const [entry] = memory['devkits.archived-threads'];
  assert.equal(entry.id, 'claude:abc');
  assert.equal(entry.title, 'Fix login');
  assert.equal(entry.folder, '/Code/api');
  assert.equal(entry.profile, 'devkits-claude-work');
  assert.deepEqual(entry.argv, [...claudeTerminal.argv.slice(4), '--resume', 'abc']);
  assert.deepEqual(commands, [['tab.close', { id: 'tab-0' }]]);
});

test('a Codex launched inside Terminal shows Close immediately, including after recreating the view', async () => {
  const commands = [], ui = fakeElements();
  const agent = { ...claudeAgent, app: 'codex' };
  const thread = { ...claudeThread, agent, agents: [agent] };
  const terminal = { address: agent.address, argv: ['/bin/zsh', '-l'], foreground: { argv: ['codex'], pid: 42 } };
  const View = await viewFor({ ...ui, terminals: () => [terminal], run: (...args) => commands.push(args),
    hc: () => assert.fail('A terminal must close without an archive lookup') });
  for (let i = 0; i < 2; i++) {
    ui.nodes.clear();
    new View().threadRow(thread, {});
    assert.ok(ui.nodes.has('close-thread-tab-0'));
    assert.ok(!ui.nodes.has('archive-thread-tab-0'));
  }
  ui.nodes.get('close-thread-tab-0').click({}, { stop_propagation() {} });
  assert.deepEqual(commands, [['tab.close', { id: 'tab-0' }]]);
  commands.length = 0;
  await new View().archiveThread(thread);
  assert.deepEqual(commands, [['tab.close', { id: 'tab-0' }]]);
  assert.ok(!archivable(thread, [terminal]));
  assert.ok(!archivable(thread, [{ ...terminal, argv: ['env', 'SHELL=/bin/zsh', '/bin/zsh', '-l'] }]));
  assert.ok(archivable(thread, [{ ...terminal, argv: ['codex'] }]));
});

test('threads without agent status follow their primary pane program in the sidebar and title bar', async () => {
  const ui = fakeElements();
  const thread = { space: 'api', tab: { id: 'tab-0' }, title: 'Run app', agents: [] };
  const primary = { pane: 'p-bun', terminal: 't-bun', tab: 'tab-0' };
  const peer = { pane: 'p-peer', terminal: 't-peer', tab: 'tab-0', focused: true,
    program: { icon: 'icons/node.svg', tint: false } };
  const View = await viewFor({ ...ui, props: () => ({ pane: primary.pane }),
    spaces: () => projects, agents: () => [], panes: () => [primary, peer] });
  const view = new View();
  for (const program of [{ icon: 'icons/bun.svg', tint: false },
    { icon: 'icons/bun.svg', tint: true }, { icon: null, shell: true }]) {
    primary.program = program;
    for (const render of [() => view.threadRow(thread, {}), () => view.paneHeader({})]) {
      ui.assets.length = 0;
      render();
      assert.ok(ui.assets.includes(program.icon || 'mods/devkits/assets/icons/terminal.svg'));
      assert.ok(!ui.assets.includes(peer.program.icon));
    }
  }
});

test('Terminal-launched agents keep the terminal icon in the sidebar and pane header', async () => {
  for (const app of ['codex', 'claude-code']) {
    const ui = fakeElements(), program = { icon: `icons/${app}.svg`, tint: false };
    const agent = { address: 't1', app, space: 'api', tab: 'tab-0', program };
    const thread = { space: 'api', tab: { id: 'tab-0' }, title: 'Task', agent, agents: [agent] };
    let argv = ['/bin/zsh', '-l'];
    const View = await viewFor({ ...ui, props: () => ({ pane: 'pane-1' }),
      spaces: () => projects, agents: () => [agent],
      terminals: () => [{ address: 't1', argv }],
      panes: () => [{ pane: 'pane-1', tab: 'tab-0', program }] });
    for (const render of [view => view.threadRow(thread, {}), view => view.paneHeader({})]) {
      ui.assets.length = 0;
      render(new View());
      assert.ok(ui.assets.includes('mods/devkits/assets/icons/terminal.svg'));
      assert.ok(!ui.assets.includes(program.icon));
    }
    argv = [app === 'codex' ? 'codex' : 'claude'];
    for (const render of [view => view.threadRow(thread, {}), view => view.paneHeader({})]) {
      ui.assets.length = 0;
      render(new View());
      assert.ok(ui.assets.includes(program.icon));
    }
  }
});

test('Codex without a readable rollout offers Close and only ends on the next click', async () => {
  const commands = [], notes = [], ui = fakeElements();
  const View = await viewFor({ ...ui, spaces: () => projects, run: (...args) => commands.push(args),
    notify: note => notes.push(note), setShared: () => assert.fail('Must not save an unknown session'),
    hc: async () => ({ code: 0, stdout: JSON.stringify({ argv: ['codex'],
      foreground: { pid: 42, argv: ['codex'] } }) }), exec: async () => ({ code: 0, stdout: 'n/state_5.sqlite\n' }) });
  const agent = { ...claudeAgent, app: 'codex' };
  const view = new View(), thread = { ...claudeThread, agent, agents: [agent] };
  let pending, redraws = 0;
  const cx = { stop_propagation() {}, notify() { redraws++; }, spawn(task) { pending = task(cx); } };
  view.threadRow(thread, {});
  ui.nodes.get('archive-thread-tab-0').click({}, cx);
  await pending;
  assert.deepEqual(commands, []);
  assert.match(notes[0].body, /Use Close thread/);
  assert.equal(redraws, 1);
  ui.nodes.clear(); view.threadRow(thread, {});
  assert.ok(!ui.nodes.has('archive-thread-tab-0'));
  ui.nodes.get('close-thread-tab-0').click({}, cx);
  assert.deepEqual(commands, [['tab.close', { id: 'tab-0' }]]);
});

test('a session without a conversation closes without an archive entry; an unreadable one stays open', async () => {
  const commands = [], memory = {}, notes = [];
  const host = { spaces: () => projects, shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run: (...args) => commands.push(args), notify: note => notes.push(note), readTextFile: async () => JSON.stringify({ sessionId: 'new' }),
    hc: async () => ({ code: 0, stdout: JSON.stringify(claudeTerminal) }), exec: async () => ({ code: 1, stdout: '' }) };
  await new (await viewFor(host))().archiveThread(claudeThread);
  assert.equal(memory['devkits.archived-threads'], undefined);
  assert.deepEqual(commands, [['tab.close', { id: 'tab-0' }]]);
  commands.length = 0;
  await new (await viewFor({ ...host, hc: async () => ({ code: 1, stderr: 'gone' }) }))().archiveThread(claudeThread);
  assert.deepEqual(commands, []);
  assert.equal(notes[0].body, 'gone');
  await new (await viewFor({ ...host, hc: async () => ({ code: 0, stdout: JSON.stringify({ argv: ['sh'], parent: 't1' }) }) }))()
    .archiveThread(claudeThread);
  assert.deepEqual(commands, []);
  assert.match(notes[1].body, /Could not find/);
});

test('restoring an archived thread resumes it in its project and leaves the archive', async () => {
  const commands = [], entry = { id: 'claude:abc', title: 'Fix login', folder: '/Code/api', projectName: 'API',
    profile: 'devkits-claude-work', argv: ['claude', '--resume', 'abc'], task: null, at: 0 };
  const memory = { 'devkits.archived-threads': [entry, { ...entry, id: 'other' }] };
  const ui = fakeElements();
  const View = await viewFor({ ...ui, spaces: () => projects, shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run: (...args) => commands.push(args) });
  const view = new View();
  view.archiveOpen = true;
  view.archiveList({});
  view.hoveredArchived = 'other';
  view.archiveList({});
  ui.nodes.get('remove-archived-other').click({}, { stop_propagation() {} });
  assert.deepEqual(memory['devkits.archived-threads'].map(item => item.id), ['claude:abc']);
  ui.nodes.get('archived-claude:abc').click();
  assert.deepEqual(memory['devkits.archived-threads'], []);
  assert.equal(view.archiveOpen, false);
  assert.deepEqual(commands.at(-1), ['tab.new', { space: 'api', folder: '/Code/api', name: 'Fix login', argv: ['claude', '--resume', 'abc'] }]);
  assert.equal(memory['devkits.pending-profiles'][0].key, 'devkits-claude-work');
});

test('Claude and Codex threads show an archive button; terminals keep a close button', async () => {
  const ui = fakeElements();
  const View = await viewFor(ui);
  const view = new View();
  view.threadRow(claudeThread, {});
  view.threadRow({ space: 'api', tab: { id: 'run' }, agents: [], title: 'Run app' }, {});
  assert.ok(ui.nodes.has('archive-thread-tab-0') && !ui.nodes.has('close-thread-tab-0'));
  assert.ok(ui.nodes.has('close-thread-run') && !ui.nodes.has('archive-thread-run'));
});

test('global rules join Claude and Codex system prompts in local sessions only', async () => {
  const claude = { key: 'devkits-claude-work', run: ['env', 'CLAUDE_CONFIG_DIR=/a', 'claude', '--permission-mode', 'plan'] };
  const codex = { key: 'codex', run: ['codex', '-m', 'gpt'] };
  const rules = { file: '/herdr/data/devkits/AGENTS.md', text: 'Use "hc run".\nAlways.' };
  assert.deepEqual(rulesArgv(claude, claude.run, rules),
    ['env', 'CLAUDE_CONFIG_DIR=/a', 'claude', '--append-system-prompt-file', rules.file, '--permission-mode', 'plan']);
  assert.deepEqual(rulesArgv(codex, codex.run, rules), ['codex', '-c', 'developer_instructions="Use \\"hc run\\".\\nAlways."', '-m', 'gpt']);
  assert.deepEqual(rulesArgv(codex, codex.run, null), codex.run);
  assert.deepEqual(rulesArgv({ key: 'aider', run: ['aider'] }, ['aider'], rules), ['aider']);
  for (const [machine, text, expected] of [[null, 'Rules', true], ['linux-server', 'Rules', false], [null, '  \n', false]]) {
    const commands = [];
    const View = await viewFor({ spaces: () => [{ id: 'api', machine, tabs: [] }], run: (...args) => commands.push(args),
      readTextFile: async path => path === '/herdr/data/devkits/AGENTS.md' ? text : null });
    await new View().launchThread(claude, { space: 'api', folder: '/Code/api' }, {});
    const argv = commands.find(([name]) => name === 'tab.new')[1].argv;
    assert.equal(argv.includes('--append-system-prompt-file'), expected);
  }
});

test('terminals an agent started sit under its thread, peek when clicked and end from their close button', async () => {
  const live = [
    { address: 't9', parent: 't1', state: 'live', argv: ['sh', '-c', 'emulator -avd Pixel'] },
    { address: 't8', parent: 't1', state: 'live', name: 'run-ios', status: 'working' },
    { address: 't7', parent: 't8', state: 'live', argv: ['node', 'server.js'] },
    { address: 't6', parent: 't1', state: 'finished', name: 'old' },
    { address: 't5', parent: 't2', state: 'live', name: 'other-thread' },
  ];
  assert.deepEqual(childTerminals(live, ['t1']).map(child => [child.terminal.address, child.depth, child.label]),
    [['t9', 1, 'emulator -avd Pixel'], ['t8', 1, 'run-ios'], ['t7', 2, 'node server.js']]);
  assert.equal(terminalLabel({ address: 't3', agent: 'zsh' }), 'zsh');
  const ui = fakeElements(), commands = [], memory = {};
  const View = await viewFor({ ...ui, props: () => ({}), theme: () => ({}), agents: () => [agents[0]], spaces: () => projects, terminals: () => live,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, run: (...args) => commands.push(args), setAgentOrder() {} });
  const view = new View(); view.folded = new Set(); view.render();
  assert.ok(ui.nodes.has('child-t9') && ui.nodes.has('child-t7') && !ui.nodes.has('child-t6') && !ui.nodes.has('child-t5'));
  commands.length = 0;
  ui.nodes.get('end-child-t9').click({}, { stop_propagation() {} });
  assert.deepEqual(commands, [['terminal.kill', { terminal: 't9' }]]);
  commands.length = 0;
  ui.nodes.get('child-t8').click();
  assert.ok(commands.some(([name, args]) => name === 'tab.select' && args.id === 'tab-0'));
  assert.deepEqual(commands.at(-1), ['terminal.peek', { terminal: 't8' }]);
});

test('dock buttons preserve the central editor and change only the right panel', async () => {
  const ui = fakeElements(), commands = [], memory = { 'devkits.editor-kind': 'files' };
  const editor = { id: 'editor', hidden: false };
  const View = await viewFor({ ...ui, props: () => ({ view: 'status' }), theme: () => ({ selected: 'sel', background: 'bg' }), spaces: () => projects,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    layout: () => ({ children: [editor] }), run: (...args) => commands.push(args) });
  const status = new View();
  status.render(); ui.nodes.get('open-diff').click();
  assert.equal(memory['devkits.right-panel'], 'diff');
  assert.equal(memory['devkits.editor-kind'], 'files');
  status.render(); assert.equal(ui.nodes.get('open-diff').background, 'sel');
  ui.nodes.get('open-diff').click(); assert.equal(memory['devkits.right-panel'], null);
  status.render(); ui.nodes.get('open-files').click(); assert.equal(memory['devkits.right-panel'], 'files');
  assert.equal(editor.hidden, false);
  assert.deepEqual(commands, []);
});

test('the header shows the branch beside the project; the status bar names only a remote machine', async () => {
  const ui = fakeElements(), commands = [];
  let target = { view: 'header' }, machine = null;
  const space = () => ({ ...projects[0], branch: 'feature/login', machine });
  const View = await viewFor({ ...ui, props: () => target, spaces: () => [space(), projects[1]], theme: () => ({}),
    settings: () => ({ zoom: 1 }), layout: () => ({ children: [] }), run: (...args) => commands.push(args) });
  new View().render();
  assert.ok(ui.texts.includes('feature/login'));
  assert.ok(!ui.nodes.has('settings'));
  target = { view: 'status' }; ui.texts.length = 0;
  new View().render();
  ui.nodes.get('settings').click();
  assert.deepEqual(commands, [['app.settings']]);
  assert.ok(!ui.texts.includes('Local project') && !ui.texts.includes('feature/login'));
  machine = 'vps'; new View().render();
  assert.ok(ui.texts.includes('vps'));
});

test('the header branch opens a read-only list of local and remote branches, newest first', async () => {
  const ui = fakeElements(), overlays = [], runs = [];
  let target = { view: 'header' }, pending;
  const space = { ...projects[0], branch: 'main', machine: null };
  const View = await viewFor({ ...ui, props: () => target, spaces: () => [space], theme: () => ({}), settings: () => ({ zoom: 1 }),
    layout: () => ({ children: [] }), run() {}, openOverlay: spec => overlays.push(spec), closeOverlay() {},
    execShell: async (args, options) => { runs.push([args.at(-1), options]); return { code: 0, stdout: [
      'refs/heads/feature/login\t2 hours ago', 'refs/heads/main\t3 days ago',
      'refs/remotes/origin/HEAD\t3 days ago', 'refs/remotes/origin/main\t3 days ago', ''].join('\n') }; } });
  new View().render();
  const trigger = ui.nodes.get('branch-switcher');
  trigger.mouseDown({ bounds: { x: 100, y: 0, width: 60, height: 32 } }, { stop_propagation() {} });
  trigger.click({}, { stop_propagation() {} });
  assert.deepEqual(overlays[0].props, { view: 'branch-menu', folder: '/Code/api', machine: null, branch: 'main' });
  target = { view: 'branch-menu', overlay: 'branches', ...overlays[0].props };
  const menu = new View(), cx = { focus_handle: () => ({ focus() {} }), notify() {}, spawn(task) { pending = task(cx); } };
  menu.init({}, cx); menu.render();
  assert.ok(ui.texts.includes('Loading…'));
  await pending; menu.render();
  assert.deepEqual(runs, [['/Code/api', { on: null }]]);
  assert.ok(ui.nodes.has('branch-local-feature/login') && ui.nodes.has('branch-local-main') && ui.nodes.has('branch-remote-origin/main'));
  assert.ok(!ui.nodes.has('branch-remote-origin/HEAD'));
  assert.equal(ui.nodes.get('branch-local-main').click, undefined);
});

test('Settings is the one place for the rules: a Rules page with icons beside each page, outside thread actions', async () => {
  const ui = fakeElements();
  let target = { view: 'pane', pane: 'p1' }, pending;
  const View = await viewFor({ ...ui, props: () => target, theme: () => ({}),
    spaces: () => [{ id: 'api', active: true, tabs: [{ id: 'tab-0', active: true }] }],
    agents: () => [{ address: 't1', space: 'api', tab: 'tab-0', app: 'claude-code', program: {} }],
    panes: () => [{ pane: 'p1', tab: 'tab-0', program: {}, title: 'T' }], layout: () => ({ children: [] }), run() {},
    readTextFile: async path => path === '/herdr/data/devkits/AGENTS.md' ? '# Global rules\n\nUse hc run.' : null,
    TextView: { markdown: (_id, text) => { ui.texts.push(text); return ui.element(); } } });
  new View().render();
  assert.ok(ui.nodes.has('thread-menu-p1'));
  assert.ok(![...ui.nodes.keys()].some(id => id.startsWith('thread-rules-')));
  target = { view: 'manage-launchers', overlay: 'settings', space: 'api', page: 'rules' };
  const view = new View(), cx = { focus_handle: () => ({ focus() {} }), notify() {}, spawn(task) { if (task.length) pending = task(cx); }, timer: { every() {} } };
  view.initSessionMenu(cx); view.launchers = [{ key: 'claude', name: 'Claude', icon: 'icons/claude.svg' }];
  await pending; view.render(cx);
  assert.ok(ui.texts.includes('# Global rules\n\nUse hc run.'));
  assert.ok(['agents', 'claude', 'rules'].every(page => ui.textOf(`settings-page-${page}`).length > 0));
  const order = ui.nodes.get('settings-pages').children.map(child => [...ui.nodes.entries()].find(([, data]) => data.element === child)?.[0]);
  assert.deepEqual(order, ['settings-page-agents', 'settings-page-rules', 'settings-page-claude']);
  assert.ok(['assets/icons/terminal.svg', 'assets/icons/book-open.svg', 'icons/claude.svg'].every(icon => ui.assets.some(asset => asset.endsWith(icon))));
});

test('new thread shortcut repeats the project agent and falls back for missing or hidden profiles', async () => {
  const memory = {}, started = [], menus = [];
  let selected = projects[0];
  const View = await viewFor({ shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
  const view = new View();
  view.projects = () => [{ ...selected, active: true }];
  view.newThread = (_cx, id) => menus.push(id);
  view.cachedAgents = async () => [{ key: 'codex', installed: true }, { key: 'claude', installed: true }];
  view.startThread = async (agent, target) => started.push([agent.key, target]);
  await view.repeatThread({});
  assert.deepEqual(menus, []);
  assert.equal(started.at(-1)[0], 'codex');
  memory['devkits.last-thread-agents'] = { '["","/Code/api"]': 'codex', '["","/Code/app"]': 'claude' };
  await view.repeatThread({});
  assert.equal(started.at(-1)[0], 'codex');
  assert.equal(started.at(-1)[1].space, 'api');
  selected = projects[1]; await view.repeatThread({});
  assert.equal(started.at(-1)[0], 'claude');
  memory['devkits.hidden-launchers'] = ['agent:claude']; await view.repeatThread({});
  assert.equal(started.at(-1)[0], 'codex');
  assert.equal(started.length, 4);
  memory['devkits.hidden-launchers'] = ['agent:codex', 'agent:claude'];
  await view.repeatThread({});
  assert.equal(menus.at(-1), 'app');
});

test('starting an agent remembers its profile; terminals do not replace it', async () => {
  const memory = {};
  const View = await viewFor({ spaces: () => projects, shared: key => memory[key],
    setShared: (key, value) => { memory[key] = value; } });
  const view = new View(); view.openThread = () => {};
  const target = { space: 'api', folder: '/Code/api' };
  await view.launchThread({ key: 'codex', name: 'Codex', run: ['codex'] }, target, {});
  assert.equal(memory['devkits.last-thread-agents']['["","/Code/api"]'], 'codex');
  await view.launchThread(null, target, {});
  assert.equal(memory['devkits.last-thread-agents']['["","/Code/api"]'], 'codex');
});

test('Add session shows the effective new-thread shortcut only beside the project default agent', async () => {
  const ui = fakeElements();
  const memory = { 'devkits.last-thread-agents': { '["","/Code/api"]': 'codex' } };
  let binding = 'devkits.new-thread';
  const View = await viewFor({ ...ui, props: () => ({ space: 'api', folder: '/Code/api' }), spaces: () => projects,
    shared: key => memory[key], window: () => ({ platform: 'macos' }),
    keys: () => [{ section: 'global', keys: 'cmd-n', action: 'space.new' },
      { section: 'layout:devkits', keys: 'cmd-n', action: binding }] });
  const view = new View(); view.launchers = [{ key: 'codex', name: 'Codex', installed: true }, { key: 'claude', name: 'Claude', installed: true }];
  view.launcher({});
  assert.ok(ui.textOf('start-codex').includes('⌘N'));
  assert.ok(!ui.textOf('start-claude').includes('⌘N'));
  assert.ok(!ui.textOf('new-terminal').includes('⌘N'));
  binding = 'app.help'; view.launcher({});
  assert.ok(!ui.textOf('start-codex').includes('⌘N'));
});


test('sidebar plus repeats the clicked project agent and expands that project', async () => {
  const ui = fakeElements(), memory = {
    'devkits.last-thread-agents': { '["","/Code/api"]': 'codex', '["","/Code/app"]': 'claude' },
  }, started = [];
  const View = await viewFor({ ...ui, spaces: () => projects, agents: () => [], theme: () => ({}),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, setAgentOrder() {}, run() {} });
  const view = new View(); view.init(); view.folded.add('app'); view.render();
  view.cachedAgents = async () => [{ key: 'codex' }, { key: 'claude' }];
  view.startThread = async (agent, target) => started.push([agent.key, target.space]);
  let pending, stopped = false;
  ui.nodes.get('new-thread-app').click({}, { stop_propagation() { stopped = true; }, notify() {},
    spawn: task => { pending = task({}); } });
  await pending;
  assert.equal(stopped, true);
  assert.equal(view.folded.has('app'), false);
  assert.deepEqual(started, [['claude', 'app']]);
});


test('new projects inherit the global agent then fall back to the first visible installed agent', async () => {
  const memory = { 'devkits.last-thread-agent': 'claude' };
  const View = await viewFor({ shared: key => memory[key] });
  const view = new View(), project = { id: 'new', folder: '/new' };
  const agents = [{ key: 'codex' }, { key: 'claude' }];
  assert.equal(view.defaultThreadAgent(project, agents).key, 'claude');
  memory['devkits.last-thread-agent'] = 'removed';
  assert.equal(view.defaultThreadAgent(project, agents).key, 'codex');
  memory['devkits.hidden-launchers'] = ['agent:codex'];
  assert.equal(view.defaultThreadAgent(project, agents).key, 'claude');
  assert.equal(view.defaultThreadAgent(project, [{ key: 'missing', installed: false }]), undefined);
});


test('close-file closes only the shown file in the visible Files editor', async () => {
  let editor = { id: 'editor', hidden: false, active: 'files' };
  const commands = [], closed = [];
  const View = await viewFor({ layout: () => editor, run: (...args) => commands.push(args) });
  const view = new View();
  view.files = { file: 'one.md', closeTab: path => closed.push(path) };
  view.closeFileTab(renderContext);
  assert.deepEqual(closed, ['one.md']);
  editor.hidden = true; view.closeFileTab(renderContext);
  editor.hidden = false; editor.active = 'diff'; view.closeFileTab(renderContext);
  editor.active = 'files'; view.files.file = null; view.closeFileTab(renderContext);
  editor = null; view.closeFileTab(renderContext);
  assert.deepEqual(closed, ['one.md']);
  assert.deepEqual(commands, []);
});

test('close-file delegates to the shared editor tab strip for files, graph and commit views', async () => {
  let editor = { id: 'editor', hidden: false, active: 'diff' }, closed = 0;
  const View = await viewFor({ layout: () => editor });
  const view = new View(); view.editor = { closeActiveTab() { closed++; } };
  view.closeFileTab(renderContext); assert.equal(closed, 1);
  editor.hidden = true; view.closeFileTab(renderContext); assert.equal(closed, 1);
});

test('conversation controls hide without closing sessions and retain visibility per project', async () => {
  const ui = fakeElements(), commands = [], memory = {};
  let selected = projects[0], target = { view: 'status' };
  const conversation = { id: 'workspace-view', hidden: true };
  const View = await viewFor({ ...ui, props: () => target, theme: () => ({ background: 'bg', selected: 'sel' }),
    spaces: () => [{ ...selected, active: true }], agents: () => agents,
    panes: () => [{ pane: 'pane-1', tab: 'tab-0' }], layout: () => ({ children: [conversation] }),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run: (name, args) => { commands.push([name, args]); if (name === 'layout.show' || name === 'layout.hide') conversation.hidden = name === 'layout.hide'; } });
  const view = new View();
  view.render(); assert.equal(ui.nodes.get('open-conversation').background, 'bg');
  ui.nodes.get('open-conversation').click();
  assert.equal(conversation.hidden, false);
  view.render(); assert.equal(ui.nodes.get('open-conversation').background, 'sel');
  const reload = new View(); reload.render(); assert.equal(ui.nodes.get('open-conversation').background, 'sel');
  selected = projects[1]; view.render(); assert.equal(ui.nodes.get('open-conversation').background, 'bg');
  selected = projects[0]; target = { pane: 'pane-1' }; view.paneHeader({});
  assert.ok(!ui.nodes.has('hide-conversation-pane-1'));
  target = { view: 'status' }; view.render();
  ui.nodes.get('open-conversation').click();
  assert.equal(conversation.hidden, true);
  target = { view: 'status' }; view.render(); assert.equal(ui.nodes.get('open-conversation').background, 'bg');
  assert.ok(!commands.some(([name]) => ['tab.close', 'pane.close', 'terminal.kill'].includes(name)));
  view.threadRow(projectGroups([{ ...selected, active: true }], agents)[0].threads[0], {});
  ui.nodes.get('thread-tab-0').click();
  assert.equal(conversation.hidden, false);
});


test('running and waiting agent threads stop generation without being archived or closed', async () => {
  for (const status of ['working', 'blocked']) {
    const ui = fakeElements(), commands = [], calls = [], memory = {};
    const View = await viewFor({ ...ui, run: (...args) => commands.push(args),
      hc: async args => { calls.push(args); return { code: 0 }; },
      shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
    const view = new View();
    const thread = { ...claudeThread, status, agents: [{ ...claudeAgent, status }] };
    await view.archiveThread(thread);
    assert.deepEqual(calls, []);
    assert.deepEqual(commands, []);
    view.threadRow(thread, {});
    assert.ok(ui.nodes.has('stop-thread-tab-0'));
    assert.ok(!ui.nodes.has('archive-thread-tab-0'));
    await view.stopThread(thread);
    assert.deepEqual(calls, [['interrupt', 't1']]);
    assert.deepEqual(commands, []);
    assert.equal(memory['devkits.archived-threads'], undefined);
  }
});

test('showing the conversation focuses its selected pane and hiding it returns to the editor', async () => {
  const commands = [];
  const View = await viewFor({ spaces: () => projects,
    panes: () => [{ pane: 'p0', tab: 'tab-0' }], run: (...args) => commands.push(args) });
  const view = new View(); view.showConversation(true);
  assert.deepEqual(commands.slice(-2), [['layout.show', { id: 'workspace-view' }], ['pane.focus', { pane: 'p0' }]]);
  view.showConversation(false);
  assert.deepEqual(commands.slice(-2), [['layout.hide', { id: 'workspace-view' }], ['devkits.focus-editor']]);
});


test('archive rechecks live status after asynchronous session discovery', async () => {
  let status = 'idle'; const commands = [], memory = {};
  const View = await viewFor({ terminals: () => [{ address: 't1', status, argv: ['claude'] }],
    run: (...args) => commands.push(args), shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    hc: async () => ({ code: 0, stdout: JSON.stringify(claudeTerminal) }),
    readTextFile: async () => { status = 'working'; return JSON.stringify({ sessionId: 'new-work' }); },
    exec: async () => ({ code: 0 }) });
  const view = new View(); await view.archiveThread({ ...claudeThread, agents: [claudeAgent] });
  assert.deepEqual(commands, []);
  assert.equal(memory['devkits.archived-threads'], undefined);
});


test('thread header menu contains only Close and targets the exact empty thread', async () => {
  const ui = fakeElements(), commands = [];
  const View = await viewFor({ ...ui, spaces: () => projects, agents: () => [], props: () => ({ pane: 'p0' }),
    panes: () => [{ pane: 'p0', tab: 'tab-0', title: 'New thread' }], run: (...args) => commands.push(args) });
  const view = new View(), cx = { ...renderContext };
  view.paneHeader({}, cx); ui.nodes.get('thread-menu-p0').click({}, cx); view.paneHeader({}, cx);
  assert.ok(!ui.nodes.has('thread-actions-p0-hide'));
  assert.ok(!ui.nodes.has('thread-actions-p0-stop'));
  assert.ok(!ui.nodes.has('thread-actions-p0-archive'));
  ui.nodes.get('thread-actions-p0-close').click({}, cx);
  assert.deepEqual(commands, [['tab.close', { id: 'tab-0' }]]);
});

test('pane header creates menu focus handles only during initialization', async () => {
  const ui = fakeElements(); let handles = 0;
  const View = await viewFor({ ...ui, props: () => ({ view: 'pane', pane: 'p0' }), theme: () => ({}), spaces: () => projects,
    agents: () => [], panes: () => [{ pane: 'p0', tab: 'tab-0' }] });
  const view = new View(); view.init({}, { focus_handle() { handles++; return { focus() {} }; } });
  view.render({ focus_handle() { throw new Error('Cannot create focus during render'); } });
  assert.equal(handles, 2);
  assert.ok(ui.nodes.has('thread-menu-p0'));
});

test('split terminals appear under their thread without agent metadata and close only their own pane', async () => {
  const ui = fakeElements(), commands = [];
  const modelPanes = [{ pane: 'p0', terminal: 't1', tab: 'tab-0', program: {} },
    { pane: 'p-shell', terminal: 'shell', tab: 'tab-0', title: 'Terminal', program: { shell: true }, focused: true }];
  const live = [{ address: 'shell', parent: 't1', state: 'live' }, { address: 'build', parent: 't1', state: 'live', name: 'Build' }];
  const View = await viewFor({ ...ui, spaces: () => projects, agents: () => [], panes: () => modelPanes,
    run: (...args) => commands.push(args) });
  const view = new View(), thread = { ...claudeThread, agents: [claudeAgent] };
  const rows = view.paneEntries(thread, live);
  assert.deepEqual(rows.map(row => [row.label, row.pane?.pane]), [['Terminal', 'p-shell'], ['Build', undefined]]);
  view.childRow(thread, rows[0], {});
  ui.nodes.get('thread-pane-p-shell').click();
  assert.deepEqual(commands.at(-1), ['pane.focus', { pane: 'p-shell' }]);
  commands.length = 0;
  ui.nodes.get('close-pane-p-shell').click({}, renderContext);
  assert.deepEqual(commands, [['pane.close', { pane: 'p-shell' }]]);
});

test('a split header menu distinguishes Close terminal from Close thread', async () => {
  const ui = fakeElements(), commands = [];
  const View = await viewFor({ ...ui, props: () => ({ pane: 'p-shell' }), spaces: () => projects, agents: () => [],
    panes: () => [{ pane: 'p0', terminal: 't1', tab: 'tab-0' }, { pane: 'p-shell', terminal: 'shell', tab: 'tab-0' }],
    run: (...args) => commands.push(args) });
  const view = new View(), cx = { ...renderContext };
  view.paneHeader({}, cx); ui.nodes.get('thread-menu-p-shell').click({}, cx); view.paneHeader({}, cx);
  ui.nodes.get('thread-actions-p-shell-close').click({}, cx);
  assert.deepEqual(commands, [['pane.close', { pane: 'p-shell' }]]);
});


test('splitting the hidden default shell makes it and its extra pane visible in the sidebar', async () => {
  const ui = fakeElements(), commands = [], memory = { 'devkits.default-terminals': { one: 'default' } };
  const View = await viewFor({ ...ui, props: () => ({}), theme: () => ({}), agents: () => [],
    spaces: () => [{ id: 'one', name: 'One', active: true, tabs: [{ id: 'default', name: '__devkits_default_terminal__', active: true }] }],
    panes: () => [{ pane: 'first', terminal: 't1', tab: 'default' }, { pane: 'extra', terminal: 't2', tab: 'default', title: 'Terminal 2' }],
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run: (...args) => commands.push(args), setAgentOrder() {} });
  const view = new View(); view.folded = new Set(); view.render();
  assert.ok(ui.nodes.has('thread-default'));
  assert.ok(ui.nodes.has('thread-pane-extra'));
  assert.ok(!commands.some(([name, args]) => name === 'layout.select' && args.child === 'project-empty'));
});


test('sidebar preserves parallel pane depth and nests each real child under its own parent', async () => {
  const modelPanes = [
    { pane: 'root', terminal: 't1', tab: 'tab-0', title: 'Agent' },
    { pane: 'parallel', terminal: 'shell', tab: 'tab-0', title: 'Terminal' },
    { pane: 'adopted-child', terminal: 'adopted', tab: 'tab-0', title: 'Child pane' },
    { pane: 'other-tab', terminal: 'elsewhere', tab: 'other' },
  ];
  const live = [
    { address: 't1', state: 'live' }, { address: 'shell', state: 'live' },
    { address: 'worker', parent: 't1', state: 'live', name: 'Worker' },
    { address: 'nested', parent: 'worker', state: 'live', name: 'Nested task' },
    { address: 'adopted', parent: 't1', state: 'live' },
    { address: 'build', parent: 'shell', state: 'live', name: 'Build' },
    { address: 'elsewhere', parent: 't1', state: 'live' },
    { address: 'finished', parent: 't1', state: 'finished' },
  ];
  const View = await viewFor({ panes: () => modelPanes });
  const rows = new View().paneEntries({ ...claudeThread, agents: [claudeAgent] }, live);
  assert.deepEqual(rows.map(row => [row.label, row.depth, row.pane?.pane]), [
    ['Worker', 1, undefined], ['Nested task', 2, undefined], ['Child pane', 1, 'adopted-child'],
    ['Terminal', 0, 'parallel'], ['Build', 1, undefined],
  ]);
});

test('child task traversal supports deeper trees and rejects cycles and duplicate roots', () => {
  const live = [{ address: 'root', parent: 'deep', state: 'live' },
    { address: 'one', parent: 'root', state: 'live' }, { address: 'two', parent: 'one', state: 'live' },
    { address: 'three', parent: 'two', state: 'live' }, { address: 'deep', parent: 'three', state: 'live' }];
  assert.deepEqual(childTerminals(live, ['root'], 1, Infinity).map(row => row.terminal.address), ['one', 'two', 'three', 'deep']);
});


test('only panes sharing a thread get a bracket; independent threads have no tree trunk', async () => {
  const ui = fakeElements();
  const View = await viewFor({ ...ui, panes: () => [
    { pane: 'root', terminal: 't1', tab: 'tab-0' },
    { pane: 'peer', terminal: 'shell', tab: 'tab-0', title: 'Terminal' },
  ] });
  const view = new View(), thread = { ...claudeThread, agents: [claudeAgent] };
  view.renderThreadGroup(thread, {}, [{ address: 'shell', state: 'live' },
    { address: 'job', parent: 'shell', name: 'Build', state: 'live' }]);
  assert.ok(ui.nodes.has('thread-group-tab-0'));
  assert.ok(ui.nodes.has('thread-tab-0-guide-0'));
  assert.ok(ui.nodes.has('thread-pane-peer-guide-0'));
  assert.ok(!ui.nodes.has('thread-pane-peer-guide-1'));
  assert.ok(ui.nodes.has('child-job-guide-1'));
  view.renderThreadGroup({ space: 'api', tab: { id: 'independent' }, agents: [], title: 'Independent' }, {}, []);
  assert.ok(ui.nodes.has('thread-independent'));
  assert.ok(!ui.nodes.has('thread-independent-guide-0'));
});

test('Tasks groups created tasks and live threads, while Asana bookmarks stay outside Todo until imported', async () => {
  const ui = fakeElements(), commands = [], memory = { 'devkits.agent-board': { '["","/Code/api"]': {
    'local:import': { gid: 'local:import', source: 'local', name: 'Imported task', status: 'todo', asana: { gid: 'original' } },
  } } };
  const View = await viewFor({ ...ui, theme: () => ({}), agents: () => agents,
    spaces: () => projects, savedTasks: folder => folder === '/Code/api' ? [{ gid: 'saved', name: 'Queued task' }] : [],
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run: (...args) => commands.push(args), setAgentOrder() {} });
  const view = new View(); view.folded = new Set(); view.render();
  assert.ok(!ui.nodes.has('board-api'));
  assert.ok(ui.nodes.has('thread-shell'));
  assert.ok(!ui.nodes.has('board-task-api-saved'));
  assert.ok(ui.nodes.has('board-task-api-local:import'));
  ui.nodes.get('board-task-api-local:import').click();
  assert.equal(memory['devkits.board-project'], 'api');
  assert.equal(memory['devkits.board-focus'], 'local:import');
  assert.ok(!commands.some(([name]) => ['tab.new', 'space.new', 'tab.close', 'terminal.kill'].includes(name)));
  ui.nodes.get('thread-tab-0').click();
  assert.equal(memory['devkits.board-project'], null);
  assert.ok(commands.some(([name, args]) => name === 'tab.select' && args.id === 'tab-0'));
});

test('Tasks opens from the visible bottom status bar without creating a terminal', async () => {
  const ui = fakeElements(), commands = [], memory = {};
  const View = await viewFor({ ...ui, spaces: () => projects, agents: () => agents,
    layout: () => ({ id: 'root', children: [{ id: 'editor' }, { id: 'workspace-view' }] }),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, run: (...args) => commands.push(args) });
  const view = new View(); view.statusBar({});
  assert.ok(ui.nodes.has('open-tasks'));
  const order = [...ui.nodes.keys()];
  assert.ok(order.indexOf('open-tasks') > order.indexOf('open-files'));
  assert.ok(order.indexOf('open-tasks') > order.indexOf('settings'));
  assert.ok(ui.textOf('open-tasks').includes('Tasks'));
  ui.nodes.get('open-tasks').click();
  assert.equal(memory['devkits.board-project'], 'api');
  assert.ok(!commands.some(([name]) => ['tab.new', 'space.new', 'tab.close', 'terminal.kill'].includes(name)));
  view.statusBar({}); ui.nodes.get('open-tasks').click();
  assert.equal(memory['devkits.board-project'], null);
});


test('Tasks stays open when selecting projects; opening a conversation explicitly leaves Tasks', async () => {
  const ui = fakeElements(), memory = {}, commands = [];
  const View = await viewFor({ ...ui, spaces: () => projects, agents: () => agents,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, run: (...args) => commands.push(args) });
  const view = new View();
  view.openBoard(projects[0]);
  assert.equal(memory['devkits.tasks-open'], true);
  view.selectProject(projects[1]);
  assert.equal(memory['devkits.tasks-open'], true);
  view.openBoard(projects[1]);
  assert.equal(memory['devkits.board-project'], 'app');
  view.showConversation(true, projects[1]);
  assert.equal(memory['devkits.tasks-open'], false);
  assert.ok(!commands.some(([name]) => ['tab.new', 'space.new', 'tab.close'].includes(name)));
});

test('restoring an unfinished archived task retains progress and reconnects the same task identity', async () => {
  const folder = '/Code/api', key = JSON.stringify(['', folder]);
  const task = { gid: 'thread:previous', name: 'Unfinished', source: 'thread', status: 'todo', threadId: 'previous' };
  const entry = { id: 'claude:unfinished', folder, title: task.name, argv: ['claude', '--resume', 'unfinished'], profile: 'claude', boardTask: task };
  const memory = { 'devkits.archived-threads': [entry], 'devkits.agent-board': { [key]: { [task.gid]: { ...task, archived: true } } } };
  const View = await viewFor({ spaces: () => projects, shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
  const view = new View(); let reopened;
  view.openThread = (...args) => { reopened = args; };
  view.restoreThread(entry);
  assert.equal(memory['devkits.agent-board'][key][task.gid].status, 'todo');
  assert.equal(memory['devkits.agent-board'][key][task.gid].archived, false);
  assert.equal(reopened[4].gid, 'thread:previous');
  assert.deepEqual(memory['devkits.archived-threads'], []);
});

test('finishing a run keeps unarchived threads visible and navigable; only archive hides them', async () => {
  const memory = {}, commands = [];
  let status = 'done', order;
  const nativeProjects = [{ id: 'p', name: 'Project', folder: '/project', active: true, tabs: [{ id: 'work', name: 'Fix login', named: true, active: true }] }];
  const currentAgents = () => [{ address: 't1', space: 'p', tab: 'work', status, seq: 1, program: { name: 'Codex' } }];
  const ui = fakeElements();
  const View = await viewFor({ ...ui, spaces: () => nativeProjects, agents: currentAgents,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run: (...args) => commands.push(args), setAgentOrder: value => { order = value; }, theme: () => ({}) });
  const view = new View(); view.folded = new Set(); view.render();
  assert.ok(ui.nodes.has('thread-work')); assert.deepEqual(order, ['t1']);
  const key = '["","/project"]';
  assert.equal(memory['devkits.agent-board'][key]['thread:work'].status, 'done');
  status = 'idle'; ui.nodes.clear(); view.render();
  assert.ok(ui.nodes.has('thread-work')); assert.deepEqual(order, ['t1']);
  assert.equal(memory['devkits.archived-threads'], undefined);
  memory['devkits.agent-board'][key]['thread:work'].archived = true;
  ui.nodes.clear(); view.render();
  assert.ok(!ui.nodes.has('thread-work')); assert.deepEqual(order, []);
  memory['devkits.agent-board'][key]['thread:work'].archived = false;
  status = 'working'; ui.nodes.clear(); view.render();
  assert.ok(ui.nodes.has('thread-work')); assert.deepEqual(order, ['t1']);
  assert.ok(!commands.some(([name]) => ['tab.close', 'terminal.kill'].includes(name)));
});

test('status and priority selects show semantic icons in the trigger and every option', async () => {
  const { boardStatusOptions, boardPriorityOptions } = await import('../mods/devkits/agent-board-model.js');
  const ui = fakeElements(), source = await readFile(new URL('../mods/devkits/components/select.js', import.meta.url), 'utf8');
  const host = { ...ui, DropdownMenuContent: () => ui.element(), DropdownMenuItem: id => ui.element().id(id) };
  const Select = new Function(...Object.keys(host), source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '') + '\nreturn Select;')(...Object.values(host));
  const state = { trigger: { focus() {} }, list: { focus() {} }, open: true, index: 0 };
  const t = { foreground: '#eee', muted: '#888' };
  let chosen;
  Select('icon-status', state, 'done', boardStatusOptions(t), 'Status', value => { chosen = value; }, t);
  assert.equal(ui.assets.filter(path => path.endsWith('/circle-check.svg')).length, 2);
  assert.ok(ui.assets.some(path => path.endsWith('/circle-half.svg')));
  assert.ok(ui.assets.some(path => path.endsWith('/clock.svg')));
  ui.nodes.get('icon-status-option-todo').click({}, { stop_propagation() {}, notify() {} });
  assert.equal(chosen, 'todo');
  Select('icon-priority', state, 'urgent', boardPriorityOptions(t), 'Priority', () => {}, t);
  for (const key of ['none', 'low', 'medium', 'high', 'urgent'])
    assert.ok(ui.assets.some(path => path.endsWith(`/priority-${key}.svg`)));
  assert.equal(ui.assets.filter(path => path.endsWith('/priority-urgent.svg')).length, 2);
});

test('Tasks assignment shares visible launcher profiles, account labels and saved order with session launchers', async () => {
  const profiles = [
    { key: 'codex', name: 'Codex', installed: true, run: ['codex'] },
    { key: 'pi', name: 'Pi', installed: true, run: ['pi'] },
    { key: 'devkits-codex-rick', name: 'Codex · RickYeh', installed: true, run: ['env', 'CODEX_HOME=/rick', 'codex'] },
    { key: 'devkits-codex-ren', name: 'Codex · RenHaoYeh', installed: true, run: ['env', 'CODEX_HOME=/ren', 'codex'] },
    { key: 'devkits-claude-night', name: 'Claude · 夜班', installed: true, run: ['claude'] },
    { key: 'unavailable', name: 'Unavailable', installed: false },
  ];
  const memory = { 'devkits.agent-cache': { null: profiles }, 'devkits.hidden-launchers': ['agent:codex', 'agent:pi'],
    'devkits.launcher-order': ['terminal', 'agent:devkits-codex-ren', 'agent:devkits-codex-rick', 'agent:devkits-claude-night'] };
  const target = { view: 'task-composer', project: projects[0] };
  const View = await viewFor({ props: () => target, theme: () => ({}), agents: () => [], shared: key => memory[key] });
  const view = new View();
  const result = view.taskAssignees(projects[0]);
  assert.deepEqual(result.map(agent => agent.name), ['RenHaoYeh', 'RickYeh', '夜班']);
  assert.deepEqual(result[0].run, ['env', 'CODEX_HOME=/ren', 'codex']);
  assert.equal(result[0].key, 'devkits-codex-ren');
  assert.equal(profiles[3].name, 'Codex · RenHaoYeh');
  view.taskComposer = { render: choices => choices };
  assert.deepEqual(view.render(), result);
  view.agentBoard = { render: (_project, _agents, choices) => choices };
  assert.deepEqual(view.boardPanel(projects[0], {}), result);
});


test('old thread snapshots stay on the board without becoming phantom sidebar threads', async () => {
  const ui = fakeElements(), memory = { 'devkits.agent-board': { '["","/project"]': {
    'thread:closed': { gid: 'thread:closed', name: 'Old completed thread', source: 'thread', threadId: 'closed', status: 'done' },
  } } };
  const View = await viewFor({ ...ui, spaces: () => [{ id: 'p', folder: '/project', name: 'Project', tabs: [], active: true }],
    agents: () => [], shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run() {}, setAgentOrder() {}, theme: () => ({}) });
  const view = new View(); view.folded = new Set(); view.render();
  assert.ok(!ui.nodes.has('board-task-p-thread:closed'));
  assert.equal(memory['devkits.agent-board']['["","/project"]']['thread:closed'].status, 'done');
});

test('a stale task composer cannot start a Done task, while an unstarted Todo can start', async () => {
  const key = '["","/Code/api"]', gid = 'local:execution-test';
  const memory = { 'devkits.agent-board': { [key]: { [gid]: { gid, source: 'local', name: 'Fix login', status: 'done' } } } };
  const View = await viewFor({ spaces: () => projects, agents: () => [],
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
  const view = new View();
  view.agentBoard = { render: (_project, _agents, _launchers, actions) => actions };
  let starts = 0; view.startThread = async () => { starts++; };
  const actions = view.boardPanel(projects[0], {});
  const eventCx = { spawn: task => task({ notify() {} }) };
  const task = { gid, source: 'local', name: 'Fix login', notes: 'Validate form' };
  await actions.start({ key: 'codex' }, task, {}, eventCx);
  assert.equal(starts, 0);
  memory['devkits.agent-board'][key][gid].status = 'todo';
  await actions.start({ key: 'codex' }, task, {}, eventCx);
  assert.equal(starts, 1);
  memory['devkits.agent-board'][key][gid].status = 'fail';
  await actions.start({ key: 'codex' }, task, {}, eventCx);
  assert.equal(starts, 1);
});

test('task archive events recheck runtime activity instead of trusting an old enabled button', async () => {
  const key = '["","/Code/api"]', gid = 'local:busy';
  const memory = { 'devkits.thread-tasks': { 'tab-0': { gid, folder: '/Code/api', source: 'local' } },
    'devkits.agent-board': { [key]: { [gid]: { gid, source: 'local', name: 'Work', status: 'done' } } } };
  const View = await viewFor({ spaces: () => projects, agents: () => [{ address: 't1', tab: 'tab-0', space: 'api', status: 'working' }],
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
  const view = new View(); view.agentBoard = { render: (_p, _a, _l, actions) => actions };
  let archives = 0; view.archiveThread = async () => { archives++; };
  view.boardPanel(projects[0], {}).archive({ gid, status: 'done', tabs: [] }, { spawn: task => task({ notify() {} }) });
  assert.equal(archives, 0); assert.ok(!memory['devkits.agent-board'][key][gid].archived);
});

async function taskBoardFor(records = {}) {
  const ui = fakeElements(), model = await import('../mods/devkits/agent-board-model.js');
  const project = { id: 'p', name: 'Project', folder: '/project', tabs: [] };
  const projects = [project], runtime = { agents: [] }, dialogs = [], launches = [];
  const key = model.boardKey(project), memory = { 'devkits.agent-board': { [key]: structuredClone(records) } };
  const field = { new: () => {
    const events = new Map(); let value = '';
    return { value: () => value, set_value(next) { value = next; },
      edit(next) { value = next; events.get('change')?.({}, renderContext); },
      on(event, handler) { events.set(event, handler); }, set_auto_grow() {}, focus() {},
      blur() { events.get('blur')?.({}, renderContext); } };
  } };
  const host = { ...ui, ...model, folderKey, InputState: field, TextareaState: field,
    Input: { new: () => ui.element() }, Textarea: { new: () => ui.element() },
    TextView: { markdown: () => ui.element() },
    shared: key => memory[key], setShared: (key, value) => { memory[key] = structuredClone(value); },
    currentAgents: () => runtime.agents, currentSpaces: () => projects, terminals: () => [],
    withTaskInputEvidence: agents => agents, savedTasks: () => [],
    AsanaPanel: class { init() {} launchRow(task) { launches.push(task); return ui.element(); } },
    boardTheme: () => ({ appearance: 'linear', fontFamily: 'Arial', foreground: '#fff', secondary: '#eee',
      background: '#121213', muted: '#959597', border: '#232426', selected: '#29292b', hover: '#232424',
      popover: '#1c1c1d', control: '#1c1c1d', controlBorder: '#303032', menuHover: '#29292b',
      card: '#1a1a1b', cardHover: '#212223', cardBorder: '#ffffff0c', cardSelected: '#242426', cardSelectedBorder: '#454548' }),
    readTaskOutput: async () => runtime.output || '', readAsanaToken: async () => null,
    taskIdentifier: task => task.gid, outputMarkdown: text => text,
    openTaskComposer: (...args) => dialogs.push(args),
  };
  const sources = await Promise.all(['components/button', 'components/dropdown-menu', 'components/select', 'components/icon', 'components/side-panel', 'agent-board-state', 'agent-board']
    .map(name => readFile(new URL(`../mods/devkits/${name}.js`, import.meta.url), 'utf8')));
  const Board = new Function(...Object.keys(host), sources.join('\n')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export \{.*\} from .*;\r?\n/gm, '')
    .replace('export default class', 'class').replace(/^export /gm, '') + '\nreturn AgentBoard;')(...Object.values(host));
  const view = new Board(), cx = { ...renderContext, timer: { every() {} }, spawn: fn => fn(renderContext) };
  view.init(cx);
  const launchers = [{ key: 'profile', name: 'Rick', icon: 'icons/codex.svg', tint: false }];
  const render = () => { ui.nodes.clear(); return view.render(project, runtime.agents, launchers, {}, cx); };
  render();
  return { ui, view, project, projects, runtime, memory, key, cx, render, dialogs, launches, Board };
}

test('Todo details edit title, empty descriptions and assignment in place with automatic persistence', async () => {
  const task = { gid: 'local:edit', source: 'local', name: 'Original', notes: 'Old description', status: 'todo' };
  const board = await taskBoardFor({ [task.gid]: task });
  const { view, ui, memory, key, dialogs, launches } = board;
  view.selected = task.gid; board.render();
  assert.ok(ui.nodes.has('board-task-title')); assert.ok(ui.nodes.has('board-task-description'));
  assert.ok(!ui.nodes.has('board-edit-task')); assert.ok(!ui.nodes.has('board-add-description'));
  view.title.edit('Updated title'); view.description.edit('New instructions\n');
  board.render();
  assert.equal(memory['devkits.agent-board'][key][task.gid].name, 'Updated title');
  assert.equal(launches.at(-1).notes, 'New instructions\n');
  ui.nodes.get('board-task-agent-option-profile').click({}, board.cx);
  assert.equal(memory['devkits.agent-board'][key][task.gid].agentKey, 'profile');
  assert.equal(memory['devkits.agent-board'][key][task.gid].agentName, 'Rick');
  view.description.edit(''); view.title.edit('   '); view.title.blur();
  assert.equal(memory['devkits.agent-board'][key][task.gid].notes, '');
  assert.equal(view.title.value(), 'Updated title');
  assert.equal(memory['devkits.agent-board'][key][task.gid].status, 'todo');
  assert.deepEqual(dialogs, []);
});

test('inline edits reject stale Todo fields after a task starts or is archived', async () => {
  const task = { gid: 'local:edit', source: 'local', name: 'Original', notes: 'Original notes', status: 'todo' };
  const board = await taskBoardFor({ [task.gid]: task });
  const { view, project, memory, key, runtime, ui } = board;
  view.selected = task.gid; board.render();
  project.tabs = [{ id: 'running' }]; memory['devkits.agent-board'][key][task.gid].threadId = 'running';
  runtime.agents = [{ address: 't1', tab: 'running', status: 'working' }];
  view.title.edit('Stale title'); view.description.edit('Stale notes');
  ui.nodes.get('board-task-agent-option-profile').click({}, board.cx);
  assert.equal(memory['devkits.agent-board'][key][task.gid].name, 'Original');
  assert.equal(memory['devkits.agent-board'][key][task.gid].notes, 'Original notes');
  assert.equal(memory['devkits.agent-board'][key][task.gid].agentKey, undefined);
  board.render();
  assert.ok(!ui.nodes.has('board-task-title')); assert.ok(!ui.nodes.has('board-task-description'));
  runtime.agents = []; project.tabs = [];
  memory['devkits.agent-board'][key][task.gid] = { ...task, archived: true };
  view.saveField('notes');
  assert.equal(memory['devkits.agent-board'][key][task.gid].notes, 'Original notes');
});

test('local Todo editing and dragging work before a saved project has any native session', async () => {
  const task = { gid: 'local:pending', source: 'local', name: 'Original', status: 'todo' };
  const board = await taskBoardFor({ [task.gid]: task });
  board.project.pending = true; board.projects.length = 0;
  board.view.selected = task.gid; board.render();
  board.view.description.edit('Prepare before starting any agent');
  assert.equal(board.memory['devkits.agent-board'][board.key][task.gid].notes, 'Prepare before starting any agent');
  assert.equal(board.view.setStatus(board.project, task.gid, 'done'), true);
  assert.equal(board.memory['devkits.agent-board'][board.key][task.gid].status, 'done');
});

test('card dragging changes manual task progress, suppresses the click and never fabricates live activity', async () => {
  const task = { gid: 'local:drag', source: 'local', name: 'Drag me', status: 'todo' };
  const board = await taskBoardFor({ [task.gid]: task });
  const { view, ui, cx, memory, key } = board;
  const drag = destination => {
    board.render();
    ui.nodes.get(`board-card-${task.gid}`).mouseDown({ position: { x: 0, y: 0 } }, cx);
    ui.nodes.get(`board-lane-${destination}`).mouseMove({ position: { x: 20, y: 0 } }, cx);
    board.render();
    ui.nodes.get(`board-lane-${destination}`).mouseUp({}, cx);
    ui.nodes.get(`board-card-${task.gid}`).click({}, cx);
  };
  drag('done');
  assert.equal(memory['devkits.agent-board'][key][task.gid].status, 'done');
  assert.equal(view.selected, null);
  assert.equal(view.drag, null);
  drag('todo');
  assert.equal(memory['devkits.agent-board'][key][task.gid].status, 'todo');
  for (const status of ['doing', 'waiting']) {
    drag(status);
    assert.equal(memory['devkits.agent-board'][key][task.gid].status, 'todo');
  }
  drag('fail');
  assert.equal(memory['devkits.agent-board'][key][task.gid].status, 'fail');
  assert.deepEqual(board.dialogs, []); assert.deepEqual(board.launches, []);
});

test('dragging respects movement thresholds, cancellation and live state at release', async () => {
  const task = { gid: 'local:drag', source: 'local', name: 'Drag me', status: 'todo' };
  const board = await taskBoardFor({ [task.gid]: task });
  const { view, ui, cx, project, runtime, memory, key } = board;
  const start = distance => {
    board.render();
    ui.nodes.get(`board-card-${task.gid}`).mouseDown({ position: { x: 0, y: 0 } }, cx);
    ui.nodes.get('board-lane-done').mouseMove({ position: { x: distance, y: 0 } }, cx);
  };
  start(2); ui.nodes.get('board-lane-done').mouseUp({}, cx);
  assert.equal(memory['devkits.agent-board'][key][task.gid].status, 'todo');
  start(20); ui.nodes.get('agent-board').keyDown({ key: 'escape' }, cx);
  ui.nodes.get('board-lane-done').mouseUp({}, cx);
  assert.equal(memory['devkits.agent-board'][key][task.gid].status, 'todo');
  start(20); ui.nodes.get('agent-board').hover(false, cx);
  ui.nodes.get('board-lane-done').mouseUp({}, cx);
  assert.equal(memory['devkits.agent-board'][key][task.gid].status, 'todo');
  start(20);
  project.tabs = [{ id: 'running' }]; memory['devkits.agent-board'][key][task.gid].threadId = 'running';
  runtime.agents = [{ address: 't1', tab: 'running', status: 'working' }];
  ui.nodes.get('board-lane-done').mouseUp({}, cx);
  assert.equal(memory['devkits.agent-board'][key][task.gid].status, 'doing');
  assert.equal(memory['devkits.agent-board'][key][task.gid].manual, false);
  assert.equal(view.drag, null);
});

test('deleting a local task removes its card and sidebar row across reloads while other task sources stay', async () => {
  const task = { gid: 'local:delete', name: 'Delete me', notes: 'Instructions', source: 'local', status: 'todo' };
  const others = { saved: { gid: 'saved', name: 'Saved task', source: 'asana', status: 'todo' } };
  const board = await taskBoardFor({ [task.gid]: task, ...others });
  board.view.selected = task.gid; board.render();
  board.ui.nodes.get('board-delete-task').click({}, board.cx);
  board.render();
  assert.ok(!board.ui.nodes.has(`board-card-${task.gid}`));
  assert.ok(!board.ui.nodes.has('board-detail'));
  assert.ok(board.ui.nodes.has('board-card-saved'));
  assert.equal(board.memory['devkits.agent-board'][board.key][task.gid], undefined);
  // A late field event cannot recreate a removed task.
  board.view.description.edit('Late input');
  assert.equal(board.memory['devkits.agent-board'][board.key][task.gid], undefined);
  const reopened = await taskBoardFor(JSON.parse(JSON.stringify(board.memory['devkits.agent-board'][board.key])));
  assert.ok(!reopened.ui.nodes.has(`board-card-${task.gid}`));
  const ui = fakeElements(), commands = [];
  const View = await viewFor({ ...ui, spaces: () => [board.project], agents: () => [], theme: () => ({}),
    shared: key => board.memory[key], setShared: (key, value) => { board.memory[key] = value; },
    run: (...args) => commands.push(args), setAgentOrder() {} });
  const sidebar = new View(); sidebar.folded = new Set(); sidebar.render();
  assert.ok(!ui.nodes.has(`board-task-p-${task.gid}`));
  assert.ok(!commands.some(([name]) => ['tab.close', 'terminal.kill'].includes(name)));
});

test('deletion preserves open and archived conversations and detaches only the selected project task', async () => {
  const task = { gid: 'local:delete', name: 'Finished', source: 'local', status: 'done' };
  const board = await taskBoardFor({ [task.gid]: task });
  const { project, runtime, memory, key, view, cx } = board;
  project.tabs = [{ id: 'conversation', name: 'Finished' }];
  runtime.agents = [{ address: 't1', tab: 'conversation', status: 'idle', turn: 1 }];
  memory['devkits.thread-tasks'] = {
    conversation: { gid: task.gid, name: task.name, folder: '/project', source: 'local' },
    closed: { gid: task.gid, name: task.name, folder: '/project/', source: 'local' },
    other: { gid: task.gid, name: 'Other project', folder: '/other', source: 'local' },
  };
  const archive = { id: 'codex:session', title: task.name, folder: project.folder, argv: ['codex', 'resume', 'session'],
    task: { gid: task.gid }, boardTask: task };
  const unrelated = { ...archive, id: 'codex:other', folder: '/other' };
  memory['devkits.archived-threads'] = [archive, unrelated];
  view.selected = task.gid; board.render();
  board.ui.nodes.get('board-delete-task').click({}, cx);
  board.render();
  assert.equal(memory['devkits.agent-board'][key][task.gid], undefined);
  assert.equal(project.tabs[0].id, 'conversation'); assert.equal(runtime.agents[0].address, 't1');
  assert.ok(board.ui.nodes.has('board-card-thread:conversation'));
  assert.deepEqual(Object.keys(memory['devkits.thread-tasks']), ['other']);
  assert.deepEqual(memory['devkits.archived-threads'][0], { ...archive, task: null, boardTask: null });
  assert.deepEqual(memory['devkits.archived-threads'][1], unrelated);
});

test('archived local tasks may be deleted, while busy, waiting, launching and external tasks cannot be', async () => {
  const task = { gid: 'local:delete', name: 'Delete me', source: 'local', status: 'todo' };
  for (const status of ['working', 'blocked', 'needsInput']) {
    const board = await taskBoardFor({ [task.gid]: task });
    board.view.selected = task.gid; board.render();
    const staleDelete = board.ui.nodes.get('board-delete-task').click;
    board.project.tabs = [{ id: 'busy' }];
    board.memory['devkits.agent-board'][board.key][task.gid].threadId = 'busy';
    board.runtime.agents = [{ address: 't1', tab: 'busy', status: status === 'needsInput' ? 'working' : status, needsInput: status === 'needsInput' }];
    staleDelete({}, board.cx); board.render();
    assert.ok(board.memory['devkits.agent-board'][board.key][task.gid]);
    assert.ok(!board.ui.nodes.has('board-delete-task'));
  }
  const pending = await taskBoardFor({ [task.gid]: task });
  pending.memory['devkits.pending-profiles'] = [{ at: Date.now(), task: { gid: task.gid, folder: '/project' } }];
  pending.view.deleteTask(pending.project, task.gid, pending.cx);
  assert.ok(pending.memory['devkits.agent-board'][pending.key][task.gid]);
  for (const source of ['thread', 'asana']) {
    const external = await taskBoardFor({ [task.gid]: { ...task, source } });
    external.view.selected = task.gid; external.render();
    assert.ok(!external.ui.nodes.has('board-delete-task'));
    external.view.deleteTask(external.project, task.gid, external.cx);
    assert.ok(external.memory['devkits.agent-board'][external.key][task.gid]);
  }
  const archived = await taskBoardFor({ [task.gid]: { ...task, archived: true } });
  archived.view.archived = true; archived.view.selected = task.gid; archived.render();
  archived.ui.nodes.get('board-delete-task').click({}, archived.cx);
  assert.equal(archived.memory['devkits.agent-board'][archived.key][task.gid], undefined);
});

test('an output read already in flight cannot recreate a deleted local task', async () => {
  const task = { gid: 'local:delete', name: 'Finished', source: 'local', status: 'done' };
  const board = await taskBoardFor({ [task.gid]: task });
  board.runtime.output = 'Late result from the original conversation';
  // Retain the real queued continuation, then delete before it runs.
  let continuation;
  board.view.loadOutput({ ...task, agents: [{ address: 't1' }] }, board.project, { spawn: fn => { continuation = fn; } });
  board.view.deleteTask(board.project, task.gid, board.cx);
  await continuation(board.cx);
  assert.equal(board.memory['devkits.agent-board'][board.key][task.gid], undefined);
});

test('a local task deleted during launch-rule loading cannot start or reappear', async () => {
  const project = { id: 'p', name: 'Project', folder: '/project', tabs: [], active: true };
  const task = { gid: 'local:delete', name: 'Delete me', source: 'local', status: 'todo' };
  const memory = { 'devkits.agent-board': { '["","/project"]': { [task.gid]: task } } }, commands = [];
  let finishRead;
  const ruleRead = new Promise(resolve => { finishRead = resolve; });
  const View = await viewFor({ spaces: () => [project], agents: () => [], shared: key => memory[key],
    setShared: (key, value) => { memory[key] = value; }, readTextFile: () => ruleRead,
    run: (...args) => commands.push(args) });
  const view = new View();
  const launch = view.startThread({ key: 'codex', name: 'Codex', run: ['codex'] }, { space: 'p', folder: '/project', task });
  await settle();
  delete memory['devkits.agent-board']['["","/project"]'][task.gid];
  finishRead('Rules'); await launch;
  assert.equal(memory['devkits.agent-board']['["","/project"]'][task.gid], undefined);
  assert.ok(!commands.some(([name]) => ['tab.new', 'space.new'].includes(name)));
});

test('the task detail divider resizes the pane and retains its width across tasks and view recreation', async () => {
  const task = { gid: 'local:resize', source: 'local', name: 'Task', notes: 'Keep these instructions', status: 'todo' };
  const other = { gid: 'local:other', source: 'local', name: 'Other', status: 'todo' };
  const board = await taskBoardFor({ [task.gid]: task, [other.gid]: other });
  const { view, ui, cx, memory, key } = board;
  assert.ok(!ui.nodes.has('board-detail-split-handle'));
  view.selected = task.gid; board.render();
  assert.equal(view.detailPanel.width, 500);
  ui.nodes.get('board-detail-split').sizeChange({ width: 1400, height: 700 }, cx);
  ui.nodes.get('board-detail-split-handle').mouseDown({ position: { x: 1000 } }, cx);
  ui.nodes.get('board-detail-split').mouseMove({ position: { x: 850 }, bounds: { width: 1400 } }, cx);
  assert.equal(view.detailPanel.width, 650);
  assert.equal(memory['devkits.task-detail-width'], undefined); // Persist on release, not every pointer movement.
  ui.nodes.get('board-detail-split').mouseUp({}, cx);
  assert.equal(memory['devkits.task-detail-width'], 650);
  view.selected = other.gid; board.render();
  assert.equal(view.detailPanel.width, 650);
  const reopened = new board.Board(); reopened.init(cx);
  assert.equal(reopened.detailPanel.width, 650);
  assert.equal(memory['devkits.agent-board'][key][task.gid].notes, 'Keep these instructions');
  assert.equal(view.drag, null); // Resizing never starts a card drag.
  ui.nodes.get('board-detail-split-handle').click({ click_count: 2 }, cx);
  assert.equal(memory['devkits.task-detail-width'], 500);
  assert.equal(view.detailPanel.width, 500);
});

test('the task divider honors bounds and zoom, and saves on leaving the split area', async () => {
  const task = { gid: 'local:resize', source: 'local', name: 'Task', status: 'todo' };
  const board = await taskBoardFor({ [task.gid]: task });
  const { view, ui, cx, memory } = board;
  view.selected = task.gid; board.render();
  const root = ui.nodes.get('board-detail-split'), handle = ui.nodes.get('board-detail-split-handle');
  root.sizeChange({ width: 1400, height: 700 }, cx);
  handle.mouseDown({ position: { x: 1800 } }, cx);
  root.mouseMove({ position: { x: 1600 }, bounds: { width: 2800 } }, cx); // 2x UI zoom: 200 screen pixels = 100 logical pixels.
  assert.equal(view.detailPanel.width, 600);
  root.hover(false, cx);
  assert.equal(view.detailPanel.drag, null); assert.equal(memory['devkits.task-detail-width'], 600);
  handle.mouseDown({ position: { x: 1000 } }, cx);
  root.mouseMove({ position: { x: -5000 }, bounds: { width: 1400 } }, cx);
  assert.equal(view.detailPanel.width, 880);
  root.mouseUp({}, cx);
  root.sizeChange({ width: 700, height: 700 }, cx);
  assert.equal(view.detailPanel.width, 380); // Leave 320px for the board.
  assert.equal(memory['devkits.task-detail-width'], 880); // A smaller window does not overwrite the preference.
  handle.mouseDown({ position: { x: 400 } }, cx);
  root.mouseMove({ position: { x: 5000 }, bounds: { width: 700 } }, cx);
  assert.equal(view.detailPanel.width, 360);
  root.mouseUp({}, cx);
  assert.equal(memory['devkits.task-detail-width'], 360);
  root.sizeChange({ width: 1400, height: 700 }, cx);
  handle.click({ click_count: 2 }, cx);
  assert.equal(view.detailPanel.width, 500);
});

test('closing details during a resize commits the width and removes the divider', async () => {
  const task = { gid: 'local:resize', source: 'local', name: 'Task', status: 'todo' };
  const board = await taskBoardFor({ [task.gid]: task });
  board.view.selected = task.gid; board.render();
  board.ui.nodes.get('board-detail-split-handle').mouseDown({ position: { x: 900 } }, board.cx);
  board.ui.nodes.get('board-detail-split').mouseMove({ position: { x: 820 } }, board.cx);
  board.ui.nodes.get('board-close-detail').click({}, board.cx);
  board.render();
  assert.equal(board.view.detailPanel.drag, null);
  assert.equal(board.memory['devkits.task-detail-width'], 580);
  assert.ok(!board.ui.nodes.has('board-detail-split-handle'));
});

test('Linear task property menus filter options and select with Enter without submitting typed spaces', async () => {
  const task = { gid: 'local:properties', source: 'local', name: 'Task', status: 'todo' };
  const board = await taskBoardFor({ [task.gid]: task });
  board.view.selected = task.gid; board.render();
  board.ui.nodes.get('board-task-status').click({}, board.cx); board.render();
  assert.ok(board.ui.nodes.has('board-task-status-search'));
  board.view.statusSelect.search.edit('done'); board.render();
  assert.ok(board.ui.nodes.has('board-task-status-option-done'));
  assert.ok(!board.ui.nodes.has('board-task-status-option-todo'));
  board.ui.nodes.get('board-task-status-options').keyDown({ key: 'enter' }, board.cx);
  assert.equal(board.memory['devkits.agent-board'][board.key][task.gid].status, 'done');
  assert.equal(board.view.statusSelect.open, false);
  board.view.setStatus(board.project, task.gid, 'todo'); board.render();
  board.ui.nodes.get('board-task-priority').click({}, board.cx); board.render();
  board.view.prioritySelect.search.edit('No priority'); board.render();
  board.ui.nodes.get('board-task-priority-options').keyDown({ key: 'space' }, board.cx);
  assert.equal(board.view.prioritySelect.open, true);
  assert.equal(board.memory['devkits.agent-board'][board.key][task.gid].priority, undefined);
  board.ui.nodes.get('board-task-priority-options').keyDown({ key: 'enter' }, board.cx);
  assert.equal(board.memory['devkits.agent-board'][board.key][task.gid].priority, 'none');
});

test('empty property searches stay harmless and reopening clears the search draft', async () => {
  const task = { gid: 'local:properties', source: 'local', name: 'Task', status: 'todo' };
  const board = await taskBoardFor({ [task.gid]: task });
  board.view.selected = task.gid; board.render();
  board.ui.nodes.get('board-task-status').click({}, board.cx); board.render();
  board.view.statusSelect.search.edit('No matching status'); board.render();
  board.ui.nodes.get('board-task-status-options').keyDown({ key: 'down' }, board.cx);
  board.ui.nodes.get('board-task-status-options').keyDown({ key: 'enter' }, board.cx);
  assert.equal(board.memory['devkits.agent-board'][board.key][task.gid].status, 'todo');
  assert.equal(board.view.statusSelect.open, true);
  board.ui.nodes.get('board-task-status-options').keyDown({ key: 'escape' }, board.cx);
  board.render(); board.ui.nodes.get('board-task-status').click({}, board.cx);
  assert.equal(board.view.statusSelect.search.value(), '');
  board.render(); assert.ok(board.ui.nodes.has('board-task-status-option-todo'));
});

test('confirming an Asana selection closes the picker and opens a Tasks draft without launching a session', async () => {
  const project = { id: 'one', name: 'One', folder: '/Code/one', active: true, tabs: [] }, drafts = [], closed = [], commands = [];
  const source = { gid: 'a1', name: 'Selected source', notes: 'Source instructions', comments: [] };
  const View = await viewFor({ props: () => ({ view: 'asana', project, overlay: 'asana' }),
    spaces: () => [project], closeOverlay: id => closed.push(id), openTaskComposer: (...args) => drafts.push(args),
    run: (...args) => commands.push(args) });
  const view = new View();
  view.asana = { render: (bound, onImport) => { assert.equal(bound, project); onImport(source); } };
  view.asanaPanel({});
  assert.deepEqual(closed, ['asana']); assert.deepEqual(drafts, [[project, null, 'todo', source]]);
  assert.deepEqual(commands, []);
});

test('imported local Todo descriptions remain editable and their source links open without changing Tasks', async () => {
  const asana = { gid: 'a1', url: 'https://app.asana.com/0/p/a1', comments: [{ author: 'Amy', text: 'Source context' }] };
  const board = await taskBoardFor({ 'local:import': { gid: 'local:import', source: 'local', name: 'Imported', status: 'todo', notes: 'Original', asana } });
  board.ui.nodes.get('board-card-local:import').click({}, board.cx); board.render();
  assert.ok(board.ui.nodes.has('board-task-description')); assert.ok(board.ui.nodes.has('board-delete-task'));
  board.view.description.edit('Original\nAdditional requirement');
  assert.equal(board.memory['devkits.agent-board'][board.key]['local:import'].notes, 'Original\nAdditional requirement');
  assert.deepEqual(board.memory['devkits.agent-board'][board.key]['local:import'].asana, asana);
  const urls = []; board.ui.nodes.get('board-asana-source').click({}, { open_url: url => urls.push(url) });
  assert.deepEqual(urls, [asana.url]);
});
