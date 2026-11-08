// Devkits owns where SYSTEM is mounted and which renderer each mount uses.
// Read legacy monitor preferences until the host saves its separate configuration.
export function systemDisplayPreferences(saved, legacy = {}) {
  const sidebar = typeof saved?.sidebar?.visible === 'boolean' ? saved.sidebar.visible : legacy?.placement !== 'status';
  const status = typeof saved?.status?.visible === 'boolean' ? saved.status.visible : legacy?.placement === 'status';
  return {
    enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : sidebar || status,
    sidebar: {
      visible: sidebar,
      style: ['inline', 'compact', 'graph'].includes(saved?.sidebar?.style) ? saved.sidebar.style : legacy?.style === 'compact' ? 'compact' : 'graph',
      cpuMode: (saved?.sidebar?.cpuMode ?? legacy?.cpuMode) === 'cores' ? 'cores' : 'total',
      heightMode: saved?.sidebar?.heightMode === 'auto' ? 'auto' : 'rows',
      rows: [2, 4, 6].includes(saved?.sidebar?.rows) ? saved.sidebar.rows : 4,
    },
    status: { visible: status },
  };
}

export function systemSidebarHeight(value, available = Infinity) {
  const maximum = Math.max(32, Number.isFinite(available) ? available : Infinity);
  return Math.round(Math.max(32, Math.min(maximum, Number.isFinite(value) ? value : 240)));
}
