import { div } from 'gpui-kit';
import { h_flex, v_flex } from 'gpui-base';
import { shared, setShared, openOverlay, closeOverlay } from 'herdr';
import { systemDisplayPreferences, systemSidebarHeight } from './system-display-model.js';
import { Button } from './components/button.js';
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from './components/dropdown-menu.js';
import { glyph } from './components/icon.js';

const displayKey = 'devkits.system-display';
const displayConfig = () => systemDisplayPreferences(shared(displayKey), shared('devkits.system-monitor'));
const saveDisplay = (patch, cx) => {
  const current = displayConfig();
  setShared(displayKey, systemDisplayPreferences({
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
  constructor(monitor, view) { this.monitor = monitor; this.view = view; }

  init() {
    if (shared(displayKey) == null) setShared(displayKey, displayConfig());
  }

  active() {
    const config = displayConfig();
    return this.view === 'hardware-details' || (this.view === 'status' ? config.status.visible : !this.view && config.sidebar.visible);
  }

  contextMenu(root) {
    return root.on_mouse_down('right', (event, cx) => {
      cx.stop_propagation();
      openOverlay({ mod: 'devkits', kind: 'popup', frame: 'none', width: 248,
        at: event.position, props: { view: 'system-display-menu' } });
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

  sidebarSize(value = this.resize?.now ?? displayConfig().sidebar.height) {
    return systemSidebarHeight(value, this.available === undefined ? 600 : this.available - (this.reserved || 0) - 32 - 96);
  }

  endResize(cx) {
    if (!this.resize) return;
    const height = this.sidebarSize(); this.resize = null;
    saveDisplay({ sidebar: { height } }, cx);
  }

  renderStatus(t) {
    return displayConfig().status.visible ? this.contextMenu(this.monitor.renderInline(t, { id: 'status-system' })) : div().flex_1().min_w(0);
  }

  renderSidebar(t) {
    const config = displayConfig().sidebar;
    if (!config.visible) return div().h(0).flex_none();
    const inline = config.style === 'inline', widgets = this.monitor.snapshot().widgets.length > 0;
    return this.contextMenu(v_flex().id('system-usage').relative().w_full().min_h(0).flex_none()
      .h(inline ? widgets ? 64 : 32 : widgets ? this.sidebarSize() : 32).border_t(1).border_color(t.border)
      .accessibility_label('Current hardware usage of this computer')
      .child(h_flex().h(32).flex_none().pl(12).items_center()
        .child(div().flex_1().text_size(11).font_medium().text_color(t.muted).child('SYSTEM'))
        .child(Button('open-hardware-details', t, { variant: 'ghost', size: 'icon' }).h_full().w(32)
          .accessibility_label('Open system monitor').on_click(() => this.monitor.open()).child(glyph('chart-column'))))
      .when(widgets, el => el.child(inline
        ? h_flex().h(32).min_w(0).child(this.monitor.renderInline(t, { id: 'sidebar-system' }))
        : this.monitor.renderWidgets(t, { style: config.style, cpuMode: config.cpuMode }).flex_1().min_h(0).overflow_y_scrollbar().pb(6)))
      .when(widgets && !inline, el => el.child(div().id('system-usage-resize').absolute().top(-3).left(0).right(0).h(6).cursor_row_resize()
        .accessibility_label('Resize system monitor. Drag the top border; double-click to reset.')
        .on_mouse_down('left', (event, cx) => {
          cx.stop_propagation(); const height = this.sidebarSize();
          this.resize = { y: event.position.y, height, now: height }; cx.notify();
        })
        .on_click((event, cx) => {
          if (event.click_count < 2) return;
          this.resize = null; saveDisplay({ sidebar: { height: 240 } }, cx);
        }))));
  }
}

export class SystemDisplayMenu {
  constructor({ overlay } = {}) { this.overlay = overlay; }

  init(cx) { this.handle = cx.focus_handle(); this.handle.focus(); this.index = 0; }

  render(t) {
    const config = displayConfig(), overlay = this.overlay;
    const actions = [
      { key: 'sidebar', label: 'Show in sidebar', checked: config.sidebar.visible },
      { key: 'status', label: 'Show in status bar', checked: config.status.visible },
      { key: 'inline', label: 'Inline values', checked: config.sidebar.style === 'inline', section: 'SIDEBAR STYLE' },
      { key: 'compact', label: 'Compact widgets', checked: config.sidebar.style === 'compact' },
      { key: 'graph', label: 'History widgets', checked: config.sidebar.style === 'graph' },
      { key: 'total', label: 'Total', checked: config.sidebar.cpuMode === 'total', section: 'WIDGET CPU' },
      { key: 'cores', label: 'Per core', checked: config.sidebar.cpuMode === 'cores' },
      { key: 'settings', label: 'Monitor settings…', section: '' },
    ];
    const choose = (action, cx) => {
      cx.stop_propagation();
      if (!action) return;
      const current = displayConfig();
      if (action.key === 'settings') { closeOverlay(overlay); openSystemDetails('settings'); return; }
      if (['sidebar', 'status'].includes(action.key)) saveDisplay({ [action.key]: { visible: !current[action.key].visible } }, cx);
      else if (['total', 'cores'].includes(action.key)) saveDisplay({ sidebar: { cpuMode: action.key } }, cx);
      else saveDisplay({ sidebar: { visible: true, style: action.key } }, cx);
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
      .child(DropdownMenuLabel(t).child('SYSTEM'))
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
