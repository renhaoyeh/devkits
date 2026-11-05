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
  for (const value of [tab.named ? tab.name : '', agent?.title, agent?.tab_name, tab.name]) {
    let title = (value || '').replace(/^[\u2800-\u28ff✳✻✽✶✢✦✴✹✺]\s*/u, '').trim();
    if (!title || (/^\d+$/.test(title) && !(tab.named && value === tab.name))) continue;
    for (const provider of providers) {
      if (title.toLowerCase() === provider.toLowerCase()) { title = ''; break; }
      if (title.toLowerCase().startsWith(`${provider.toLowerCase()} · `)) {
        title = title.slice(provider.length + 3).trim(); break;
      }
    }
    const named = tab.named && value === tab.name;
    if (!named && (folders.includes(title) || /^(?:[~/\\]|[A-Za-z]:[\\/])/.test(title))) continue;
    if (title) return title;
  }
  return agent ? 'New thread' : 'Terminal';
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

export function projectGroups(spaces, agents) {
  return spaces.map(space => ({ space, threads: space.tabs.map(tab => {
    const members = agents.filter(a => a.space === space.id && a.tab === tab.id);
    const agent = members.find(a => a.focused) || members[0];
    return { space: space.id, tab, agents: members, agent,
      title: threadTitle(tab, agent, space),
      status: tab.status || agent?.status || 'idle',
      active: space.active && tab.active };
  }) }));
}
