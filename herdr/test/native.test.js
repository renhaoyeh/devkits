import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ruleModules, ruleSelection, splitRuleGuide, composeRuleGuide, defaultRules, ruleSettingsKey } from '../mods/devkits-agents/global-rules-model.js';
import { threadTitle, projectGroups, projectCatalog, folderKey, launcherChoices, launcherLabel, launcherOption, accountAddresses, noAccountLabel, codexPermissionModes, isAccountLauncher, autoAgent, autoRank, autoMultipliers, autoMultiplier, planMultiplier, planLabel, autoLauncherKey, permissionModes, launcherArgv, sessionArgv, tasksMcpServer, sessionKind, claudeModels, claudeEfforts, codexHome, codexModels, mergeModels, orderedOptions, moveOption, effortLabel, sessionChoices, quotaResetLabel, quotaElapsedPercent, resolveThreadProfiles, threadProfile, threadProgram, archivable, agentCommand, commandKind, resumeArgv, codexSessionId, archivedAge, rulesArgv, childTerminals, terminalLabel, terminalWorking, settingsKey, configuredAgents } from '../mods/devkits/components/session-model.js';
import { install } from '../install.js';
import { syncShared } from '../sync-shared.js';
import { evaluateNative } from './source-harness.js';
import { terminalArgv } from '../mods/devkits/components/session-shell.js';
import { taskTokenId } from '../mods/devkits/components/tasks-model.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const tasksMcpFlags = provider => provider === 'codex'
  ? ['-c', 'mcp_servers.herdr_tasks={command="node",args=["/herdr/mods/devkits-tasks/mcp-server.cjs"],env={HERDR_APP_HOME="/herdr"},env_vars=["HC_TERMINAL_ID"]}']
  : ['--mcp-config', JSON.stringify({ mcpServers: { herdr_tasks: { command: 'node', args: ['/herdr/mods/devkits-tasks/mcp-server.cjs'], env: { HERDR_APP_HOME: '/herdr' } } } })];
const renderContext = { focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {}, spawn() {} };

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

test('reopening empty projects keeps the internal terminal covered after native selection resets the stack', async () => {
  const ui = fakeElements(), commands = [], memory = {};
  const stack = { id: 'workspace-view', type: 'stack', active: 'main' };
  const spaces = ['one', 'two'].map(id => ({ id, active: id === 'one', tabs: [
    { id: `default-${id}`, name: '__devkits_default_terminal__', active: true },
  ] }));
  const View = await viewFor({ ...ui, props: () => ({}), theme: () => ({}), agents: () => [],
    spaces: () => spaces, layout: () => stack,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run: (name, args) => {
      commands.push([name, args]);
      if (name === 'space.select') for (const space of spaces) space.active = space.id === args.id;
      if (name === 'layout.select' && args.stack === stack.id) stack.active = args.child;
    }, setAgentOrder() {} });
  const view = new View(); view.folded = new Set(); view.render();
  assert.equal(stack.active, 'project-empty');
  for (const project of [spaces[1], spaces[0]]) {
    view.selectProject(project);
    view.render();
    assert.equal(stack.active, 'project-empty');
    assert.ok(!ui.nodes.has(`thread-default-${project.id}`));
  }
  stack.active = 'main'; // A restored native layout may reveal the terminal again.
  view.render();
  assert.equal(stack.active, 'project-empty');
  assert.ok(!commands.some(([name]) => name === 'tab.close' || name === 'terminal.kill'));
});

test('empty projects hide a restored conversation area without clearing its preference', async () => {
  const ui = fakeElements(), memory = { 'devkits.conversation-visible': { '["","/Code/one"]': true } };
  const stack = { id: 'workspace-view', active: 'main', hidden: false };
  const project = { id: 'one', folder: '/Code/one', active: true, tabs: [] };
  let liveAgents = [], livePanes = [];
  const View = await viewFor({ ...ui, props: () => ({}), theme: () => ({}), spaces: () => [project],
    agents: () => liveAgents, panes: () => livePanes, layout: () => stack,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run: (name, args) => {
      if (args?.id === stack.id && ['layout.show', 'layout.hide'].includes(name)) stack.hidden = name === 'layout.hide';
      if (name === 'layout.select' && args.stack === stack.id) stack.active = args.child;
    }, setAgentOrder() {} });
  const view = new View(); view.folded = new Set();
  const check = expected => { view.render(); assert.equal(stack.hidden, !expected); };
  check(false);
  project.tabs = [{ id: 'default', name: '__devkits_default_terminal__', active: true }];
  stack.hidden = false; check(false);
  view.showConversation(true, project); assert.equal(stack.hidden, true);
  assert.equal(memory['devkits.conversation-visible']['["","/Code/one"]'], true);
  livePanes = [{ tab: 'default' }, { tab: 'default' }]; check(true);
  livePanes = []; liveAgents = [{ space: 'one', tab: 'default' }]; check(true);
  liveAgents = []; project.tabs = [{ id: 'thread', name: 'Terminal', active: true }]; check(true);
  project.tabs = []; check(false);
});

test('sidebar reads native panes and terminals once per frame and releases them for event-time checks', async () => {
  const ui = fakeElements(), reads = { panes: 0, terminals: 0 };
  const tabs = Array.from({ length: 30 }, (_, i) => ({ id: `shell-${i}`, name: `Shell ${i}` }));
  const project = { id: 'one', folder: '/project', tabs, active: true };
  const View = await viewFor({ ...ui, props: () => ({}), theme: () => ({}), spaces: () => [project],
    panes: () => { reads.panes++; return []; }, terminals: () => { reads.terminals++; return []; }, setAgentOrder() {} });
  const view = new View(), renderView = view.renderView; view.folded = new Set();
  view.renderView = function(cx) { reads.panes = reads.terminals = 0; return renderView.call(this, cx); };
  view.render();
  assert.deepEqual(reads, { panes: 1, terminals: 1 });
  assert.equal(view.renderModel, null);
  view.threadRow({ space: 'one', tab: tabs[0], agents: [] }, {});
  assert.deepEqual(reads, { panes: 2, terminals: 2 }, 'Actions outside a frame get fresh native state');
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
  const features = await Promise.all(['components/session-shell', 'components/shared-mcp-model', 'components/shared-mcp', 'components/agents', 'components/agent-selection', '../devkits-agents/shared-mcp-settings', '../devkits-agents/ecc-model', '../devkits-agents/ecc', '../devkits-agents/ecc-settings', '../devkits-agents/global-rules-model', '../devkits-agents/global-rules', '../devkits-agents/global-rules-settings', '../devkits-agents/discovery', '../devkits-agents/account-storage-model', '../devkits-agents/session-menu', 'start-panel', '../devkits-agents/agent-profiles', '../devkits-agents/account-actions', '../devkits-agents/session-preparation', 'components/usage', 'components/system-monitor-topology', 'components/system-monitor-model', 'components/system-monitor', 'components/tasks-model', 'components/tasks', 'system-display-model', 'system-display', 'ui-settings', 'run-app', 'thread-archive', 'branch-menu', 'project-layout', 'git-result-toast']
    .map(name => readFile(new URL(`../mods/devkits/${name}.js`, import.meta.url), 'utf8')));
  const agentsOwner = await readFile(new URL('../mods/devkits-agents/main.js', import.meta.url), 'utf8');
  const provider = await readFile(new URL('../mods/devkits-system/monitor.js', import.meta.url), 'utf8');
  const usageOwner = await Promise.all(['monitor', 'details'].map(name => readFile(new URL(`../mods/devkits-usage/${name}.js`, import.meta.url), 'utf8')));
  const domain = await Promise.all(['agent-board-model', 'agent-task-evidence', 'agent-board-state', 'runtime']
    .map(name => readFile(new URL(`../mods/devkits-tasks/${name}.js`, import.meta.url), 'utf8')));
  const strip = text => text.replace(/^import .*;\r?\n/gm, '').replace(/^export \{.*\}(?: from .*)?;\r?\n/gm, '').replace(/^export /gm, '');
  // The fixture runs the actual Tasks provider to publish a read model before the host renders.
  // Older task interaction cases invoke the moved runtime directly, with native host actions mocked.
  const fixture = `
    const Host = Devkits;
    class IntegratedDevkits extends Host {
      constructor() { super(); this.agentClient = { init() {}, close() {}, discover: discoverAgents, prepare: prepareSession }; this.taskSources = new TaskSources(); this.syncTaskSnapshot(); }
      init(p, cx) { return ['launcher', 'manage-launchers', 'agent-profile-editor', 'account-login', 'shared-mcp', 'rename-account', 'remove-account'].includes(props()?.view) ? AgentOwner.AgentsMod.prototype.init.call(this, p, cx) : super.init(p, cx); }
      renderView(cx) { return ['launcher', 'manage-launchers', 'agent-profile-editor', 'account-login', 'shared-mcp', 'rename-account', 'remove-account'].includes(props()?.view) ? AgentOwner.AgentsMod.prototype.render.call(this, cx) : super.renderView(cx); }
      syncTaskSnapshot() { Domain.TaskRuntime.prototype.resolveSessions.call(this); setShared('devkits.tasks.snapshot', Domain.TaskRuntime.prototype.snapshot.call(this)); }
      taskAssignees(project) { return Domain.TaskRuntime.prototype.taskAssignees.call(this, project); }
      boardPanel(project, cx) { return Domain.TaskRuntime.prototype.boardPanel.call(this, project, cx); }
      startThread(agent, target = props(), options = {}) {
        return target.task ? Domain.TaskRuntime.prototype.startThread.call(this, agent, target, options) : super.startThread(agent, target, options);
      }
      launchThread(agent, target, options) {
        return target.task ? Domain.TaskRuntime.prototype.launchThread.call(this, agent, target, options) : super.launchThread(agent, target, options);
      }
      navigate(event) { this.taskNavigation(event, { spawn: fn => fn({ notify() {} }) }); }
      context() { return { machine: this.projects().find(project => project.active)?.machine || null }; }
      active() { return shared('devkits.usage-visible') !== false; }
      snapshot() { return UsageOwner.UsageMonitor.prototype.snapshot.call(this); }
      publish() { return UsageOwner.UsageMonitor.prototype.publish.call(this); }
      refreshUsage(cx, force, manual) { return UsageOwner.UsageMonitor.prototype.refreshUsage.call(this, cx, force, manual); }
      entries(snapshot) { return UsageClient.prototype.entries.call(this, snapshot); }
      accountUsage(t) { return usageShownIn('sidebar') ? UsageClient.prototype.render.call(this, t, { style: usageStyle(), openMenu: at => openUsageDisplayMenu(at, 'sidebar') }) : div().h(0).flex_none(); }
      usageDetails(t) { return UsageOwner.UsageDetails.prototype.usageDetails.call(this, t); }
      drainTasks() {
        const service = new Domain.TaskRuntime(); service.projects = () => this.projects(); service.navigate = event => this.navigate(event);
        service.poll({ spawn: fn => fn({ notify() {} }), notify() {} }); this.syncTaskSnapshot();
      }
    }
    Object.assign(IntegratedDevkits.prototype, sessionMenu, agentProfiles, accountActions, sharedMcpSettings, eccSettings, globalRulesSettings);
    IntegratedDevkits.SystemMonitorCore = (() => { const SystemClient = SystemMonitor;
      ${strip(provider)}
      return SystemMonitorCore; })();
    IntegratedDevkits.UsageDetails = UsageOwner.UsageDetails;
    return IntegratedDevkits;
  `;
  return new Function('View', ...Object.keys(host), strip([...components, ...features].join('\n')) + '\n' +
    strip(source).replace('default class', 'class') + '\nconst Domain = (() => {\n' + strip(domain.join('\n')) +
    '\nreturn { TaskRuntime }; })();\nconst UsageOwner = (() => {\n' + strip(usageOwner.join('\n')) + '\nreturn { UsageMonitor, UsageDetails }; })();\nconst AgentOwner = (() => {\n' + strip(agentsOwner).replace('default class', 'class') + '\nreturn { AgentsMod }; })();\n' + fixture);
}
async function viewFor(host) {
  const memory = {};
  let rendering = false;
  const input = host.InputState || { new: () => ({ text: '', events: {}, value() { return this.text; },
    set_value(value) { assert.equal(rendering, false, 'retained input values must change outside render'); this.text = value; },
    on(name, action) { this.events[name] = action; } }) };
  host = { run() {}, ensureClaudeStatusLine: async () => {}, TaskSources: class { init() {} open(project, source = 'asana') { return host.openOverlay?.({ mod: `devkits-${source}`, kind: 'dialog', modal: false, frame: 'none', width: 0.9, height: 0.86, props: { context: project } }); } }, savedTasks: () => [], agents: () => [], spaces: () => [], projectCatalog, projectGroups, threadTitle, folderKey, launcherChoices, launcherLabel, launcherOption, accountAddresses, noAccountLabel, isAccountLauncher, autoAgent, autoRank, autoMultipliers, autoMultiplier, planMultiplier, planLabel, autoLauncherKey, permissionModes, launcherArgv, sessionArgv, tasksMcpServer, sessionKind, claudeModels, claudeEfforts, codexHome, codexModels, mergeModels, orderedOptions, moveOption, effortLabel, sessionChoices, home: () => '/home', quotaResetLabel, quotaElapsedPercent, resolveThreadProfiles, threadProfile, threadProgram, archivable, agentCommand, commandKind, resumeArgv, codexSessionId, archivedAge, rulesArgv, childTerminals, terminalLabel, terminalWorking, settingsKey, configuredAgents, terminals: () => [], panes: () => [], focused: () => null, writeTextFile: async () => null, notify() {}, accountLabel: launcherLabel, readTextFile: async () => null, window: () => ({}), layout: () => null, keys: () => [], appHome: () => '/herdr', props: () => ({}), shared: key => memory[key],
    setShared: (key, value) => { memory[key] = value; }, exec: async () => ({ code: 0 }), nextCommand: () => new Promise(() => {}), ...host };
  const originalShared = host.shared, originalSetShared = host.setShared;
  let taskSnapshot;
  host.shared = key => key === 'devkits.tasks.snapshot' && taskSnapshot ? taskSnapshot : originalShared(key);
  host.setShared = (key, value) => { if (key === 'devkits.tasks.snapshot') { taskSnapshot = value; return; } originalSetShared(key, value); };
  host.InputState = { new: (...args) => { assert.equal(rendering, false, 'InputState.new cannot run during render'); return input.new(...args); } };
  const textarea = host.TextareaState || input;
  host.TextareaState = { new: (...args) => { assert.equal(rendering, false, 'TextareaState.new cannot run during render'); return textarea.new(...args); } };
  const factory = await loadView(host);
  const View = factory(class {}, ...Object.values(host)), render = View.prototype.render;
  View.prototype.render = function(...args) {
    this.syncTaskSnapshot(); rendering = true;
    try { return render.apply(this, args); } finally { rendering = false; }
  };
  return View;
}

async function systemViewFor(host) {
  const Parent = await viewFor(host);
  return class SystemFixture extends Parent {
    constructor() {
      super();
      this.systemMonitor = new Parent.SystemMonitorCore({ active: () => this.systemDisplay.active(),
        details: host.props?.()?.view === 'hardware-details', page: host.props?.()?.page, overlay: host.props?.()?.overlay,
        openDetails: page => host.openOverlay?.({ mod: 'devkits-system', width: 0.9, height: 0.82, props: { view: 'details', page } }),
      });
      this.systemDisplay.monitor = this.systemMonitor;
    }
    init(props, cx) {
      if (host.props?.()?.view === 'hardware-details') { this.systemDisplay.init(); this.systemMonitor.init(cx); }
      else super.init(props, cx);
    }
    render(cx) { return host.props?.()?.view === 'hardware-details' ? this.systemMonitor.renderDetails(host.theme?.() || {}) : super.render(cx); }
  };
}

test('SystemMonitor keeps host and window state separate while coalescing reads across surfaces', async () => {
  const ui = fakeElements(), tasks = [], timers = [], reads = [], notifications = [];
  let target = {}, finish;
  const View = await systemViewFor({ ...ui, props: () => target,
    exec: (...args) => { reads.push(args); return new Promise(resolve => { finish = resolve; }); } });
  const sidebar = new View();
  target = { view: 'status' }; const status = new View();
  target = { view: 'hardware-details', page: 'cpu', overlay: 'monitor' }; const details = new View();
  const context = name => ({ ...renderContext, notify() { notifications.push(name); },
    timer: { every(ms, tick) { timers.push([name, ms, tick]); } },
    spawn(task) { tasks.push(task(this)); } });
  const sidebarContext = context('sidebar');
  sidebar.systemMonitor.init(sidebarContext);
  sidebar.systemMonitor.init(sidebarContext);
  status.systemMonitor.init(context('status'));
  details.systemMonitor.init(context('details'));
  assert.equal(reads.length, 1, 'The sidebar and details share the in-flight hardware read');
  assert.equal(timers.length, 3, 'Each surface starts its timer once');
  finish({ code: 0, stdout: JSON.stringify({ cpu: 25, cores: 2, sample: {}, updatedAt: Date.now() }) });
  await Promise.all(tasks);
  assert.equal(sidebar.systemMonitor.hardware.cpu, 25);
  assert.equal(details.systemMonitor.hardware.cpu, 25);
  assert.equal(status.systemMonitor.hardware, undefined, 'Status does not collect readings in Sidebar placement');
  assert.equal(sidebar.hardware, undefined, 'Hardware state belongs to the monitor, not its host');
  assert.equal(sidebar.refreshHardware, undefined);
  assert.equal(sidebar.systemMonitor.hardwareHistory, details.systemMonitor.hardwareHistory);
  assert.deepEqual(notifications.sort(), ['details', 'sidebar']);
  sidebar.systemMonitor.hardwareDrag = 'gpu';
  assert.equal(details.systemMonitor.hardwareDrag, undefined, 'Window-specific interaction state is isolated');
  assert.equal(details.systemMonitor.hardwarePage, 'cpu');
});

test('hardware refresh avoids overlap, clears failed readings and recovers with a new sample', async () => {
  const ui = fakeElements(), calls = [], tasks = [];
  let finish;
  const View = await systemViewFor({ ...ui, exec: (...args) => {
    calls.push(args); return new Promise(resolve => { finish = resolve; });
  } });
  const view = new View(), cx = { notify() {}, spawn(task) { tasks.push(task(cx)); } };
  view.systemMonitor.refresh(cx); view.systemMonitor.refresh(cx);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], undefined, 'Always read this computer, including with a remote project selected');
  const sample = { count: 2, total: 100, idle: 20 };
  finish({ code: 0, stdout: JSON.stringify({ sample, cpu: 42, memory: { used: 8 * 1024 ** 3, total: 16 * 1024 ** 3, percent: 50 } }) });
  await Promise.all(tasks.splice(0));
  view.systemDisplay.renderSidebar({});
  assert.ok(ui.textOf('system-cpu').includes('42%'));
  assert.ok(ui.textOf('system-ram-value').includes('16 GB'));
  assert.ok(ui.textOf('system-ram-subtitle').includes('8.0 GB used'));
  assert.ok(ui.textOf('system-ram-bar').includes('50%'));
  view.systemMonitor.refresh(cx);
  assert.deepEqual(JSON.parse(calls[1][1][1]), sample);
  finish({ code: 1 }); await Promise.all(tasks.splice(0));
  view.systemDisplay.renderSidebar({});
  assert.ok(ui.textOf('system-cpu').includes('Unavailable'));
  assert.ok(ui.textOf('system-ram').includes('Unavailable'));
  assert.equal(view.systemMonitor.hardwareSample, null);
  view.systemMonitor.refresh(cx);
  assert.equal(calls[2][1][1], 'null');
  finish({ code: 0, stdout: JSON.stringify({ sample, cpu: null, memory: null }) });
  await Promise.all(tasks.splice(0));
  view.systemDisplay.renderSidebar({});
  assert.ok(ui.textOf('system-cpu').includes('Sampling…'));
  assert.ok(ui.textOf('system-ram').includes('Unavailable'));
});

test('system monitor opens from each summary and refreshes hardware details while open', async t => {
  const ui = fakeElements(), opened = [], closed = [], ticks = [], tasks = [];
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let request = 0;
  const View = await systemViewFor({ ...ui, theme: () => ({}), props: () => ({ view: 'hardware-details', overlay: 'system-overlay' }),
    shared: key => key === 'devkits.system-monitor' ? { visible: { disk: true, network: true } } : key === 'devkits.system-display' ? { sidebar: { style: 'graph', cpuMode: 'total' } } : undefined,
    openOverlay: spec => opened.push(spec), closeOverlay: id => closed.push(id),
    exec: async () => ({ code: 0, stdout: JSON.stringify({ sample: { count: 10, total: 100, idle: 50 },
      cpu: ++request * 10, cores: 10, cpuName: 'Apple M4', load: [1, 2, 3],
      gpus: [{ name: 'Apple M4', percent: 12, renderer: 10, tiler: 2 }],
      memory: { used: 8 * 1024 ** 3, total: 16 * 1024 ** 3, percent: 50, pressure: 'Normal', swap: { used: 0, total: 1024 ** 3 } },
      disk: { used: 200 * 1024 ** 3, total: 500 * 1024 ** 3, free: 300 * 1024 ** 3, percent: 40, rates: { read: 1024, write: 2048 } },
      network: { name: 'en0', received: 10000, sent: 5000, rates: { received: 4096, sent: 2048 } },
      battery: { percent: 80, plugged: true, charging: false, health: 93, cycles: 23, temperature: 30.5 }, updatedAt: Date.now() }) }) });
  const view = new View(), cx = { ...renderContext, timer: { every(ms, tick) { ticks.push([ms, tick]); } },
    spawn(task) { tasks.push(task(cx)); } };
  view.init({}, cx); await Promise.all(tasks.splice(0)); view.render(cx);
  assert.deepEqual(ticks.map(([ms]) => ms), [1000]);
  assert.ok(ui.textOf('hardware-detail-cpu').includes('10%'));
  assert.ok(ui.textOf('hardware-detail-gpu').includes('12%'));
  assert.ok(ui.textOf('hardware-detail-ram').includes('Normal'));
  assert.ok(ui.textOf('hardware-detail-disk').includes('1.0 KB/s'));
  assert.ok(ui.textOf('hardware-detail-disk').includes('2.0 KB/s'));
  assert.ok(ui.textOf('hardware-detail-network').includes('en0 · download / upload'));
  ui.nodes.get('hardware-page-battery').click({}, cx); view.render(cx);
  assert.ok(ui.textOf('hardware-module-battery').includes('30.5 °C'));
  ui.nodes.get('hardware-page-overview').click({}, cx);
  now += 3001;
  ticks[0][1](cx); await Promise.all(tasks.splice(0)); view.render(cx);
  assert.ok(ui.textOf('hardware-detail-cpu').includes('20%'));
  view.systemDisplay.renderSidebar({});
  assert.ok(ui.textOf('system-disk-value').includes('500 GB'));
  assert.ok(ui.textOf('system-disk-subtitle').join(' ').includes('R1K/s W2K/s'));
  for (const id of ['network', 'disk']) {
    assert.equal(ui.nodes.get(`system-${id}-sparkline`).width, 116);
    assert.equal(ui.nodes.get(`system-${id}-sparkline`).height, 12);
    assert.ok(ui.nodes.has(`system-chart-${id}`));
  }
  for (const id of ['system-cpu', 'system-gpu', 'system-ram', 'system-disk', 'system-network', 'open-hardware-details']) ui.nodes.get(id).click();
  assert.ok(opened.every(spec => spec.props.view === 'details'));
  assert.ok(opened.every(spec => spec.width === 0.9), 'The monitor uses the window width rather than a fixed narrow dialog');
  assert.ok(ui.textOf('system-cpu-model').includes('Apple M4'));
  ui.nodes.get('hardware-details').keyDown({ key: 'escape' }, cx);
  ui.nodes.get('hardware-details-done').click();
  assert.deepEqual(closed, ['system-overlay', 'system-overlay']);
});

test('monitor settings persist module choices, order, interval, style and selected CPU cores', async () => {
  const ui = fakeElements(), memory = { 'devkits.system-monitor': { visible: { disk: true, battery: true } } };
  const View = await systemViewFor({ ...ui, shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
  const view = new View(), cx = renderContext;
  view.systemMonitor.hardware = { cores: 4, coreUsage: [10, 20, 30, 40], cpu: 25, cpuName: 'Fixture',
    gpus: [{ name: 'Apple M4', percent: 30, memory: { type: 'unified', total: 24 * 1024 ** 3, used: 1024 ** 3 } }],
    memory: { total: 24 * 1024 ** 3, used: 12 * 1024 ** 3, percent: 50, type: 'LPDDR5', manufacturer: 'Micron', model: 'MT-24G', speed: '5600 MHz' },
    battery: { percent: 75, plugged: false, charging: false }, disk: { model: 'APPLE SSD AP0512Z', percent: 50, rates: { read: 1024, write: 2048 } } };
  view.systemMonitor.hardwareSettings({});
  ui.nodes.get('hardware-visible-network').change(false, cx);
  ui.nodes.get('hardware-visible-storage').change(true, cx);
  ui.nodes.get('hardware-drag-battery').mouseDown({}, cx);
  ui.nodes.get('hardware-setting-row-storage').mouseMove({}, cx);
  assert.equal(memory['devkits.system-monitor'].order[6], 'battery', 'Hovering a drop target does not save an order');
  ui.nodes.get('hardware-setting-row-storage').mouseUp({}, cx);
  ui.nodes.get('hardware-interval-10').change(true, cx);
  memory['devkits.system-display'] = { sidebar: { visible: true, style: 'compact', cpuMode: 'cores' } };
  view.systemMonitor.hardwareSettings({});
  ui.nodes.get('hardware-core-1').change(false, cx);
  ui.nodes.get('hardware-core-3').change(false, cx);
  const reloaded = new View(); reloaded.systemMonitor.hardware = view.systemMonitor.hardware;
  ui.nodes.clear(); reloaded.systemDisplay.renderSidebar({});
  assert.ok(!ui.nodes.has('system-network'));
  assert.ok(ui.nodes.has('system-storage') && ui.nodes.has('system-disk') && ui.nodes.has('system-battery'));
  assert.ok(ui.nodes.has('system-core-bars-0') && ui.nodes.has('system-core-bars-2'));
  assert.equal(ui.nodes.get('system-core-bars').height, 12);
  assert.equal(ui.nodes.get('system-cpu-bar').width, ui.nodes.get('system-ram-bar').width);
  assert.equal(ui.nodes.get('system-cpu-usage').children.length, ui.nodes.get('system-ram-usage').children.length);
  assert.ok(!ui.nodes.has('system-core-bars-1') && !ui.nodes.has('system-core-bars-3'));
  assert.equal(reloaded.systemMonitor.hardware.cores, 4, 'Choosing displayed cores must not fabricate the detected core count');
  assert.deepEqual(memory['devkits.system-monitor'].cores, [0, 2]);
  assert.equal(memory['devkits.system-monitor'].interval, 10);
  assert.equal(memory['devkits.system-display'].sidebar.style, 'compact');
  assert.equal(memory['devkits.system-monitor'].order[3], 'battery');
  assert.ok(ui.textOf('system-disk-subtitle').join(' ').includes('R1K/s W2K/s'));
  assert.ok(ui.textOf('system-disk').includes('Disk I/O'));
  assert.ok(ui.textOf('system-disk-model').includes('APPLE SSD AP0512Z'));
  reloaded.systemMonitor.hardwareModuleDetails('disk', {});
  assert.ok(ui.textOf('hardware-module-disk').includes('All physical disks · disk images excluded'));
  assert.ok(ui.textOf('system-gpu-value').includes('24 GB unified'));
  assert.ok(ui.textOf('system-gpu-model').includes('Apple M4'));
  assert.ok(ui.textOf('system-gpu-subtitle').includes('1.0 GB used'));
  assert.ok(ui.textOf('system-ram').includes('RAM · LPDDR5'));
  assert.ok(ui.textOf('system-ram-subtitle').includes('12.0 GB used'));
  assert.ok(ui.textOf('system-ram-model').includes('Micron · MT-24G · 5600 MHz'));
  assert.ok(ui.textOf('system-cpu-model').includes('Fixture'));
  assert.ok(ui.textOf('system-storage-model').includes('APPLE SSD AP0512Z'));
  for (const [id, percent, filled] of [['ram', 50, 10], ['gpu', 30, 6], ['storage', 50, 10]]) {
    assert.ok(!ui.nodes.has(`system-chart-${id}`));
    assert.ok(ui.textOf(`system-${id}-bar`).includes(`${percent}%`));
    assert.equal([...ui.nodes.keys()].filter(key => new RegExp(`^system-${id}-bar-\\d+$`).test(key)).length, 20);
    assert.equal([...ui.nodes.keys()].filter(key => new RegExp(`^system-${id}-bar-\\d+-fill$`).test(key)).length, filled);
  }
  reloaded.systemMonitor.hardwareModuleDetails('ram', {});
  assert.ok(ui.textOf('hardware-module-ram').includes('LPDDR5'));
  assert.ok(ui.textOf('hardware-module-ram').includes('Micron'));
  reloaded.systemMonitor.hardwareModuleDetails('gpu', {});
  assert.ok(ui.textOf('hardware-module-gpu').includes('Unified · shared with CPU'));
  reloaded.systemMonitor.hardwareSettings({});
  for (const id of Object.keys(memory['devkits.system-monitor'].visible)) ui.nodes.get(`hardware-visible-${id}`).change(false, cx);
  ui.nodes.clear(); reloaded.systemDisplay.renderSidebar({}); reloaded.statusBar({});
  assert.ok(!ui.nodes.has('system-monitor-settings') && ui.nodes.has('open-hardware-details'));
  assert.ok(!ui.nodes.has('system-cpu') && !ui.nodes.has('system-battery'));
  reloaded.systemMonitor.hardwareSettings({}); ui.nodes.get('hardware-visible-battery').change(true, cx);
  reloaded.systemMonitor.hardware = { ...reloaded.systemMonitor.hardware, battery: null };
  ui.nodes.clear(); reloaded.systemDisplay.renderSidebar({});
  assert.ok(!ui.nodes.has('system-battery'));
  reloaded.systemMonitor.hardwareSettings({});
  assert.ok(ui.textOf('hardware-setting-row-battery').includes('No battery detected · appears when available'));
});

test('the host context menu toggles status monitoring independently of the sidebar', async () => {
  const ui = fakeElements(), opened = [], ticks = [], tasks = [];
  const memory = { 'devkits.system-display': null, 'devkits.system-monitor': { placement: 'sidebar', order: ['ram', 'cpu', 'disk', 'network'], visible: { gpu: false, storage: false, disk: true, network: true } } };
  let target = { view: 'status' };
  const View = await systemViewFor({ ...ui, theme: () => ({}), props: () => target,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    closeOverlay() {}, openOverlay: spec => opened.push(spec), exec: async () => ({ code: 0, stdout: JSON.stringify({ cpu: 25,
      memory: { total: 32 * 1024 ** 3, used: 8 * 1024 ** 3, percent: 25 },
      disk: { rates: { read: 1024 ** 2, write: 2048 } }, network: { rates: { received: 4096, sent: 0 } } }) }) });
  const view = new View(), cx = { ...renderContext, timer: { every: (ms, tick) => ticks.push([ms, tick]) },
    spawn: task => tasks.push(task(cx)) };
  const choose = key => {
    target = { view: 'system-display-menu', surface: 'status', overlay: 'display-menu' };
    const menu = new View(); menu.init({}, cx); menu.render(cx);
    ui.nodes.get(`system-display-${key}`).click({}, cx); target = { view: 'status' };
  };
  view.init({}, cx);
  assert.equal(tasks.length, 0, 'The hidden status mount does not poll');
  choose('status');
  assert.equal(memory['devkits.system-display'].sidebar.visible, true, 'Showing status leaves the sidebar enabled');
  ui.nodes.clear(); ticks[0][1](cx); await Promise.all(tasks.splice(0)); view.render(cx);
  assert.deepEqual(ticks.map(([ms]) => ms), [1000]);
  assert.ok(!ui.nodes.has('status-system-gpu'));
  assert.deepEqual(ui.textOf('status-system-ram'), ['RAM', '25%']);
  assert.deepEqual(ui.textOf('status-system-disk'), ['I/O', 'R1M/s W2K/s']);
  assert.deepEqual(ui.textOf('status-system-network'), ['↓4K/s ↑0B/s']);
  assert.deepEqual([...ui.nodes.keys()].filter(id => /^status-system-(?:ram|cpu|disk|network)$/.test(id)),
    ['status-system-ram', 'status-system-cpu', 'status-system-disk', 'status-system-network']);
  ui.nodes.get('status-system-ram').click(); choose('settings');
  assert.deepEqual(opened.map(spec => spec.props.page), ['ram', 'settings']);
  view.systemMonitor.hardwareSettings({});
  assert.ok(!ui.nodes.has('hardware-placement-status') && !ui.nodes.has('hardware-style-compact'));
  for (const id of ['ram', 'cpu', 'disk', 'network', 'battery']) ui.nodes.get(`hardware-visible-${id}`).change(false, cx);
  ui.nodes.clear(); view.render(cx);
  assert.ok(!ui.nodes.has('system-monitor-settings'));
  assert.equal([...ui.nodes.keys()].filter(id => /^status-system-(?:ram|cpu|disk|network)$/.test(id)).length, 0);
  choose('status');
  ui.nodes.clear(); view.render(cx); ticks[0][1](cx);
  assert.equal(tasks.length, 0, 'Hiding status pauses this mount');
  assert.equal(memory['devkits.system-display'].sidebar.visible, true);
});

test('SYSTEM right-click menus stay inside monitor targets and remain reachable after hiding', async () => {
  const ui = fakeElements(), opened = [], closed = [], memory = {};
  let target = {};
  const View = await systemViewFor({ ...ui, theme: () => ({}), props: () => target, setAgentOrder() {}, run() {},
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    openOverlay: spec => opened.push(spec), closeOverlay: id => closed.push(id) });
  const view = new View(); view.folded = new Set();
  const cx = { ...renderContext, spawn() {} };
  view.render(cx);
  assert.equal(ui.nodes.get('devkits-sidebar').mouseDownByButton?.right, undefined);
  assert.equal(ui.nodes.get('project-list').mouseDownByButton?.right, undefined);
  ui.nodes.get('system-usage').mouseDownByButton.right({ position: { x: 100, y: 300 } }, cx);
  assert.deepEqual(opened.at(-1).at, { x: 100, y: 300 });
  assert.equal(opened.at(-1).props.view, 'system-display-menu');
  assert.equal(opened.at(-1).props.surface, 'sidebar');
  target = { ...opened.at(-1).props, overlay: 'display' };
  const menu = new View(); menu.init({}, cx); ui.nodes.clear(); menu.render(cx);
  assert.ok(!ui.nodes.has('system-display-status'));
  for (const style of ['inline', 'compact', 'graph']) assert.ok(!ui.nodes.has(`system-display-${style}`));
  assert.ok(ui.textOf('system-display-total').includes('Overall CPU'));
  assert.ok(ui.textOf('system-display-cores').includes('Per logical CPU'));
  // Keyboard chooses Overall CPU after the sidebar visibility control.
  const element = ui.nodes.get('system-display-menu');
  element.keyDown({ key: 'down' }, cx); element.keyDown({ key: 'enter' }, cx);
  assert.equal(memory['devkits.system-display'].sidebar.cpuMode, 'total');
  assert.equal(closed.at(-1), 'display');
  target = {}; view.systemMonitor.hardware = { cpu: 25, cores: 2 };
  ui.nodes.clear(); view.systemDisplay.renderSidebar({});
  assert.ok(ui.textOf('system-cpu').includes('25%'));
  assert.ok(ui.nodes.has('system-cpu-bar') && !ui.nodes.has('system-core-bars'));
  assert.equal(ui.nodes.get('system-cpu-bar').width, ui.nodes.get('system-ram-bar').width);
  assert.equal(ui.nodes.get('system-cpu-bar-segments').height, ui.nodes.get('system-ram-bar-segments').height);
  assert.equal(ui.nodes.get('system-cpu-usage').children.length, ui.nodes.get('system-ram-usage').children.length);
  assert.ok(ui.textOf('system-cpu-bar').includes('25%'));
  assert.ok(!ui.nodes.has('system-cpu-value'), 'CPU usage is shown once beside its bar');
  assert.equal([...ui.nodes.keys()].filter(key => /^system-cpu-bar-\d+-fill$/.test(key)).length, 5);
  assert.ok(ui.nodes.has('system-usage-resize') && !ui.nodes.has('sidebar-system-cpu'));
  target = { view: 'system-display-menu', surface: 'status', overlay: 'display' };
  const statusMenu = new View(); statusMenu.init({}, cx); ui.nodes.clear(); statusMenu.render(cx);
  assert.ok(!ui.nodes.has('system-display-sidebar') && !ui.nodes.has('system-display-inline') && !ui.nodes.has('system-display-cores'));
  ui.nodes.get('system-display-status').click({}, cx);
  assert.equal(memory['devkits.system-display'].status.visible, true);
  assert.equal(memory['devkits.system-display'].sidebar.visible, true);
  menu.render(cx); ui.nodes.get('system-display-sidebar').click({}, cx);
  target = {}; ui.nodes.clear(); view.render(cx); view.statusBar({});
  assert.ok(!ui.nodes.has('system-usage'));
  for (const id of ['devkits-status', 'status-actions', 'status-workspace-actions', 'open-calendar'])
    assert.equal(ui.nodes.get(id).mouseDownByButton?.right, undefined, `${id} must not open SYSTEM's menu`);
  ui.nodes.get('status-system').mouseDownByButton.right({ position: { x: 400, y: 700 } }, cx);
  assert.equal(opened.at(-1).props.view, 'system-display-menu');
  assert.equal(opened.at(-1).props.surface, 'status');
  assert.ok(!ui.nodes.has('system-monitor-settings'));
  ui.nodes.get('open-interface-settings').click();
  assert.equal(opened.at(-1).props.view, 'ui-settings', 'Settings remain reachable while sidebar monitoring is hidden');
  target = { view: 'system-display-menu', overlay: 'display' };
  const reloaded = new View(); reloaded.init({}, cx); reloaded.render(cx);
  ui.nodes.get('system-display-sidebar').click({}, cx);
  assert.equal(memory['devkits.system-display'].sidebar.style, 'compact');
  assert.equal(memory['devkits.system-display'].status.visible, true);
  assert.equal(memory['devkits.system-monitor'], undefined, 'Display changes never overwrite monitoring preferences');
  reloaded.render(cx);
  ui.nodes.get('system-display-menu').keyDown({ key: 'escape' }, cx);
  assert.equal(closed.at(-1), 'display');
});

test('SystemMonitor exposes data and independently mountable renderers without host layout decisions', async () => {
  const ui = fakeElements(), memory = { 'devkits.system-monitor': { placement: 'status', style: 'compact', sidebarHeight: 380 } };
  const View = await systemViewFor({ ...ui, shared: key => memory[key] });
  const monitor = new View().systemMonitor;
  monitor.hardware = { cpu: 42, cores: 2 }; monitor.hardwareHistory = [{ at: 1, cpu: 42 }];
  monitor.renderInline({}, { id: 'anywhere-inline' });
  monitor.renderWidgets({}, { id: 'anywhere-widgets', style: 'compact' });
  assert.deepEqual(ui.textOf('anywhere-inline-cpu'), ['CPU', '42%']);
  assert.ok(ui.nodes.has('anywhere-widgets-cpu'));
  assert.ok(!ui.nodes.has('system-usage') && !ui.nodes.has('system-usage-resize'), 'Only the host adds layout chrome');
  assert.equal(monitor.snapshot().data.cpu, 42);
  assert.deepEqual(monitor.snapshot().history, [{ at: 1, cpu: 42 }]);
  assert.ok(monitor.snapshot().widgets.includes('cpu'));
});

test('System row presets use actual card sizes and dragging snaps to a preset', async () => {
  const ui = fakeElements(), memory = {
    'devkits.system-monitor': { order: ['cpu', 'ram', 'disk'], visible: { disk: true, gpu: false, network: false, storage: false, battery: false, sensors: false } },
    'devkits.system-display': { enabled: true, sidebar: { visible: true, style: 'graph', heightMode: 'rows', rows: 2 } },
  };
  const View = await systemViewFor({ ...ui, theme: () => ({}), setAgentOrder() {},
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
  const view = new View(), cx = { ...renderContext, spawn() {} };
  const render = () => { ui.nodes.clear(); view.systemDisplay.renderSidebar({}); };
  render();
  ui.nodes.get('system-compact-cores-cpu-layout').sizeChange({ height: 52 }, cx);
  ui.nodes.get('system-compact-cores-ram-layout').sizeChange({ height: 38 }, cx);
  ui.nodes.get('system-compact-cores-disk-layout').sizeChange({ height: 60 }, cx); render();
  assert.equal(ui.nodes.get('system-usage').height, 123);
  memory['devkits.system-monitor'].order = ['disk', 'ram', 'cpu']; render();
  assert.equal(ui.nodes.get('system-usage').height, 131);
  memory['devkits.system-display'].sidebar.rows = 6; render();
  assert.equal(ui.nodes.get('system-usage').height, 183, 'No empty rows when fewer cards are available');
  view.systemDisplay.sidebarContainer(ui.element().id('row-test-sidebar'));
  const root = ui.nodes.get('row-test-sidebar');
  ui.nodes.get('system-usage-resize').mouseDown({ position: { y: 900 } }, cx);
  root.mouseMove({ position: { y: 1000 }, bounds: { height: 1200 } }, cx);
  root.mouseUp({}, cx); render();
  assert.equal(memory['devkits.system-display'].sidebar.rows, 2);
  assert.equal(Object.hasOwn(memory['devkits.system-display'].sidebar, 'height'), false);
  ui.nodes.get('system-usage-resize').click({ click_count: 2 }, cx);
  assert.equal(memory['devkits.system-display'].sidebar.rows, 4);
  view.systemDisplay.available = 228; render();
  assert.equal(ui.nodes.get('system-usage').height, 100);
  assert.equal(memory['devkits.system-display'].sidebar.rows, 4, 'Window changes preserve the selected preset');
});

test('auto System height fits content and only scrolls when available space is smaller', async () => {
  const ui = fakeElements(), memory = {
    'devkits.system-monitor': { order: ['cpu', 'ram', 'disk'], visible: { disk: true, gpu: false, network: false, storage: false, battery: false, sensors: false } },
    'devkits.system-display': { enabled: true, sidebar: { visible: true, style: 'graph', heightMode: 'auto', rows: 4 }, status: { visible: false } },
  };
  const View = await systemViewFor({ ...ui, theme: () => ({}), setAgentOrder() {}, run() {},
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
  const view = new View(); view.folded = new Set();
  const cx = { ...renderContext, spawn() {} }, render = () => { ui.nodes.clear(); view.render(cx); };
  render();
  ui.nodes.get('devkits-sidebar').sizeChange({ height: 1200 }, cx);
  ui.nodes.get('account-usage').sizeChange({ height: 200 }, cx);
  ui.nodes.get('system-compact-cores-cpu-layout').sizeChange({ height: 52 }, cx);
  ui.nodes.get('system-compact-cores-ram-layout').sizeChange({ height: 38 }, cx);
  ui.nodes.get('system-compact-cores-disk-layout').sizeChange({ height: 60 }, cx); render();
  assert.equal(ui.nodes.get('system-usage').height, 183, 'Auto fits the measured card layout');
  memory['devkits.system-display'].sidebar.cpuMode = 'total'; render();
  assert.equal(ui.nodes.get('system-usage').height, 183, 'Switching CPU modes reuses equal card heights before new measurements arrive');
  assert.ok(ui.nodes.has('system-compact-total-cpu-layout') && !ui.nodes.has('system-compact-cores-cpu-layout'), 'A new native measurement element receives the new mode callbacks');
  memory['devkits.system-display'].sidebar.cpuMode = 'cores'; render();
  assert.equal(ui.nodes.get('system-usage').height, 183, 'Returning to per-core mode keeps the full Auto height');
  ui.nodes.get('account-usage').sizeChange({ height: 300 }, cx); render();
  assert.equal(ui.nodes.get('system-usage').height, 183, 'Quota changes do not expand the monitor');
  ui.nodes.get('devkits-sidebar').sizeChange({ height: 500 }, cx); render();
  assert.equal(ui.nodes.get('system-usage').height, 72, 'Only constrained content scrolls');
  ui.nodes.get('devkits-sidebar').sizeChange({ height: 1200 }, cx); render();
  assert.equal(ui.nodes.get('system-usage').height, 183);
  memory['devkits.system-monitor'].visible.ram = false; render();
  assert.equal(ui.nodes.get('system-usage').height, 145, 'Only visible cards contribute to content height');
  memory['devkits.system-display'].sidebar.style = 'compact'; render();
  ui.nodes.get('system-compact-cores-cpu-layout').sizeChange({ height: 22 }, cx);
  ui.nodes.get('system-compact-cores-disk-layout').sizeChange({ height: 34 }, cx); render();
  assert.equal(ui.nodes.get('system-usage').height, 89, 'Measurements follow the selected card style');
  ui.nodes.get('system-usage').sizeChange({ height: 89 }, cx);
  assert.equal(memory['devkits.system-display'].sidebar.heightMode, 'auto');
  assert.equal(memory['devkits.system-display'].sidebar.rows, 4);
  ui.nodes.get('system-usage-resize').mouseDown({ position: { y: 900 } }, cx);
  ui.nodes.get('devkits-sidebar').mouseMove({ position: { y: 1000 }, bounds: { height: 1200 } }, cx);
  ui.nodes.get('devkits-sidebar').mouseUp({}, cx);
  assert.equal(memory['devkits.system-display'].sidebar.heightMode, 'rows');
  assert.ok([2, 4, 6].includes(memory['devkits.system-display'].sidebar.rows));
});

test('hardware ordering reuses drag handles, supports keyboard movement and cancels without changing preferences', async () => {
  const ui = fakeElements(), memory = {}, closed = [];
  const View = await systemViewFor({ ...ui, theme: () => ({}), shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    props: () => ({ view: 'hardware-details', page: 'settings', overlay: 'monitor' }), closeOverlay: id => closed.push(id) });
  const view = new View(); view.handle = { focus() {} }; view.render(renderContext);
  assert.ok(ui.textOf('hardware-setting-row-ram').includes('RAM'));
  assert.ok(ui.textOf('hardware-page-ram').includes('RAM'));
  assert.ok(!ui.nodes.has('hardware-order-cpu--1'));
  ui.nodes.get('hardware-drag-gpu').keyDown({ key: 'up', modifiers: { alt: true } }, renderContext);
  assert.equal(memory['devkits.system-monitor'].order[1], 'gpu');
  const order = [...memory['devkits.system-monitor'].order];
  ui.nodes.get('hardware-drag-battery').mouseDown({}, renderContext);
  ui.nodes.get('hardware-setting-row-cpu').mouseMove({}, renderContext);
  view.render(renderContext);
  assert.equal(ui.nodes.get('hardware-setting-row-battery').opacity, 0.5);
  ui.nodes.get('hardware-details').keyDown({ key: 'escape' }, renderContext);
  assert.equal(view.systemMonitor.hardwareDrag, null);
  assert.deepEqual(memory['devkits.system-monitor'].order, order);
  assert.deepEqual(closed, [], 'Escape cancels dragging before closing the monitor');
  ui.nodes.get('hardware-drag-battery').mouseDown({}, renderContext);
  ui.nodes.get('hardware-settings').hover(false, renderContext);
  assert.equal(view.systemMonitor.hardwareDrag, null);
  assert.deepEqual(memory['devkits.system-monitor'].order, order);
  ui.nodes.get('hardware-visible-cpu').change(false, renderContext);
  assert.equal(view.systemMonitor.hardwareDrag, null, 'Toggling visibility never starts a reorder');
  assert.deepEqual(memory['devkits.system-monitor'].order, order);
});

test('CPU detail renders Task Manager style processor histories, P/E groups and optional real sensor readings', async () => {
  const ui = fakeElements(), memory = {};
  const View = await systemViewFor({ ...ui, theme: () => ({}), props: () => ({ view: 'hardware-details', page: 'cpu' }),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
  const view = new View(); view.handle = { focus() {} };
  view.systemMonitor.hardware = { cpu: 40, cpuName: 'Fixture', cores: 4, coreUsage: [10, 20, 50, 80],
    topology: { physical: 3, logical: 4, sockets: 1, processors: [
      { index: 0, id: '0,0', logical: 0, group: 0, physical: 0, type: 'P' },
      { index: 1, id: '0,1', logical: 1, group: 0, physical: 0, type: 'P' },
      { index: 2, id: '0,2', logical: 2, group: 0, physical: 1, type: 'E' },
      { index: 3, id: '0,3', logical: 3, group: 0, physical: 2, type: 'E' },
    ] }, sensors: [{ id: 'cpu-temperature', name: 'CPU package', type: 'Temperature', value: 65, unit: '°C', source: 'Fixture provider' }] };
  view.render(renderContext);
  assert.ok([0,1,2,3].every(index => ui.nodes.has(`hardware-cpu-processor-${index}`) && ui.nodes.has(`hardware-cpu-history-${index}`)));
  assert.ok(ui.textOf('hardware-cpu-processor-0').includes('CPU 0 · P'));
  assert.ok(ui.textOf('hardware-cpu-processor-3').includes('CPU 3 · E'));
  assert.equal(ui.nodes.get('hardware-cpu-view-groups').click, undefined, 'Native toggles emit change rather than click');
  ui.nodes.get('hardware-cpu-view-groups').change(true, renderContext); view.render(renderContext);
  assert.ok(ui.nodes.has('hardware-cpu-group-P') && ui.nodes.has('hardware-cpu-group-E'));
  ui.nodes.get('hardware-cpu-view-groups').change(false, renderContext); view.render(renderContext);
  assert.equal(memory['devkits.system-monitor'].cpuGraph, 'groups', 'The selected radio-style option cannot turn itself off');
  ui.nodes.get('hardware-cpu-view-total').change(true, renderContext); view.render(renderContext);
  assert.ok(ui.nodes.has('hardware-detail-cpu'));
  view.systemMonitor.hardwarePage = 'sensors'; view.render(renderContext);
  assert.ok(ui.textOf('hardware-module-sensors').includes('65.0 °C'));
  assert.ok(ui.textOf('hardware-module-sensors').includes('Fixture provider'));
  assert.ok(ui.textOf('hardware-module-sensors').includes('Temperature points measure thermal zones. They do not correspond one-to-one with CPU cores.'));
  view.systemMonitor.hardware.platform = 'win32';
  view.systemMonitor.hardware.sensors = [{ id: 'nvidia:gpu', name: 'GPU temperature', type: 'Temperature', value: 47, unit: '°C', source: 'NVIDIA driver' }];
  ui.nodes.clear(); view.render(renderContext);
  assert.ok(ui.textOf('hardware-sensor-availability-cpu').includes('Unavailable'));
  assert.ok(ui.textOf('hardware-sensor-availability-gpu').includes('47.0 °C'));
  assert.ok(ui.textOf('hardware-module-sensors').some(text => text.includes('LibreHardwareMonitor WMI provider')));
});

test('Storage details groups partitions by physical disk and keeps shared or unknown volumes separate', async () => {
  const ui = fakeElements();
  const View = await systemViewFor({ ...ui, shared: () => null });
  const view = new View(), monitor = view.systemMonitor;
  const disk = { mount: 'C:', model: 'Same model', total: 10000, free: 4000, used: 6000, percent: 60 };
  const volume = (mount, driveIds, poolId = null) => ({ id: mount, mount, mounts: [mount], type: 'NTFS', total: 5000, used: 3000,
    free: 2000, percent: 60, system: mount === 'C:', driveIds, poolId });
  monitor.hardware = { disk, storage: { available: true,
    drives: [{ id: 'b', device: 'disk1', model: 'Same model', total: 20000 }, { id: 'a', device: 'disk0', model: 'Same model', total: 10000 }],
    volumes: [volume('C:', ['a']), volume('D:', ['a']), volume('Unknown:', [])], pools: [] } };
  monitor.hardwareModuleDetails('storage', {});
  assert.ok(ui.textOf('hardware-storage-drive-a').some(text => text.includes('C:')));
  assert.ok(ui.textOf('hardware-storage-drive-a').some(text => text.includes('D:')));
  assert.ok(ui.textOf('hardware-storage-drive-b').includes('No mounted volumes'));
  assert.ok(!ui.textOf('hardware-storage-drive-a').some(text => text.includes('Unknown:')));
  assert.ok(ui.textOf('hardware-module-storage').includes('Shared or unmapped volumes'));
  assert.deepEqual([...ui.nodes.keys()].filter(id => id.startsWith('hardware-storage-drive-')), ['hardware-storage-drive-a', 'hardware-storage-drive-b']);
  view.systemDisplay.renderSidebar({});
  assert.ok(ui.textOf('system-storage').includes('Storage · 2 disks'));
  assert.ok(ui.textOf('system-storage-model').includes('C: · Same model'));
  monitor.hardware.storage.volumes = [volume('System', ['a'], 'apfs:disk3'), volume('Data', ['a'], 'apfs:disk3')].map(row => ({ ...row, type: 'APFS' }));
  monitor.hardware.storage.pools = [{ id: 'apfs:disk3', device: 'disk3', driveIds: ['a'], total: 10000, used: 6000, free: 4000 }];
  ui.nodes.clear(); monitor.hardwareModuleDetails('storage', {});
  assert.equal(ui.textOf('hardware-module-storage').filter(text => text === 'APFS shared pool · disk3').length, 1);
  assert.ok(ui.textOf('hardware-storage-System').includes('APFS · Shares pool capacity'));
});

test('Settings controls persist independent storage, I/O and temperature selections and measure every expanded card', async () => {
  const ui = fakeElements(), memory = { 'devkits.system-monitor': { visible: { cpu: false, ram: false, gpu: false, storage: true, disk: false, sensors: false } } };
  const View = await systemViewFor({ ...ui, shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
  const view = new View(), monitor = view.systemMonitor;
  const volume = (id, mount, system) => ({ id, mount, mounts: [mount], system, type: 'NTFS', driveIds: ['drive:a'], total: 10000, used: 4000, free: 6000, percent: 40 });
  monitor.hardware = { disk: { mount: 'C:', model: 'Drive A', total: 10000, used: 4000, free: 6000, percent: 40 },
    storage: { available: true, drives: [{ id: 'drive:a', device: 'disk0', model: 'Drive A', total: 10000 }], pools: [],
      volumes: [volume('volume:c', 'C:', true), volume('volume:d', 'D:', false)] },
    diskIO: [{ id: 'drive:a', model: 'Drive A', device: 'disk0', total: 10000, supported: true, rates: { read: 2048, write: 1024 } }],
    sensors: [{ name: 'CPU temperature', type: 'Temperature', value: 70 }, { name: 'GPU temperature', type: 'Temperature', value: 45 }] };
  monitor.hardwarePage = 'settings';
  monitor.renderDetails({});
  assert.ok(ui.nodes.has('hardware-display-settings'));
  assert.ok(ui.nodes.get('hardware-monitoring-settings').children.includes(ui.nodes.get('hardware-display-settings').element),
    'Display controls appear directly in the Settings right column');
  assert.ok(ui.textOf('hardware-display-settings').includes('Storage volumes'));
  assert.ok(ui.textOf('hardware-display-settings').includes('Disk activity'));
  assert.ok(ui.textOf('hardware-display-settings').includes('Temperatures'));
  assert.ok(!ui.nodes.has('hardware-choose-overview'));
  assert.ok(ui.nodes.has('hardware-disk-combined'));
  assert.ok(ui.nodes.has('hardware-display-temperature-gpu'));
  assert.equal(ui.nodes.get('hardware-display-volume:c').checked, true);
  ui.nodes.get('hardware-display-volume:d').change(true, renderContext);
  assert.deepEqual(memory['devkits.system-monitor'].storageVolumes, ['volume:c', 'volume:d']);
  ui.nodes.clear(); monitor.renderDetails({});
  ui.nodes.get('hardware-display-volume:c').change(false, renderContext);
  const measured = [];
  ui.nodes.clear(); monitor.renderWidgets({}, { id: 'selection', onWidgetSize: id => measured.push(id) });
  assert.ok(ui.textOf('selection-volume%3Ad-storage').includes('Storage · D:'));
  ui.nodes.get('selection-volume%3Ad-compact-total-storage-layout').sizeChange({ height: 60 }, renderContext);
  assert.deepEqual(measured, ['storage:volume:d']);
  monitor.renderDetails({}); ui.nodes.get('hardware-display-io-drive:a').change(true, renderContext);
  assert.deepEqual(memory['devkits.system-monitor'].ioDisks, ['drive:a']);
  assert.equal(memory['devkits.system-monitor'].visible.disk, true);
  ui.nodes.clear(); monitor.renderWidgets({});
  assert.ok(ui.textOf('system-drive%3Aa-disk-subtitle').join(' ').includes('R2K/s W1K/s'));
  monitor.renderDetails({});
  ui.nodes.get('hardware-display-temperature-cpu').change(false, renderContext);
  ui.nodes.get('hardware-display-temperature-ssd').change(false, renderContext);
  assert.deepEqual(memory['devkits.system-monitor'].temperatureGroups, ['gpu']);
  ui.nodes.clear(); monitor.renderWidgets({});
  assert.ok(ui.nodes.has('system-sensor-gpu'));
  assert.ok(!ui.nodes.has('system-sensor-cpu') && !ui.nodes.has('system-sensor-ssd'));
  monitor.renderDetails({}); ui.nodes.get('hardware-display-temperature-gpu').change(false, renderContext);
  assert.equal(memory['devkits.system-monitor'].visible.sensors, false);
  monitor.hardware.storage.volumes = monitor.hardware.storage.volumes.filter(row => row.id !== 'volume:d');
  ui.nodes.clear(); monitor.renderDetails({});
  assert.ok(ui.nodes.has('hardware-display-volume:d'), 'An unavailable selection can still be removed');
  ui.nodes.get('hardware-display-volume:d').change(false, renderContext);
  assert.deepEqual(memory['devkits.system-monitor'].storageVolumes, []);
  monitor.renderDetails({}); ui.nodes.get('hardware-disk-combined').change(true, renderContext);
  assert.equal(memory['devkits.system-monitor'].ioDisks, null);
  ui.nodes.get('hardware-storage-system-default').click({}, renderContext);
  assert.equal(memory['devkits.system-monitor'].storageVolumes, null);
  assert.equal(memory['devkits.system-monitor'].visible.storage, true);
  for (const page of ['overview', 'storage', 'disk', 'sensors']) {
    monitor.hardwarePage = page;
    ui.nodes.clear(); monitor.renderDetails({});
    assert.ok(!ui.nodes.has('hardware-display-volume:c'));
    assert.ok(!ui.nodes.has('hardware-disk-combined'));
    assert.ok(!ui.nodes.has('hardware-display-temperature-cpu'));
  }
  monitor.hardwarePage = 'settings';
  monitor.hardware = null;
  memory['devkits.system-monitor'].visible = Object.fromEntries(['cpu', 'ram', 'gpu', 'storage', 'network', 'disk', 'battery', 'sensors'].map(id => [id, false]));
  ui.nodes.clear(); monitor.renderDetails({});
  assert.equal(monitor.hardwarePage, 'settings');
  assert.ok(ui.nodes.has('hardware-display-settings'), 'Choices remain reachable with no readings and every widget hidden');
  assert.ok(ui.nodes.has('hardware-disk-combined'));
  assert.ok(ui.nodes.has('hardware-display-temperature-cpu'));
});

test('opening a monitor reuses warm data without requesting a repaint during initialization', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const cache = { checkedAt: Date.now(), sensorCollection: false, error: false, history: [], sample: {},
    data: { cpu: 10, cores: 2, cpuName: 'Fixture', updatedAt: Date.now() } };
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true,
    value: { sessionStorage: { getItem: () => JSON.stringify(cache) } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  const View = await systemViewFor({ props: () => ({ view: 'hardware-details' }) });
  let notifications = 0;
  const cx = { focus_handle: () => ({ focus() {} }), timer: { every() {} }, notify() { notifications++; },
    spawn() { assert.fail('A warm cache must not start another hardware reader'); } };
  const view = new View(); view.init({}, cx);
  assert.equal(view.systemMonitor.hardware.cpu, 10);
  assert.equal(notifications, 0, 'Initialization already renders; notification here breaks live reload');
  cache.checkedAt++; cache.data.cpu = 20;
  view.systemMonitor.poll(cx);
  assert.equal(view.systemMonitor.hardware.cpu, 20);
  assert.equal(notifications, 1);
});

test('Windows starts legacy account launchers locally and preserves commands on remote machines', async () => {
  const agent = { key: 'devkits-codex-work', name: 'Work', run: ['env', 'CODEX_HOME=C:/Account', 'codex'] };
  for (const machine of [null, 'linux-server']) {
    const commands = [];
    const View = await viewFor({ window: () => ({ platform: 'windows' }),
      spaces: () => [{ id: 'api', machine, tabs: [] }], run: (...args) => commands.push(args) });
    await new View().launchThread(agent, { space: 'api', folder: 'C:/Project' }, {});
    const argv = commands.find(([name]) => name === 'tab.new')[1].argv;
    assert.equal(argv[0], machine ? 'env' : 'git');
    assert.deepEqual(argv, machine ? agent.run : terminalArgv([...rulesArgv(agent, agent.run), ...tasksMcpFlags('codex')], 'windows'));
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
        if (key === 'on_mouse_down') { data.mouseDown = args[1]; (data.mouseDownByButton ||= {})[args[0]] = args[1]; }
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
  return { nodes, texts, textOf, assets, element, div: element, svg: asset, image: asset, h_flex: element, v_flex: element, Input: { new: element },
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
  // The + menu only starts sessions; Agent settings lives in the thread ⋯ menu.
  assert.ok(!ui.nodes.has('manage-launchers-open'));
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
  assert.ok(!ui.nodes.has('manage-launchers-open'));
  target = { view: 'manage-launchers', space: 'api', page: 'agents', overlay: 'manage-dialog' };
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
  target = { view: 'manage-launchers', space: 'api', page: 'agents', overlay: 'manage-dialog-2' };
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
  const view = new View(); view.launchers = choices; view.manageIndex = 0; view.render(renderContext);
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
test('profile rename blocks duplicate saves, refreshes labels, and closes only itself above Settings', async () => {
  const ui = fakeElements(), overlays = [], closed = [], memory = { 'devkits.agent-cache': { old: [] } };
  let pending, resolve, calls = 0;
  const View = await viewFor({ ...ui, theme: () => ({}),
    props: () => ({ view: 'rename-account', overlay: 'rename', space: 'project', account: { key: 'devkits-codex-work', name: 'Codex · Work' } }),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    closeOverlay: id => closed.push(id), openOverlay: value => overlays.push(value),
    renameAccountProfile: async (key, name) => {
      calls++; assert.equal(key, 'devkits-codex-work'); assert.equal(name, '工作');
      await new Promise(done => { resolve = done; });
    } });
  const view = new View(); view.renameInput = { value: () => '工作' };
  const cx = { notify() {}, spawn: fn => { pending = fn(cx); } };
  view.saveAccountName(cx); view.saveAccountName(cx); view.finishRename();
  assert.equal(calls, 1); assert.deepEqual(closed, []);
  resolve(); await pending;
  assert.deepEqual(memory['devkits.agent-cache'], {});
  assert.equal(memory['devkits.profile-revision'], 1);
  assert.deepEqual(closed, ['rename']); assert.equal(overlays.length, 0);
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
  const view = new View(); view.initSessionMenu({ ...renderContext, spawn() {}, timer: { every() {} } }); view.launchers = [{ key: 'codex', name: 'Codex' }, { key: 'devkits-codex-work', name: 'Codex · Work' }];
  view.manageIndex = 0; view.settingsPage = 'accounts'; view.selectedAccount = 'devkits-codex-work'; view.render(renderContext);
  assert.ok(!ui.nodes.has('account-menu-codex'));
  ui.nodes.get('account-actions-devkits-codex-work-remove').click({}, renderContext);
  assert.deepEqual(removed, []);
  assert.equal(overlays[0].props.view, 'remove-account');
  target = { ...overlays[0].props, overlay: 'confirm' };
  const prompt = new View(); prompt.render(renderContext);
  ui.nodes.get('cancel-remove-account').click();
  // The confirmation stacks above Settings and closes only itself.
  assert.equal(overlays[0].modal, true); assert.deepEqual(closed, ['confirm']);
  assert.deepEqual(removed, []); assert.equal(overlays.length, 1);
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
  assert.equal(memory['devkits.profile-revision'], 1);
  assert.deepEqual(closed, ['confirm', 'confirm']); assert.equal(overlays.length, 1);
});
test('profile permissions apply independently from Settings to the selected account', async () => {
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
  const settings = (page, account) => { target = { view: 'manage-launchers', overlay: 'settings', space: 'api', page };
    view.initSessionMenu({ ...cx, spawn() {}, timer: { every() {} } }); view.launchers = launchers; view.selectedAccount = account; ui.nodes.clear(); view.render(cx); };
  const pick = (section, key) => { ui.nodes.get(`defaults-${section}-select`).openChange(true, cx); view.render(cx);
    ui.nodes.get(`defaults-${section}-option-${key}`).click({}, cx); view.render(cx); };
  settings('agents');
  assert.ok(['accounts', 'agents', 'agent-profiles'].every(page => ui.nodes.has(`settings-page-${page}`)));
  assert.ok(!ui.nodes.has('settings-page-usage'));
  assert.ok(!ui.nodes.has('settings-page-models'));
  assert.ok(![...ui.nodes.keys()].some(id => id.startsWith('defaults-') || id.startsWith('permissions-')));
  // Select the Codex account through the current Accounts page.
  settings('accounts', 'codex');
  assert.ok(ui.nodes.has('account-defaults-panel-codex'));
  pick('permissions', 'read-only');
  assert.deepEqual(memory['devkits.codex-permissions'], { codex: 'read-only' });
  assert.ok(ui.textOf('defaults-permissions').includes('Read only'));
  commands.length = 0;
  target = { view: 'launcher', overlay: 'menu', space: 'api', folder: '/Code/api' }; view.startThread(codex);
  await settle();
  assert.deepEqual(commands.find(([name]) => name === 'tab.new')[1].argv,
    [...rulesArgv(codex, ['codex']), ...tasksMcpFlags('codex'), '--sandbox', 'read-only', '--ask-for-approval', 'on-request']);
  // Another profile retains its own launcher permissions.
  target = { ...target, space: null, projectName: 'New project' }; await view.startThread(work);
  assert.deepEqual(commands.find(([name]) => name === 'space.new')[1].argv,
    [...rulesArgv(work, ['env', 'CODEX_HOME=/accounts/work', 'codex']), ...tasksMcpFlags('codex'), '--no-daemon']);
  settings('accounts', 'codex');
  pick('permissions', 'default');
  assert.deepEqual(memory['devkits.codex-permissions'], {});
  ui.nodes.get('account-claude').click({}, cx); ui.nodes.clear(); view.render(cx);
  assert.ok(ui.nodes.has('account-defaults-panel-claude') && !ui.nodes.has('account-defaults-panel-codex'));
  ui.nodes.get('manage-launchers-done').click();
  assert.equal(closed.at(-1), 'settings');
});
test('shared MCP details stay read-only and refreshing does not write configuration', async () => {
  const ui = fakeElements(); let pending;
  let original = JSON.stringify({ version: 1, servers: {
    vs: { command: 'bridge', args: ['hello world', 'line\narg'], startup_timeout_sec: 45, env_vars: ['PATH'] },
    search: { url: 'http://localhost:9000/mcp', enabled: false, env_http_headers: { 'X-Client': 'CLIENT_ID' } },
  } });
  const cx = { ...renderContext, spawn: fn => { pending = fn(cx); } };
  const View = await viewFor({ ...ui, props: () => ({ view: 'shared-mcp', overlay: 'mcp' }), theme: () => ({}),
    readTextFile: async () => original, writeTextFile: () => assert.fail('read-only MCP must never write') });
  const view = new View(); view.init({}, cx); await pending; view.render(cx);
  assert.ok(ui.texts.includes('bridge') && ui.texts.includes('Startup timeout (seconds)') && ui.texts.includes('45'));
  for (const id of ['mcp-add', 'mcp-transport', 'mcp-arg-add', 'mcp-remove', 'mcp-save', 'mcp-cancel']) assert.ok(!ui.nodes.has(id), id);
  assert.equal(view.saveSharedMcp, undefined);
  assert.ok(ui.texts.includes('hello world') && ui.texts.includes('line\narg'));
  assert.ok(ui.texts.includes('PATH'));
  assert.ok(!ui.texts.includes(JSON.stringify(['hello world', 'line\narg'], null, 2)));
  ui.nodes.get('mcp-select-search').click({}, cx); view.render(cx);
  assert.ok(ui.texts.includes('http://localhost:9000/mcp') && ui.texts.includes('Disabled'));
  assert.ok(ui.texts.some(text => String(text).includes('CLIENT_ID')));
  original = JSON.stringify({ version: 1, servers: { search: { url: 'http://localhost:9100/mcp' } } });
  ui.nodes.get('mcp-refresh').click({}, cx); await pending; view.render(cx);
  assert.equal(view.mcpSelected, 'search'); assert.ok(ui.texts.includes('http://localhost:9100/mcp'));
  original = JSON.stringify({ version: 1, servers: {} });
  ui.nodes.get('mcp-refresh').click({}, cx); await pending; ui.nodes.clear(); view.render(cx);
  assert.equal(view.mcpSelected, 'builtin:herdr_tasks');
  assert.ok(ui.nodes.has('mcp-select-builtin:herdr_tasks'));
  assert.ok(ui.texts.includes('Built-in · Managed automatically by Devkits.'));
  assert.ok(!ui.nodes.has('mcp-enabled'));
  view.toggleMcpEnabled(view.mcpRows[0], cx);
  assert.deepEqual(view.mcpConfig.servers, {});
  original = '{invalid'; view.initSharedMcp(cx); await pending;
  assert.ok(view.mcpError); assert.equal(view.mcpConfig, null);
});

test('MCP Enable saves only enabled with revision checks, blocks duplicate writes and preserves state on conflicts', async () => {
  const ui = fakeElements(), writes = []; let pending, finishWrite, conflict = false;
  const original = JSON.stringify({ version: 1, servers: { vs: { command: 'bridge', args: ['one'], startup_timeout_sec: 30 }, other: { url: 'http://localhost:9000/mcp', enabled: false } } });
  const cx = { ...renderContext, spawn: fn => { pending = fn(cx); } };
  const View = await viewFor({ ...ui, props: () => ({ view: 'shared-mcp' }), theme: () => ({}), readTextFile: async () => original,
    writeTextFile: async (...args) => { writes.push(args); if (conflict) throw Error('File changed'); await new Promise(resolve => { finishWrite = resolve; }); } });
  const view = new View(); view.init({}, cx); await pending; view.render(cx);
  const row = view.mcpRows[0];
  assert.equal(ui.nodes.get('mcp-enabled').click, undefined);
  ui.nodes.get('mcp-enabled').change(false, cx);
  assert.equal(row.enabled, true); assert.equal(view.mcpSaving, true);
  view.toggleMcpEnabled(row, cx); assert.equal(writes.length, 1);
  finishWrite(); await pending;
  assert.equal(row.enabled, false); assert.equal(writes[0][2], original);
  const expected = JSON.parse(original); expected.servers.vs.enabled = false;
  assert.deepEqual(JSON.parse(writes[0][1]), expected);
  conflict = true; view.toggleMcpEnabled(row, cx); await pending;
  assert.match(view.mcpError, /File changed/); assert.equal(row.enabled, false);
  assert.equal(writes[1][2], writes[0][1]);
  assert.deepEqual(view.mcpConfig, expected);
});

test('new local Codex sessions receive shared MCP settings and remote sessions do not read them', async () => {
  const commands = [], reads = [];
  const View = await viewFor({ spaces: () => [{ id: 'local', tabs: [] }, { id: 'remote', machine: 'server', tabs: [] }],
    run: (...args) => commands.push(args), readTextFile: async path => {
      reads.push(path); return path.endsWith('/codex-mcp.json') ? '{"version":1,"servers":{"vs":{"command":"bridge"}}}' : null;
    } });
  const view = new View(), agent = { key: 'codex', run: ['codex'] };
  await view.startThread(agent, { space: 'local', folder: '/local' });
  assert.ok(commands.find(([name]) => name === 'tab.new')[1].argv.includes('mcp_servers.vs={"command"="bridge"}'));
  const before = reads.length; commands.length = 0;
  await view.startThread(agent, { space: 'remote', folder: '/remote' });
  assert.equal(reads.length, before);
  assert.deepEqual(commands.find(([name]) => name === 'tab.new')[1].argv, ['codex']);
});

test('account actions are direct buttons on Accounts and Shared MCP stays out of Settings', async () => {
  const ui = fakeElements(), overlays = [];
  const View = await viewFor({ ...ui, props: () => ({ view: 'manage-launchers', overlay: 'manage' }),
    spaces: () => [], theme: () => ({}), closeOverlay() {}, openOverlay: value => overlays.push(value) });
  const view = new View(); view.initSessionMenu({ ...renderContext, spawn() {}, timer: { every() {} } });
  view.launchers = [{ key: 'codex', name: 'Codex', run: ['codex'] }, { key: 'devkits-codex-work', name: 'Work', run: ['codex'] }];
  view.settingsPage = 'accounts'; view.render(renderContext);
  assert.ok(!ui.nodes.has('shared-local-mcp'));
  // The default account has no Rename or Remove; selecting an added account shows them beside its details.
  assert.ok(!ui.nodes.has('account-actions-codex-rename'));
  ui.nodes.get('account-devkits-codex-work').click({}, renderContext); ui.nodes.clear(); view.render(renderContext);
  assert.ok(ui.nodes.has('account-actions-devkits-codex-work-rename'));
  assert.ok(ui.nodes.has('account-actions-devkits-codex-work-remove'));
  assert.ok(!ui.nodes.has('account-menu-devkits-codex-work'));
  assert.ok(!ui.nodes.has('account-actions-devkits-codex-work-mcp'));
  assert.ok(!ui.nodes.has('account-actions-devkits-codex-work-sync'));
  assert.ok(!ui.texts.some(text => String(text).includes('Shared plugins and skills')));
  ui.nodes.get('account-actions-devkits-codex-work-rename').click({}, renderContext);
  assert.equal(overlays.at(-1).props.view, 'rename-account');
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
test('hiding every agent says where Agent settings can restore the menu', async () => {
  const ui = fakeElements();
  const View = await viewFor({ ...ui, props: () => ({ view: 'launcher' }), spaces: () => [], theme: () => ({}),
    shared: () => ['terminal', 'agent:codex'] });
  const view = new View(); view.launchers = [{ key: 'codex', name: 'Codex', installed: true }]; view.render();
  assert.ok(!ui.nodes.has('new-terminal'));
  assert.ok(!ui.nodes.has('start-codex'));
  assert.ok(ui.texts.includes('All agents are hidden. Show them in Agent settings → Add session.'));
});
test('compact Usage shows one line of percentages per account, and its right-click menu switches style or hides it', async () => {
  const ui = fakeElements(), overlays = [], closed = [];
  const memory = { 'devkits.usage-style': 'compact' };
  let target = {};
  const View = await viewFor({ ...ui, props: () => target, spaces: () => projects, shared: key => memory[key],
    setShared: (key, value) => { memory[key] = value; }, openOverlay: overlay => overlays.push(overlay), closeOverlay: id => closed.push(id),
    settings: () => ({ zoom: 1 }), window: () => ({}), layout: () => ({ children: [] }), theme: () => ({}) });
  const view = new View(); view.usageMachine = null;
  view.usageAgents = [{ key: 'codex', name: 'Codex', run: ['codex'] }, { key: 'pi', name: 'Pi', run: ['pi'] }];
  view.usage = [{ key: 'codex', email: 'me@example.com', windows: [{ bucket: 'codex', minutes: 300, usedPercent: 28 },
    { bucket: 'codex', minutes: 10080, usedPercent: 91 }] }];
  view.accountUsage({});
  assert.equal(ui.nodes.get('usage-agent:codex').height, 28);
  assert.ok(!ui.nodes.has('usage-meter-agent:codex-300'));
  assert.ok(ui.textOf('usage-name-agent:codex').includes('me@example.com'));
  assert.ok(ui.textOf('usage-compact-agent:codex-300').includes('5h 28%'));
  assert.ok(ui.textOf('usage-compact-agent:codex-10080').includes('W 91%'));
  assert.ok(ui.textOf('usage-agent:pi').includes('—'));
  ui.nodes.get('account-usage').mouseDownByButton.right({ position: { x: 20, y: 400 } }, renderContext);
  assert.deepEqual(overlays.at(-1).props, { view: 'usage-display-menu', surface: 'sidebar' });
  target = { view: 'usage-display-menu', surface: 'sidebar', overlay: 'usage-menu' };
  const menu = new View(); menu.init({}, renderContext); menu.render(renderContext);
  ui.nodes.get('usage-display-full').click({}, renderContext);
  assert.equal(memory['devkits.usage-style'], 'full'); assert.deepEqual(closed, ['usage-menu']);
  // Locations toggle like SYSTEM's; turning off the only one hides Usage.
  ui.nodes.get('usage-display-status').click({}, renderContext);
  assert.equal(memory['devkits.usage-location'], 'both');
  ui.nodes.clear(); menu.render(renderContext);
  ui.nodes.get('usage-display-sidebar').click({}, renderContext);
  assert.equal(memory['devkits.usage-location'], 'status');
  ui.nodes.clear(); menu.render(renderContext);
  assert.ok(!ui.nodes.has('usage-display-compact'));
  ui.nodes.get('usage-display-status').click({}, renderContext);
  assert.equal(memory['devkits.usage-visible'], false);
  ui.nodes.get('usage-display-sidebar').click({}, renderContext);
  assert.equal(memory['devkits.usage-visible'], true); assert.equal(memory['devkits.usage-location'], 'sidebar');
  ui.nodes.clear(); menu.render(renderContext);
  ui.nodes.get('usage-display-hide').click({}, renderContext);
  assert.equal(memory['devkits.usage-visible'], false);
  ui.nodes.get('usage-display-settings').click({}, renderContext);
  assert.deepEqual(overlays.at(-1).props, { view: 'ui-settings', page: 'usage' });
  // Interface settings offers the same style choice while Usage is shown.
  memory['devkits.usage-visible'] = true; target = { view: 'ui-settings', page: 'usage', overlay: 'interface' };
  const settings = new View(); settings.init({}, renderContext); ui.nodes.clear(); settings.render(renderContext);
  assert.ok(ui.nodes.has('interface-usage-location') && ui.nodes.has('interface-usage-style'));
  // Status bar alone has no sidebar style, and the status bar shows one item per supported account.
  memory['devkits.usage-location'] = 'status'; ui.nodes.clear(); settings.render(renderContext);
  assert.ok(ui.nodes.has('interface-usage-location') && !ui.nodes.has('interface-usage-style'));
  memory['devkits.usage.snapshot'] = { contexts: { null: { choices: [{ key: 'agent:codex', name: 'Codex', agent: { key: 'codex' }, provider: 'codex' },
    { key: 'agent:pi', name: 'Pi', agent: { key: 'pi' }, provider: null }],
    usage: [{ key: 'codex', email: 'me@example.com', windows: [{ bucket: 'codex', minutes: 10080, usedPercent: 91 }] }] } } };
  target = { view: 'status' }; ui.nodes.clear(); new View().render(renderContext);
  assert.ok(ui.textOf('status-usage-agent:codex').includes('me@example.com'));
  assert.ok(ui.textOf('status-usage-agent:codex-10080').includes('W 91%'));
  assert.ok(!ui.nodes.has('status-usage-agent:pi') && !ui.nodes.has('account-usage'));
  memory['devkits.usage-visible'] = false; ui.nodes.clear(); settings.render(renderContext);
  assert.ok(!ui.nodes.has('interface-usage-style'));
});

test('usage follows its independent profile selection and launcher order, shows actual quota windows, always has meters, and opens details', async () => {
  const ui = fakeElements(), overlays = [];
  const now = Date.UTC(2026, 0, 1);
  const memory = { 'devkits.hidden-launchers': ['terminal'], 'devkits.hidden-usage-profiles': ['work'],
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
  memory['devkits.hidden-usage-profiles'] = ['codex'];
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
test('the Agents page selects Usage accounts in their own column, never individual agent configurations', async () => {
  const ui = fakeElements(), memory = {
    'devkits.hidden-launchers': ['agent:codex'], 'devkits.hidden-usage-profiles': [] }, requests = [];
  const profiles = [{ key: 'codex', name: 'Codex', installed: true, run: ['codex'] },
    { key: 'devkits-codex-work', name: 'Work', installed: true, run: ['env', 'CODEX_HOME=/work', 'codex'] }];
  memory['devkits.agent-configs'] = [{ key: 'devkits-preset-fast', profileKey: 'codex', name: 'Fast' }];
  const View = await viewFor({ ...ui, props: () => ({ view: 'manage-launchers', page: 'usage' }), spaces: () => projects,
    theme: () => ({}), shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    exec: async (_command, args) => { requests.push(JSON.parse(args[1])); return { code: 0, stdout: '[]' }; } });
  const pending = [], cx = { ...renderContext, spawn: task => pending.push(task(cx)), timer: { every() {} } };
  memory['devkits.agent-cache'] = { null: profiles };
  const view = new View(); view.initSessionMenu({ ...cx, spawn() {} }); view.launchers = profiles; view.render(cx);
  // An old Usage link opens the merged Agents page.
  assert.equal(view.settingsPage, 'agents');
  assert.ok(ui.nodes.has('usage-profile-codex') && ui.nodes.has('usage-profile-devkits-codex-work'));
  assert.ok(ui.textOf('manage-usage-agent:devkits-preset-fast').includes('–') && ui.textOf('manage-usage-terminal').includes('–'));
  assert.ok(!ui.nodes.has('usage-profile-devkits-preset-fast'));
  assert.equal(ui.nodes.get('usage-profile-codex').checked, true);
  ui.nodes.get('usage-profile-devkits-codex-work').change(false, cx); view.render(cx);
  assert.deepEqual(memory['devkits.hidden-usage-profiles'], ['devkits-codex-work']);
  assert.deepEqual(memory['devkits.hidden-launchers'], ['agent:codex']);
  view.refreshUsage(cx); await Promise.all(pending);
  assert.deepEqual(requests.flat().map(profile => profile.key), ['codex']);
  ui.nodes.clear(); view.accountUsage({});
  assert.ok(ui.nodes.has('usage-agent:codex'));
  assert.ok(!ui.nodes.has('usage-agent:devkits-codex-work') && !ui.nodes.has('usage-agent:devkits-preset-fast'));
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
  new View.UsageDetails().init(cx);
  assert.equal(typeof tick, 'function');
  tick(cx);
  assert.equal(notified, 1);
});
test('account removal stays reflected in Settings and the cache while native discovery is stale', async () => {
  const ui = fakeElements(), memory = {};
  const removed = { key: 'devkits-codex-work', name: 'Codex · Work', installed: true };
  const personal = { key: 'devkits-codex-personal', name: 'Codex · Personal', installed: true };
  const base = { key: 'codex', name: 'Codex', installed: true };
  const custom = { key: 'custom-agent', name: 'Custom', installed: true };
  const View = await viewFor({ ...ui, props: () => ({ view: 'manage-launchers' }), spaces: () => [], theme: () => ({}),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    knownAgents: async () => [base, removed, personal, custom],
    readTextFile: async () => JSON.stringify({ programs: { [personal.key]: { name: personal.name } } }) });
  const view = new View(); view.initSessionMenu({ ...renderContext, spawn() {}, timer: { every() {} } }); 
  view.launchers = await view.cachedAgents(null);
  view.settingsPage = 'accounts'; view.selectedAccount = personal.key; view.render(renderContext);
  assert.ok(!ui.nodes.has(`account-${removed.key}`));
  assert.ok(ui.nodes.has(`account-actions-${personal.key}-remove`));
  assert.deepEqual(view.launchers.map(agent => agent.key), [base.key, personal.key, custom.key]);
  assert.deepEqual(memory['devkits.agent-cache'].null.map(agent => agent.key), [base.key, personal.key, custom.key]);
  assert.deepEqual(await new View().cachedAgents(null), view.launchers);
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
  const memory = { 'devkits.hidden-usage-profiles': ['work'] };
  const claude = { key: 'devkits-claude-me', installed: true, run: ['env', 'CLAUDE_CONFIG_DIR=/accounts/me', 'claude'] };
  const View = await viewFor({ spaces: () => projects, shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    readTextFile: async () => JSON.stringify({ programs: { [claude.key]: { name: 'Claude · Me' } } }),
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
        : { code: 0, stdout: JSON.stringify(keys.map(key => ({ key, plan: null, email: null, windows: [{ usedPercent: 42 }], fetchedAt: 1 }))) };
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
  memory['devkits.hidden-usage-profiles'] = [];
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
test('the Usage master switch hides the section and pauses reads while preserving account choices', async () => {
  const ui = fakeElements(), reads = [], tasks = [];
  const memory = { 'devkits.hidden-usage-profiles': ['work'], 'devkits.launcher-order': ['agent:work', 'agent:codex'],
    'devkits.usage-cache': { codex: { key: 'codex', checkedAt: Date.now(), plan: null, email: null, windows: [] } } };
  const View = await viewFor({ ...ui, spaces: () => projects,
    props: () => ({ view: 'ui-settings', page: 'usage' }), theme: () => ({}),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    exec: async (...args) => { reads.push(args); return { code: 0, stdout: '[]' }; } });
  const cx = { ...renderContext, spawn(task) { tasks.push(task(cx)); } }, view = new View();
  let discoveries = 0;
  view.cachedAgents = async () => { discoveries++; return [{ key: 'codex', name: 'Codex', run: ['codex'], installed: true }]; };
  view.init({}, cx); view.render(cx);
  assert.equal(ui.nodes.get('usage-visible').checked, true);
  ui.nodes.get('usage-visible').change(false, cx);
  ui.nodes.clear(); view.accountUsage({}); view.refreshUsage(cx, true, true);
  assert.ok(!ui.nodes.has('account-usage'));
  assert.equal(discoveries, 0); assert.equal(reads.length, 0);
  const reloaded = new View(); reloaded.init({}, cx); reloaded.render(cx);
  assert.equal(ui.nodes.get('usage-visible').checked, false);
  ui.nodes.get('usage-visible').change(true, cx);
  view.refreshUsage(cx, false); await Promise.all(tasks.splice(0));
  view.accountUsage({});
  assert.ok(ui.nodes.has('account-usage') && ui.nodes.has('usage-agent:codex'));
  assert.equal(discoveries, 1); assert.equal(reads.length, 0, 'Enabling reuses the fresh quota cache');
  assert.deepEqual(memory['devkits.hidden-usage-profiles'], ['work']);
  assert.deepEqual(memory['devkits.launcher-order'], ['agent:work', 'agent:codex']);
  assert.ok(memory['devkits.usage-cache'].codex);
});

test('disabling Usage during account discovery prevents a subsequent provider query', async () => {
  const ui = fakeElements(), tasks = [], memory = {}, reads = [];
  const View = await viewFor({ ...ui, shared: key => memory[key],
    exec: async (...args) => { reads.push(args); return { code: 0, stdout: '[]' }; } });
  const view = new View(), cx = { ...renderContext, spawn(task) { tasks.push(task(cx)); } };
  let finish;
  view.cachedAgents = () => new Promise(resolve => { finish = resolve; });
  view.refreshUsage(cx);
  memory['devkits.usage-visible'] = false;
  finish([{ key: 'codex', name: 'Codex', run: ['codex'] }]);
  await Promise.all(tasks);
  assert.equal(reads.length, 0); assert.equal(view.usageLoading, false);
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
test('Storage shows account totals and categories directly and refreshes without changing settings', async () => {
  const ui = fakeElements(), writes = [], jobs = [];
  const data = { bytes: 2048, groups: { conversations: 1024, cache: 512, extensions: 256, logs: 128, other: 128 }, partial: false };
  const View = await viewFor({ ...ui, theme: () => ({}),
    exec: async () => ({ code: 0, stdout: JSON.stringify(data) }),
    setShared: (...args) => writes.push(args) });
  const view = new View(), agent = { key: 'codex', run: ['codex'] };
  const cx = { notify() {}, spawn(fn) { jobs.push(fn(cx)); } };
  view.loadAccountStorage(agent, cx);
  view.accountStoragePanel(agent, {});
  assert.ok(ui.textOf('account-storage-codex').includes('Calculating…'));
  assert.equal(ui.nodes.get('account-storage-refresh-codex').disabled, true);
  await Promise.all(jobs.splice(0));
  ui.nodes.clear(); view.accountStoragePanel(agent, {});
  assert.ok(ui.textOf('account-storage-total-codex').includes('2.0 KB'));
  assert.ok(ui.textOf('account-storage-codex').join(' ').includes('Adding a profile does not duplicate them.'));
  assert.ok(!ui.nodes.has('account-storage-toggle-codex'));
  assert.ok(ui.textOf('account-storage-breakdown-codex').includes('Chat & file history'));
  assert.ok(ui.textOf('account-storage-breakdown-codex').includes('1.0 KB'));
  data.partial = true;
  ui.nodes.get('account-storage-refresh-codex').click({}, cx);
  await Promise.all(jobs.splice(0));
  ui.nodes.clear(); view.accountStoragePanel(agent, {});
  assert.ok(ui.textOf('account-storage-codex').includes('At least 2.0 KB'));
  assert.ok(ui.textOf('account-storage-codex').join(' ').includes('incomplete'));
  assert.deepEqual(writes, []);
});

test('Storage stays expanded beside account defaults and moves below them in narrow details', async () => {
  const ui = fakeElements();
  const View = await viewFor({ ...ui, theme: () => ({}) });
  const view = new View(), agent = { key: 'codex', run: ['codex'] };
  view.initSessionMenu(renderContext);
  view.accountDetail(agent, [], {});
  ui.nodes.get('account-detail-codex').sizeChange({ width: 600 }, renderContext);
  ui.nodes.clear(); view.accountDetail(agent, [], {});
  assert.equal(ui.nodes.get('account-storage-position-codex').width, 250);
  assert.ok(ui.nodes.has('account-defaults-panel-codex'));
  assert.ok(ui.nodes.has('account-storage-breakdown-codex'));
  assert.ok(!ui.nodes.has('account-storage-toggle-codex'));
  ui.nodes.get('account-detail-codex').sizeChange({ width: 500 }, renderContext);
  ui.nodes.clear(); view.accountDetail(agent, [], {});
  assert.equal(ui.nodes.get('account-storage-position-codex').width, undefined);
  assert.ok(ui.nodes.has('account-storage-breakdown-codex'));
});

test('Accounts offers Add account once per provider, including when Codex is hidden from the launcher', async () => {
  const ui = fakeElements(), overlays = [], closed = [];
  const target = { view: 'manage-launchers', space: 'api', overlay: 'manage-dialog' };
  const View = await viewFor({ ...ui, props: () => target, spaces: () => projects,
    theme: () => ({}), shared: key => key === 'devkits.hidden-launchers' ? ['agent:codex'] : undefined,
    closeOverlay: id => closed.push(id), openOverlay: value => overlays.push(value) });
  const view = new View(); view.initSessionMenu({ ...renderContext, spawn() {}, timer: { every() {} } }); view.launchers = [{ key: 'codex', name: 'Codex' }, { key: 'devkits-codex-work', name: 'Codex · work' }];
  view.manageIndex = 0; view.settingsPage = 'accounts'; view.render(renderContext);
  assert.ok(ui.nodes.has('add-codex-account'));
  assert.ok(!ui.textOf('account-devkits-codex-work').includes('Add account'));
  assert.ok(!ui.nodes.has('add-claude-account'));
  ui.nodes.get('add-codex-account').click();
  // Sign-in stacks above Settings instead of closing and reopening it.
  assert.deepEqual(closed, []);
  assert.deepEqual(overlays[0].props, { view: 'account-login', provider: 'codex' });
  assert.equal(overlays[0].modal, true);
  ui.nodes.clear(); view.launcher({});
  assert.ok(!ui.nodes.has('add-codex-account'));
});
test('Settings stays open under account dialogs, reloads on profile-revision and selects a newly added account', async () => {
  const ui = fakeElements(), memory = {}, pending = [];
  const work = { key: 'devkits-codex-work', name: 'Codex · Work', installed: true, run: ['codex'] };
  let found = [{ key: 'codex', name: 'Codex', installed: true, run: ['codex'] }];
  const View = await viewFor({ ...ui, props: () => ({ view: 'manage-launchers', overlay: 'settings', page: 'accounts' }), spaces: () => [],
    theme: () => ({}), shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    knownAgents: async () => found, readTextFile: async () => JSON.stringify({ programs: { [work.key]: { name: work.name } } }) });
  const view = new View(), cx = { ...renderContext, spawn: fn => pending.push(fn(cx)), timer: { every() {} } };
  view.initSessionMenu(cx); await Promise.all(pending.splice(0));
  view.render(cx); assert.equal(view.selectedAccount, undefined);
  found = [...found, work]; memory['devkits.agent-cache'] = {}; memory['devkits.profile-revision'] = 1;
  view.render(cx); await Promise.all(pending.splice(0));
  assert.equal(view.selectedAccount, work.key);
  ui.nodes.clear(); view.render(cx);
  assert.ok(ui.nodes.has(`account-detail-${work.key}`));
});

test('Accounts reads the address of an account hidden from Usage once, through the usage reader', async () => {
  const ui = fakeElements(), calls = [], pending = [];
  const memory = { 'devkits.usage.snapshot': { contexts: { null: { usage: [{ key: 'devkits-codex-work', email: 'work@example.com' }] } } } };
  const View = await viewFor({ ...ui, props: () => ({ view: 'manage-launchers', overlay: 'settings', page: 'accounts' }), spaces: () => [],
    theme: () => ({}), shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, appHome: () => '/herdr',
    exec: async (command, args) => { calls.push([command, args[0], JSON.parse(args[1]).map(account => account.key)]);
      return { code: 0, stdout: JSON.stringify([{ key: 'codex', email: 'me@example.com', plan: 'pro' }]) }; } });
  const view = new View(), cx = { ...renderContext, spawn: fn => pending.push(fn(cx)), timer: { every() {} } };
  view.initSessionMenu({ ...cx, spawn() {} });
  view.launchers = [{ key: 'codex', name: 'Codex', run: ['codex'] }, { key: 'devkits-codex-work', name: 'Work', run: ['codex'] }];
  view.render(cx); await Promise.all(pending.splice(0)); view.render(cx); await Promise.all(pending.splice(0));
  assert.deepEqual(calls, [['node', '/herdr/mods/devkits-usage/usage-reader.js', ['codex']]]);
  ui.nodes.clear(); view.render(cx);
  // The Default account is named by its address; its detail line keeps only the plan.
  assert.ok(ui.textOf('account-list-name-codex').includes('me@example.com'));
  assert.ok(ui.textOf('account-email-codex').includes('Pro'));
});

test('a Default account is named by its shared address in Add session, Settings and the thread header', async () => {
  const ui = fakeElements();
  const memory = { 'devkits.account-identities': { codex: { email: 'me@example.com', plan: 'pro' } },
    'devkits.agent-cache': { null: [{ key: 'codex', name: 'Codex', installed: true, run: ['codex'] }, { key: 'claude', name: 'Claude', installed: true, run: ['claude'] }] },
    'devkits.thread-profiles': { 'tab-0': 'codex' } };
  let target = { view: 'launcher', space: 'api', overlay: 'menu' };
  const View = await viewFor({ ...ui, props: () => target, spaces: () => projects, theme: () => ({}), keys: () => [],
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    agents: () => [{ address: 't1', space: projects[0].id, tab: 'tab-0', app: 'codex', program: {} }],
    panes: () => [{ pane: 'p0', tab: 'tab-0', title: 'New thread' }] });
  const view = new View(); view.launchers = memory['devkits.agent-cache'].null; view.render(renderContext);
  assert.ok(ui.textOf('start-codex').includes('me@example.com') && !ui.textOf('start-codex').includes('Default account'));
  assert.ok(ui.textOf('start-claude').includes('No account'));
  target = { view: 'manage-launchers', overlay: 'settings', page: 'accounts' }; ui.nodes.clear();
  const settings = new View(); settings.initSessionMenu({ ...renderContext, timer: { every() {} } });
  settings.launchers = memory['devkits.agent-cache'].null; settings.selectedAccount = 'codex'; settings.render(renderContext);
  assert.ok(ui.textOf('account-list-name-codex').includes('me@example.com'));
  assert.ok(ui.textOf('account-list-name-claude').includes('No account'));
  assert.ok(ui.textOf('account-email-codex').includes('Pro'));
  settings.settingsPage = 'agents'; ui.nodes.clear(); settings.render(renderContext);
  assert.ok(ui.textOf('manage-agent:codex').includes('me@example.com') && ui.textOf('manage-agent:claude').includes('No account'));
  target = { pane: 'p0' }; ui.nodes.clear(); const before = ui.texts.length;
  new View().paneHeader({}, renderContext);
  const header = ui.texts.slice(before);
  assert.ok(header.includes('me@example.com') && !header.includes('Default account'));
});

test('the Claude section offers Add account and lists Claude accounts after the default', async () => {
  const ui = fakeElements(), overlays = [], memory = {};
  const target = { view: 'manage-launchers', space: 'api', overlay: 'manage-dialog' };
  const View = await viewFor({ ...ui, props: () => target, spaces: () => projects, theme: () => ({}),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    closeOverlay() {}, openOverlay: value => overlays.push(value) });
  const view = new View(); view.initSessionMenu({ ...renderContext, spawn() {}, timer: { every() {} } }); view.launchers = [{ key: 'claude', name: 'Claude' }, { key: 'devkits-claude-work', name: 'Claude · work' }];
  view.manageIndex = 0; view.settingsPage = 'accounts'; view.render(renderContext);
  assert.ok(ui.nodes.has('add-claude-account'));
  assert.ok(ui.nodes.has('account-claude') && ui.nodes.has('account-devkits-claude-work'));
  assert.ok(!ui.nodes.has('add-codex-account'));
  ui.nodes.get('account-devkits-claude-work').click({}, renderContext); ui.nodes.clear(); view.render(renderContext);
  assert.ok(ui.nodes.has('account-actions-devkits-claude-work-rename')); assert.ok(ui.nodes.has('account-actions-devkits-claude-work-remove'));
  assert.ok(!ui.nodes.has('permissions-devkits-claude-work') && !ui.nodes.has('permissions-claude'));
  ui.nodes.get('add-claude-account').click();
  assert.equal(overlays[0].props.view, 'account-login');
  assert.equal(overlays[0].props.provider, 'claude');
});
test('the selected account shows its provider\'s shared Models card choosing the models and efforts offered', async () => {
  const ui = fakeElements(), memory = {};
  const launchers = [{ key: 'claude', name: 'Claude', run: ['claude'] }, { key: 'codex', name: 'Codex', run: ['codex'] }, { key: 'aider', name: 'Aider', run: ['aider'] }];
  let target = {};
  const View = await viewFor({ ...ui, props: () => target, spaces: () => projects, theme: () => ({}),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, closeOverlay() {}, openOverlay() {} });
  const view = new View(), cx = renderContext;
  const settings = (page, account) => { target = { view: 'manage-launchers', overlay: 'settings', space: 'api', page };
    view.initSessionMenu({ ...cx, spawn() {}, timer: { every() {} } }); view.launchers = launchers; view.selectedAccount = account; ui.nodes.clear(); view.render(cx); };
  const pick = (section, key) => { ui.nodes.get(`defaults-${section}-select`).openChange(true, cx); view.render(cx);
    ui.nodes.get(`defaults-${section}-option-${key}`).click({}, cx); view.render(cx); };
  settings('agents');
  assert.ok(![...ui.nodes.keys()].some(id => id.startsWith('session-')));
  // The first account shows its provider's Models card beside its defaults.
  settings('accounts');
  assert.equal(view.settingsPage, 'accounts');
  assert.ok(ui.texts.includes('MODELS IN MENUS · ALL CLAUDE ACCOUNTS'));
  assert.ok(ui.nodes.has('session-claude-models-haiku') && ui.nodes.has('session-claude-efforts-max'));
  assert.ok(!ui.nodes.has('session-options-codex'));
  ui.nodes.get('session-claude-models-haiku').change(false, cx);
  assert.deepEqual(memory['devkits.session-options'], { claude: { models: ['haiku'] } });
  ui.nodes.get('session-claude-models-haiku').change(true, cx);
  assert.deepEqual(memory['devkits.session-options'].claude.models, []);
  ui.nodes.get('drag-session-claude-sonnet').mouseDown({}, cx); view.render(cx);
  ui.nodes.get('session-claude-model-fable').mouseMove({}, cx);
  ui.nodes.get('session-claude-model-fable').mouseUp({}, cx);
  assert.deepEqual(memory['devkits.session-options'].claude.order, ['sonnet', 'fable', 'opus', 'haiku']);
  assert.equal(view.modelDrag, null);
  settings('accounts', 'codex');
  view.codexModelList = [{ key: 'gpt-6-luna', label: 'GPT-6 Luna', efforts: ['low', 'high'] }]; ui.nodes.clear(); view.render(cx);
  assert.ok(ui.nodes.has('session-codex-models-gpt-6-luna') && !ui.nodes.has('session-claude-models-haiku'));
  ui.nodes.get('session-codex-efforts-low').change(false, cx);
  assert.deepEqual(memory['devkits.session-options'].codex, { efforts: ['low'] });
});
test('model and effort defaults are independent per profile and explicit session choices override them', async () => {
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
  const settings = (page, account) => { target = { view: 'manage-launchers', overlay: 'settings', space: 'api', page };
    view.initSessionMenu({ ...cx, spawn() {}, timer: { every() {} } }); view.launchers = launchers; view.selectedAccount = account; ui.nodes.clear(); view.render(cx); };
  const pick = (section, key) => { ui.nodes.get(`defaults-${section}-select`).openChange(true, cx); view.render(cx);
    ui.nodes.get(`defaults-${section}-option-${key}`).click({}, cx); view.render(cx); };
  settings('accounts', 'claude');
  pick('model', 'opus');
  pick('effort', 'high');
  assert.deepEqual(memory['devkits.profile-sessions'], { claude: { model: 'opus', effort: 'high' } });
  const space = { space: 'api', folder: '/Code/api' };
  await view.startThread(work, space);
  assert.deepEqual(commands.at(-1)[1].argv, [...rulesArgv(work, work.run), ...tasksMcpFlags('claude')]);
  await view.startThread(claude, space, { model: 'sonnet' });
  assert.deepEqual(commands.at(-1)[1].argv, [...rulesArgv(claude, ['claude', '--model', 'sonnet', '--effort', 'high']), ...tasksMcpFlags('claude')]);
  await view.startThread(claude, space, { model: 'sonnet', effort: null });
  assert.deepEqual(commands.at(-1)[1].argv, [...rulesArgv(claude, ['claude', '--model', 'sonnet']), ...tasksMcpFlags('claude')]);
  memory['devkits.profile-sessions'][codex.key] = { model: 'a', effort: 'high' };
  memory['devkits.session-options'] = { codex: { models: ['a'] } };
  settings('accounts'); ui.nodes.get(`account-${codex.key}`).click({}, cx);
  view.codexModelList = [{ key: 'a', label: 'A', efforts: ['high'] }, { key: 'b', label: 'B', efforts: ['low'] }]; view.render(cx);
  // A model hidden below is no longer offered, and the default falls back to Default.
  assert.ok(ui.textOf('defaults-model').includes('Default'));
  ui.nodes.get('defaults-model-select').openChange(true, cx); view.render(cx);
  assert.ok(!ui.nodes.has('defaults-model-option-a'));
  ui.nodes.get('defaults-model-option-b').click({}, cx);
  assert.deepEqual(memory['devkits.profile-sessions'][codex.key], { model: 'b', effort: null });
  await view.startThread(codex, space);
  assert.deepEqual(commands.at(-1)[1].argv, [...rulesArgv(codex, [...codex.run, '-m', 'b']), ...tasksMcpFlags('codex')]);
  view.render(cx); pick('model', 'default');
  await view.startThread(codex, space);
  assert.deepEqual(commands.at(-1)[1].argv, [...rulesArgv(codex, codex.run), ...tasksMcpFlags('codex')]);
});

test('Fast is a checkbox saved independently for each profile and used by task sessions', async () => {
  const ui = fakeElements(), memory = {}, commands = [];
  const codex = { key: 'codex', name: 'Codex', run: ['codex'] };
  const work = { key: 'devkits-codex-work', name: 'Work', run: ['env', 'CODEX_HOME=/work', 'codex'] };
  const target = { view: 'manage-launchers', overlay: 'settings', page: 'accounts' };
  const View = await viewFor({ ...ui, props: () => target, spaces: () => projects, theme: () => ({}), taskPrompt: task => task.name,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, closeOverlay() {},
    run: (...args) => commands.push(args), notify: error => assert.fail(error.body) });
  const cx = { ...renderContext, spawn() {}, timer: { every() {} } };
  const view = new View(); view.initSessionMenu(cx); view.launchers = [codex, work]; view.render(cx);
  assert.ok(ui.nodes.has('defaults-fast')); assert.ok(!ui.nodes.has('defaults-speed-select'));
  ui.nodes.get('defaults-fast').change(true, cx); view.render(cx);
  assert.equal(memory['devkits.profile-sessions'].codex.serviceTier, 'fast');
  ui.nodes.get('account-devkits-codex-work').click({}, cx); view.render(cx);
  assert.equal(ui.nodes.get('defaults-fast').checked, false);
  ui.nodes.get('defaults-model-select').openChange(true, cx); view.render(cx);
  // Model and effort edits never discard this profile's Fast checkbox.
  ui.nodes.get('defaults-fast').change(true, cx); view.render(cx);
  ui.nodes.get('defaults-fast').change(false, cx); view.render(cx);
  assert.equal(memory['devkits.profile-sessions'].codex.serviceTier, 'fast');
  assert.equal(memory['devkits.profile-sessions'][work.key].serviceTier, null);
  await view.startThread(work, { space: 'api', folder: '/Code/api' });
  assert.deepEqual(commands.at(-1)[1].argv, [...rulesArgv(work, work.run), ...tasksMcpFlags('codex')]);
  await view.startThread(codex, { space: 'api', folder: '/Code/api', task: { gid: 'task', name: 'Do work' } }, { model: 'b', effort: null });
  assert.deepEqual(commands.findLast(([name]) => name === 'tab.new')[1].argv,
    ['codex', '-m', 'b', '-c', 'service_tier="fast"', ...tasksMcpFlags('codex'), 'Do work']);
});

async function profileTableUi(memory = {}) {
  const ui = fakeElements(), overlays = [], commands = [], closed = [];
  const accounts = [{ key: 'codex', name: 'Codex', installed: true, run: ['codex'] },
    { key: 'devkits-codex-work', name: 'Codex · Work', installed: true, run: ['env', 'CODEX_HOME=/work', 'codex'] },
    { key: 'claude', name: 'Claude', installed: true, run: ['claude'] }];
  memory['devkits.agent-cache'] = { null: accounts };
  let target, view;
  const View = await viewFor({ ...ui, Input: { new: () => ui.element() }, Textarea: { new: () => ui.element() }, props: () => target,
    spaces: () => projects, theme: () => ({}), taskPrompt: task => task.name,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    openOverlay: spec => overlays.push(spec), closeOverlay: id => closed.push(id), run: (...args) => commands.push(args), notify: error => assert.fail(error.body) });
  const cx = { ...renderContext, spawn() {}, timer: { every() {} } };
  const mount = (mode = 'manage-launchers', configKey = null) => {
    target = { view: mode, page: 'agent-profiles', configKey, overlay: mode === 'agent-profile-editor' ? 'profile-editor' : 'settings', space: 'api' };
    ui.nodes.clear(); view = new View(); view.initSessionMenu(cx); view.launchers = accounts;
    view.codexModelList = [{ key: 'a', label: 'A', efforts: ['low', 'high'] }, { key: 'b', label: 'B', efforts: ['low'] }];
    view.render(cx); return view;
  };
  return { ui, memory, accounts, cx, overlays, commands, closed, mount, get view() { return view; },
    render() { view.render(cx); },
    pick(section, key) {
      ui.nodes.get(`defaults-${section}-select`).openChange(true, cx); view.render(cx);
      ui.nodes.get(`defaults-${section}-option-${key}`).click({}, cx); view.render(cx);
    },
    name(value) { view.configName.set_value(value); view.configName.events.change({}, cx); view.render(cx); },
    mode(value) { target.view = value; ui.nodes.clear(); view.render(cx); },
  };
}

test('Add opens a profile draft; Create saves independent setups used by launchers and Tasks', async () => {
  const h = await profileTableUi({}), { ui, cx, memory } = h;
  h.mount();
  assert.ok(ui.nodes.has('agent-profiles-table'));
  assert.ok(!ui.nodes.has('defaults-profile-select'));
  ui.nodes.get('add-agent-configuration').click({}, cx);
  assert.equal(h.overlays.at(-1).props.view, 'agent-profile-editor');
  assert.equal(memory['devkits.agent-configs'], undefined);
  h.mount('agent-profile-editor'); h.name('Sol Fast');
  assert.ok(!ui.nodes.has('agent-profile-visible'));
  assert.ok(!ui.texts.includes('Show in Add session'));
  assert.equal(ui.nodes.get('save-agent-profile').disabled, true);
  h.pick('profile', 'devkits-codex-work'); h.pick('model', 'a'); h.pick('effort', 'high');
  ui.nodes.get('defaults-fast').change(true, cx); h.render();
  assert.equal(memory['devkits.profile-sessions'], undefined);
  ui.nodes.get('save-agent-profile').click({}, cx);
  const first = memory['devkits.agent-configs'][0].key;
  assert.deepEqual(memory['devkits.profile-sessions'][first], { model: 'a', effort: 'high', serviceTier: 'fast' });
  h.view.saveAgentProfile(cx); assert.equal(memory['devkits.agent-configs'].length, 1);
  assert.deepEqual(h.closed, ['profile-editor']);
  assert.equal(h.overlays.length, 1);
  h.mount('agent-profile-editor'); h.name('Astra'); h.pick('profile', 'devkits-codex-work'); h.pick('model', 'b');
  ui.nodes.get('save-agent-profile').click({}, cx);
  const second = memory['devkits.agent-configs'][1].key;
  assert.equal(memory['devkits.profile-sessions']['devkits-codex-work'], undefined);
  h.mount();
  assert.ok(ui.textOf(`agent-profile-row-${first}`).includes('Sol Fast'));
  assert.ok(ui.textOf(`agent-profile-row-${first}`).includes('Fast'));
  assert.ok(ui.textOf(`agent-profile-row-${second}`).includes('Astra'));
  const available = await h.view.cachedAgents(null), space = { space: 'api', folder: '/Code/api' };
  await h.view.startThread(available.find(agent => agent.key === first), space);
  assert.deepEqual(h.commands.at(-1)[1].argv, [...rulesArgv(h.accounts[1], [...h.accounts[1].run, '-m', 'a', '-c', 'model_reasoning_effort="high"', '-c', 'service_tier="fast"']), ...tasksMcpFlags('codex')]);
  assert.equal(h.view.defaultThreadAgent(projects[0], available).key, first);
  await h.view.startThread(available.find(agent => agent.key === second), { ...space, task: { gid: 'new', name: 'Task' } });
  assert.deepEqual(h.commands.findLast(([name]) => name === 'tab.new')[1].argv, [...h.accounts[1].run, '-m', 'b', ...tasksMcpFlags('codex'), 'Task']);
  assert.ok(!ui.nodes.has(`agent-profile-visible-${first}`));
  assert.ok(h.view.taskAssignees(projects[0]).some(agent => agent.key === first));
  ui.nodes.get(`remove-agent-profile-${first}`).click({}, cx);
  assert.equal(memory['devkits.agent-configs'].length, 1);
  assert.equal(memory['devkits.profile-sessions'][first], undefined);
  assert.ok(!h.commands.some(([name]) => ['tab.close', 'terminal.kill'].includes(name)));
});

test('profile editing retains its saved account when unchecked in Usage and saves only on confirmation', async () => {
  const key = 'devkits-preset-work';
  const memory = { 'devkits.hidden-usage-profiles': ['devkits-codex-work'],
    'devkits.agent-configs': [{ key, name: 'Sol Fast', profileKey: 'devkits-codex-work' }],
    'devkits.profile-sessions': { [key]: { model: 'a', effort: 'high', serviceTier: 'fast' } } };
  const h = await profileTableUi(memory), { ui, cx } = h;
  h.mount(); ui.nodes.get(`edit-agent-profile-${key}`).click({}, cx);
  assert.equal(h.overlays.at(-1).props.configKey, key);
  h.mount('agent-profile-editor', key);
  const input = h.view.configName, original = structuredClone(memory['devkits.profile-sessions']);
  assert.equal(input.value(), 'Sol Fast');
  h.name('Unsaved'); h.pick('model', 'b');
  assert.equal(h.view.profileDraft.effort, null);
  ui.nodes.get('defaults-fast').change(false, cx); h.render(); h.render();
  assert.equal(h.view.configName, input);
  assert.deepEqual(memory['devkits.profile-sessions'], original);
  assert.equal(memory['devkits.agent-configs'][0].name, 'Sol Fast');
  ui.nodes.get('cancel-agent-profile').click();
  h.mount('agent-profile-editor', key);
  assert.equal(h.view.configName.value(), 'Sol Fast');
  assert.equal(ui.nodes.get('defaults-fast').checked, true);
  h.pick('profile', 'claude');
  assert.ok(!ui.nodes.has('agent-settings-fields') || !ui.textOf('agent-settings-fields').includes('Fast mode'));
  h.name('Review'); h.pick('model', 'sonnet'); h.pick('effort', 'high');
  ui.nodes.get('save-agent-profile').click({}, cx);
  assert.deepEqual(memory['devkits.agent-configs'], [{ key, name: 'Review', profileKey: 'claude' }]);
  assert.deepEqual(memory['devkits.profile-sessions'][key], { model: 'sonnet', effort: 'high', serviceTier: null });
  assert.deepEqual(memory['devkits.hidden-usage-profiles'], ['devkits-codex-work']);
});

test('profile instructions are optional retained drafts, persist across account changes and clear on Save', async () => {
  const key = 'devkits-preset-review', instructions = 'Review only.\nUse "繁體中文" and `code`.';
  const h = await profileTableUi({ 'devkits.agent-configs': [{ key, name: 'Review', profileKey: 'codex', instructions }] });
  h.mount('agent-profile-editor', key);
  assert.equal(h.view.configInstructions.value(), instructions);
  const state = h.view.configInstructions;
  state.set_value('Unsaved'); h.pick('profile', 'claude'); h.render();
  assert.equal(h.view.configInstructions, state);
  assert.equal(state.value(), 'Unsaved');
  assert.equal(h.memory['devkits.agent-configs'][0].instructions, instructions);
  h.ui.nodes.get('cancel-agent-profile').click();
  h.mount('agent-profile-editor', key);
  assert.equal(h.view.configInstructions.value(), instructions);
  h.view.configInstructions.set_value('  Updated\nInstructions  ');
  h.view.saveAgentProfile(h.cx);
  assert.equal(h.memory['devkits.agent-configs'][0].instructions, 'Updated\nInstructions');
  h.mount('agent-profile-editor', key);
  h.view.configInstructions.set_value('  \n'); h.view.saveAgentProfile(h.cx);
  assert.equal(h.memory['devkits.agent-configs'][0].instructions, undefined);
  h.mount('agent-profile-editor'); h.name('Writer'); h.pick('profile', 'claude');
  h.view.configInstructions.set_value(instructions); h.view.saveAgentProfile(h.cx);
  assert.equal(h.memory['devkits.agent-configs'][1].instructions, instructions);
});

test('new profiles offer every installed account in saved order, independent of Usage', async () => {
  const h = await profileTableUi({ 'devkits.hidden-usage-profiles': ['codex', 'devkits-codex-work'],
    'devkits.launcher-order': ['agent:devkits-codex-work', 'agent:claude', 'agent:codex'] });
  const { ui, memory, cx } = h;
  h.mount('agent-profile-editor'); h.name('Review');
  assert.deepEqual(h.view.profileEditorAccounts().map(account => account.key), ['claude', 'codex', 'devkits-codex-work']);
  ui.nodes.get('defaults-profile-select').openChange(true, cx); h.render();
  const options = [...ui.nodes.keys()].filter(key => key.startsWith('defaults-profile-option-'));
  assert.deepEqual(options, ['defaults-profile-option-none', 'defaults-profile-option-claude', 'defaults-profile-option-codex', 'defaults-profile-option-devkits-codex-work']);
  h.pick('profile', 'devkits-codex-work');
  ui.nodes.get('save-agent-profile').click({}, cx);
  assert.equal(memory['devkits.agent-configs'][0].profileKey, 'devkits-codex-work');
});

test('profile and Settings account menus share provider-free labels and full-color icons', async () => {
  const h = await profileTableUi();
  h.accounts[0].name = 'CODEX'; h.accounts[1].name = 'CODEX · Work'; h.accounts[2].name = 'CLAUDE CODE';
  h.mount('agent-profile-editor');
  const { ui, cx } = h;
  ui.nodes.get('defaults-profile-select').openChange(true, cx); h.render();
  for (const key of ['codex', 'claude']) assert.ok(ui.textOf(`defaults-profile-option-${key}`).includes('No account'));
  assert.ok(ui.textOf('defaults-profile-option-devkits-codex-work').includes('Work'));
  const menu = ui.textOf('defaults-profile-options').join(' ');
  assert.ok(!/codex|claude/i.test(menu));
  assert.ok(ui.assets.includes('icons/codex.svg') && ui.assets.includes('icons/claude.svg'));
  h.pick('profile', 'codex');
  assert.ok(ui.textOf('defaults-profile').includes('No account'));
  h.mount(); h.view.settingsPage = 'accounts'; ui.nodes.clear(); h.render();
  // Without a known address, a Default account reads No account in every list.
  assert.ok(ui.textOf('account-codex').includes('No account'));
  assert.ok(ui.textOf('account-devkits-codex-work').includes('Work'));
  assert.equal(h.accounts[0].name, 'CODEX');
});

test('Add ignores Usage and is disabled only without an installed account; a stale click cannot open the editor', async () => {
  const h = await profileTableUi({ 'devkits.hidden-usage-profiles': ['codex', 'claude', 'devkits-codex-work'] });
  h.mount();
  assert.equal(h.ui.nodes.get('add-agent-configuration').disabled, false);
  h.view.launchers = []; h.ui.nodes.clear(); h.render();
  assert.equal(h.ui.nodes.get('add-agent-configuration').disabled, true);
  h.ui.nodes.get('add-agent-configuration').click({}, h.cx);
  assert.deepEqual(h.overlays, []);
  assert.equal(h.memory['devkits.agent-configs'], undefined);
  assert.ok(h.ui.texts.some(text => text.includes('Install Claude Code or Codex CLI')));
});

test('optional Agent profiles are a table separate from native settings, with no upfront account choice or Default row', async () => {
  const h = await profileTableUi(), { ui, cx, memory } = h;
  h.mount();
  assert.equal(memory['devkits.agent-configs'], undefined);
  assert.ok(ui.textOf('agent-profiles-table').join(' ').includes('No agent profiles.'));
  assert.ok(!ui.nodes.has('defaults-profile-select'));
  assert.ok(!ui.nodes.has('defaults-model-select'));
  const pageOrder = ui.nodes.get('settings-pages').children.map(child => [...ui.nodes.entries()].find(([, data]) => data.element === child)?.[0]?.replace('settings-section-', 'settings-page-'));
  assert.deepEqual(pageOrder, ['settings-page-accounts', 'settings-page-agents', 'settings-page-agent-profiles', 'settings-page-global-rules', 'settings-page-shared-mcp', 'settings-page-ecc']);
  const key = 'devkits-preset-one';
  memory['devkits.agent-configs'] = [{ key, name: 'Review', profileKey: 'claude' }]; h.render();
  assert.ok(!ui.textOf('agent-profiles-table').includes('Default agent'));
  // Profiles join Add session's one visibility and order list.
  h.view.settingsPage = 'agents'; ui.nodes.clear(); h.render();
  assert.ok(ui.nodes.has(`manage-agent:${key}`) && ui.nodes.has('manage-section-3'));
  h.view.settingsPage = 'accounts'; h.view.selectedAccount = 'claude'; ui.nodes.clear(); h.render();
  assert.ok(ui.nodes.has('defaults-model-select'));
  assert.ok(!ui.nodes.has('agent-profiles-table') && !ui.nodes.has('add-agent-configuration'));
  h.mode('launcher');
  const rows = ui.nodes.get('thread-launchers').children;
  assert.ok(rows.indexOf(ui.nodes.get('start-claude').element) < rows.indexOf(ui.nodes.get('launcher-section-3').element));
  assert.ok(rows.indexOf(ui.nodes.get('launcher-section-3').element) < rows.indexOf(ui.nodes.get(`start-${key}`).element));
});

test('Usage keeps the Auto table as a one-row empty box until an added account can join it', async () => {
  const h = await profileTableUi(), { ui, memory } = h;
  h.mount(); h.view.launchers = h.accounts.filter(agent => agent.key !== 'devkits-codex-work');
  h.view.settingsPage = 'usage'; ui.nodes.clear(); h.render();
  // Auto sits below the merged list; its rules stay collapsed until asked for.
  assert.ok(!ui.nodes.has('auto-account-rules') && ui.nodes.has('auto-account-empty'));
  ui.nodes.get('auto-rules-toggle').click({}, h.cx); ui.nodes.clear(); h.render();
  assert.ok(ui.nodes.has('auto-account-rules'));
  assert.ok(ui.texts.includes('No added accounts.'));
  assert.ok(!ui.nodes.has('auto-open-accounts'));
  h.view.launchers = h.accounts; memory['devkits.hidden-usage-profiles'] = [];
  ui.nodes.clear(); h.render();
  assert.ok(!ui.nodes.has('auto-account-empty') && ui.nodes.has('auto-account-devkits-codex-work'));
});

test('Add and Edit stack over Settings; Cancel, Escape and Save close only the editor', async () => {
  const key = 'devkits-preset-one', h = await profileTableUi({ 'devkits.agent-configs': [{ key, name: 'Review', profileKey: 'claude' }] });
  const { ui, cx } = h;
  for (const action of ['add-agent-configuration', `edit-agent-profile-${key}`]) {
    h.mount(); const closedBefore = h.closed.length, openedBefore = h.overlays.length;
    ui.nodes.get(action).click({}, cx);
    assert.equal(h.closed.length, closedBefore);
    assert.equal(h.overlays.length, openedBefore + 1);
    assert.equal(h.overlays.at(-1).modal, true);
    h.mount('agent-profile-editor', action.startsWith('edit') ? key : null);
    ui.nodes.get('cancel-agent-profile').click();
    assert.deepEqual(h.closed.slice(closedBefore), ['profile-editor']);
    assert.equal(h.overlays.length, openedBefore + 1);
  }
  h.mount('agent-profile-editor', key);
  let stopped = false;
  ui.nodes.get('agent-profile-editor').keyDown({ key: 'escape' }, { ...cx, stop_propagation() { stopped = true; } });
  assert.equal(h.closed.at(-1), 'profile-editor'); assert.equal(stopped, true);
  h.mount('agent-profile-editor', key); h.name('Updated');
  const openedBeforeSave = h.overlays.length;
  ui.nodes.get('save-agent-profile').click({}, cx);
  assert.equal(h.closed.at(-1), 'profile-editor');
  assert.equal(h.overlays.length, openedBeforeSave);
  assert.ok(!h.closed.includes('settings'));
  assert.equal(h.memory['devkits.agent-configs'][0].name, 'Updated');
});

test('invalid or deleted profile drafts cannot create or resurrect stored configurations', async () => {
  const key = 'devkits-preset-one', h = await profileTableUi({ 'devkits.agent-configs': [{ key, name: 'Review', profileKey: 'claude' }] });
  h.mount('agent-profile-editor'); h.view.saveAgentProfile(h.cx);
  assert.match(h.view.profileError, /name/);
  h.name('New'); h.view.saveAgentProfile(h.cx); assert.match(h.view.profileError, /account/);
  h.pick('profile', 'codex'); h.view.profileDraft.model = 'missing'; h.view.saveAgentProfile(h.cx);
  assert.match(h.view.profileError, /available model/);
  assert.equal(h.memory['devkits.agent-configs'].length, 1);
  h.mount('agent-profile-editor', key); h.memory['devkits.agent-configs'] = [];
  h.view.saveAgentProfile(h.cx);
  assert.match(h.view.profileError, /no longer exists/);
  assert.deepEqual(h.memory['devkits.agent-configs'], []);
});

test('account discovery preserves independent settings and never converts old preference keys', async () => {
  const memory = { 'devkits.profile-sessions': { codex: { model: 'saved' } },
    'devkits.hidden-launchers': ['agent:devkits-preset-review'],
    'devkits.agent-configs': [{ key: 'devkits-preset-review', profileKey: 'codex', name: 'Review' }] };
  const View = await viewFor({ shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
  const view = new View(), before = structuredClone(memory);
  view.availableAgents([{ key: 'codex', run: ['codex'] }, { key: 'devkits-codex-work', run: ['codex'] }]);
  assert.deepEqual(memory, before);
  assert.equal(memory['devkits.profile-sessions']['devkits-codex-work'], undefined);
  assert.equal(memory['devkits.hidden-usage-profiles'], undefined);
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
  assert.ok(!ui.nodes.has('settings-page-codex') && ui.nodes.has('settings-page-agents') && !ui.nodes.has('settings-page-rules'));
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
  const view = new View(); view.paneHeader({});
  ui.nodes.get('asana-link-tab-1').click({}, { stop_propagation() {} }); view.drainTasks();
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
  assert.ok(ui.texts.includes('Work'));
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
  assert.equal(threadProfile({ id: 'a', name: 'Fix login', named: true }, launchers, { a: 'devkits-codex-work' }), 'work');
  assert.equal(threadProfile({ id: 'b', name: 'Codex · work', named: true }, launchers), 'work');
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
test('Codex account sessions synchronize MCP without running plugin synchronization', async () => {
  const commands = [], closed = [], ui = fakeElements();
  const View = await viewFor({ ...ui, spaces: () => [], run: (...args) => commands.push(args),
    shared: key => key === 'devkits.plugin-syncs' ? { '/account': 1 } : undefined,
    closeOverlay: id => closed.push(id), notify: error => assert.fail(error.body),
    exec: async (command, args) => { assert.equal(command, 'node'); assert.ok(args[0].endsWith('/shared-mcp-sync.js')); assert.equal(args[1], '/account'); return { code: 0 }; } });
  const view = new View();
  const pending = view.startThread({ key: 'devkits-codex-work', name: 'Work',
    run: ['env', 'CODEX_HOME=/account', 'codex'] }, { space: 'one', folder: '/project', overlay: 'launcher' });
  assert.deepEqual(closed, []);
  await settle();
  assert.deepEqual(commands.find(([name]) => name === 'tab.new'), ['tab.new', {
    space: 'one', folder: '/project', name: 'Work', argv: [...rulesArgv({ key: 'codex' }, ['env', 'CODEX_HOME=/account', 'codex']), ...tasksMcpFlags('codex')],
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
      readTextFile: path => path.endsWith('/AGENTS.md') ? new Promise(resolve => { finishRead = resolve; }) : Promise.resolve(null) });
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
    assert.deepEqual(starts[0][1].argv, [...rulesArgv(agent, [key], {file:'/herdr/data/devkits/AGENTS.md',text:composeRuleGuide(splitRuleGuide('Use hc run.'), ruleSelection()),composed:true}), ...tasksMcpFlags(key)]);
    assert.ok(!starts[0][1].argv.join(' ').includes('tasks-cli.cjs'));
  }
});

test('Asana opens directly from the status bar and stays bound to its originating project', async () => {
  const overlays = [], memory = {}, project = { id: 'one', name: 'One', folder: '/Code/one', active: true, tabs: [] };
  const ui = fakeElements();
  const View = await viewFor({ ...ui, spaces: () => [project], openOverlay: spec => overlays.push(spec),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
  const view = new View(); view.statusBar({});
  ui.nodes.get('open-asana').click(); view.drainTasks();
  assert.equal(overlays[0].kind, 'dialog'); assert.equal(overlays[0].modal, false);
  assert.equal(overlays[0].mod, 'devkits-asana');
  assert.equal(overlays[0].props.context.folder, '/Code/one');
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
    ['tab.new', { space: 'api', folder: '/Code/api', name: 'Fix login', argv: ['claude', '--model', 'opus', '--effort', 'max', ...tasksMcpFlags('claude'), 'prompt:Fix login'] }]);
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
  for (const id of ['open-tasks', 'open-asana', 'open-mantisbt']) assert.ok(ui.nodes.has(id));
});
test('with no project, Welcome opens a folder, lists this computer\'s agents and opens agent settings', async () => {
  const ui = fakeElements(), overlays = [], memory = { 'devkits.agent-cache': { null: [
    { key: 'claude', name: 'Claude', installed: true, run: ['claude'] },
    { key: 'devkits-claude-work', name: 'Claude · Work', installed: true, run: ['claude'] }] } };
  const View = await viewFor({ ...ui, spaces: () => [], theme: () => ({}), shared: key => memory[key],
    setShared: (key, value) => { memory[key] = value; }, openOverlay: value => overlays.push(value), closeOverlay() {} });
  // Use the shell without the Agents provider mixins from the integration fixture.
  const Shell = Object.getPrototypeOf(View), view = new Shell();
  const cx = { spawn() { assert.fail('cached agents need no discovery'); }, notify() {} };
  view.welcomeView({}, cx);
  assert.ok(ui.nodes.has('welcome-open-folder'));
  assert.ok(ui.textOf('welcome-agent-claude').includes('Ready'));
  assert.ok(ui.textOf('welcome-agent-codex').includes('Not installed'));
  assert.ok(ui.texts.includes('npm install -g @openai/codex') && ui.texts.includes('1 account'));
  assert.ok(ui.nodes.has('welcome-recheck-agents'));
  memory['devkits.account-identities'] = { claude: { email: 'saved@example.com' } };
  view.welcomeView({}, cx);
  assert.ok(ui.textOf('welcome-agent-claude').includes('saved@example.com'));
  memory['devkits.usage.snapshot'] = { contexts: { null: { usage: [{ key: 'claude', email: 'usage@example.com' }] } } };
  view.welcomeView({}, cx);
  assert.ok(ui.textOf('welcome-agent-claude').includes('usage@example.com'));
  memory['devkits.usage.snapshot'].contexts.null.usage[0].email = null;
  view.welcomeView({}, cx);
  assert.ok(ui.textOf('welcome-agent-claude').includes('saved@example.com'));
  ui.nodes.get('welcome-agent-settings').click({}, renderContext);
  assert.deepEqual(overlays[0].props, { view: 'manage-launchers', space: null, page: 'accounts' });
});

test('a project start list shows Add session\'s visible launchers and starts only the chosen one', async () => {
  const ui = fakeElements(), memory = { 'devkits.hidden-launchers': ['agent:claude'], 'devkits.agent-cache': { null: [
    { key: 'codex', name: 'Codex', installed: true, run: ['codex'] }, { key: 'claude', name: 'Claude', installed: true, run: ['claude'] }] } };
  const View = await viewFor({ ...ui, spaces: () => [], theme: () => ({}), keys: () => [], shared: key => memory[key],
    setShared: (key, value) => { memory[key] = value; } });
  const view = new View(), started = [];
  view.startThread = async (agent, target, options) => started.push([agent?.key || 'terminal', target, options]);
  view.projectStartView({ id: 'api', name: 'api', folder: '/Code/api', active: true }, {}, { spawn() {}, notify() {} });
  assert.ok(ui.nodes.has('start-panel-terminal') && ui.nodes.has('start-panel-codex'));
  assert.ok(!ui.nodes.has('start-panel-claude'));
  assert.deepEqual(started, []);
  ui.nodes.get('start-panel-codex').click({}, renderContext);
  ui.nodes.get('start-panel-terminal').click({}, renderContext);
  assert.deepEqual(started, [['codex', { space: 'api', folder: '/Code/api', projectName: 'api' }, undefined],
    ['terminal', { space: 'api', folder: '/Code/api', projectName: 'api' }, undefined]]);
});

test('empty conversation areas stay blank while the editor offers the start list', async () => {
  const ui = fakeElements();
  const saved = ['/Code/new'];
  let catalog = projectCatalog([], saved, {}, 'project:/Code/new');
  assert.equal(catalog[0].pending, true);
  assert.deepEqual(catalog[0].tabs, []);
  const commands = [], overlays = [];
  let currentView = 'project-empty';
  const View = await viewFor({ ...ui, spaces: () => [], shared: key => key === 'devkits.projects' ? saved : key === 'devkits.selected-project' ? 'project:/Code/new' : undefined,
    props: () => ({ view: currentView, space: null, folder: '/Code/new', projectName: 'new', overlay: 'popup' }), theme: () => ({}),
    run: (...args) => commands.push(args), openOverlay: value => overlays.push(value), closeOverlay() {} });
  const view = new View();
  view.render({ spawn() {}, notify() {} });
  assert.ok(!ui.nodes.has('project-start'));
  assert.ok(!ui.texts.includes('Start a thread'));
  assert.deepEqual(commands, []);
  currentView = 'editor';
  view.editor = { render: (_project, _cx, { empty }) => empty() };
  view.render({ spawn() {}, notify() {} });
  assert.ok(ui.nodes.has('project-start') && ui.texts.includes('Start a thread'));
  assert.ok(ui.nodes.has('project-start-settings'));
  assert.deepEqual(commands, []);
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
test('closing every project hides a conversation area that native layout reports without a hidden flag', async () => {
  const commands = [];
  const View = await viewFor({ ...fakeElements(), spaces: () => [], agents: () => [], theme: () => ({}), setAgentOrder() {},
    layout: () => ({ id: 'root', children: [{ id: 'workspace-view', type: 'stack', active: 'main', children: [] }] }),
    run: (...args) => commands.push(args) });
  const view = new View(); view.init(); view.render();
  assert.ok(commands.some(([name, args]) => name === 'layout.hide' && args.id === 'workspace-view'));
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

test('profile launcher labels never mask live task titles in the sidebar, pane header or Tasks', async () => {
  const key = 'devkits-preset-work', label = 'Agent 1 - Work';
  const project = { id: 'one', folder: '/Code/repo', name: 'Repo', active: true,
    tabs: [{ id: 'custom', name: label, named: true, active: true }] };
  const agent = { address: 'live', space: 'one', tab: 'custom', app: 'codex', title: '✳ Fix login | repo',
    status: 'working', program: { key: 'codex', name: 'Codex' } };
  const memory = { 'devkits.agent-cache': { null: [{ key: 'devkits-codex-work', name: 'Codex · Work', run: ['codex'] }] },
    'devkits.agent-configs': [{ key, profileKey: 'devkits-codex-work', name: 'Agent 1' }],
    'devkits.thread-profiles': { custom: key } };
  const ui = fakeElements();
  const View = await viewFor({ ...ui, spaces: () => [project], agents: () => [agent],
    props: () => ({ pane: 'primary' }), theme: () => ({}), run() {}, setAgentOrder() {},
    panes: () => [{ pane: 'primary', tab: 'custom', terminal: 'live', focused: true }],
    shared: name => memory[name], setShared: (name, value) => { memory[name] = value; } });
  const view = new View(); view.folded = new Set();
  const cx = { ...renderContext, spawn() {}, timer: { every() {} } };
  const assertTitle = expected => {
    view.render(cx);
    assert.ok(ui.textOf('thread-custom').includes(expected));
    view.paneHeader({}, cx);
    assert.ok(ui.textOf('pane-header-primary').includes(expected));
    assert.equal(Object.values(memory['devkits.agent-board'])[0]['thread:custom'].name, expected);
  };
  for (const status of ['working', 'blocked', 'done', 'idle']) { agent.status = status; assertTitle('Fix login'); }
  agent.title = 'Codex'; assertTitle(label);
  agent.title = 'Fix a different issue';
  memory['devkits.thread-tasks'] = { custom: { gid: 'local:task', name: 'Explicit task', source: 'local', folder: project.folder } };
  view.render(cx); view.paneHeader({}, cx);
  assert.ok(ui.textOf('thread-custom').includes('Explicit task'));
  assert.ok(ui.textOf('pane-header-primary').includes('Explicit task'));
  project.tabs[0].name = 'Manually named conversation';
  view.render(cx);
  assert.ok(ui.textOf('thread-custom').includes('Explicit task'));
});

test('automatic custom and account labels are fallbacks for both providers, while explicit task names win', () => {
  for (const [app, provider] of [['codex', 'Codex'], ['claude-code', 'Claude Code']]) {
    for (const label of ['Agent 1 - Work', 'Work', `${provider} · Work`]) {
      const tab = { name: label, named: true }, agent = { app, program: { name: provider }, title: '✳ Fix login' };
      assert.equal(threadTitle(tab, agent, null, { launcherName: label }), 'Fix login');
      assert.equal(threadTitle(tab, { ...agent, title: provider }, null, { launcherName: label }), launcherLabel(label));
      assert.equal(threadTitle({ ...tab, name: 'My conversation' }, agent, null, { launcherName: label }), 'My conversation');
      assert.equal(threadTitle(tab, agent, null, { launcherName: label, taskName: 'Assigned task' }), 'Assigned task');
    }
  }
});
test('installer adds only its own files and refuses to overwrite an existing installation', async t => {
  const home = await mkdtemp(join(tmpdir(), 'devkits-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await install(home);
  const layout = JSON.parse(await readFile(join(home, 'layouts', 'devkits.json'), 'utf8'));
  assert.equal(layout.children[0].id, 'sidebar');
  assert.match(await readFile(join(home, layout.preview), 'utf8'), /<svg/);
  const mod = join(home, 'mods', 'devkits');
  const system = join(home, 'mods', 'devkits-system');
  for (const name of ['devkits-agents', 'devkits-system', 'devkits-asana', 'devkits-mantisbt', 'devkits-tasks', 'devkits-calendar', 'devkits-usage']) {
    const path = join(home, 'mods', name);
    assert.equal(JSON.parse(await readFile(join(path, 'mod.json'), 'utf8')).place, 'none');
    assert.equal(await readFile(join(path, 'main.js'), 'utf8'), await readFile(new URL(`../mods/${name}/main.js`, import.meta.url), 'utf8'));
  }
  const hostFiles = await readdir(mod);
  for (const obsolete of ['asana.js', 'mantisbt.js', 'system-monitor.js', 'hardware-reader.js', 'vendor', 'agent-board.js', 'agent-board-state.js', 'calendar.js', 'task-composer.js', 'usage.js', 'usage-reader.js', 'analytics.js', 'analytics-reader.js', 'session-menu.js', 'account-login.js', 'account-actions.js', 'agent-profiles.js', 'shared-mcp-settings.js', 'shared-mcp-sync.js', 'codex-config.js', 'global-rules.js']) assert.ok(!hostFiles.includes(obsolete));
  const hardwarePackage = JSON.parse(await readFile(join(system, 'vendor', 'systeminformation', 'package.json'), 'utf8'));
  assert.equal(hardwarePackage.version, '5.33.19');
  assert.equal(hardwarePackage.license, 'MIT');
  assert.match(await readFile(join(system, 'vendor', 'systeminformation', 'LICENSE'), 'utf8'), /MIT License/);
  assert.match(await readFile(join(system, 'hardware-package.js'), 'utf8'), /vendor\/systeminformation\/lib\/index\.js/);
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
  assert.ok(ids.has('agents-service'));
  const separator = layout.children[1].children[2].children[0];
  assert.equal(separator.size.px, 1);
  assert.equal(separator.background, 'border');
  assert.equal(layout.children[1].children[2].children[0].children.find(node => node.id === 'agents-service').content.mod, 'devkits-agents');
  // The thread, then the editor (Files or Changes, each with its list at the right), then the simulator at the window's edge.
  const row = layout.children[1].children[1], [stack, editor, simulator] = row.children;
  assert.equal(stack.id, 'workspace-view');
  assert.ok(!stack.children.some(child => ['files', 'diff'].includes(child.id)));
  assert.equal(editor.id, 'editor');
  assert.equal(editor.hidden, false);
  assert.equal(stack.hidden, true);
  assert.equal(editor.type, 'stack');
  assert.equal(editor.children.find(child => child.id === 'workspace-editor').content.props.view, 'editor');
  assert.equal(editor.children.find(child => child.id === 'tasks').content.mod, 'devkits-tasks');
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

for (const name of ['devkits-agents', 'devkits-system', 'devkits-asana', 'devkits-mantisbt', 'devkits-tasks', 'devkits-calendar', 'devkits-usage']) test(`installer preserves an existing ${name} mod`, async t => {
  const home = await mkdtemp(join(tmpdir(), 'devkits-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const path = join(home, 'mods', name);
  await mkdir(path, { recursive: true }); await writeFile(join(path, 'main.js'), 'existing module');
  await assert.rejects(install(home), /Refusing to overwrite/);
  assert.equal(await readFile(join(path, 'main.js'), 'utf8'), 'existing module');
  await assert.rejects(readFile(join(home, 'mods', 'devkits', 'main.js')), { code: 'ENOENT' });
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

test('ordinary terminal icons follow live commands in primary, parallel and child panes', async () => {
  const ui = fakeElements();
  const thread = { space: 'api', tab: { id: 'tab-0' }, title: 'Terminal', agents: [] };
  const primary = { pane: 'p-main', terminal: 't-main', tab: 'tab-0', program: { shell: true } };
  const peer = { pane: 'p-peer', terminal: 't-peer', tab: 'tab-0', program: { shell: true } };
  let foreground = { pid: 42, name: 'bun', argv: ['bun', 'run', 'test'] };
  let target = primary.pane;
  const live = () => [primary, peer].map(pane => ({ address: pane.terminal, state: 'live', foreground }));
  const View = await viewFor({ ...ui, spaces: () => projects, agents: () => [],
    panes: () => [primary, peer], terminals: live, props: () => ({ pane: target }) });
  const view = new View();
  const loader = 'mods/devkits/assets/icons/loader.svg';
  for (const running of [true, false, true]) {
    foreground = running ? { pid: 42, name: 'bun', argv: ['bun', 'run', 'test'] }
      : { pid: 7, name: 'zsh', argv: ['/bin/zsh', '-l'] };
    const renders = [() => view.threadRow(thread, {}),
      ...[primary, peer].map(pane => () => { target = pane.pane; view.paneHeader({}); }),
      () => view.childRow(thread, view.paneEntries(thread, live())[0], {}),
      () => view.childRow(thread, { terminal: { address: 'child', state: 'live', foreground }, depth: 1, label: 'Build' }, {})];
    for (const render of renders) {
      ui.assets.length = 0;
      render();
      assert.equal(ui.assets.includes(loader), running);
      assert.equal(ui.assets.includes('mods/devkits/assets/icons/terminal.svg'), !running);
    }
  }
  // A parallel command has its own indicator; it does not mark an idle primary pane busy.
  peer.status = 'working';
  foreground = { pid: 7, name: 'zsh', argv: ['/bin/zsh', '-l'] };
  ui.assets.length = 0;
  view.threadRow(thread, {});
  assert.ok(!ui.assets.includes(loader));
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

test('Windows account launchers keep provider icons in the sidebar and pane header', async () => {
  for (const app of ['codex', 'claude-code']) {
    const command = ['env', 'CODEX_HOME=C:/Account', app === 'codex' ? 'codex' : 'claude'];
    const wrapped = terminalArgv(command, 'windows');
    const argv = ['powershell.exe', '-NoExit', '-Command',
      '& ' + wrapped.map(arg => "'" + arg.replaceAll("'", "''") + "'").join(' ')];
    const ui = fakeElements(), program = { icon: `icons/${app}.svg`, tint: app === 'claude-code' };
    const agent = { address: 't1', app, space: 'api', tab: 'tab-0', program, status: 'idle' };
    const thread = { space: 'api', tab: { id: 'tab-0' }, title: 'Task', agent, agents: [agent] };
    const View = await viewFor({ ...ui, props: () => ({ pane: 'pane-1' }),
      spaces: () => projects, agents: () => [agent], terminals: () => [{ address: 't1', argv }],
      panes: () => [{ pane: 'pane-1', tab: 'tab-0', program }] });
    assert.equal(commandKind(argv), app === 'codex' ? 'codex' : 'claude');
    assert.deepEqual(agentCommand(argv), command);
    assert.ok(archivable(thread, [{ address: 't1', argv }]));
    for (const render of [view => view.threadRow(thread, {}), view => view.paneHeader({})]) {
      ui.assets.length = 0;
      render(new View());
      assert.ok(ui.assets.includes(program.icon));
      assert.ok(!ui.assets.includes('mods/devkits/assets/icons/terminal.svg'));
    }
    ui.assets.length = 0;
    agent.status = 'working';
    new View().threadRow(thread, {});
    assert.ok(ui.assets.includes('mods/devkits/assets/icons/loader.svg'));
    assert.ok(!ui.assets.includes(program.icon));
  }
});

for (const resumed of [false, true]) for (const kind of ['codex', 'claude']) test(`Windows ${kind} ${resumed ? 'resumed ' : ''}archive uses shared JS discovery and retains account and resume flags`, async () => {
  const ui = fakeElements(), memory = { 'devkits.thread-profiles': { 'tab-0': 'work-profile' } }, commands = [], tasks = [], lookups = [];
  const id = '12345678-1234-1234-1234-123456789abc', directory = 'C:\\Accounts\\Work account';
  const command = ['env', `${kind === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'}=${directory}`, kind,
    ...(kind === 'codex' ? [...(resumed ? ['resume'] : []), '-m', 'fixture-model', '--sandbox', 'read-only'] : ['--permission-mode', 'bypassPermissions', ...(resumed ? ['--resume'] : [])]),
    ...(resumed ? [id] : [])];
  const wrapped = terminalArgv(command, 'windows');
  const argv = ['powershell.exe', '-NoExit', '-Command', '& ' + wrapped.map(arg => "'" + arg.replaceAll("'", "''") + "'").join(' ')];
  const agent = { ...claudeAgent, app: kind === 'codex' ? 'codex' : 'claude-code', status: 'idle', seq: 1 };
  const thread = { ...claudeThread, agent, agents: [agent] };
  const terminal = { address: agent.address, argv, cwd: '/Code/api', status: 'idle', foreground: { pid: 42 } };
  const file = kind === 'codex' ? `${directory}\\sessions\\rollout-2026-11-08T00-00-00-${id}.jsonl` : `${directory}\\projects\\work\\${id}.jsonl`;
  const View = await viewFor({ ...ui, window: () => ({ platform: 'windows' }), spaces: () => projects,
    terminals: () => [terminal], shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    run: (...args) => commands.push(args), hc: async () => ({ code: 0, stdout: JSON.stringify(terminal) }),
    exec: async (...args) => { lookups.push(args); return { code: 0, stdout: JSON.stringify({ file }) }; } });
  const view = new View(), cx = { notify() {}, spawn: fn => tasks.push(fn(cx)) };
  view.prepareThreadArchive(thread, cx); await Promise.all(tasks);
  ui.nodes.clear(); view.threadRow(thread, {});
  assert.equal(ui.nodes.get('archive-thread-tab-0').disabled, false);
  assert.ok(!ui.nodes.has('close-thread-tab-0'));
  assert.deepEqual(commands, [], 'Checking a conversation never archives or closes it');
  assert.deepEqual(lookups[0], ['node', ['/herdr/mods/devkits/components/agent-session-windows.js', '42', kind, directory, ...(resumed && kind === 'codex' ? [id] : [])]]);
  await view.archiveThread(thread);
  const entry = memory['devkits.archived-threads'][0];
  assert.equal(entry.id, `${kind}:${id}`);
  assert.equal(entry.profile, 'work-profile');
  assert.deepEqual(entry.argv, resumeArgv(command, id));
  assert.deepEqual(commands, [['tab.close', { id: thread.tab.id }]]);
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

for (const platform of ['windows', 'macos', 'linux']) test(`${platform} threads without a resumable conversation show Close before any Archive click`, async () => {
  for (const app of ['codex', 'claude-code']) {
    const ui = fakeElements(), commands = [], tasks = [];
    let reads = 0;
    const agent = { ...claudeAgent, app, status: 'idle', seq: 1 };
    const thread = { ...claudeThread, agent, agents: [agent] };
    const terminal = { address: agent.address, argv: [app === 'codex' ? 'codex' : 'claude'], foreground: { pid: 42 } };
    const View = await viewFor({ ...ui, window: () => ({ platform }), spaces: () => projects,
      terminals: () => [terminal], run: (...args) => commands.push(args),
      setShared: () => assert.fail('A missing session must not create an archive'),
      notify: () => assert.fail('Preflight must not show an archive failure'),
      hc: async () => { reads++; return { code: 0, stdout: JSON.stringify(terminal) }; },
      readTextFile: async () => null, exec: async () => ({ code: 0, stdout: '' }) });
    const view = new View(), cx = { stop_propagation() {}, notify() {}, spawn: fn => tasks.push(fn(cx)) };
    view.prepareThreadArchive(thread, cx);
    view.threadRow(thread, {});
    assert.equal(ui.nodes.get('archive-thread-tab-0').disabled, true);
    ui.nodes.get('archive-thread-tab-0').click({}, cx);
    assert.deepEqual(commands, []);
    await Promise.all(tasks);
    assert.deepEqual(commands, []);
    view.prepareThreadArchive(thread, cx);
    assert.equal(reads, 1, 'An unchanged idle thread must reuse its check');
    ui.nodes.clear(); view.threadRow(thread, {});
    assert.ok(!ui.nodes.has('archive-thread-tab-0'));
    assert.equal(ui.nodes.get('close-thread-tab-0').disabled, false);
    // A rendered Close action must not terminate a thread that has since started working.
    terminal.status = 'working';
    ui.nodes.get('close-thread-tab-0').click({}, cx);
    assert.deepEqual(commands, []);
    terminal.status = 'idle';
    ui.nodes.get('close-thread-tab-0').click({}, cx);
    assert.deepEqual(commands, [['tab.close', { id: thread.tab.id }]]);
  }
});

for (const platform of ['windows', 'macos', 'linux']) test(`${platform} archive checks retain resumable sessions and discard results after work resumes`, async () => {
  const ui = fakeElements(), tasks = [], commands = [];
  let reply;
  const agent = { ...claudeAgent, app: 'codex', status: 'idle', seq: 1 };
  const thread = { ...claudeThread, agent, agents: [agent] };
  const terminal = { address: agent.address, argv: ['codex'], status: 'idle', foreground: { pid: 42 } };
  const View = await viewFor({ ...ui, window: () => ({ platform }), spaces: () => projects,
    terminals: () => [terminal], run: (...args) => commands.push(args),
    hc: () => new Promise(resolve => { reply = () => resolve({ code: 0, stdout: JSON.stringify(terminal) }); }),
    exec: async () => ({ code: 0, stdout: platform === 'windows'
      ? JSON.stringify({ file: 'C:\\Account\\sessions\\rollout-2026-11-08-12345678-1234-1234-1234-123456789abc.jsonl' })
      : 'n/home/rollout-2026-11-08-12345678-1234-1234-1234-123456789abc.jsonl\n' }) });
  const view = new View(), cx = { notify() {}, spawn: fn => tasks.push(fn(cx)) };
  view.prepareThreadArchive(thread, cx);
  terminal.status = agent.status = 'working'; agent.seq++;
  view.prepareThreadArchive(thread, cx);
  reply(); await Promise.all(tasks.splice(0));
  view.threadRow(thread, {});
  assert.ok(ui.nodes.has('stop-thread-tab-0'));
  assert.ok(!view.closeOnlyThreads?.has(thread.tab.id));
  terminal.status = agent.status = 'idle'; agent.seq++;
  view.prepareThreadArchive(thread, cx);
  reply(); await Promise.all(tasks);
  ui.nodes.clear(); view.threadRow(thread, {});
  assert.equal(ui.nodes.get('archive-thread-tab-0').disabled, false);
  assert.ok(!ui.nodes.has('close-thread-tab-0'));
  assert.deepEqual(commands, []);
});

test('archive discovery recovers after startup metadata arrives without requiring a new agent status', async () => {
  const ui = fakeElements(), tasks = [];
  let found = false, reads = 0;
  const agent = { ...claudeAgent, app: 'codex', status: 'idle', seq: 0 };
  const thread = { ...claudeThread, agent, agents: [agent] };
  const terminal = { address: agent.address, argv: ['codex'], status: 'idle', foreground: { pid: 42 } };
  const View = await viewFor({ ...ui, spaces: () => projects, window: () => ({ platform: 'windows' }),
    terminals: () => [terminal], hc: async () => ({ code: 0, stdout: JSON.stringify(terminal) }),
    exec: async () => { reads++; return { code: 0, stdout: JSON.stringify({ file: found
      ? 'C:/Account/sessions/rollout-2026-11-08-12345678-1234-1234-1234-123456789abc.jsonl' : null }) }; } });
  const view = new View(), cx = { notify() {}, spawn: fn => tasks.push(fn(cx)) };
  view.prepareThreadArchive(thread, cx); await Promise.all(tasks.splice(0));
  assert.ok(view.closeOnlyThreads.has(thread.tab.id));
  view.prepareThreadArchive(thread, cx); assert.equal(reads, 1, 'Failed discovery is throttled');
  found = true; view.archiveChecks.get(thread.tab.id).retryAt = Date.now() - 1;
  view.prepareThreadArchive(thread, cx); await Promise.all(tasks.splice(0));
  assert.equal(reads, 2);
  assert.ok(!view.closeOnlyThreads.has(thread.tab.id));
  ui.nodes.clear(); view.threadRow(thread, {});
  assert.equal(ui.nodes.get('archive-thread-tab-0').disabled, false);
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

test('resuming an archived thread preserves its archive until the new native tab is confirmed', async () => {
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
  assert.deepEqual(memory['devkits.archived-threads'], [entry]);
  assert.equal(view.archiveOpen, false);
  assert.deepEqual(commands.at(-1), ['tab.new', { space: 'api', folder: '/Code/api', name: 'Fix login', argv: ['claude', '--resume', 'abc'] }]);
  assert.equal(memory['devkits.pending-profiles'][0].key, 'devkits-claude-work');
  assert.equal(memory['devkits.pending-profiles'][0].restoreArchiveId, entry.id);
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

test('the global Agent Guide seeds visible task reporting once and preserves edits or intentional emptiness', async () => {
  let guide = null;
  const writes = [], root = 'C:\\Guide space\\Herdr';
  const model = await import('../mods/devkits-agents/global-rules-model.js');
  const { ensureRules, sessionRules } = await evaluateNative('../mods/devkits-agents/global-rules.js', {
    ...model, shared: () => undefined,
    appHome: () => root, rulesPath: () => `${root}/data/devkits/AGENTS.md`, readTextFile: async () => guide,
    writeTextFile: async (file, text, expected) => { writes.push({ file, text, expected }); guide = text; },
  }, 'ensureRules, sessionRules');
  await ensureRules();
  assert.match(guide, /## Herdr task progress/);
  assert.match(guide, /herdr_tasks/);
  assert.match(guide, /report_task/);
  assert.ok(!guide.includes(root) && !guide.includes('tasks-cli.cjs'), 'Guide discovers MCP tools without a local script path');
  assert.match(guide, /whole task is complete/);
  assert.equal(writes[0].expected, null);
  assert.equal((await sessionRules()).text, guide);
  for (const edited of ['My custom reporting policy', '']) {
    guide = edited; await ensureRules(); assert.equal(guide, edited);
  }
  assert.equal(writes.length, 1, 'An existing Guide is never rewritten on startup');
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
    assert.equal(argv.includes('--append-system-prompt'), expected);
    assert.ok(!argv.join(' ').includes('tasks-cli.cjs'), 'Reporting policy must come only from the editable global Guide');
    assert.equal(argv.some(arg => arg.includes('## Custom rules')), expected);
  }
});

test('new profile sessions append their latest instructions after global rules without changing native accounts or files', async () => {
  const extra = 'Review "繁體中文".\nKeep `code` and \\paths.';
  for (const provider of ['codex', 'claude']) {
    for (const global of ['Global rules', null, '  \n', new Error('unreadable')]) {
      const commands = [], key = 'devkits-preset-review';
      const config = { key, profileKey: provider, name: 'Review', instructions: extra };
      const View = await viewFor({ spaces: () => [{ id: 'api', tabs: [] }],
        shared: name => name === 'devkits.agent-configs' ? [config] : undefined,
        readTextFile: async path => { if (!path.endsWith('/AGENTS.md')) return null; if (global instanceof Error) throw global; return global; },
        writeTextFile: async () => assert.fail('Launching must not modify rules files'),
        run: (...args) => commands.push(args) });
      const agent = { key, profileKey: provider, run: [provider], instructions: 'Stale cached value' };
      await new View().launchThread(agent, { space: 'api', folder: '/Code/api' }, {});
      const argv = commands.find(([name]) => name === 'tab.new')[1].argv;
      const expected = (global === 'Global rules' ? composeRuleGuide(splitRuleGuide(global), ruleSelection()).trim() + '\n\n' : '') + '# Agent profile instructions\n\n' + extra;
      assert.deepEqual(argv, provider === 'codex' ? [provider, '-c', `developer_instructions=${JSON.stringify(expected)}`, ...tasksMcpFlags(provider)]
        : [provider, '--append-system-prompt', expected, ...tasksMcpFlags(provider)]);
      commands.length = 0;
      await new View().launchThread({ key: provider, run: [provider] }, { space: 'api', folder: '/Code/api' }, {});
      assert.ok(!commands.find(([name]) => name === 'tab.new')[1].argv.join(' ').includes(extra));
    }
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
  ui.nodes.get('settings').click();
  assert.deepEqual(commands, [['app.settings']]);
  assert.equal(ui.nodes.get('settings').mouseDownByButton?.right, undefined);
  target = { view: 'status' }; ui.texts.length = 0; ui.nodes.clear();
  new View().render();
  assert.ok(!ui.nodes.has('settings'));
  assert.ok(!ui.texts.includes('Local project') && !ui.texts.includes('feature/login'));
  machine = 'vps'; new View().render();
  assert.ok(ui.texts.includes('vps'));
});

test('interface settings control features before locations and preserve preferences while hidden', async () => {
  const ui = fakeElements(), opened = [], closed = [], resetCommands = [];
  const monitoring = { interval: 3000, widgets: ['cpu', 'ram'], placement: 'sidebar' };
  const memory = { 'devkits.system-monitor': monitoring,
    'devkits.system-display': { sidebar: { visible: true, style: 'graph', cpuMode: 'cores', height: 320 }, status: { visible: false } } };
  let target = {}, sideEffects = 0;
  const View = await viewFor({ ...ui, props: () => target, theme: () => ({}), setAgentOrder() {},
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; },
    openOverlay: spec => opened.push(spec), closeOverlay: id => closed.push(id),
    run: command => resetCommands.push(command),
    exec: async () => { sideEffects++; return { code: 0 }; } });
  const sidebar = new View(); sidebar.folded = new Set(); sidebar.render(renderContext);
  ui.nodes.get('open-interface-settings').click();
  assert.equal(opened.at(-1).props.view, 'ui-settings');
  target = { view: 'ui-settings', overlay: 'interface' };
  const settings = new View(); settings.init({}, renderContext);
  const render = () => { ui.nodes.clear(); settings.render(renderContext); };
  const choose = (id, value) => {
    ui.nodes.get(id).click({}, renderContext); settings.render(renderContext);
    ui.nodes.get(`${id}-option-${value}`).click({}, renderContext); render();
  };
  render();
  assert.ok(ui.nodes.has('interface-page-system') && ui.nodes.has('interface-page-usage'));
  assert.ok(!ui.nodes.has('interface-page-sidebar') && !ui.nodes.has('usage-visible'));
  assert.equal(ui.nodes.get('interface-system-visible').checked, true);
  choose('interface-system-location', 'both');
  assert.equal(memory['devkits.system-display'].sidebar.visible, true);
  assert.equal(memory['devkits.system-display'].status.visible, true);
  assert.ok(!ui.nodes.has('interface-system-style'));
  choose('interface-system-cpu', 'total');
  choose('interface-system-height-mode', 'rows-4');
  ui.nodes.get('interface-system-visible').change(false, renderContext); render();
  assert.ok(!ui.nodes.has('interface-system-location') && !ui.nodes.has('interface-system-style'));
  assert.deepEqual(memory['devkits.system-display'], {
    enabled: false, sidebar: { visible: true, style: 'compact', cpuMode: 'total', heightMode: 'rows', rows: 4 }, status: { visible: true },
  });
  target = {}; const hiddenSidebar = new View();
  target = { view: 'status' }; const hiddenStatus = new View();
  assert.equal(hiddenSidebar.systemDisplay.active(), false);
  assert.equal(hiddenStatus.systemDisplay.active(), false);
  ui.nodes.clear(); hiddenSidebar.systemDisplay.renderSidebar({}); hiddenStatus.systemDisplay.renderStatus({});
  assert.ok(!ui.nodes.has('system-usage') && !ui.nodes.has('status-system'));
  target = { view: 'ui-settings', overlay: 'interface' };
  const reloaded = new View(); reloaded.init({}, renderContext); reloaded.render(renderContext);
  assert.equal(ui.nodes.get('interface-system-visible').checked, false);
  ui.nodes.get('interface-system-visible').change(true, renderContext); render();
  assert.equal(memory['devkits.system-display'].sidebar.visible, true);
  assert.equal(memory['devkits.system-display'].status.visible, true);
  choose('interface-system-location', 'status');
  for (const id of ['interface-system-style', 'interface-system-cpu', 'interface-system-reset-height'])
    assert.ok(!ui.nodes.has(id), `${id} only applies to the Sidebar location`);
  choose('interface-system-location', 'sidebar');
  assert.equal(memory['devkits.system-display'].sidebar.style, 'compact');
  assert.ok(!ui.nodes.has('interface-system-style'));
  assert.ok(ui.nodes.has('interface-system-cpu'));
  assert.equal(memory['devkits.system-monitor'], monitoring);
  assert.equal(sideEffects, 0, 'Interface settings do not start provider reads or discovery');
  assert.deepEqual(closed, []);
  ui.nodes.get('interface-monitor-settings').click();
  assert.equal(opened.at(-1).mod, 'devkits-system');
  assert.equal(opened.at(-1).props.page, 'settings');
  assert.deepEqual(closed, [], 'Provider settings stack above interface settings');
  ui.nodes.get('interface-system-reset').click({}, renderContext); render();
  assert.deepEqual(memory['devkits.system-display'], {
    enabled: true, sidebar: { visible: true, style: 'compact', cpuMode: 'cores', heightMode: 'auto', rows: 6 }, status: { visible: false },
  });
  assert.equal(resetCommands.at(-1), 'devkits-system.reset', 'The monitoring owner handles its own reset');
  assert.equal(memory['devkits.system-monitor'], monitoring, 'The host never writes monitoring preferences');
  assert.equal(sideEffects, 0, 'Reset does not launch a hardware reader');
  assert.deepEqual(closed, [], 'Reset keeps settings open');
  ui.nodes.get('interface-page-usage').click({}, renderContext); render();
  assert.ok(!ui.nodes.has('interface-system-visible'));
  assert.ok(!ui.nodes.has('interface-system-reset'), 'SYSTEM reset is scoped to its own page');
  assert.equal(ui.nodes.get('usage-visible').checked, true);
  ui.nodes.get('usage-visible').change(false, renderContext); render();
  assert.equal(ui.nodes.get('usage-visible').checked, false);
  ui.nodes.get('interface-settings-done').click();
  assert.deepEqual(closed, ['interface']);
});

test('System height settings offer row presets and automatic content height without pixel input', async () => {
  const ui = fakeElements(), memory = { 'devkits.system-display': {
    enabled: true, sidebar: { visible: true, style: 'graph', heightMode: 'fixed', height: 350 }, status: { visible: false },
  } };
  const View = await viewFor({ ...ui, theme: () => ({}), props: () => ({ view: 'ui-settings' }),
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; } });
  const settings = new View(); settings.init({}, renderContext);
  const render = () => { ui.nodes.clear(); settings.render(renderContext); };
  render();
  assert.equal(settings.interfaceSettings.heightInput, undefined);
  assert.ok(!ui.nodes.has('interface-system-height'));
  assert.ok(!ui.nodes.has('interface-system-height-mode-option-fixed'));
  for (const value of ['rows-2', 'rows-4', 'rows-6', 'auto']) {
    ui.nodes.get('interface-system-height-mode').click({}, renderContext); settings.render(renderContext);
    ui.nodes.get(`interface-system-height-mode-option-${value}`).click({}, renderContext); render();
    assert.equal(memory['devkits.system-display'].sidebar.heightMode, value === 'auto' ? 'auto' : 'rows');
    if (value !== 'auto') assert.equal(memory['devkits.system-display'].sidebar.rows, Number(value.slice(5)));
    assert.equal(Object.hasOwn(memory['devkits.system-display'].sidebar, 'height'), false);
  }
});

test('System enables explicitly disabled current preferences and retains the last location', async () => {
  const ui = fakeElements(), memory = { 'devkits.system-display': {
    enabled: false, sidebar: { visible: false, style: 'compact', heightMode: 'auto', rows: 6 }, status: { visible: false },
  } };
  let target = { view: 'ui-settings', overlay: 'interface' };
  const View = await viewFor({ ...ui, theme: () => ({}), props: () => target,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, closeOverlay() {} });
  const settings = new View(); settings.init({}, renderContext); settings.render(renderContext);
  assert.equal(ui.nodes.get('interface-system-visible').checked, false);
  assert.ok(!ui.nodes.has('interface-system-location'));
  ui.nodes.get('interface-system-visible').change(true, renderContext);
  assert.equal(memory['devkits.system-display'].enabled, true);
  assert.equal(memory['devkits.system-display'].sidebar.visible, true);
  assert.equal(memory['devkits.system-display'].sidebar.rows, 6);
  target = { view: 'system-display-menu', surface: 'sidebar' };
  const menu = new View(); menu.init({}, renderContext); menu.render(renderContext);
  ui.nodes.get('system-display-sidebar').click({}, renderContext);
  assert.equal(memory['devkits.system-display'].enabled, false);
  assert.equal(memory['devkits.system-display'].sidebar.visible, true, 'Hide retains the last chosen location');
  target = { view: 'system-display-menu', surface: 'status' };
  const statusMenu = new View(); statusMenu.init({}, renderContext); statusMenu.render(renderContext);
  ui.nodes.get('system-display-status').click({}, renderContext);
  assert.equal(memory['devkits.system-display'].enabled, true);
  assert.equal(memory['devkits.system-display'].sidebar.visible, false);
  assert.equal(memory['devkits.system-display'].status.visible, true);
  assert.equal(memory['devkits.system-display'].sidebar.style, 'compact');
});

test('agent Usage settings choose accounts only; the Usage display switch stays in Interface settings', async () => {
  const ui = fakeElements();
  const View = await viewFor({ ...ui });
  new View().agentsPage([], [], () => {}, () => {}, () => {}, {});
  assert.ok(!ui.nodes.has('usage-visible') && !ui.nodes.has('usage-interface-settings'));
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

test('Agent settings includes Global Rules and Shared MCP after Profiles', async () => {
  const ui = fakeElements();
  const View = await viewFor({ ...ui, props: () => ({ view: 'manage-launchers', overlay: 'settings' }), theme: () => ({}) });
  const view = new View(); view.initSessionMenu({ ...renderContext, spawn() {}, timer: { every() {} } });
  view.launchers = [{ key: 'claude', name: 'Claude', icon: 'icons/claude.svg' }];
  view.render(renderContext);
  const order = ui.nodes.get('settings-pages').children.map(child => [...ui.nodes.entries()].find(([, data]) => data.element === child)?.[0]?.replace('settings-section-', 'settings-page-'));
  assert.deepEqual(order, ['settings-page-accounts', 'settings-page-agents', 'settings-page-agent-profiles', 'settings-page-global-rules', 'settings-page-shared-mcp', 'settings-page-ecc']);
  assert.ok(ui.nodes.has('settings-page-global-rules') && !ui.nodes.has('shared-local-mcp'));
  assert.ok(!ui.nodes.has('hardware-settings'));
});

test('ECC architecture panel separates provider selections, explains components and saves one global draft with conflict protection', async () => {
  const ui = fakeElements(), writes = [], tasks = [];
  const original = JSON.stringify({ version: 1, enabled: false, source: '/ecc', claudeHooks: 'standard' });
  const skill = { id: 'skills:alpha', group: 'skills', name: 'alpha', path: 'skills/alpha/SKILL.md', description: 'Alpha workflow', providers: ['claude', 'codex'], defaultEnabled: true };
  const catalog = { source: '/ecc', version: '2.2.3', items: [skill, { id: 'agents:planner.md', group: 'agents', name: 'planner', path: 'agents/planner.md', description: 'Plan features', providers: ['claude'], defaultEnabled: true }] };
  let conflict = true;
  const cx = { ...renderContext, spawn: fn => { tasks.push(fn(cx)); } };
  const drain = async () => { while (tasks.length) await Promise.all(tasks.splice(0)); };
  const View = await viewFor({ ...ui, props: () => ({ view: 'manage-launchers', overlay: 'settings' }), theme: () => ({}),
    readTextFile: async path => path.endsWith('/ecc.json') ? original : null,
    exec: async (_command, args) => ({ code: 0, stdout: JSON.stringify(args[1] === 'catalog' ? catalog : { version: '2.2.3' }) }),
    mkdir: async () => {}, unlink: async () => {},
    writeTextFile: async (...args) => { if (!args[0].endsWith('/ecc.json')) return; if (conflict) throw Error('File changed'); writes.push(args); } });
  const view = new View(); view.initSessionMenu({ ...cx, spawn() {} }); view.launchers = [{ key: 'claude', name: 'Claude' }];
  view.render(cx); ui.nodes.get('settings-page-ecc').click({}, cx); await drain(); view.render(cx);
  assert.ok(ui.nodes.has('ecc-page-overview') && ui.nodes.has('ecc-page-claude') && ui.nodes.has('ecc-page-codex'));
  assert.ok(ui.texts.includes('Understand what each part of ECC does'));
  assert.ok(!ui.nodes.has('ecc-account'));
  assert.ok(!ui.nodes.has('ecc-browse') && !ui.nodes.has('ecc-source-options'));
  assert.equal(view.eccSource, '/herdr/data/devkits/ecc-source');
  assert.equal(ui.nodes.get('ecc-enabled').disabled, false);
  assert.equal(ui.nodes.get('ecc-enabled').click, undefined);
  ui.nodes.get('ecc-enabled').change(true, cx);
  assert.equal(view.eccDraft.enabled, true);
  ui.nodes.get('ecc-enabled').change(true, cx);
  assert.equal(view.eccDraft.enabled, true);
  ui.nodes.get('ecc-page-claude').click({}, cx); view.render(cx);
  assert.ok(!ui.nodes.has('ecc-component-group'));
  assert.equal(ui.nodes.get('ecc-group-enable').height, 30);
  assert.equal(ui.nodes.get('ecc-group-disable').height, 30);
  assert.ok(ui.nodes.has('ecc-category-agents') && ui.nodes.has('ecc-category-mcp'));
  ui.nodes.get('ecc-category-agents').click({}, cx); view.render(cx);
  assert.equal(view.eccSection, 'agents');
  assert.ok(ui.nodes.has('ecc-component-agents:planner.md'));
  ui.nodes.get('ecc-category-skills').click({}, cx); view.render(cx);
  ui.nodes.get('ecc-component-skills:alpha').click({}, cx); view.render(cx);
  assert.equal(ui.nodes.get('ecc-item-enabled').click, undefined);
  ui.nodes.get('ecc-item-enabled').change(false, cx);
  assert.equal(view.eccDraft.selection.claude[skill.id], false); assert.equal(writes.length, 0);
  ui.nodes.get('ecc-page-codex').click({}, cx); view.render(cx);
  ui.nodes.clear(); view.render(cx);
  assert.ok(ui.nodes.has('ecc-category-skills') && !ui.nodes.has('ecc-category-agents'));
  ui.nodes.get('ecc-component-skills:alpha').click({}, cx); view.render(cx);
  assert.equal(ui.nodes.get('ecc-item-enabled').checked, true);
  assert.equal(ui.nodes.get('ecc-provider-enabled').click, undefined);
  ui.nodes.get('ecc-provider-enabled').change(false, cx);
  assert.equal(view.eccDraft.providerEnabled.codex, false); assert.equal(view.eccDraft.providerEnabled.claude, true);
  ui.nodes.get('settings-page-agents').click({}, cx); view.render(cx);
  ui.nodes.get('settings-page-ecc').click({}, cx); view.render(cx);
  assert.equal(view.eccDraft.selection.claude[skill.id], false);
  view.saveEcc(cx); await drain(); assert.match(view.eccError, /File changed/);
  conflict = false; view.saveEcc(cx); await drain();
  assert.equal(writes[0][2], original); assert.equal(JSON.parse(writes[0][1]).selection.claude[skill.id], false);
  assert.deepEqual(JSON.parse(writes[0][1]).selection.codex, {});
  assert.equal(JSON.parse(writes[0][1]).providerEnabled.codex, false);
  assert.equal(view.eccSaved, true); assert.equal(view.eccTab, 'codex');
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


test('Auto starts the selected account furthest below quota pace and is remembered as Auto', async () => {
  const now = Date.now() / 1000;
  const memory = { 'devkits.auto-accounts': ['codex', 'devkits-codex-a', 'devkits-codex-b', 'devkits-claude-c'],
    'devkits.usage.snapshot': { contexts: { null: { usage: [
      { key: 'devkits-codex-a', windows: [{ minutes: 300, usedPercent: 100, resetsAt: now + 3600 }] },
      { key: 'devkits-codex-b', plan: 'team', windows: [{ minutes: 10080, usedPercent: 60, resetsAt: now + 302400 }] },
      { key: 'devkits-claude-c', windows: [{ minutes: 10080, usedPercent: 80, resetsAt: now + 60480 }] },
    ] } } } }, started = [];
  const ui = fakeElements();
  const View = await viewFor({ ...ui, props: () => ({ space: 'api', folder: '/Code/api' }), spaces: () => projects,
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, keys: () => [] });
  const view = new View();
  const agents = [{ key: 'codex', installed: true }, { key: 'devkits-codex-a', installed: true },
    { key: 'devkits-codex-b', name: 'Codex · B', installed: true }, { key: 'devkits-claude-c', name: 'Claude · C', run: ['claude'], installed: true }];
  // b has 40% left for half a week (0.8); c has 20% left for a tenth of it (2); a is at its 5h limit.
  assert.equal(view.autoThreadAgent(agents, null).key, 'devkits-claude-c');
  memory['devkits.auto-multipliers'] = { 'devkits-codex-b': 5 };
  assert.equal(view.autoThreadAgent(agents, null).key, 'devkits-codex-b', 'a larger plan has more room');
  delete memory['devkits.auto-multipliers'];
  assert.equal(view.autoThreadAgent(agents, 'remote'), null);
  assert.equal(view.autoThreadAgent([agents[0]], null), null, 'default agents are not Auto accounts');
  view.launchers = agents; view.startThread = async (agent, target, options) => started.push([agent.key, options]);
  view.autoAccountsSection(launcherChoices(agents), {});
  assert.ok(!ui.nodes.has('auto-account-codex'), 'only your accounts can join Auto');
  assert.ok(ui.textOf('auto-standing-devkits-codex-a').join('').startsWith('At limit'));
  assert.equal(ui.textOf('auto-standing-devkits-codex-b').join(''), 'Room 0.80');
  assert.equal(ui.textOf('auto-standing-devkits-claude-c').join(''), 'Room 2.00');
  assert.equal(ui.textOf('auto-plan-devkits-codex-b').join(''), 'Team');
  ui.nodes.get('auto-multiplier-devkits-codex-b-5').change(true, { notify() {} });
  assert.deepEqual(memory['devkits.auto-multipliers'], { 'devkits-codex-b': 5 });
  ui.nodes.get('auto-multiplier-devkits-codex-b-1').change(true, { notify() {} });
  assert.deepEqual(memory['devkits.auto-multipliers'], {}, 'choosing the detected size follows the plan again');
  assert.ok(ui.nodes.has('auto-next-devkits-claude-c') && !ui.nodes.has('auto-next-devkits-codex-b'));
  memory['devkits.hidden-usage-profiles'] = ['devkits-claude-c'];
  assert.equal(view.autoThreadAgent(agents, null).key, 'devkits-codex-b', 'accounts hidden from Usage leave Auto');
  ui.nodes.clear(); view.autoAccountsSection(launcherChoices(agents), {});
  assert.ok(!ui.nodes.has('auto-account-devkits-claude-c') && ui.nodes.has('auto-account-devkits-codex-b'));
  delete memory['devkits.hidden-usage-profiles'];
  view.autoRulesOpen = true; ui.nodes.clear(); view.autoAccountsSection(launcherChoices(agents), {});
  assert.ok(ui.textOf('auto-account-rules').join(' ').includes('most Room'));
  view.launcher({});
  assert.equal(ui.textOf('start-auto').join(''), 'Auto · C');
  memory['devkits.auto-multipliers'] = { 'devkits-codex-b': 5 };
  ui.nodes.clear(); view.launcher({});
  assert.equal(ui.textOf('start-auto').join(''), 'Auto · B', 'The preview follows the current quota ranking');
  delete memory['devkits.auto-multipliers'];
  ui.nodes.get('start-auto').click({}, {});
  assert.deepEqual(started.at(-1), ['devkits-claude-c', { auto: true }]);
  view.openThread = () => {};
  await view.launchThread(agents[3], { space: 'api', folder: '/Code/api' }, { auto: true });
  assert.equal(memory['devkits.last-thread-agents']['["","/Code/api"]'], 'auto');
  assert.deepEqual(view.defaultThreadChoice({ id: 'api', folder: '/Code/api' }, agents), { agent: agents[3], auto: true });
  memory['devkits.auto-accounts'] = [];
  assert.equal(view.defaultThreadAgent({ id: 'api', folder: '/Code/api' }, agents).key, 'codex');
  ui.nodes.clear(); view.launcher({});
  assert.ok(!ui.nodes.has('start-auto'), 'Auto is hidden without selected accounts');
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


test('thread header menu consolidates configuration under Agent settings', async () => {
  const ui = fakeElements(), commands = [];
  const overlays = [], requests = [];
  const View = await viewFor({ ...ui, spaces: () => projects, agents: () => [], props: () => ({ pane: 'p0' }),
    panes: () => [{ pane: 'p0', tab: 'tab-0', title: 'New thread' }], run: (...args) => commands.push(args),
    shared: key => key === 'devkits.agent-cache' ? { null: [{ key: 'codex', installed: true }] } : undefined,
    setShared: (key, value) => { if (key === 'devkits.open-file-request') requests.push(value); },
    openOverlay: value => overlays.push(value) });
  const view = new View(), cx = { ...renderContext };
  view.paneHeader({}, cx); ui.nodes.get('thread-menu-p0').click({}, cx); view.paneHeader({}, cx);
  ui.nodes.get('thread-actions-p0-settings').click({}, cx);
  assert.deepEqual(overlays.at(-1), { mod: 'devkits-agents', kind: 'dialog', frame: 'none', modal: false, width: 1040, height: 0.86,
    props: { view: 'manage-launchers', space: projects.find(project => project.tabs?.some(tab => tab.id === 'tab-0'))?.id ?? null, page: 'accounts' } });
  assert.deepEqual(commands, []);
  assert.ok(!ui.nodes.has('thread-actions-p0-mcp'));
  assert.ok(!ui.nodes.has('thread-actions-p0-rules'));
  assert.equal(overlays.length, 1);
  commands.length = 0;
  ui.nodes.get('thread-menu-p0').click({}, cx); view.paneHeader({}, cx);
  for (const action of ['hide', 'stop', 'archive', 'close']) assert.ok(!ui.nodes.has(`thread-actions-p0-${action}`));
  assert.deepEqual(commands, []);
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
  assert.ok(!ui.nodes.has('thread-actions-p-shell-settings'));
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
  ui.nodes.get('board-task-api-local:import').click(); view.drainTasks();
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
  assert.ok(order.indexOf('open-tasks') < order.indexOf('open-files'));
  assert.ok(order.indexOf('open-tasks') > order.indexOf('open-calendar'));
  assert.ok(order.indexOf('open-calendar') > order.indexOf('open-mantisbt'));
  assert.ok(order.indexOf('open-mantisbt') > order.indexOf('open-asana'));
  assert.ok(order.indexOf('open-tasks') > order.indexOf('open-mantisbt'));
  assert.ok(ui.textOf('open-tasks').includes('Tasks'));
  for (const source of ['asana', 'mantisbt']) {
    ui.nodes.get(`open-${source}`).click();
    const request = memory['devkits.tasks.requests'].at(-1);
    assert.equal(request.action, 'source');
    assert.equal(request.source, source);
    assert.equal(request.project.id, 'api');
    assert.equal(memory['devkits.board-project'], undefined);
  }
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
  view.restoreThread(entry); view.drainTasks();
  assert.equal(memory['devkits.agent-board'][key][task.gid].status, 'todo');
  assert.equal(memory['devkits.agent-board'][key][task.gid].archived, true, 'A mocked launch has not confirmed a new native tab');
  assert.equal(reopened[4].gid, 'thread:previous');
  assert.deepEqual(memory['devkits.archived-threads'], [entry]);
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
  assert.equal(memory['devkits.agent-board'][key]['thread:work'].status, 'todo');
  memory['devkits.agent-board'][key]['thread:work'].status = 'done';
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

test('full-width repository select follows measured resizing and keeps keyboard selection', async () => {
  const ui = fakeElements(), source = await readFile(new URL('../mods/devkits/components/select.js', import.meta.url), 'utf8');
  const host = { ...ui, DropdownMenuContent: id => ui.element().id(id), DropdownMenuItem: id => ui.element().id(id) };
  const Select = new Function(...Object.keys(host), source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nreturn Select;')(...Object.values(host));
  const state = { trigger: { focus() {} }, list: { focus() {} }, open: true, index: 0 };
  const options = [{ key: 'a', label: 'Repo A' }, { key: 'b', label: 'Repo B' }];
  let chosen, notified = 0;
  const cx = { notify() { notified++; }, stop_propagation() {} };
  const render = () => Select('repository', state, 'a', options, 'Git repository', value => { chosen = value; }, {}, { fullWidth: true });
  render();
  for (const width of [280, 480, 200]) {
    ui.nodes.get('repository').sizeChange({ width }, cx);
    render();
    assert.equal(ui.nodes.get('repository-options').width, width);
    ui.nodes.get('repository').sizeChange({ width }, cx);
  }
  assert.equal(notified, 3, 'Equal layout measurements must not cause repeated renders');
  ui.nodes.get('repository-options').keyDown({ key: 'down' }, cx);
  ui.nodes.get('repository-options').keyDown({ key: 'enter' }, cx);
  assert.equal(chosen, 'b');
  assert.equal(state.open, false);
});

test('status and priority selects show semantic icons in the trigger and every option', async () => {
  const { boardStatusOptions, boardPriorityOptions } = await import('../mods/devkits-tasks/agent-board-model.js');
  const ui = fakeElements(), source = await readFile(new URL('../mods/devkits/components/select.js', import.meta.url), 'utf8');
  const host = { ...ui, DropdownMenuContent: () => ui.element(), DropdownMenuItem: id => ui.element().id(id) };
  const Select = new Function(...Object.keys(host), source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nreturn Select;')(...Object.values(host));
  const state = { trigger: { focus() {} }, list: { focus() {} }, open: true, index: 0 };
  const t = { foreground: '#eee', muted: '#888' };
  let chosen;
  Select('icon-status', state, 'done', boardStatusOptions(t), 'Status', value => { chosen = value; }, t);
  assert.equal(ui.assets.filter(path => path.endsWith('/circle-check.svg')).length, 2);
  assert.ok(ui.assets.some(path => path.endsWith('/circle-half.svg')));
  assert.equal(ui.assets.some(path => path.endsWith('/clock.svg')), false, 'Action Required is not a progress option');
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
  assert.deepEqual(view.taskComposer.render(view.taskAssignees(projects[0])), result);
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

test('copying the Agent Guide uses its latest editable content and never supplies hidden fallback rules', async () => {
  const board = await taskBoardFor({ 'thread:chat': { gid: 'thread:chat', source: 'thread', threadId: 'chat', name: 'Chat', status: 'todo' } });
  board.project.tabs = [{ id: 'chat', name: 'Chat' }];
  board.runtime.agents = [{ address: 't-chat', tab: 'chat', status: 'idle' }];
  board.view.selected = 'thread:chat'; board.render();
  const copied = [];
  const cx = { ...board.cx, write_to_clipboard: text => copied.push(text), spawn(fn) { return fn(cx); } };
  for (const guide of ['## Herdr task progress\nCustom policy', 'Edited again']) {
    board.runtime.guide = guide;
    await board.ui.nodes.get('board-copy-reporting').click({}, cx);
    assert.equal(copied.at(-1), guide);
    assert.equal(board.runtime.guidePath, '/herdr/data/devkits/AGENTS.md');
  }
  board.runtime.guide = '';
  await board.ui.nodes.get('board-copy-reporting').click({}, cx);
  assert.equal(copied.length, 2); assert.match(board.view.relatedError, /empty or unavailable/);
});

async function taskBoardFor(records = {}, actions = {}) {
  const ui = fakeElements(), model = await import('../mods/devkits-tasks/agent-board-model.js');
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
  const host = { ...ui, ...model, taskTokenId, appHome: () => '/herdr', folderKey, launcherLabel, launcherOption, accountAddresses, noAccountLabel, configuredAgents, threadTitle, InputState: field, TextareaState: field,
    Input: { new: () => ui.element() }, Textarea: { new: () => ui.element() },
    TextView: { markdown: () => ui.element() },
    shared: key => memory[key], setShared: (key, value) => { memory[key] = structuredClone(value); },
    currentAgents: () => runtime.agents, currentSpaces: () => projects, terminals: () => [],
    readTextFile: async path => { runtime.guidePath = path; return runtime.guide; },
    withTaskInputEvidence: agents => agents, savedTasks: () => [],
    SourceTaskReader: class { init() {} show(task) { runtime.tokenReads = (runtime.tokenReads || 0) + 1; this.detailError = runtime.token ? null : 'Connect Asana'; } },
    TaskSession: class { init() {} render(task) { launches.push(task); return ui.element(); } },
    boardTheme: () => ({ appearance: 'linear', fontFamily: 'Arial', foreground: '#fff', secondary: '#eee',
      background: '#121213', muted: '#959597', border: '#232426', selected: '#29292b', hover: '#232424',
      popover: '#1c1c1d', control: '#1c1c1d', controlBorder: '#303032', menuHover: '#29292b',
      card: '#1a1a1b', cardHover: '#212223', cardBorder: '#ffffff0c', cardSelected: '#242426', cardSelectedBorder: '#454548' }),
    readTaskOutput: async () => runtime.output || '', readAsanaToken: async () => { runtime.tokenReads = (runtime.tokenReads || 0) + 1; return runtime.token || null; },
    taskIdentifier: task => task.gid, outputMarkdown: text => text,
    openTaskComposer: (...args) => dialogs.push(args),
    openDeleteTask: (project, task) => dialogs.push({ view: 'delete-task', gid: task.gid }), openOverlay: spec => dialogs.push(spec),
  };
  const sources = await Promise.all(['components/button', 'components/dropdown-menu', 'components/select', 'components/icon', 'components/side-panel', 'agent-board-state', 'agent-board']
    .map(name => readFile(new URL(`../mods/${name.startsWith('components/') ? 'devkits' : 'devkits-tasks'}/${name}.js`, import.meta.url), 'utf8')));
  const Board = new Function(...Object.keys(host), sources.join('\n')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export \{.*\} from .*;\r?\n/gm, '')
    .replace('export default class', 'class').replace(/^export /gm, '') + '\nreturn Object.assign(AgentBoard, { deleteLocalTask });')(...Object.values(host));
  const view = new Board(), cx = { ...renderContext, timer: { every() {} }, spawn: fn => fn(renderContext) };
  view.init(cx);
  const launchers = [{ key: 'profile', name: 'Rick', icon: 'icons/codex.svg', tint: false }];
  const render = () => { ui.nodes.clear(); return view.render(project, runtime.agents, launchers, actions, cx); };
  render();
  // Pressing Delete in the confirmation dialog opened by the last delete request.
  const confirmDelete = () => { const request = dialogs.at(-1); if (request?.view === 'delete-task') Board.deleteLocalTask(project, request.gid, runtime.agents); };
  return { ui, view, project, projects, runtime, memory, key, cx, render, dialogs, launches, Board, confirmDelete };
}

test('Tasks separates attention, dates and calendar scheduling, and card deletion asks for confirmation', async () => {
  const task = { gid: 'local:plan', name: 'Plan', source: 'local', status: 'todo' };
  const waiting = { gid: 'local:question', name: 'Question', source: 'local', status: 'doing',
    execution: { id: 'run:question', status: 'waiting', startedAt: Date.now(), profileName: 'Reviewer', summary: 'Which redirect?' } };
  const board = await taskBoardFor({ [task.gid]: task, [waiting.gid]: waiting });
  assert.ok(!board.ui.nodes.has('board-lane-waiting'));
  board.ui.nodes.get('board-attention').click({}, board.cx); board.render();
  assert.ok(!board.ui.nodes.has(`board-card-${task.gid}`)); assert.ok(board.ui.nodes.has(`board-card-${waiting.gid}`));
  board.ui.nodes.get('board-active').click({}, board.cx); board.render();
  board.ui.nodes.get(`board-card-actions-${task.gid}`).click({}, board.cx); board.render();
  board.ui.nodes.get(`board-card-menu-${task.gid}-delete`).click({}, board.cx); board.render();
  assert.deepEqual(board.dialogs.at(-1), { view: 'delete-task', gid: task.gid }); assert.ok(board.memory['devkits.agent-board'][board.key][task.gid]);
  board.view.dueDate.edit('2026-11-12'); board.view.dueDate.blur(); board.render();
  assert.equal(board.memory['devkits.agent-board'][board.key][task.gid].dueDate, '2026-11-12');
  board.ui.nodes.get('board-schedule-task').click({}, board.cx);
  const event = board.dialogs.at(-1); assert.equal(event.mod, 'devkits-calendar');
  assert.equal(event.props.draft.startDate, '2026-11-12');
  assert.equal(event.props.draft.taskLink.id, taskTokenId(board.project, task.gid));
  assert.equal(board.memory['devkits.agent-board'][board.key][task.gid].status, 'todo');
});

test('Tasks Archived uses current snapshots without synthesizing cards for absent or deleted snapshots', async () => {
  const existing = { gid: 'local:existing', source: 'local', name: 'Current name', status: 'fail', archived: true, archiveId: 'existing' };
  const board = await taskBoardFor({ [existing.gid]: existing });
  const entries = [
    { id: 'legacy', folder: '/project/', title: 'Older conversation', task: null, profile: 'profile' },
    { id: 'snapshot', folder: '/project', title: 'Saved conversation', boardTask: { gid: 'thread:saved', source: 'thread', name: 'Saved task', status: 'fail', lastOutput: 'Retained output' } },
    { id: 'existing', folder: '/project', title: 'Old title', boardTask: { ...existing, name: 'Old title', status: 'done' } },
    { id: 'deleted', folder: '/project', title: 'Deleted local task', boardTask: null, task: null },
    { id: 'other', folder: '/other', title: 'Other project' },
  ];
  board.memory['devkits.archived-threads'] = structuredClone(entries);
  board.render();
  assert.ok(!board.ui.nodes.has('board-card-archive:legacy'));
  board.ui.nodes.get('board-archived').click({}, board.cx); board.render();
  assert.ok(!board.ui.nodes.has('board-card-archive:legacy'));
  assert.ok(board.ui.nodes.has('board-card-thread:saved'));
  assert.ok(board.ui.nodes.has('board-card-local:existing'));
  const records = board.memory['devkits.agent-board'][board.key];
  assert.equal(Object.keys(records).length, 2);
  assert.equal(records['archive:legacy'], undefined);
  assert.equal(records['thread:saved'].lastOutput, 'Retained output');
  assert.equal(records['thread:saved'].status, 'fail');
  assert.deepEqual(records[existing.gid], existing, 'Current task metadata wins over the archived snapshot');
  board.view.search.set_value('older'); board.render();
  assert.ok(!board.ui.nodes.has('board-card-archive:legacy'));
  assert.ok(!board.ui.nodes.has('board-card-thread:saved'));
  const saved = structuredClone(board.memory);
  board.render(); assert.deepEqual(board.memory, saved, 'Repeated reads do not duplicate or rewrite archived cards');
  board.project.machine = 'remote'; board.render();
  assert.equal(board.memory['devkits.agent-board']['["remote","/project"]'], undefined);
  assert.deepEqual(board.memory['devkits.archived-threads'], entries);
});

test('task details create subtasks in a separate composer and navigate between parent and child tasks', async () => {
  const parent = { gid: 'local:parent', source: 'local', name: 'Ship release', status: 'todo' };
  const child = { gid: 'local:child', source: 'local', name: 'Add tests', status: 'todo', parentId: parent.gid };
  const done = { gid: 'local:done', source: 'local', name: 'Review changes', status: 'done', parentId: parent.gid };
  const board = await taskBoardFor({ [parent.gid]: parent, [child.gid]: child, [done.gid]: done });
  board.view.selected = parent.gid; board.render();
  assert.ok(board.ui.textOf('board-subtasks').includes('1/2'));
  assert.ok(board.ui.textOf(`board-card-${parent.gid}`).includes('1/2'));
  const before = structuredClone(board.memory['devkits.agent-board']);
  board.ui.nodes.get('board-add-subtask').click({}, board.cx);
  assert.equal(board.dialogs.length, 1); assert.equal(board.dialogs[0][4].gid, parent.gid);
  assert.equal(board.view.selected, parent.gid); assert.deepEqual(board.memory['devkits.agent-board'], before);
  board.ui.nodes.get(`board-subtask-${child.gid}`).click({}, board.cx); board.render();
  assert.equal(board.view.selected, child.gid); assert.ok(board.ui.textOf('board-parent-task').includes(parent.name));
  assert.ok(board.ui.nodes.has('board-task-title'), 'the child has its own ordinary editable detail');
  board.ui.nodes.get('board-add-subtask').click({}, board.cx);
  assert.equal(board.dialogs[1][4].gid, child.gid, 'children may have their own subtasks');
  board.ui.nodes.get('board-parent-task').click({}, board.cx); board.render();
  assert.equal(board.view.selected, parent.gid);
});

test('subtask navigation includes archived children and rechecks stale Add subtask actions', async () => {
  const parent = { gid: 'p', source: 'local', name: 'Parent', status: 'doing' };
  const child = { gid: 'c', source: 'local', name: 'Archived child', status: 'done', parentId: 'p', archived: true };
  const board = await taskBoardFor({ p: parent, c: child });
  board.view.selected = parent.gid; board.render();
  const add = board.ui.nodes.get('board-add-subtask').click;
  board.ui.nodes.get('board-subtask-c').click({}, board.cx); board.render();
  assert.equal(board.view.archived, true); assert.equal(board.view.selected, 'c');
  assert.equal(board.ui.nodes.has('board-add-subtask'), false);
  board.ui.nodes.get('board-parent-task').click({}, board.cx); board.render();
  assert.equal(board.view.archived, false); assert.equal(board.view.selected, 'p');
  board.memory['devkits.agent-board'][board.key].p.archived = true;
  add({}, board.cx); board.render();
  assert.equal(board.dialogs.length, 0); assert.ok(board.ui.nodes.has('board-related-error'));
});

test('deleting a parent from Tasks retains its children as independent cards', async () => {
  const board = await taskBoardFor({ p: { gid: 'p', source: 'local', name: 'Parent', status: 'todo' },
    c: { gid: 'c', source: 'local', name: 'Child', notes: 'Keep me', status: 'todo', parentId: 'p' } });
  board.view.selected = 'p'; board.render();
  board.ui.nodes.get('board-delete-task').click({}, board.cx); board.render();
  board.confirmDelete(); board.render();
  assert.equal(board.ui.nodes.has('board-card-p'), false); assert.ok(board.ui.nodes.has('board-card-c'));
  assert.equal(board.memory['devkits.agent-board'][board.key].c.parentId, null);
  assert.equal(board.memory['devkits.agent-board'][board.key].c.notes, 'Keep me');
});

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
  for (const status of ['doing']) {
    drag(status);
    assert.equal(memory['devkits.agent-board'][key][task.gid].status, 'todo');
  }
  drag('fail');
  assert.equal(memory['devkits.agent-board'][key][task.gid].status, 'fail');
  assert.deepEqual(board.dialogs, []); assert.deepEqual(board.launches, []);
});

test('opening a task finishes its pending drag before stopping the click release', async () => {
  const board = await taskBoardFor({ a: { gid: 'a', source: 'local', name: 'A', status: 'todo' } });
  const { ui, view, cx } = board;
  ui.nodes.get('board-card-a').mouseDown({ position: { x: 0, y: 0 } }, cx);
  assert.equal(view.drag.active, false);
  // A stopped card click must clean up without relying on ancestor release handlers.
  ui.nodes.get('board-card-a').click({}, cx); board.render();
  assert.equal(view.selected, 'a'); assert.equal(view.drag, null);
  ui.nodes.get('board-lane-doing').mouseMove({ position: { x: 20, y: 0 } }, cx);
  assert.equal(view.drag, null); assert.equal(view.dropStatus, null);
  ui.nodes.get('agent-board-columns').click({}, cx); board.render();
  assert.equal(view.selected, null); assert.ok(!ui.nodes.has('board-detail'));
});

test('a drag released on another card finishes before its click without changing selection', async () => {
  const board = await taskBoardFor({
    a: { gid: 'a', source: 'local', name: 'A', status: 'todo' },
    b: { gid: 'b', source: 'local', name: 'B', status: 'done' },
  });
  const { ui, view, cx } = board;
  ui.nodes.get('board-card-a').click({}, cx); board.render();
  ui.nodes.get('board-card-a').mouseDown({ position: { x: 0, y: 0 } }, cx);
  ui.nodes.get('board-lane-done').mouseMove({ position: { x: 20, y: 0 } }, cx);
  ui.nodes.get('board-card-b').click({}, cx); board.render();
  assert.equal(board.memory['devkits.agent-board'][board.key].a.status, 'done');
  assert.equal(view.drag, null); assert.equal(view.dropStatus, null);
  assert.equal(view.suppressClick, null); assert.equal(view.selected, 'a');
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
  assert.equal(memory['devkits.agent-board'][key][task.gid].status, 'todo');
  assert.equal(view.drag, null);
});

test('deleting a local task removes its card and sidebar row across reloads while other task sources stay', async () => {
  const task = { gid: 'local:delete', name: 'Delete me', notes: 'Instructions', source: 'local', status: 'todo' };
  const others = { saved: { gid: 'saved', name: 'Saved task', source: 'asana', status: 'todo' } };
  const board = await taskBoardFor({ [task.gid]: task, ...others });
  board.view.selected = task.gid; board.render();
  board.ui.nodes.get('board-delete-task').click({}, board.cx);
  assert.ok(board.memory['devkits.agent-board'][board.key][task.gid], 'Delete opens a confirmation first');
  board.confirmDelete();
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
  board.confirmDelete();
  board.render();
  assert.equal(memory['devkits.agent-board'][key][task.gid], undefined);
  assert.equal(project.tabs[0].id, 'conversation'); assert.equal(runtime.agents[0].address, 't1');
  assert.ok(!board.ui.nodes.has('board-card-thread:conversation'), 'A kept conversation does not recreate the deleted card');
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
  pending.view.deleteTask(pending.project, task.gid); pending.confirmDelete();
  assert.ok(pending.memory['devkits.agent-board'][pending.key][task.gid]);
  for (const source of ['asana']) {
    const external = await taskBoardFor({ [task.gid]: { ...task, source } });
    external.view.selected = task.gid; external.render();
    assert.ok(!external.ui.nodes.has('board-delete-task'));
    external.view.deleteTask(external.project, task.gid); external.confirmDelete();
    assert.ok(external.memory['devkits.agent-board'][external.key][task.gid]);
  }
  const archived = await taskBoardFor({ [task.gid]: { ...task, archived: true } });
  archived.view.archived = true; archived.view.selected = task.gid; archived.render();
  archived.ui.nodes.get('board-delete-task').click({}, archived.cx);
  archived.confirmDelete();
  assert.equal(archived.memory['devkits.agent-board'][archived.key][task.gid], undefined);
});

test('an output read already in flight cannot recreate a deleted local task', async () => {
  const task = { gid: 'local:delete', name: 'Finished', source: 'local', status: 'done' };
  const board = await taskBoardFor({ [task.gid]: task });
  board.runtime.output = 'Late result from the original conversation';
  // Retain the real queued continuation, then delete before it runs.
  let continuation;
  board.view.loadOutput({ ...task, agents: [{ address: 't1' }] }, board.project, { spawn: fn => { continuation = fn; } });
  board.view.deleteTask(board.project, task.gid); board.confirmDelete();
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

test('Tasks owns the Asana import callback and opens a draft without launching a session', async () => {
  const project = { id: 'one', name: 'One', folder: '/Code/one', active: true, tabs: [] }, drafts = [], closed = [], commands = [];
  const source = { gid: 'a1', name: 'Selected source', notes: 'Source instructions', comments: [] };
  const { TaskRuntime } = await evaluateNative('../mods/devkits-tasks/runtime.js', { AgentClient: class {},
    openTaskComposer: (...args) => drafts.push(args),
    TaskSources: class { constructor(onImport) { this.onImport = onImport; } open(bound, key) { assert.equal(bound, project); assert.equal(key, 'asana'); this.onImport(bound, source); } },
    run: (...args) => commands.push(args),
  }, 'TaskRuntime');
  const runtime = new TaskRuntime(); runtime.taskSources.open(project, 'asana');
  assert.deepEqual(drafts, [[project, null, 'todo', source]]); assert.deepEqual(commands, []);
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

test('MantisBT import routes through the same Tasks draft without launching an agent', async () => {
  const project = { id: 'one', name: 'One', folder: '/Code/one', active: true, tabs: [] }, drafts = [], closed = [], commands = [];
  const source = { source: 'mantisbt', gid: '1', server: 'https://mantis.test', name: 'Selected issue', notes: 'Instructions', comments: [] };
  const { TaskRuntime } = await evaluateNative('../mods/devkits-tasks/runtime.js', { AgentClient: class {},
    openTaskComposer: (...args) => drafts.push(args),
    TaskSources: class { constructor(onImport) { this.onImport = onImport; } open(bound, key) { assert.equal(bound, project); assert.equal(key, 'mantisbt'); this.onImport(bound, source); } },
    run: (...args) => commands.push(args),
  }, 'TaskRuntime');
  const runtime = new TaskRuntime(); runtime.taskSources.open(project, 'mantisbt');
  assert.deepEqual(drafts, [[project, null, 'todo', source]]); assert.deepEqual(commands, []);
});

test('imported MantisBT tasks stay editable offline and retain source links and comments in session context', async () => {
  const mantisbt = { gid: '1', server: 'https://mantis.test', url: 'https://mantis.test/view.php?id=1', comments: [{ author: 'Amy', text: 'Source note' }] };
  const board = await taskBoardFor({ 'local:mantis': { gid: 'local:mantis', source: 'local', name: 'Imported MantisBT', status: 'todo', notes: 'Original', mantisbt } });
  assert.ok(!board.ui.nodes.has('board-mantisbt'));
  assert.ok(!board.ui.nodes.has('board-asana'));
  board.ui.nodes.get('board-card-local:mantis').click({}, board.cx); board.render();
  board.view.description.edit('Updated locally'); board.render();
  assert.equal(board.memory['devkits.agent-board'][board.key]['local:mantis'].notes, 'Updated locally');
  assert.deepEqual(board.memory['devkits.agent-board'][board.key]['local:mantis'].mantisbt, mantisbt);
  assert.deepEqual(board.launches.at(-1).comments, mantisbt.comments);
  assert.deepEqual(board.launches.at(-1).mantisbt, mantisbt);
  assert.equal(board.runtime.tokenReads, undefined);
  const urls = []; board.ui.nodes.get('board-asana-source').click({}, { open_url: url => urls.push(url) });
  assert.deepEqual(urls, [mantisbt.url]);
});

test('reselecting the current Tasks card keeps its preview and output; another task or explicit refresh still loads', async () => {
  const board = await taskBoardFor({
    a: { gid: 'a', source: 'local', name: 'A', status: 'todo', notes: 'Description', lastOutput: 'Saved output' },
    b: { gid: 'b', source: 'local', name: 'B', status: 'todo' },
  });
  const reads = []; board.view.loadOutput = task => reads.push(task.gid);
  board.ui.nodes.get('board-card-a').click({}, board.cx); board.render();
  const retained = { notes: 'Retain preview' }; board.view.detail.detail = retained;
  board.view.description.edit('Description\nMy instructions');
  board.ui.nodes.get('board-card-a').click({}, board.cx); board.render();
  assert.deepEqual(reads, ['a']); assert.equal(board.view.detail.detail, retained);
  assert.equal(board.view.description.value(), 'Description\nMy instructions');
  board.ui.nodes.get('board-refresh-output').click({}, board.cx);
  assert.deepEqual(reads, ['a', 'a']);
  board.ui.nodes.get('board-card-b').click({}, board.cx); board.render();
  board.ui.nodes.get('board-card-a').click({}, board.cx); board.render();
  assert.deepEqual(reads, ['a', 'a', 'b', 'a']);
  // Closing and reopening the same card is a new selection.
  board.ui.nodes.get('board-close-detail').click({}, board.cx); board.render();
  board.ui.nodes.get('board-card-a').click({}, board.cx);
  assert.deepEqual(reads, ['a', 'a', 'b', 'a', 'a']);
});

test('clicking empty Tasks board space closes details in active and archived views and preserves saved edits', async () => {
  for (const archived of [false, true]) {
    const board = await taskBoardFor({ a: { gid: 'a', source: 'local', name: 'A', status: 'todo', notes: 'Description', archived } });
    board.view.archived = archived; board.render();
    const reads = []; board.view.loadOutput = task => reads.push(task.gid);
    board.ui.nodes.get('board-card-a').click({}, board.cx); board.render();
    if (!archived) board.view.description.edit('Saved changes');
    board.ui.nodes.get('agent-board-columns').click({}, board.cx); board.render();
    assert.equal(board.view.selected, null); assert.equal(board.view.currentTask, null);
    assert.equal(board.view.selection, null);
    assert.ok(!board.ui.nodes.has('board-detail') && !board.ui.nodes.has('board-detail-split'));
    assert.equal(board.memory['devkits.agent-board'][board.key].a.notes, archived ? 'Description' : 'Saved changes');
    board.ui.nodes.get('board-card-a').click({}, board.cx); board.render();
    assert.equal(board.view.selected, 'a'); assert.ok(board.ui.nodes.has('board-detail'));
    assert.deepEqual(reads, ['a', 'a']);
  }
});

test('Tasks card and creation clicks stay inside their controls and drag releases do not dismiss details', async () => {
  const board = await taskBoardFor({ a: { gid: 'a', source: 'local', name: 'A', status: 'todo' } });
  let stopped = false;
  const cx = { ...board.cx, stop_propagation() { stopped = true; } };
  const click = id => {
    stopped = false;
    board.ui.nodes.get(id).click({}, cx);
    if (!stopped) board.ui.nodes.get('agent-board-columns').click({}, cx);
  };
  click('board-card-a'); board.render();
  assert.equal(board.view.selected, 'a'); assert.ok(board.ui.nodes.has('board-detail'));
  click('board-card-a');
  assert.equal(board.view.selected, 'a');
  click('board-add-todo');
  assert.equal(board.view.selected, 'a'); assert.equal(board.dialogs.length, 1);
  board.ui.nodes.get('board-card-a').mouseDown({ position: { x: 10, y: 10 } }, cx);
  board.view.dragOver('done', { position: { x: 350, y: 10 } }, cx);
  board.view.drop(board.project, 'done', cx);
  board.ui.nodes.get('agent-board-columns').click({}, cx); board.render();
  assert.equal(board.view.selected, 'a'); assert.ok(board.ui.nodes.has('board-detail'));
  assert.equal(board.memory['devkits.agent-board'][board.key].a.status, 'done');
  board.ui.nodes.get('agent-board-columns').click({}, cx); board.render();
  assert.equal(board.view.selected, null); assert.ok(!board.ui.nodes.has('board-detail'));
});

test('Tasks deduplicates pending and loaded external detail reads while allowing failed reads to retry', async () => {
  const board = await taskBoardFor({ a: { gid: 'a', source: 'asana', name: 'External task', status: 'todo' } });
  board.runtime.token = 'secret'; let detailReads = 0;
  board.view.detail.show = function(task) { detailReads++; this.detail = { ...task, notes: 'Source description' }; };
  board.ui.nodes.get('board-card-a').click({}, board.cx);
  board.ui.nodes.get('board-card-a').click({}, board.cx);
  assert.equal(board.runtime.tokenReads, undefined, 'The host does not read provider credentials');
  await settle();
  const detail = board.view.detail.detail;
  assert.equal(detailReads, 1); assert.equal(detail.notes, 'Source description');
  board.ui.nodes.get('board-card-a').click({}, board.cx); await settle();
  assert.equal(detailReads, 1); assert.equal(board.view.detail.detail, detail);
  board.view.detail.detailError = 'Offline';
  board.ui.nodes.get('board-card-a').click({}, board.cx); await settle();
  assert.equal(detailReads, 2); assert.equal(board.view.detail.detailError, null);
});


test('a closed conversation is restorable from its Tasks card menu and fixed detail footer', async () => {
  const task = { gid: 'thread:closed-test', name: 'Run tests', source: 'thread', status: 'todo', hasInput: true,
    conversation: { id: 'codex:session', argv: ['codex', 'resume', 'session'] } };
  const resumed = [];
  const board = await taskBoardFor({ [task.gid]: task }, { resume: current => resumed.push(current.gid) });
  board.ui.nodes.get(`board-card-actions-${task.gid}`).click({}, board.cx); board.render();
  const restore = board.ui.nodes.get(`board-card-menu-${task.gid}-resume`);
  assert.ok(restore);
  restore.click({}, board.cx); board.render();
  assert.deepEqual(resumed, [task.gid]);
  board.ui.nodes.get('board-resume-session').click({}, board.cx);
  assert.deepEqual(resumed, [task.gid, task.gid]);
  board.memory['devkits.agent-board'][board.key][task.gid].archived = true;
  board.view.archived = true; board.view.cardMenuTask = task.gid; board.view.cardMenu.open = true; board.render();
  assert.ok(!board.ui.nodes.has(`board-card-menu-${task.gid}-resume`));
  assert.ok(!board.ui.nodes.has('board-resume-session'));
});
