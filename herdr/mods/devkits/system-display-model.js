// Devkits owns where SYSTEM is mounted and which renderer each mount uses.
export function systemDisplayPreferences(saved) {
  const sidebar = typeof saved?.sidebar?.visible === 'boolean' ? saved.sidebar.visible : true;
  const status = typeof saved?.status?.visible === 'boolean' ? saved.status.visible : false;
  return {
    enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : true,
    sidebar: {
      visible: sidebar,
      style: 'compact',
      cpuMode: saved?.sidebar?.cpuMode === 'total' ? 'total' : 'cores',
      heightMode: saved?.sidebar?.heightMode === 'rows' ? 'rows' : 'auto',
      rows: [2, 4, 6].includes(saved?.sidebar?.rows) ? saved.sidebar.rows : 6,
    },
    status: { visible: status },
  };
}

export function systemSidebarHeight(value, available = Infinity) {
  const maximum = Math.max(32, Number.isFinite(available) ? available : Infinity);
  return Math.round(Math.max(32, Math.min(maximum, Number.isFinite(value) ? value : 240)));
}
