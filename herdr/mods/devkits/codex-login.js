import { div } from 'gpui-kit';
import { v_flex, h_flex, InputState, Input } from 'gpui-base';
import { WebSocket } from 'websocket';
import { appHome, exec, hc, readTextFile, writeTextFile, theme, closeOverlay, openOverlay } from 'herdr';
import { Button } from './components/button.js';

function accountName(name) {
  name = name.trim();
  if (!name || Array.from(name).length > 48 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) {
    throw new Error('Use 1–48 characters without control characters. Chinese and uppercase names are welcome.');
  }
  return name;
}

export function codexProfile(name, root, id) {
  name = accountName(name);
  if (!/^account-[a-zA-Z0-9]{12}$/.test(id || '')) throw new Error('Invalid Codex account ID.');
  const directory = `${root}/data/devkits/codex/${id}`;
  return { name, directory, key: `devkits-codex-${id}`, run: [
    'env', '-u', 'OPENAI_API_KEY', '-u', 'CODEX_API_KEY', '-u', 'CODEX_ACCESS_TOKEN',
    `CODEX_HOME=${directory}`, 'codex', '-c', 'cli_auth_credentials_store="file"',
  ] };
}

function hasAccountName(data, name) {
  return Object.values(data.programs || {}).some(program => program?.name === `Codex · ${name}`);
}

function programs(source) {
  const data = source === null ? {} : JSON.parse(source);
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      (data.programs !== undefined && (!data.programs || typeof data.programs !== 'object' || Array.isArray(data.programs)))) {
    throw new Error('Herdr programs.json must contain a programs object.');
  }
  return data;
}

export async function registerCodex(profile) {
  const path = `${appHome()}/programs.json`;
  const source = await readTextFile(path);
  const data = programs(source);
  if (Object.hasOwn(data.programs || {}, profile.key) || hasAccountName(data, profile.name)) {
    throw new Error('That account name is already in the agent menu. Choose another name.');
  }
  data.programs = { ...data.programs, [profile.key]: {
    name: `Codex · ${profile.name}`, icon: 'icons/codex.svg', tint: false,
    run: [...profile.run, '--no-daemon'],
  } };
  // Compare-and-swap keeps concurrent settings edits from being overwritten.
  await writeTextFile(path, `${JSON.stringify(data, null, 2)}\n`, source);
}

export async function removeCodexAccount(key) {
  const id = /^devkits-codex-([a-zA-Z0-9][a-zA-Z0-9_-]{0,47})$/.exec(key)?.[1];
  if (!id) throw new Error('Only Devkits Codex accounts can be removed.');
  const path = `${appHome()}/programs.json`;
  const data = programs(await readTextFile(path));
  const entry = data.programs?.[key];
  const home = `CODEX_HOME=${appHome()}/data/devkits/codex/${id}`;
  if (!Array.isArray(entry?.run) || !entry.run.includes(home)) {
    throw new Error('This account does not use its own Devkits credentials directory. Nothing was changed.');
  }
  if (Object.entries(data.programs).some(([other, value]) => other !== key && Array.isArray(value?.run) && value.run.includes(home))) {
    throw new Error('Another entry shares this account’s credentials. Nothing was changed.');
  }
  const result = await exec('env', ['-u', 'OPENAI_API_KEY', '-u', 'CODEX_API_KEY', '-u', 'CODEX_ACCESS_TOKEN',
    home, 'codex', '-c', 'cli_auth_credentials_store="file"', 'logout']);
  if (result.code !== 0) throw new Error('Could not sign out. The account entry was kept.');
  try {
    const source = await readTextFile(path);
    const latest = programs(source);
    if (!Object.hasOwn(latest.programs || {}, key)) return;
    if (JSON.stringify(latest.programs[key]) !== JSON.stringify(entry)) throw new Error('Account settings changed.');
    delete latest.programs[key];
    await writeTextFile(path, `${JSON.stringify(latest, null, 2)}\n`, source);
  } catch {
    throw new Error('Signed out, but could not remove the account entry. Reload Manage and retry.');
  }
}

export default class CodexLogin {
  init(target, cx) {
    this.target = target;
    this.phase = 'name';
    this.input = InputState.new({ placeholder: 'e.g. 工作帳號 or Personal' });
    this.input.on('submit', (_event, cx) => this.start(cx));
    this.handle = cx.focus_handle();
    this.input.focus();
  }

  async request(method, params) {
    const id = ++this.nextId;
    await this.socket.write(JSON.stringify({ id, method, params }));
    for (;;) {
      const message = JSON.parse(await this.socket.read());
      if (message.id === id) {
        if (message.error) throw new Error(message.error.message || 'Codex could not complete this request.');
        return message.result;
      }
      if (message.method === 'account/login/completed') this.completed.push(message.params);
    }
  }

  async stop() {
    this.stopped = true;
    this.timeout?.cancel();
    const terminal = this.terminal;
    const socket = this.socket;
    this.terminal = null;
    this.socket = null;
    await Promise.allSettled([
      ...(terminal ? [hc(['kill', terminal])] : []),
      ...(socket ? [socket.close()] : []),
    ]);
  }

  async close() {
    this.closed = true;
    await this.stop();
  }

  armTimeout(cx, ms) {
    this.timeout?.cancel();
    this.timeout = cx.timer.after(ms, cx => {
      this.error = 'Sign-in timed out. Please try again.';
      this.phase = 'error';
      cx.spawn(async cx => { await this.stop(); cx.notify(); });
    });
  }

  start(cx) {
    if (this.busy || this.phase === 'success') return;
    let name;
    try { name = accountName(this.input.value()); }
    catch (error) { this.error = error.message; cx.notify(); return; }
    this.busy = true;
    this.stopped = false;
    this.error = null;
    this.authUrl = null;
    this.phase = 'connecting';
    this.nextId = 0;
    this.completed = [];
    this.armTimeout(cx, 20000);
    cx.spawn(async cx => {
      try {
        const current = programs(await readTextFile(`${appHome()}/programs.json`));
        if (this.closed || this.stopped) return;
        if (hasAccountName(current, name)) throw new Error('That account name is already in the agent menu. Choose another name.');
        if (!this.profile) {
          const root = appHome();
          const parent = `${root}/data/devkits/codex`;
          const created = await exec('mkdir', ['-p', '-m', '700', parent]);
          if (created.code !== 0) throw new Error('Could not create the account directory.');
          if (this.closed || this.stopped) return;
          // Atomically allocate an ID so even case-insensitive filesystems keep accounts separate.
          const allocated = await exec('mktemp', ['-d', `${parent}/account-XXXXXXXXXXXX`]);
          if (allocated.code !== 0) throw new Error('Could not create the account directory.');
          const directory = allocated.stdout.trim();
          const profile = codexProfile(name, root, directory.slice(parent.length + 1));
          if (profile.directory !== directory) throw new Error('Invalid Codex account directory.');
          this.profile = profile;
        }
        const profile = this.profile;
        profile.name = name;
        if (this.closed || this.stopped) return;
        const started = await hc(['run', '--json', '--bg', '--rm', '--no-parent', '--no-notify', '--cwd', profile.directory,
          '--', ...profile.run, 'app-server', '--listen', 'ws://127.0.0.1:0']);
        if (started.code !== 0) throw new Error('Could not start Codex. Make sure Codex CLI is installed.');
        this.terminal = JSON.parse(started.stdout).address;
        if (!this.terminal) throw new Error('Codex did not return a background process.');
        if (this.closed || this.stopped) return;
        let endpoint;
        for (let attempt = 0; attempt < 50 && !this.closed && !this.stopped; attempt++) {
          const output = await hc(['read', this.terminal, '--lines', '20']);
          if (output.code !== 0) throw new Error('Codex stopped before sign-in could start. Check your Codex CLI installation.');
          endpoint = output.stdout.match(/listening on: (ws:\/\/127\.0\.0\.1:\d+)/)?.[1];
          if (endpoint) break;
          await cx.sleep(100);
        }
        if (this.closed || this.stopped) return;
        if (!endpoint) throw new Error('Codex did not become ready. Please try again.');
        this.socket = await WebSocket.connect(endpoint);
        if (this.closed || this.stopped) return;
        await this.request('initialize', { clientInfo: { name: 'devkits_herdr', title: 'Devkits', version: '0.1.0' } });
        await this.socket.write(JSON.stringify({ method: 'initialized' }));
        let { account } = await this.request('account/read', { refreshToken: true });
        if (account?.type !== 'chatgpt') {
          const login = await this.request('account/login/start', { type: 'chatgpt' });
          if (login.type !== 'chatgpt' || !login.loginId || !/^https:\/\/(auth\.openai\.com|chatgpt\.com)\//.test(login.authUrl || '')) {
            throw new Error('Codex returned an invalid sign-in response.');
          }
          this.authUrl = login.authUrl;
          this.phase = 'waiting';
          this.armTimeout(cx, 600000);
          cx.notify();
          this.openBrowser(cx);
          for (;;) {
            const completed = this.completed.find(event => event.loginId === login.loginId);
            if (completed) {
              if (!completed.success) throw new Error(completed.error || 'Sign-in was cancelled. Please try again.');
              break;
            }
            const message = JSON.parse(await this.socket.read());
            if (message.method === 'account/login/completed') this.completed.push(message.params);
          }
          ({ account } = await this.request('account/read', { refreshToken: true }));
        }
        if (this.closed || this.stopped) return;
        if (this.error) throw new Error(this.error);
        if (account?.type !== 'chatgpt') throw new Error('Codex could not confirm your ChatGPT account. Please try again.');
        this.phase = 'saving';
        this.armTimeout(cx, 20000);
        cx.notify();
        await registerCodex(profile);
        this.phase = 'success';
        this.email = account.email || profile.name;
      } catch (error) {
        if (!this.closed) { this.error = this.error || error.message; this.phase = 'error'; }
      } finally {
        await this.stop();
        this.busy = false;
        if (!this.closed) cx.notify();
      }
    });
    cx.notify();
  }

  openBrowser(cx) {
    if (!this.authUrl) return;
    cx.open_url(this.authUrl);
  }

  finish() {
    closeOverlay(this.target.overlay);
    if (this.target.returnTo) openOverlay({ mod: 'devkits', kind: 'dialog', modal: true, width: 680, height: 0.8,
      props: this.target.returnTo });
  }

  render() {
    const t = theme();
    const action = (id, label, handler, primary = false) => Button(id, t, { variant: primary ? 'default' : 'outline' })
      .on_click(handler).child(label);
    return v_flex().id('codex-login-dialog').size_full().p(24).gap(16).bg(t.popover).text_color(t.foreground).role('dialog')
      .track_focus(this.handle).on_key_down((event, cx) => {
        if (event.key === 'escape') { cx.stop_propagation(); this.finish(); }
        else if (event.key === 'enter' && this.phase === 'success') { cx.stop_propagation(); this.finish(); }
        else if (event.key === 'enter' && this.phase === 'waiting') { cx.stop_propagation(); this.openBrowser(cx); }
      })
      .child(v_flex().gap(6)
        .child(div().text_size(16).font_semibold().child(this.phase === 'success' ? 'Codex account connected' : 'Add Codex account'))
        .child(div().text_size(13).text_color(t.muted).child(this.phase === 'success'
          ? `${this.email} is ready in your agent menu.` : 'Connect a ChatGPT account to use with Codex.')))
      .child(v_flex().flex_1().min_h(0).gap(10)
        .when(!this.busy && this.phase !== 'success', el => el
          .child(div().text_size(12).font_medium().child('Account name'))
          .child(Input.new(this.input).id('codex-account-name').h(36).px(10).rounded(6).border(1).border_color(t.input).text_size(13))
          .child(div().text_size(12).text_color(t.muted).child('A display name. Chinese and uppercase names are welcome.')))
        .when(this.busy, el => el.child(div().text_size(13).text_color(t.muted).child(
          this.phase === 'waiting' ? 'Finish signing in in your browser. This window will update automatically.'
            : this.phase === 'saving' ? 'Adding your account to the agent menu…' : 'Preparing Codex sign-in…')))
        .when(Boolean(this.error), el => el.child(div().id('codex-login-error').text_size(12).text_color(t.destructive || t.foreground).child(this.error))))
      .child(h_flex().gap(8).justify_end()
        .when(this.phase === 'success', el => el.child(action('codex-login-done', 'Back to Manage', () => this.finish(), true)))
        .when(this.phase !== 'success', el => el
          .child(action('codex-login-cancel', 'Cancel', () => this.finish()))
          .when(this.phase === 'waiting', el => el.child(action('codex-login-browser', 'Open browser', (_event, cx) => {
            this.openBrowser(cx);
          }, true)))
          .when(!this.busy, el => el.child(action('codex-login-start', this.phase === 'error' ? 'Try again' : 'Continue with ChatGPT', (_event, cx) => this.start(cx), true)))));
  }
}
