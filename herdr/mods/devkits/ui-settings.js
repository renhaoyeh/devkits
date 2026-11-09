import { div } from 'gpui-kit';
import { h_flex, v_flex } from 'gpui-base';
import { shared, setShared, props, openOverlay, closeOverlay, run } from 'herdr';
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from './components/dropdown-menu.js';
import { glyph } from './components/icon.js';
import { systemDisplayConfig, saveSystemDisplay, openSystemDetails } from './system-display.js';
import { systemDisplayPreferences } from './system-display-model.js';
import { Button } from './components/button.js';
import { Switch } from './components/switch.js';
import { Select, SelectState } from './components/select.js';
import { DialogContent, DialogTitle, DialogDescription, DialogFooter } from './components/dialog.js';
import { openDevkitsReset } from './reset-devkits.js';

// USAGE presentation, like SYSTEM's: the existing master switch, a sidebar/status bar location, then the sidebar's style.
export const usageStyle = () => shared('devkits.usage-style') === 'compact' ? 'compact' : 'full';
export const usageLocation = () => ['status', 'both'].includes(shared('devkits.usage-location')) ? shared('devkits.usage-location') : 'sidebar';
export const usageShownIn = surface => shared('devkits.usage-visible') !== false
  && (usageLocation() === 'both' || usageLocation() === surface);
export const openUsageDisplayMenu = (at, surface = 'sidebar') => openOverlay({ mod: 'devkits', kind: 'popup', frame: 'none', width: 224, at,
  props: { view: 'usage-display-menu', surface } });
// Turning off the only location hides Usage; showing a location while hidden starts with that one alone.
export function toggleUsageSurface(surface) {
  const other = surface === 'sidebar' ? 'status' : 'sidebar';
  if (shared('devkits.usage-visible') === false) { setShared('devkits.usage-visible', true); setShared('devkits.usage-location', surface); return; }
  const shown = { sidebar: usageShownIn('sidebar'), status: usageShownIn('status') };
  shown[surface] = !shown[surface];
  if (!shown.sidebar && !shown.status) { setShared('devkits.usage-visible', false); return; }
  setShared('devkits.usage-location', shown.sidebar && shown.status ? 'both' : shown[other] ? other : surface);
}

export const openInterfaceSettings = (page = 'system') => openOverlay({
  mod: 'devkits', kind: 'dialog', frame: 'none', modal: false, width: 840, height: 0.78,
  props: { view: 'ui-settings', page },
});

// Feature visibility comes first; enabled features then choose their supported locations.
export class InterfaceSettings {
  init(cx) {
    this.handle = cx.focus_handle(); this.handle.focus();
    this.page = ['usage', 'data'].includes(props()?.page) ? props().page : 'system';
    this.location = new SelectState(cx); this.cpuMode = new SelectState(cx);
    this.heightMode = new SelectState(cx); this.usageStyle = new SelectState(cx); this.usageLocation = new SelectState(cx);
  }

  render(t) {
    const done = () => closeOverlay(props().overlay);
    const row = (title, description, control) => h_flex().min_h(64).flex_none().gap(20).items_center().py(12)
      .border_b(1).border_color(t.border)
      .child(v_flex().flex_1().min_w(0).gap(4)
        .child(div().text_size(13).child(title))
        .child(DialogDescription(t).child(description)))
      .child(control);
    const config = systemDisplayConfig(), usage = shared('devkits.usage-visible') !== false;
    const location = config.sidebar.visible && config.status.visible ? 'both' : config.sidebar.visible ? 'sidebar' : 'status';
    const options = items => items.map(([key, label]) => ({ key, label, color: t.foreground }));
    return DialogContent('interface-settings', t).accessibility_label('Interface settings')
      .track_focus(this.handle).on_key_down((event, cx) => {
        if (event.key === 'escape') { cx.stop_propagation(); done(); }
      })
      .child(DialogTitle().flex_none().child('Interface settings'))
      .child(h_flex().flex_1().min_h(0).items_start().gap(24)
        .child(v_flex().w(144).h_full().flex_none().gap(4)
          .children([{ key: 'system', label: 'SYSTEM' }, { key: 'usage', label: 'USAGE' }, { key: 'data', label: 'Data' }]
            .map(page => Button(`interface-page-${page.key}`, t, { variant: 'ghost' }).w_full().justify_start().px(12)
              .bg(this.page === page.key ? t.selected : t.popover)
              .text_color(this.page === page.key ? t.foreground : t.muted)
              .hover(el => el.bg(this.page === page.key ? t.selected : t.hover))
              .on_click((_event, cx) => { this.page = page.key; cx.notify(); })
              .child(page.label))))
        .child(v_flex().flex_1().h_full().min_w(0).min_h(0).overflow_y_scroll().gap(4)
          .when(this.page === 'system', el => el
            .child(div().text_size(16).font_medium().child('SYSTEM'))
            .child(row('Show System', 'Display hardware usage in this workspace.',
              Switch('interface-system-visible', config.enabled, t).accessibility_label('Show System')
                .on_change((enabled, cx) => {
                  const current = systemDisplayConfig();
                  saveSystemDisplay({ enabled,
                    ...(enabled && !current.sidebar.visible && !current.status.visible ? { sidebar: { visible: true } } : {}),
                  }, cx);
                })))
            .when(config.enabled, el => el
              .child(row('Location', 'Choose the sidebar, bottom status bar, or both.',
                Select('interface-system-location', this.location, location,
                  options([['sidebar', 'Sidebar'], ['status', 'Status bar'], ['both', 'Both']]),
                  'System location', (value, cx) => saveSystemDisplay({
                    sidebar: { visible: value !== 'status' }, status: { visible: value !== 'sidebar' },
                  }, cx), t, { width: 176, boxed: true })))
              .when(config.sidebar.visible, el => el
                  .child(row('Widget CPU view', 'Overall CPU averages all logical processors. Per logical CPU shows one bar per processor.',
                    Select('interface-system-cpu', this.cpuMode, config.sidebar.cpuMode,
                      options([['total', 'Overall CPU'], ['cores', 'Per logical CPU']]), 'Widget CPU view',
                      (cpuMode, cx) => saveSystemDisplay({ sidebar: { cpuMode } }, cx), t, { width: 176, boxed: true })))
                  .child(row('Visible rows', 'Choose a row count, or fit all monitor cards automatically.',
                    Select('interface-system-height-mode', this.heightMode,
                      config.sidebar.heightMode === 'rows' ? `rows-${config.sidebar.rows}` : config.sidebar.heightMode,
                      options([['rows-2', '2 rows'], ['rows-4', '4 rows'], ['rows-6', '6 rows'], ['auto', 'Auto height (default)']]), 'Visible monitor rows',
                      (value, cx) => {
                        saveSystemDisplay({ sidebar: value.startsWith('rows-')
                          ? { heightMode: 'rows', rows: Number(value.slice(5)) } : { heightMode: value } }, cx);
                      }, t, { width: 176, boxed: true }))))
              .child(row('Monitoring', 'Choose shared resources, sampling interval and resource details.',
                Button('interface-monitor-settings', t, { variant: 'secondary' }).child('Monitor settings…')
                  .on_click(() => openSystemDetails('settings'))))))
          .when(this.page === 'usage', el => el
            .child(div().text_size(16).font_medium().child('USAGE'))
            .child(row('Show Usage', 'Display account quotas. Turning this off pauses quota refreshes.',
              Switch('usage-visible', usage, t).accessibility_label('Show Usage')
                .on_change((visible, cx) => { setShared('devkits.usage-visible', visible); cx.notify(); })))
            .when(usage, el => el.child(row('Location', 'Choose the sidebar, bottom status bar, or both.',
              Select('interface-usage-location', this.usageLocation, usageLocation(),
                options([['sidebar', 'Sidebar'], ['status', 'Status bar'], ['both', 'Both']]), 'Usage location',
                (location, cx) => { setShared('devkits.usage-location', location); cx.notify(); }, t, { width: 176, boxed: true }))))
            .when(usage && usageLocation() !== 'status', el => el.child(row('Style', 'Full shows 5-hour and weekly meters with reset times; Compact shows one line of percentages per account.',
              Select('interface-usage-style', this.usageStyle, usageStyle(), options([['full', 'Full'], ['compact', 'Compact']]),
                'Usage style', (style, cx) => { setShared('devkits.usage-style', style); cx.notify(); }, t, { width: 176, boxed: true })))))
          .when(this.page === 'data', el => el
            .child(div().text_size(16).font_medium().child('Devkits data'))
            .child(row('Clear all Devkits data', 'Delete settings, saved sign-ins, dedicated account history, Tasks, Calendar, connections and caches. Project files and external default accounts are kept.',
              Button('interface-clear-devkits-data', t, { variant: 'secondary' }).text_color(t.destructive || t.ansi1)
                .on_click(() => openDevkitsReset()).child('Clear data…'))))))
      .child(DialogFooter().flex_none()
        .when(this.page === 'system', el => el.child(Button('interface-system-reset', t, { variant: 'secondary' })
          .accessibility_label('Reset System settings to defaults')
          .on_click((_event, cx) => {
            setShared('devkits.system-display', systemDisplayPreferences());
            run('devkits-system.reset');
            cx.notify();
          }).child('Reset')))
        .child(Button('interface-settings-done', t).on_click(done).child('Done')));
  }
}

// Right-click menu on the sidebar USAGE section, like SYSTEM's: style, hiding, and the full settings.
export class UsageDisplayMenu {
  constructor({ overlay, surface } = {}) { this.overlay = overlay; this.surface = surface === 'status' ? 'status' : 'sidebar'; }

  init(cx) { this.handle = cx.focus_handle(); this.handle.focus(); this.index = 0; }

  render(t) {
    const overlay = this.overlay, style = usageStyle();
    const actions = [
      { key: 'sidebar', label: 'Show in sidebar', checked: usageShownIn('sidebar') },
      { key: 'status', label: 'Show in status bar', checked: usageShownIn('status') },
      ...(usageShownIn('sidebar') ? [{ key: 'full', label: 'Full', checked: style === 'full', section: 'SIDEBAR STYLE' },
        { key: 'compact', label: 'Compact', checked: style === 'compact' }] : []),
      { key: 'hide', label: 'Hide Usage', section: '' },
      { key: 'settings', label: 'Interface settings…' },
    ];
    const choose = (action, cx) => {
      cx.stop_propagation();
      if (!action) return;
      closeOverlay(overlay);
      if (action.key === 'settings') openInterfaceSettings('usage');
      else if (action.key === 'hide') setShared('devkits.usage-visible', false);
      else if (['sidebar', 'status'].includes(action.key)) toggleUsageSurface(action.key);
      else setShared('devkits.usage-style', action.key);
    };
    return DropdownMenuContent('usage-display-menu', undefined, t).role('menu').accessibility_label('Usage display')
      .track_focus(this.handle)
      .on_mouse_down_out((_event, cx) => { cx.stop_propagation(); closeOverlay(overlay); })
      .on_key_down((event, cx) => {
        if (event.key === 'escape') closeOverlay(overlay);
        else if (event.key === 'enter' || event.key === 'space') choose(actions[this.index], cx);
        else if (event.key === 'down' || event.key === 'up') {
          this.index = (this.index + (event.key === 'up' ? -1 : 1) + actions.length) % actions.length; cx.notify();
        } else return;
        cx.stop_propagation();
      })
      .child(DropdownMenuLabel(t).child(this.surface === 'status' ? 'USAGE · STATUS BAR' : 'USAGE · SIDEBAR'))
      .children(actions.flatMap((action, index) => [
        ...(action.section !== undefined ? [DropdownMenuSeparator(t), ...(action.section ? [DropdownMenuLabel(t).child(action.section)] : [])] : []),
        DropdownMenuItem(`usage-display-${action.key}`, t).role('menu_item').accessibility_label(action.label)
          .when(this.index === index, el => el.bg(t.selected))
          .on_hover((inside, cx) => { if (inside) { this.index = index; cx.notify(); } })
          .on_click((_event, cx) => choose(action, cx))
          .child(div().size(14).flex_none().when(Boolean(action.checked), el => el.child(glyph('check'))))
          .child(action.label),
      ]));
  }
}
