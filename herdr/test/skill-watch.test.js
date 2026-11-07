import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { skillSnapshot } from '../mods/devkits/skill-snapshot.js';

test('snapshots detect skill additions, edits, removals and linked content, excluding system skills', async t => {
  const root = await mkdtemp(join(tmpdir(), 'devkits-skill-watch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await skillSnapshot(root), {});
  for (const dir of ['.agents/skills/寫作', '.codex/skills/.system', 'external/scripts']) await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, '.agents/skills/寫作/SKILL.md'), 'one');
  await writeFile(join(root, '.codex/skills/.system/SKILL.md'), 'system');
  await writeFile(join(root, 'external/SKILL.md'), 'linked');
  await symlink(join(root, 'external'), join(root, '.codex/skills/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const first = await skillSnapshot(root);
  assert.deepEqual(Object.keys(first), ['.agents/skills/寫作', '.codex/skills/linked']);
  assert.deepEqual(await skillSnapshot(root), first);
  await writeFile(join(root, '.codex/skills/.system/SKILL.md'), 'changed');
  assert.deepEqual(await skillSnapshot(root), first);
  await writeFile(join(root, '.agents/skills/寫作/SKILL.md'), 'two');
  await writeFile(join(root, 'external/scripts/run.js'), 'script');
  const edited = await skillSnapshot(root);
  for (const key of Object.keys(first)) assert.notEqual(edited[key], first[key]);
  await rm(join(root, '.agents/skills/寫作'), { recursive: true });
  assert.deepEqual(Object.keys(await skillSnapshot(root)), ['.codex/skills/linked']);
  await symlink(join(root, 'external'), join(root, 'external/scripts/cycle'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(Object.keys(await skillSnapshot(root)).length, 1);
});

async function actions(host) {
  const source = await readFile(new URL('../mods/devkits/account-actions.js', import.meta.url), 'utf8');
  return new Function(...Object.keys(host), source.replace(/^import .*;\n/gm, '').replace('export const', 'const') + '\nreturn accountActions;')(...Object.values(host));
}

function clock() {
  const tasks = [], scheduled = [];
  const timer = (ms, callback) => { const entry = { ms, callback, cancel() { this.cancelled = true; } }; scheduled.push(entry); return entry; };
  const cx = { notify() {}, focus_handle: () => ({ focus() {} }), timer: { after: timer, every: timer },
    spawn(fn) { const task = fn(cx); task.cancel = () => { task.cancelled = true; }; tasks.push(task); return task; } };
  return { cx, scheduled, tasks };
}

test('watch notifications deduplicate content, survive reloads, retain good data on failure and never sync', async () => {
  const memory = {}, notices = [], calls = [];
  let snapshot = { '.codex/skills/one': 'v1' }, fail = false;
  const api = await actions({ appHome: () => '/herdr', home: () => '/user',
    shared: key => memory[key], setShared: (key, value) => { memory[key] = value; }, notify: value => notices.push(value),
    exec: async (cmd, args) => { calls.push([cmd, args]); return { code: fail ? 1 : 0, stdout: JSON.stringify(fail ? { error: 'unreadable' } : snapshot) }; } });
  const view = { ...api }, { cx, tasks } = clock();
  const scan = async () => { view.checkSkills(cx); await tasks.at(-1); };
  await scan(); assert.equal(notices.length, 0);
  await scan(); assert.equal(notices.length, 0);
  snapshot = { '.codex/skills/one': 'v2', '.agents/skills/new': 'v1' };
  await scan(); assert.equal(notices.length, 1);
  assert.match(notices[0].body, /one, new/);
  fail = true; await scan(); assert.equal(notices.length, 1);
  assert.equal(memory['devkits.skill-snapshot']['.codex/skills/one'], 'v2');
  fail = false; snapshot = {};
  const reloaded = { ...api }; reloaded.checkSkills(cx); await tasks.at(-1);
  assert.equal(notices.length, 2);
  view.closeSkillWatch(); await scan(); assert.equal(notices.length, 2);
  assert.ok(calls.every(([cmd, args]) => cmd === 'node' && args.length === 1 && args[0].endsWith('/skill-snapshot.js')));
});

test('native events debounce and watchers/timers stop on close; missing watches retain polling', async () => {
  const waits = [];
  const api = await actions({ home: () => '/user', watchFolder: path => new Promise(resolve => waits.push({ path, resolve })) });
  let scans = 0;
  const view = { ...api, checkSkills() { scans++; } }, { cx, tasks, scheduled } = clock();
  view.initSkillWatch(cx);
  assert.equal(scans, 1); assert.equal(scheduled[0].ms, 30000);
  assert.deepEqual(waits.map(item => item.path), ['/user/.agents/skills', '/user/.codex/skills']);
  waits[0].resolve([]); await new Promise(resolve => setImmediate(resolve));
  waits[2].resolve([]); await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduled[1].cancelled, true);
  scheduled[2].callback(cx); assert.equal(scans, 2);
  view.closeSkillWatch();
  assert.ok(tasks.every(task => task.cancelled));
  assert.equal(scheduled[0].cancelled, true); assert.equal(scheduled[2].cancelled, true);
  for (const wait of waits) wait.resolve([]);
  await Promise.all(tasks);
  const missing = await actions({ home: () => '/user', watchFolder: async () => { throw Error('missing'); } });
  const fallback = { ...missing, checkSkills() { scans++; } }, c = clock();
  fallback.initSkillWatch(c.cx); await Promise.all(c.tasks);
  c.scheduled[0].callback(c.cx); assert.equal(scans, 4);
});

test('sharing refresh preserves in-progress choices, leaves additions unchecked and retries read failures', async () => {
  let fail = false, reads = 0;
  const api = await actions({ props: () => ({ agent: { key: 'devkits-codex-work' } }), appHome: () => '/herdr',
    exec: async (_cmd, args) => { reads++; assert.equal(args.at(-1), '--list'); return { code: fail ? 1 : 0,
      stdout: JSON.stringify(fail ? { error: 'read failed' } : { items: [
        { kind: 'skills', key: 'old', selected: true, status: 'synced' },
        { kind: 'skills', key: 'new', selected: false, status: 'not-shared' }] }) }; } });
  const view = { ...api, sharingItems: [{ kind: 'skills', key: 'old', selected: false }] }, c = clock();
  view.loadCodexSharing(c.cx); await c.tasks.at(-1);
  assert.ok(view.sharingItems.every(item => !item.selected));
  fail = true; view.loadCodexSharing(c.cx); await c.tasks.at(-1);
  assert.equal(view.sharingReadError, true); assert.equal(view.sharingItems.length, 2);
  fail = false; view.loadCodexSharing(c.cx); await c.tasks.at(-1);
  assert.equal(view.sharingReadError, false); assert.equal(view.sharingError, null);
  view.sharingBusy = true; view.loadCodexSharing(c.cx); assert.equal(reads, 3);
});

test('open sharing dialog refreshes on native events without waiting for polling and retains events during a read', async () => {
  const waits = [], replies = [];
  const api = await actions({ home: () => '/user', appHome: () => '/herdr',
    props: () => ({ agent: { key: 'devkits-codex-work' } }),
    watchFolder: path => new Promise(resolve => waits.push({ path, resolve })),
    exec: () => new Promise(resolve => replies.push(resolve)) });
  const view = { ...api }, c = clock();
  const result = label => ({ code: 0, stdout: JSON.stringify({ items: [{ kind: 'skills', key: 'one', selected: true, label }] }) });
  view.initCodexSharing(c.cx);
  assert.deepEqual(waits.map(item => item.path), ['/user/.codex/skills', '/user/.codex/plugins']);
  replies[0](result('initial')); await c.tasks[0];
  view.sharingItems[0].selected = false;
  waits[0].resolve(['/user/.codex/skills/one/SKILL.md']);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(c.scheduled.at(-1).ms, 1000);
  c.scheduled.at(-1).callback(c.cx);
  assert.equal(replies.length, 2, 'Native events refresh without firing the 30-second timer');
  waits[1].resolve(['/user/.codex/plugins/cache/team/one']);
  await new Promise(resolve => setImmediate(resolve));
  c.scheduled.at(-1).callback(c.cx);
  assert.equal(replies.length, 2, 'Concurrent reads coalesce');
  const reading = c.tasks.at(-1);
  replies[1](result('first update')); await reading;
  assert.equal(view.sharingItems[0].selected, false);
  assert.equal(c.scheduled.at(-1).ms, 1000);
  c.scheduled.at(-1).callback(c.cx);
  assert.equal(replies.length, 3, 'An event received while reading causes a follow-up refresh');
  const late = c.tasks.at(-1);
  view.closeSkillWatch();
  assert.ok(view.sharingWatchers.every(task => task.cancelled));
  assert.equal(view.sharingPoll.cancelled, true);
  assert.equal(view.sharingDebounce.cancelled, true);
  replies[2](result('closed')); await late;
  assert.equal(view.sharingItems[0].label, 'first update');
  for (const wait of waits) wait.resolve([]);
  await Promise.all(c.tasks);
});
