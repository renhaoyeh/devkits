import { div } from 'gpui-kit';
import { h_flex, v_flex } from 'gpui-base';
import { shared, setShared, props, openOverlay, closeOverlay, run } from 'herdr';
import { systemDisplayConfig, saveSystemDisplay, openSystemDetails } from './system-display.js';
import { systemDisplayPreferences } from './system-display-model.js';
import { Button } from './components/button.js';
import { Switch } from './components/switch.js';
import { Select, SelectState } from './components/select.js';
import { DialogContent, DialogTitle, DialogDescription, DialogFooter } from './components/dialog.js';

export const openInterfaceSettings = (page = 'system') => openOverlay({
  mod: 'devkits', kind: 'dialog', frame: 'none', modal: false, width: 840, height: 0.78,
  props: { view: 'ui-settings', page },
});

// Feature visibility comes first; enabled features then choose their supported locations.
export class InterfaceSettings {
  init(cx) {
    this.handle = cx.focus_handle(); this.handle.focus();
    this.page = props()?.page === 'usage' ? 'usage' : 'system';
    this.location = new SelectState(cx); this.cpuMode = new SelectState(cx);
    this.heightMode = new SelectState(cx);
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
          .children([{ key: 'system', label: 'SYSTEM' }, { key: 'usage', label: 'USAGE' }]
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
                  .child(row('Widget CPU view', 'Show total usage or individual logical processors.',
                    Select('interface-system-cpu', this.cpuMode, config.sidebar.cpuMode,
                      options([['total', 'Total'], ['cores', 'Per core']]), 'Widget CPU view',
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
            .child(row('Show Usage', 'Display account quotas in the sidebar. Turning this off pauses quota refreshes.',
              Switch('usage-visible', usage, t).accessibility_label('Show Usage')
                .on_change((visible, cx) => { setShared('devkits.usage-visible', visible); cx.notify(); }))))))
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
