export function quotaElapsedPercent(window, now = Date.now()) {
  const duration = window.minutes * 60000;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(window.resetsAt) || window.resetsAt <= 0) return null;
  const remaining = window.resetsAt * 1000 - now;
  // An expired or inconsistent reset belongs to stale data, not a new window.
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > duration) return null;
  return (1 - remaining / duration) * 100;
}

export function quotaResetLabel(window, now = Date.now()) {
  if (!Number.isFinite(window.resetsAt) || window.resetsAt <= 0) return 'Reset time unavailable';
  const minutes = Math.ceil((window.resetsAt * 1000 - now) / 60000);
  if (minutes <= 0) return 'Reset due · awaiting refresh';
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `Resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `Resets in ${hours ? `${hours}h ` : ''}${minutes % 60}m`;
}

export const codexPermissionModes = [
  { key: 'default', label: 'Default', description: 'Use this launcher’s existing Codex settings.', args: [] },
  { key: 'read-only', label: 'Read only', description: 'Read files. Request approval when additional access is needed.',
    args: ['--sandbox', 'read-only', '--ask-for-approval', 'on-request'] },
  { key: 'workspace-write', label: 'Workspace', description: 'Write in the workspace. Request approval for additional access.',
    args: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'] },
  { key: 'danger-full-access', label: 'Full access', description: 'Write outside the workspace and run commands without sandboxing or approval.',
    args: ['--sandbox', 'danger-full-access', '--ask-for-approval', 'never'] },
];

export const claudePermissionModes = [
  { key: 'default', label: 'Default', description: 'Use this launcher’s existing Claude Code settings.', args: [] },
  { key: 'plan', label: 'Plan', description: 'Read files and plan. Ask before editing files or running commands.',
    args: ['--permission-mode', 'plan'] },
  { key: 'acceptEdits', label: 'Accept edits', description: 'Edit files without asking. Ask before running commands.',
    args: ['--permission-mode', 'acceptEdits'] },
  { key: 'bypassPermissions', label: 'Full access', description: 'Edit files and run commands without permission prompts.',
    args: ['--permission-mode', 'bypassPermissions'] },
];

export const isAccountLauncher = agent => /^devkits-(?:codex|claude)-/.test(agent?.key || '');
export const isCodexLauncher = agent => agent?.key === 'codex' || Boolean(agent?.key?.startsWith('devkits-codex-'));
export const isClaudeLauncher = agent => agent?.key === 'claude' || Boolean(agent?.key?.startsWith('devkits-claude-'));
export const permissionModes = agent => isCodexLauncher(agent) ? codexPermissionModes
  : isClaudeLauncher(agent) ? claudePermissionModes : null;

const permissionFlags = {
  codex: { name: 'Codex', executable: /(?:^|[/\\])codex(?:\.exe)?$/i, valued: ['--sandbox', '-s', '--ask-for-approval', '-a'],
    drop: arg => /^--(?:sandbox|ask-for-approval)=|^-[sa]=|^-[sa](?:read-only|workspace-write|danger-full-access|never|on-request)$/.test(arg) ||
      ['--full-auto', '--approve-for-me', '--not-so-yolo', '--yolo', '--dangerously-bypass-approvals-and-sandbox'].includes(arg) },
  claude: { name: 'Claude', executable: /(?:^|[/\\])claude(?:\.exe|\.cmd)?$/i, valued: ['--permission-mode'],
    drop: arg => arg.startsWith('--permission-mode=') || arg === '--dangerously-skip-permissions' },
};

export function launcherArgv(agent, permission) {
  const mode = permissionModes(agent)?.find(mode => mode.key === permission);
  if (!mode?.args.length) return agent?.run;
  const flags = permissionFlags[isCodexLauncher(agent) ? 'codex' : 'claude'];
  const executable = agent.run.findIndex(arg => !arg.includes('=') && flags.executable.test(arg));
  if (executable < 0) throw new Error(`Could not find ${flags.name} in this launcher. Choose Default to keep its existing command.`);
  const rest = [];
  for (let i = executable + 1; i < agent.run.length; i++) {
    const arg = agent.run[i];
    if (arg === '--') { rest.push(...agent.run.slice(i)); break; }
    if (flags.valued.includes(arg)) { i++; continue; }
    if (flags.drop(arg)) continue;
    rest.push(arg);
  }
  return [...agent.run.slice(0, executable + 1), ...mode.args, ...rest];
}

export function launcherChoices(agents, order = []) {
  const choices = [{ key: 'terminal', name: 'Terminal', group: 0 },
    ...agents.map(agent => ({ key: `agent:${agent.key}`, name: agent.name, agent,
      group: isAccountLauncher(agent) ? 2 : 1 }))];
  const ranks = new Map(order.map((key, index) => [key, index]));
  return choices.sort((a, b) => a.group - b.group || (ranks.get(a.key) ?? order.length) - (ranks.get(b.key) ?? order.length));
}

export function threadTitle(tab, agent, space) {
  const providers = agent ? ['Codex', 'Claude', agent.program?.name, agent.app].filter(Boolean) : [];
  const folders = [agent?.space_name, space?.name, space?.folder,
    space?.folder?.split(/[\\/]/).filter(Boolean).at(-1)].filter(Boolean);
  // Codex appends its repository to the terminal title ("Task | repo"); the project is already shown.
  const codex = agent?.app === 'codex' || isCodexLauncher(agent?.program);
  let fallback;
  for (const value of [tab.named ? tab.name : '', agent?.title, agent?.tab_name, tab.name]) {
    let title = (value || '').replace(/^[\u2800-\u28ff✳✻✽✶✢✦✴✹✺]\s*/u, '').trim();
    if (codex && value === agent.title) title = title.replace(/\s+\|\s+[^|]+$/, '');
    if (!title || (/^\d+$/.test(title) && !(tab.named && value === tab.name))) continue;
    for (const provider of providers) {
      if (title.toLowerCase() === provider.toLowerCase()) { title = ''; break; }
      if (title.toLowerCase().startsWith(`${provider.toLowerCase()} · `)) {
        fallback ||= title.slice(provider.length + 3).trim(); title = ''; break;
      }
    }
    const named = tab.named && value === tab.name;
    if (!named && (folders.includes(title) || /^(?:[~/\\]|[A-Za-z]:[\\/])/.test(title))) continue;
    if (title) return title;
  }
  return fallback || (agent ? 'New thread' : 'Terminal');
}

// A started session is the first tab that appears in its project afterwards; remember which profile ran it.
export function resolveThreadProfiles(spaces, pending = [], profiles = {}, now = Date.now()) {
  const next = { ...profiles };
  const waiting = pending.filter(entry => {
    const space = spaces.find(space => entry.space ? space.id === entry.space
      : !space.machine && folderKey(space.folder) === folderKey(entry.folder));
    const tab = space?.tabs.find(tab => !entry.before.includes(tab.id) && !next[tab.id]);
    if (tab) next[tab.id] = entry.key;
    return !tab && now - entry.at < 60000;
  });
  return { pending: waiting, profiles: Object.fromEntries(Object.entries(next).slice(-200)) };
}

// Threads started before profiles were recorded are still named after their launcher.
export function threadProfile(tab, launchers = [], profiles = {}) {
  return (launchers.find(agent => agent.key === profiles[tab.id])
    || (tab.named ? launchers.find(agent => agent.name === tab.name) : null))?.name || null;
}

// shortcut: compare path spellings; resolve aliases if symlinked project roots need deduplication.
export const folderKey = folder => (folder || '').replace(/\\/g, '/').replace(/\/+$/, '');

export function projectCatalog(spaces, saved = [], roots = {}, selected, order = []) {
  const projects = spaces.map(space => ({ ...space, folder: roots[space.id] || space.folder }));
  for (const folder of saved) {
    if (projects.some(p => !p.machine && folderKey(p.folder) === folderKey(folder))) continue;
    projects.push({ id: `project:${folder}`, name: folder.split(/[\\/]/).filter(Boolean).at(-1) || folder,
      folder, machine: null, tabs: [], pending: true });
  }
  const chosen = projects.find(p => p.id === selected) || projects.find(p => p.active) || projects[0];
  const ranks = new Map(order.map((key, index) => [key, index]));
  projects.sort((a, b) => (ranks.get(JSON.stringify([a.machine || '', folderKey(a.folder) || a.id])) ?? order.length)
    - (ranks.get(JSON.stringify([b.machine || '', folderKey(b.folder) || b.id])) ?? order.length));
  return projects.map(project => ({ ...project, active: project.id === chosen?.id }));
}

export function projectGroups(spaces, agents, defaults = {}) {
  return spaces.map(space => ({ space, threads: space.tabs.filter(tab => tab.id !== defaults[space.id]
    || agents.some(agent => agent.space === space.id && agent.tab === tab.id)).map(tab => {
    const members = agents.filter(a => a.space === space.id && a.tab === tab.id);
    const agent = members.find(a => a.focused) || members[0];
    return { space: space.id, tab, agents: members, agent,
      title: threadTitle(tab, agent, space),
      status: tab.status || agent?.status || 'idle',
      active: space.active && tab.active };
  }).sort((a, b) => Number(b.agents.some(agent => agent.status === 'working') || b.status === 'working')
    - Number(a.agents.some(agent => agent.status === 'working') || a.status === 'working')) }));
}
