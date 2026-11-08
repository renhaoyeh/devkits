// Devkits owns where SYSTEM is mounted and which renderer each mount uses.
// Read legacy monitor preferences until the host saves its separate configuration.
export function systemDisplayPreferences(saved, legacy = {}) {
  return {
    sidebar: {
      visible: typeof saved?.sidebar?.visible === 'boolean' ? saved.sidebar.visible : legacy?.placement !== 'status',
      style: ['inline', 'compact', 'graph'].includes(saved?.sidebar?.style) ? saved.sidebar.style : legacy?.style === 'compact' ? 'compact' : 'graph',
      cpuMode: (saved?.sidebar?.cpuMode ?? legacy?.cpuMode) === 'cores' ? 'cores' : 'total',
      height: systemSidebarHeight(saved?.sidebar?.height ?? legacy?.sidebarHeight),
    },
    status: { visible: typeof saved?.status?.visible === 'boolean' ? saved.status.visible : legacy?.placement === 'status' },
  };
}

export function systemSidebarHeight(value, available = 600) {
  const maximum = Math.max(32, Math.min(600, Number.isFinite(available) ? available : 600));
  return Math.round(Math.max(Math.min(96, maximum), Math.min(maximum, Number.isFinite(value) ? value : 240)));
}
