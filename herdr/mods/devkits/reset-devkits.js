import { div } from 'gpui-kit';
import { v_flex, Input, InputState } from 'gpui-base';
import { appHome, props, shared, setShared, spaces, exec, readTextFile, run, openOverlay, closeOverlay, window } from 'herdr';
import { Button } from './components/button.js';
import { AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from './components/alert-dialog.js';

export const openDevkitsReset = () => openOverlay({ mod: 'devkits', kind: 'dialog', frame: 'none', modal: true,
  width: 620, height: 560, props: { view: 'reset-devkits' } });
const authorizationKey = 'devkits.reset-authorization';
const helper = () => `${appHome()}/mods/devkits/reset-data.js`;

export class ResetDevkits {
  init(cx) {
    this.target = props() || {};
    this.handle = cx.focus_handle(); this.handle.focus();
    this.executing = this.target.phase === 'execute';
    if (this.executing) {
      this.original = this.target.original;
      const authorization = shared(authorizationKey);
      this.authorized = Boolean(authorization?.token === this.target.token && authorization.expiresAt > Date.now());
      setShared(authorizationKey, null);
      if (!this.authorized) { this.error = 'Reset was interrupted. Return to Devkits to start again.'; return; }
      // The previous layout and both dialogs have been removed. Allow their bounded
      // native close handlers to finish before touching account files or shared state.
      this.busy = true;
      cx.timer.after(350, cx => { this.busy = false; this.clear(cx); });
      return;
    }
    this.input = InputState.new({ placeholder: 'DEVKITS' });
    this.input.on('change', (_event, cx) => cx.notify());
    this.input.on('submit', (_event, cx) => this.begin(cx));
    this.loading = true;
    cx.spawn(async cx => {
      try {
        this.source = await readTextFile(`${appHome()}/layouts/devkits.json`);
        this.original = JSON.parse(this.source);
        const result = await exec('node', [helper(), 'inspect', appHome()]);
        if (result.code !== 0) throw new Error(result.stderr?.trim() || 'Could not inspect Devkits data.');
        this.plan = JSON.parse(result.stdout);
      } catch (error) { this.error = error.message; }
      this.loading = false; cx.notify();
    });
  }

  ready() { return !this.loading && !this.busy && !this.error && Boolean(this.plan) && this.input?.value() === 'DEVKITS'; }

  begin(cx) {
    if (!this.ready()) return;
    this.busy = true; cx.notify();
    cx.spawn(async cx => {
      try {
        if (shared('layout') !== 'devkits') throw new Error('Switch to the Devkits layout before clearing data.');
        const result = await exec('herdr-app', ['status']);
        if (result.code !== 0) throw new Error('Could not check open dialogs.');
        const status = JSON.parse(result.stdout);
        if (status.overlays?.length !== 2 || status.overlays.some(name => name !== 'devkits'))
          throw new Error('Close other dialogs and windows before clearing data.');
        if (await readTextFile(`${appHome()}/layouts/devkits.json`) !== this.source)
          throw new Error('The layout changed. Close this dialog and start again.');
        const token = `reset:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        setShared(authorizationKey, { token, expiresAt: Date.now() + 10000 });
        run('layout.set', { layout: { id: 'devkits-reset-root', type: 'block', theme: this.original.theme,
          content: { mod: 'devkits', props: { view: 'reset-devkits', phase: 'execute', token, original: this.original } } } });
        // No old Devkits provider or dialog may remain alive and repopulate cleared data.
        run('overlay.close'); run('overlay.close');
      } catch (error) { this.error = error.message; this.busy = false; cx.notify(); }
    });
  }

  clear(cx) {
    if (this.busy || this.complete || !this.authorized) return;
    this.busy = true; this.error = null; cx.notify();
    cx.spawn(async cx => {
      try {
        this.closing = true; cx.notify();
        for (const project of spaces()) {
          const reply = await exec('herdr-app', ['do', 'space.close', '--id', project.id, '--confirmed', 'true']);
          if (reply.code !== 0) throw new Error(`Could not close project ${project.name || project.id}. No account files were removed; Retry to try again.`);
        }
        if (spaces().length) await new Promise((resolve, reject) => {
          const deadline = Date.now() + 15000;
          const check = cx => {
            if (!spaces().length) return resolve();
            if (Date.now() >= deadline) return reject(new Error('Projects are still closing. No account files were removed; Retry to try again.'));
            cx.timer.after(100, check);
          };
          check(cx);
        });
        this.closing = false; cx.notify();
        const result = await exec('node', [helper(), 'clear', appHome(), 'DEVKITS'], { timeout: 600000 });
        if (result.code !== 0) throw new Error(result.stderr?.trim() || 'Could not clear all Devkits data.');
        const { sharedKeys } = JSON.parse(result.stdout);
        if (!Array.isArray(sharedKeys) || sharedKeys.some(key => typeof key !== 'string' || !key.startsWith('devkits.')))
          throw new Error('Invalid reset result.');
        for (const key of sharedKeys) setShared(key, null);
        setShared(authorizationKey, null);
        this.complete = true;
      } catch (error) { this.error = error.message; }
      this.closing = false; this.busy = false; cx.notify();
    });
  }

  restore() {
    if (!this.busy && this.original) {
      run('layout.set', { layout: this.original });
      // End the old native module contexts too; their session-only caches must not
      // survive a complete reset. The next app launch starts the restored layout.
      if (this.complete) run(window()?.platform === 'macos' ? 'app.quit' : 'window.close');
    }
  }

  render(t) {
    const done = () => { if (!this.busy) this.executing ? this.restore() : closeOverlay(this.target.overlay); };
    const content = AlertDialogContent('reset-devkits-dialog', t).accessibility_label('Clear all Devkits data')
      .track_focus(this.handle).on_key_down((event, cx) => {
        if (event.key === 'escape') { cx.stop_propagation(); if (!this.busy) done(); }
      })
      .child(AlertDialogTitle().child(this.complete ? 'Devkits data cleared' : 'Clear all Devkits data?'))
      .child(AlertDialogDescription(t).flex_none().child(this.complete
        ? 'All Devkits data has been cleared. Finish to close Herdr, then open it again to start with new defaults.'
        : 'Permanently delete all Devkits settings, saved accounts and their sign-ins, conversations, plugins and skills, Tasks, Calendar events, source connections, Rules, shared MCP settings and caches.'))
      .child(div().text_size(13).text_color(t.muted).child('Project files and external default Claude/Codex accounts, their sign-ins and history are kept. Devkits integrations in those default accounts are removed.'))
      .when(!this.executing, el => el
        .child(div().text_size(13).text_color(t.muted).child(this.loading ? 'Checking Devkits data…'
          : `${this.plan?.accounts ?? 0} dedicated account directories. This cannot be undone.`))
        .child(div().text_size(13).text_color(t.muted).child('This closes all open projects and stops their sessions and any Devkits account sessions. Type DEVKITS to confirm.'))
        .child(Input.new(this.input).id('reset-devkits-confirmation').accessibility_label('Type DEVKITS to confirm')
          .h(36).px(10).rounded(0).border_b(1).border_color(t.input).text_size(13)))
      .when(Boolean(this.error), el => el.child(div().id('reset-devkits-error').text_size(12).text_color(t.destructive || t.ansi1)
        .child(`${this.error}${this.executing && this.authorized ? ' Reset is incomplete. Some accounts may already be signed out.' : ''}`)))
      .child(div().flex_1())
      .child(AlertDialogFooter()
        .child(AlertDialogCancel('reset-devkits-cancel', t).disabled(Boolean(this.busy)).on_click(done)
          .child(this.complete ? 'Finish and close Herdr' : this.executing ? 'Return to Devkits' : 'Cancel'))
        .when(!this.complete && (!this.executing || this.authorized), el => el
          .child(Button('reset-devkits-clear', t, { variant: 'destructive' })
            .disabled(this.executing ? Boolean(this.busy) : !this.ready())
            .opacity((this.executing ? this.busy : !this.ready()) ? 0.45 : 1)
            .on_click((_event, cx) => this.executing ? this.clear(cx) : this.begin(cx))
            .child(this.busy ? this.closing ? 'Closing projects…' : 'Clearing…' : this.executing ? 'Retry' : 'Clear all Devkits data'))));
    return this.executing ? v_flex().size_full().items_center().justify_center().bg(t.canvas)
      .child(v_flex().w(620).h(500).child(content)) : content;
  }
}
