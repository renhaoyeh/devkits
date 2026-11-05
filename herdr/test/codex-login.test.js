import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function load(host = {}) {
  const source = await readFile(new URL('../mods/devkits/codex-login.js', import.meta.url), 'utf8');
  const factory = new Function('View', ...Object.keys(host), source.replace(/^import .*;\n/gm, '')
    .replace('export default class', 'class').replace(/^export /gm, '') + '\nreturn { CodexLogin, codexProfile, registerCodex, removeCodexAccount };');
  return factory(class {}, ...Object.values(host));
}

const profileId = 'account-000000000001';

test('removing an account signs out only its owned credentials and merges concurrent unrelated settings', async () => {
  for (const id of [profileId, 'Legacy']) {
    const key = `devkits-codex-${id}`, calls = [], writes = [];
    const entry = { name: 'Codex · Work', run: ['env', `CODEX_HOME=/root/data/devkits/codex/${id}`, 'codex'] };
    let source = JSON.stringify({ programs: { [key]: entry, keep: { name: 'Keep me' } } });
    const { removeCodexAccount } = await load({ appHome: () => '/root', readTextFile: async () => source,
      exec: async (command, args) => {
        calls.push([command, args]);
        source = JSON.stringify({ ...JSON.parse(source), shells: ['fish'] });
        return { code: 0 };
      }, writeTextFile: async (path, next, expected) => {
        assert.equal(path, '/root/programs.json'); assert.equal(expected, source); writes.push(JSON.parse(next));
      } });
    await removeCodexAccount(key);
    assert.deepEqual(calls, [['env', ['-u', 'OPENAI_API_KEY', '-u', 'CODEX_API_KEY', '-u', 'CODEX_ACCESS_TOKEN',
      `CODEX_HOME=/root/data/devkits/codex/${id}`, 'codex', '-c', 'cli_auth_credentials_store="file"', 'logout']]]);
    assert.deepEqual(writes, [{ programs: { keep: { name: 'Keep me' } }, shells: ['fish'] }]);
  }
});

test('removal refuses built-ins, path traversal, external or shared credentials, and invalid settings before logout', async () => {
  const home = `CODEX_HOME=/root/data/devkits/codex/${profileId}`;
  const key = `devkits-codex-${profileId}`;
  for (const [target, source] of [['codex', '{}'], ['devkits-codex-../other', '{}'],
    [key, '[]'], [key, '{}'], [key, JSON.stringify({ programs: { [key]: { run: ['CODEX_HOME=/root/.codex'] } } })],
    [key, JSON.stringify({ programs: { [key]: { run: [home] }, another: { run: [home] } } })]]) {
    const { removeCodexAccount } = await load({ appHome: () => '/root', readTextFile: async () => source,
      exec: async () => assert.fail('must not log out'), writeTextFile: async () => assert.fail('must not write') });
    await assert.rejects(removeCodexAccount(target));
  }
});

test('logout failures keep the account; changed entries or failed atomic writes report partial sign-out', async () => {
  const key = `devkits-codex-${profileId}`;
  for (const failure of ['logout', 'entry-changed', 'write']) {
    let source = JSON.stringify({ programs: { [key]: { name: 'Work', run: [`CODEX_HOME=/root/data/devkits/codex/${profileId}`] } } });
    const { removeCodexAccount } = await load({ appHome: () => '/root', readTextFile: async () => source,
      exec: async () => {
        if (failure === 'entry-changed') source = source.replace('Work', 'Changed');
        return { code: failure === 'logout' ? 1 : 0 };
      }, writeTextFile: async () => {
        assert.equal(failure, 'write'); throw Error('stale snapshot');
      } });
    await assert.rejects(removeCodexAccount(key), failure === 'logout' ? /Could not sign out/ : /Signed out, but could not remove/);
    assert.ok(JSON.parse(source).programs[key]);
  }
});

test('finishing, cancelling, or escaping account sign-in returns to the large Manage dialog', async () => {
  const actions = {}, closed = [], overlays = [];
  const element = id => {
    const el = new Proxy({}, { get(_target, key) {
      if (key === 'when') return (condition, render) => { if (condition) render(el); return el; };
      if (key === 'on_key_down') return handler => { actions.keyDown = handler; return el; };
      if (key === 'on_click') return handler => { actions[id] = handler; return el; };
      return () => el;
    } });
    return el;
  };
  const { CodexLogin } = await load({ div: element, v_flex: element, h_flex: element,
    Input: { new: element }, theme: () => ({}),
    Button: id => element(id),
    closeOverlay: id => closed.push(id), openOverlay: spec => overlays.push(spec) });
  const view = new CodexLogin();
  view.target = { overlay: 'login', returnTo: { view: 'manage-launchers', space: 'api' } };
  view.phase = 'name'; view.render();
  actions['codex-login-cancel']();
  actions.keyDown({ key: 'escape' }, { stop_propagation() {} });
  view.phase = 'success'; view.render(); actions['codex-login-done']();
  assert.deepEqual(closed, ['login', 'login', 'login']);
  assert.equal(overlays.length, 3);
  for (const spec of overlays) {
    assert.deepEqual(spec, { mod: 'devkits', kind: 'dialog', modal: true, width: 680, height: 0.8,
      props: { view: 'manage-launchers', space: 'api' } });
  }
});

async function scenario({ success = true, confirm = true, existing = false, failure, beforeStartReply = false,
  name = 'work', initialPrograms = {}, failSaveOnce = false } = {}) {
  const commands = [], messages = [], writes = [], queue = [], timers = [];
  const root = '/Users/test/App Home';
  let source = JSON.stringify({ shells: ['fish'], programs: { existing: { name: 'Keep me' }, ...initialPrograms } });
  let inputName = name, saveFailed = false;
  let account = existing ? { type: 'chatgpt', email: 'test@example.com' } : null;
  const socket = {
    async write(text) {
      const message = JSON.parse(text); messages.push(message);
      if (!message.id) return;
      let result = {};
      if (message.method === 'account/read') result = { account };
      if (message.method === 'account/login/start') {
        result = { type: 'chatgpt', loginId: 'login-1', authUrl: 'https://auth.openai.com/authorize?test=1' };
        const notification = { method: 'account/login/completed', params: { loginId: 'login-1', success, error: success ? null : 'Login rejected' } };
        if (beforeStartReply) queue.push(notification);
        else queue.push({ id: message.id, result });
        queue.push({ method: 'account/login/completed', params: { loginId: 'unrelated', success: false } });
        if (!beforeStartReply) queue.push(notification);
        account = success && confirm ? { type: 'chatgpt', email: 'test@example.com' } : null;
        if (!beforeStartReply) return;
      }
      queue.push({ id: message.id, result });
    },
    async read() {
      const next = queue.shift();
      assert.ok(next, 'unexpected protocol read');
      return JSON.stringify(next);
    },
    async close() { commands.push(['socket.close']); },
  };
  let task;
  const cx = { notify() {}, focus_handle: () => ({}), sleep: async () => {}, open_url: url => commands.push(['open', [url]]),
    timer: { after(ms, handler) { const timer = { ms, handler, cancel() { this.cancelled = true; } }; timers.push(timer); return timer; } },
    spawn(fn) { task = fn(cx); } };
  const api = await load({ appHome: () => root,
    InputState: { new: () => ({ value: () => inputName, on() {}, focus() {} }) },
    exec: async (...args) => {
      commands.push(args);
      return { code: 0, stdout: args[0] === 'mktemp' ? `${root}/data/devkits/codex/${profileId}\n` : '' };
    },
    hc: async args => {
      commands.push(['hc', args]);
      if (failure === args[0]) return { code: 1, stdout: '' };
      return { code: 0, stdout: args[0] === 'run' ? '{"address":"t-test"}' : args[0] === 'read'
        ? 'listening on: ws://127.0.0.1:12345' : '{}' };
    },
    WebSocket: { connect: async endpoint => { assert.equal(endpoint, 'ws://127.0.0.1:12345'); return socket; } },
    readTextFile: async () => source,
    writeTextFile: async (path, next, expected) => {
      assert.equal(expected, source);
      if (failSaveOnce && !saveFailed) { saveFailed = true; throw Error('stale snapshot'); }
      writes.push([path, next]); source = next;
    },
  });
  const view = new api.CodexLogin(); view.init({ overlay: 'login-dialog' }, cx);
  view.start(cx); view.start(cx); await task;
  return { ...api, view, commands, messages, writes, timers, get source() { return JSON.parse(source); },
    async retry(nextName = inputName) { inputName = nextName; view.start(cx); await task; } };
}

test('Chinese and uppercase labels are separate from validated internal IDs and command arguments', async () => {
  const { codexProfile } = await load();
  for (const name of ['', '   ', 'a\nb', 'a\u0000b', 'a'.repeat(49)]) {
    assert.throws(() => codexProfile(name, '/root', profileId), /Use 1–48/);
  }
  for (const name of [' 工作帳號 ', 'PERSONAL', 'Work / 工作', '../work', '$(id)', '工作'.repeat(24)]) {
    const profile = codexProfile(name, '/Root With Spaces', profileId);
    assert.equal(profile.name, name.trim());
    assert.equal(profile.directory, `/Root With Spaces/data/devkits/codex/${profileId}`);
    assert.ok(profile.run.includes(`CODEX_HOME=${profile.directory}`));
    assert.ok(!profile.run.includes(name.trim()));
  }
  for (const id of [undefined, '../work', 'Work', 'account-../../etc', 'account-000000000001/extra']) {
    assert.throws(() => codexProfile('工作', '/root', id), /Invalid Codex account ID/);
  }
  const upper = codexProfile('Work', '/root', profileId);
  const lower = codexProfile('work', '/root', 'account-000000000002');
  assert.notEqual(upper.directory.toLowerCase(), lower.directory.toLowerCase());
  assert.notEqual(upper.key, lower.key);
});

test('successful browser sign-in confirms account, preserves settings, and cleans up the private server', async () => {
  const result = await scenario();
  assert.equal(result.view.phase, 'success');
  assert.equal(result.view.busy, false);
  assert.equal(result.writes.length, 1);
  assert.deepEqual(result.source.shells, ['fish']);
  assert.deepEqual(result.source.programs.existing, { name: 'Keep me' });
  const entry = result.source.programs[`devkits-codex-${profileId}`];
  assert.equal(entry.name, 'Codex · work');
  assert.equal(entry.run.at(-1), '--no-daemon');
  assert.ok(result.commands.some(([command, args]) => command === 'open' && args[0].startsWith('https://auth.openai.com/')));
  assert.ok(result.commands.some(([command, args]) => command === 'hc' && args[0] === 'kill' && args[1] === 't-test'));
  assert.ok(result.commands.some(([command]) => command === 'socket.close'));
  assert.ok(result.timers.every(timer => timer.cancelled));
});

test('completion arriving before login-start response is retained', async () => {
  const { view, writes } = await scenario({ beforeStartReply: true });
  assert.equal(view.phase, 'success');
  assert.equal(writes.length, 1);
});

test('rejected or unconfirmed login never registers an account', async () => {
  for (const options of [{ success: false }, { confirm: false }, { failure: 'run' }, { failure: 'read' }]) {
    const { view, writes } = await scenario(options);
    assert.equal(view.phase, 'error');
    assert.ok(view.error);
    assert.equal(writes.length, 0);
    assert.equal(view.busy, false);
  }
});

test('a previously authenticated directory can retry registration without another browser login', async () => {
  const { view, messages } = await scenario({ existing: true });
  assert.equal(view.phase, 'success');
  assert.ok(!messages.some(message => message.method === 'account/login/start'));
});

test('duplicate names, invalid settings, and concurrent settings edits are never overwritten', async () => {
  for (const source of ['[]', '{"programs":[]}',
    '{"programs":{"devkits-codex-work":{"name":"Codex · work"}}}',
    `{"programs":{"devkits-codex-${profileId}":{}}}`]) {
    const api = await load({ appHome: () => '/root', readTextFile: async () => source,
      writeTextFile: async () => assert.fail('must not write') });
    await assert.rejects(api.registerCodex(api.codexProfile('work', '/root', profileId)));
  }
  const api = await load({ appHome: () => '/root', readTextFile: async () => '{"shells":["fish"]}',
    writeTextFile: async (_path, _next, expected) => {
      assert.equal(expected, '{"shells":["fish"]}'); throw Error('stale snapshot');
    } });
  await assert.rejects(api.registerCodex(api.codexProfile('work', '/root', profileId)), /stale snapshot/);
});

test('retrying with a different display name keeps the same identity and credentials directory', async () => {
  const result = await scenario({ name: '工作帳號', failSaveOnce: true });
  assert.equal(result.view.phase, 'error');
  const original = { ...result.view.profile };
  await result.retry('PERSONAL');
  assert.equal(result.view.phase, 'success');
  assert.equal(result.view.profile.directory, original.directory);
  assert.equal(result.view.profile.key, original.key);
  assert.equal(result.commands.filter(([command]) => command === 'mktemp').length, 1);
  assert.equal(result.messages.filter(message => message.method === 'account/login/start').length, 1);
  assert.equal(result.source.programs[original.key].name, 'Codex · PERSONAL');
});

test('adding a Unicode account preserves legacy profile paths and rejects existing display labels', async () => {
  const legacy = { name: 'Codex · Legacy', run: ['env', 'CODEX_HOME=/old/profile/path', 'codex'] };
  const result = await scenario({ name: '工作帳號', initialPrograms: { 'devkits-codex-Legacy': legacy } });
  assert.equal(result.view.phase, 'success');
  assert.deepEqual(result.source.programs['devkits-codex-Legacy'], legacy);
  assert.equal(result.source.programs[`devkits-codex-${profileId}`].name, 'Codex · 工作帳號');
  const duplicate = await scenario({ name: 'Legacy', initialPrograms: { 'devkits-codex-Legacy': legacy } });
  assert.equal(duplicate.view.phase, 'error');
  assert.equal(duplicate.commands.length, 0);
  assert.equal(duplicate.writes.length, 0);
});

test('closing the login view ends only its own process and never removes credentials', async () => {
  const commands = [];
  const { CodexLogin } = await load({ hc: async args => commands.push(args) });
  const view = new CodexLogin();
  view.terminal = 'own-login'; view.socket = { close: async () => commands.push(['socket.close']) };
  await view.close(); await view.close();
  assert.equal(view.closed, true);
  assert.deepEqual(commands, [['kill', 'own-login'], ['socket.close']]);
});

test('a timeout during directory creation does not launch Codex afterward', async () => {
  let timeout, task, release;
  const cx = { notify() {}, focus_handle: () => ({}),
    timer: { after(_ms, handler) { timeout = handler; return { cancel() {} }; } },
    spawn(fn) { const pending = fn(cx); task ||= pending; return pending; } };
  const { CodexLogin } = await load({ appHome: () => '/root', readTextFile: async () => null,
    InputState: { new: () => ({ value: () => 'work', on() {}, focus() {} }) },
    exec: async () => new Promise(resolve => { release = resolve; }),
    hc: async () => assert.fail('must not start a process after timeout') });
  const view = new CodexLogin(); view.init({}, cx); view.start(cx);
  await Promise.resolve(); await Promise.resolve();
  timeout(cx); release({ code: 0 }); await task;
  assert.equal(view.phase, 'error');
  assert.match(view.error, /timed out/);
  assert.equal(view.busy, false);
});
