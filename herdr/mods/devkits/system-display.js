import { div } from 'gpui-kit';
import { h_flex, v_flex } from 'gpui-base';
import { shared, setShared, openOverlay, closeOverlay } from 'herdr';
import { systemDisplayPreferences, systemSidebarHeight } from './system-display-model.js';
import { Button } from './components/button.js';
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from './components/dropdown-menu.js';
import { glyph } from './components/icon.js';

const displayKey = 'devkits.system-display';
export const systemDisplayConfig = () => systemDisplayPreferences(shared(displayKey), shared('devkits.system-monitor'));
export const saveSystemDisplay = (patch, cx) => {
  const current = systemDisplayConfig();
  setShared(displayKey, systemDisplayPreferences({
    enabled: patch.enabled ?? current.enabled,
    sidebar: { ...current.sidebar, ...patch.sidebar }, status: { ...current.status, ...patch.status },
  }));
  cx.notify();
};

export const openSystemDetails = (page = 'overview') => openOverlay({
  mod: 'devkits-system', kind: 'dialog', frame: 'none', modal: false, width: 0.9, height: 0.82,
  props: { view: 'details', page },
});

// Devkits' adapter: placement, containers, sizing and context menus belong to this consumer.
export class SystemDisplay {
  constructor(monitor, view) { this.monitor = monitor; this.view = view; this.widgetHeights = {}; }

  init() {
    if (shared(displayKey) == null) setShared(displayKey, systemDisplayConfig());
  }

  active() {
    const config = systemDisplayConfig();
    return this.view === 'hardware-details' || (config.enabled && (this.view === 'status' ? config.status.visible : !this.view && config.sidebar.visible));
  }

  contextMenu(root, surface = 'sidebar') {
    return root.on_mouse_down('right', (event, cx) => {
      cx.stop_propagation();
      openOverlay({ mod: 'devkits', kind: 'popup', frame: 'none', width: 248,
        at: event.position, props: { view: 'system-display-menu', surface } });
    });
  }

  sidebarContainer(root) {
    return root.when(Boolean(this.resize), el => el.cursor_row_resize())
      .on_size_change((size, cx) => {
        if (this.available !== size.height) { this.available = size.height; cx.notify(); }
      })
      .on_mouse_move((event, cx) => {
        if (!this.resize) return;
        const scale = this.available && event.bounds?.height ? event.bounds.height / this.available : 1;
        const height = this.sidebarSize(this.resize.height + (this.resize.y - event.position.y) / scale);
        if (height !== this.resize.now) { this.resize.now = height; cx.notify(); }
      })
      .on_mouse_up('left', (_event, cx) => this.endResize(cx))
      .on_hover((inside, cx) => { if (!inside) this.endResize(cx); });
  }

  reservedSidebarContent(root) {
    return root.on_size_change((size, cx) => {
      if (this.reserved !== size.height) { this.reserved = size.height; cx.notify(); }
    });
  }

  sidebarAvailableHeight() {
    return Math.max(32, this.available === undefined ? 600 : this.available - (this.reserved || 0) - 32 - 96);
  }

  sidebarSize(value = this.resize?.now) {
    const config = systemDisplayConfig().sidebar, available = this.sidebarAvailableHeight();
    if (value !== undefined) return systemSidebarHeight(value, available);
    return Math.min(Math.round(available), this.rowsHeight(config.heightMode === 'auto' ? Infinity : config.rows));
  }

  rowsHeight(rows = Infinity) {
    const ids = this.monitor.snapshot().widgets.slice(0, rows);
    // Header and top border, then the measured cards in visible order.
    return Math.ceil(33 + ids.reduce((total, id) => total + (this.widgetHeights[id] ?? 48), 0));
  }

  endResize(cx) {
    if (!this.resize) return;
    const height = this.sidebarSize(); this.resize = null;
    const rows = [2, 4, 6].reduce((best, count) => Math.abs(this.rowsHeight(count) - height) < Math.abs(this.rowsHeight(best) - height) ? count : best, 4);
    saveSystemDisplay({ sidebar: { heightMode: 'rows', rows } }, cx);
  }

  renderStatus(t) {
    const config = systemDisplayConfig();
    return config.enabled && config.status.visible ? this.contextMenu(this.monitor.renderInline(t, { id: 'status-system' }), 'status') : div().flex_1().min_w(0);
  }

  renderSidebar(t) {
    const display = systemDisplayConfig(), config = display.sidebar;
    if (!display.enabled || !config.visible) return div().h(0).flex_none();
    const widgets = this.monitor.snapshot().widgets.length > 0;
    return this.contextMenu(v_flex().id('system-usage').relative().w_full().min_h(0).flex_none()
      .h(widgets ? this.sidebarSize() : 32)
      .on_size_change((size) => { this.renderedHeight = size.height; })
      .border_t(1).border_color(t.border)
      .accessibility_label('Current hardware usage of this computer')
      .child(h_flex().h(32).flex_none().pl(12).items_center()
        .child(div().flex_1().text_size(11).font_medium().text_color(t.muted).child('SYSTEM'))
        .child(Button('open-hardware-details', t, { variant: 'ghost', size: 'icon' }).h_full().w(32)
          .accessibility_label('Open system monitor').on_click(() => this.monitor.open()).child(glyph('chart-column'))))
      .when(widgets, el => el.child(this.monitor.renderWidgets(t, { style: config.style, cpuMode: config.cpuMode,
          onWidgetSize: (id, size, cx) => {
            if (!Number.isFinite(size.height) || size.height <= 0) return;
            // Compact CPU modes share the same row geometry and measured card heights.
            if (Math.abs((this.widgetHeights[id] ?? 0) - size.height) < 0.25) return;
            this.widgetHeights[id] = size.height;
            cx.notify();
          },
        }).flex_1().min_h(0).overflow_y_scrollbar()))
      .when(widgets, el => el.child(div().id('system-usage-resize').absolute().top(-3).left(0).right(0).h(6).cursor_row_resize()
        .accessibility_label('Drag to choose 2, 4 or 6 monitor rows; double-click for 4 rows.')
        .on_mouse_down('left', (event, cx) => {
          cx.stop_propagation(); const height = this.renderedHeight ?? this.sidebarSize();
          this.resize = { y: event.position.y, height, now: height }; cx.notify();
        })
        .on_click((event, cx) => {
          if (event.click_count < 2) return;
          this.resize = null; saveSystemDisplay({ sidebar: { heightMode: 'rows', rows: 4 } }, cx);
        }))));
  }
}

export class SystemDisplayMenu {
  constructor({ overlay, surface } = {}) { this.overlay = overlay; this.surface = surface === 'status' ? 'status' : 'sidebar'; }

  init(cx) { this.handle = cx.focus_handle(); this.handle.focus(); this.index = 0; }

  render(t) {
    const config = systemDisplayConfig(), overlay = this.overlay;
    const actions = [...(this.surface === 'status' ? [
      { key: 'status', label: 'Show in status bar', checked: config.enabled && config.status.visible },
    ] : [
      { key: 'sidebar', label: 'Show in sidebar', checked: config.enabled && config.sidebar.visible },
      { key: 'total', label: 'Overall CPU', checked: config.sidebar.cpuMode === 'total', section: 'WIDGET CPU' },
      { key: 'cores', label: 'Per logical CPU', checked: config.sidebar.cpuMode === 'cores' },
    ]),
      { key: 'settings', label: 'Monitor settings…', section: '' },
    ];
    const choose = (action, cx) => {
      cx.stop_propagation();
      if (!action) return;
      const current = systemDisplayConfig();
      if (action.key === 'settings') { closeOverlay(overlay); openSystemDetails('settings'); return; }
      if (['sidebar', 'status'].includes(action.key)) {
        const other = action.key === 'sidebar' ? 'status' : 'sidebar';
        if (!current.enabled) saveSystemDisplay({ enabled: true, [action.key]: { visible: true }, [other]: { visible: false } }, cx);
        else if (current[action.key].visible && !current[other].visible) saveSystemDisplay({ enabled: false }, cx);
        else saveSystemDisplay({ [action.key]: { visible: !current[action.key].visible } }, cx);
      }
      else if (['total', 'cores'].includes(action.key)) saveSystemDisplay({ sidebar: { cpuMode: action.key } }, cx);
      closeOverlay(overlay);
    };
    return DropdownMenuContent('system-display-menu', undefined, t).role('menu').accessibility_label('System display')
      .track_focus(this.handle)
      .on_mouse_down_out((_event, cx) => { cx.stop_propagation(); closeOverlay(overlay); })
      .on_key_down((event, cx) => {
        if (event.key === 'escape') closeOverlay(overlay);
        else if (event.key === 'enter' || event.key === 'space') choose(actions[this.index], cx);
        else if (event.key === 'down' || event.key === 'up') {
          this.index = (this.index + (event.key === 'up' ? -1 : 1) + actions.length) % actions.length; cx.notify();
        } else if (event.key === 'home') { this.index = 0; cx.notify(); }
        else if (event.key === 'end') { this.index = actions.length - 1; cx.notify(); }
        else return;
        cx.stop_propagation();
      })
      .child(DropdownMenuLabel(t).child(this.surface === 'status' ? 'SYSTEM · STATUS BAR' : 'SYSTEM · SIDEBAR'))
      .children(actions.flatMap((action, index) => [
        ...(action.section !== undefined ? [DropdownMenuSeparator(t), ...(action.section ? [DropdownMenuLabel(t).child(action.section)] : [])] : []),
        DropdownMenuItem(`system-display-${action.key}`, t).role('menu_item').accessibility_label(action.label)
          .when(this.index === index, el => el.bg(t.selected))
          .on_hover((inside, cx) => { if (inside) { this.index = index; cx.notify(); } })
          .on_click((_event, cx) => choose(action, cx))
          .child(div().size(14).flex_none().when(action.checked, el => el.child(glyph('check'))))
          .child(action.label),
      ]));
  }
}
