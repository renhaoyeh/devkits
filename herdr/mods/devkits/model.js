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

export const isCodexLauncher = agent => agent?.key === 'codex' || Boolean(agent?.key?.startsWith('devkits-codex-'));

export function launcherArgv(agent, permission) {
  const mode = codexPermissionModes.find(mode => mode.key === permission);
  if (!isCodexLauncher(agent) || !mode?.args.length) return agent?.run;
  const executable = agent.run.findIndex(arg => !arg.includes('=') && /(?:^|[/\\])codex(?:\.exe)?$/i.test(arg));
  if (executable < 0) throw new Error('Could not find Codex in this launcher. Choose Default to keep its existing command.');
  const rest = [];
  for (let i = executable + 1; i < agent.run.length; i++) {
    const arg = agent.run[i];
    if (arg === '--') { rest.push(...agent.run.slice(i)); break; }
    if (['--sandbox', '-s', '--ask-for-approval', '-a'].includes(arg)) { i++; continue; }
    if (/^--(?:sandbox|ask-for-approval)=|^-[sa]=|^-[sa](?:read-only|workspace-write|danger-full-access|never|on-request)$/.test(arg) ||
        ['--full-auto', '--approve-for-me', '--not-so-yolo', '--yolo', '--dangerously-bypass-approvals-and-sandbox'].includes(arg)) continue;
    rest.push(arg);
  }
  return [...agent.run.slice(0, executable + 1), ...mode.args, ...rest];
}

export function launcherChoices(agents, order = []) {
  const choices = [{ key: 'terminal', name: 'Terminal', group: 0 },
    ...agents.map(agent => ({ key: `agent:${agent.key}`, name: agent.name, agent,
      group: agent.key.startsWith('devkits-codex-') ? 2 : 1 }))];
  const ranks = new Map(order.map((key, index) => [key, index]));
  return choices.sort((a, b) => a.group - b.group || (ranks.get(a.key) ?? order.length) - (ranks.get(b.key) ?? order.length));
}

export function threadTitle(tab, agent, space) {
  const providers = agent ? ['Codex', agent.program?.name, agent.app].filter(Boolean) : [];
  const folders = [agent?.space_name, space?.name, space?.folder,
    space?.folder?.split(/[\\/]/).filter(Boolean).at(-1)].filter(Boolean);
  let fallback;
  for (const value of [tab.named ? tab.name : '', agent?.title, agent?.tab_name, tab.name]) {
    let title = (value || '').replace(/^[\u2800-\u28ff✳✻✽✶✢✦✴✹✺]\s*/u, '').trim();
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

// shortcut: compare path spellings; resolve aliases if symlinked project roots need deduplication.
export const folderKey = folder => (folder || '').replace(/\\/g, '/').replace(/\/+$/, '');

export function projectCatalog(spaces, saved = [], roots = {}, selected) {
  const projects = spaces.map(space => ({ ...space, folder: roots[space.id] || space.folder }));
  for (const folder of saved) {
    if (projects.some(p => !p.machine && folderKey(p.folder) === folderKey(folder))) continue;
    projects.push({ id: `project:${folder}`, name: folder.split(/[\\/]/).filter(Boolean).at(-1) || folder,
      folder, machine: null, tabs: [], pending: true });
  }
  const chosen = projects.find(p => p.id === selected) || projects.find(p => p.active) || projects[0];
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
