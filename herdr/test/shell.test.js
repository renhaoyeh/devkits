import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

async function load(exec) {
  const source = await readFile(new URL('../mods/devkits/shell.js', import.meta.url), 'utf8');
  const command = await readFile(new URL('../mods/devkits/components/session-shell.js', import.meta.url), 'utf8');
  return new Function('exec', (command + '\n' + source).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')
    + '\nreturn execShell;')(exec);
}

test('shell fallback is per machine and never retries a command that exited', async () => {
  const calls = [], result = { code: 1, stdout: '', stderr: 'operation failed' };
  const execShell = await load(async (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (cmd === 'sh' && !options.on) throw Error('cannot run sh: program not found');
    return result;
  });
  const args = ['-c', 'exit 1', 'devkits-test', "中文 ' $(literal) &"];
  assert.equal(await execShell(args), result);
  assert.equal(await execShell(args), result);
  assert.equal(await execShell(args, { on: 'mac' }), result);
  assert.deepEqual(calls.map(call => call.cmd), ['sh', 'git', 'git', 'sh']);
  assert.deepEqual(calls[1].args, ['-c', 'alias.devkits-shell=!sh', 'devkits-shell', ...args]);
  assert.deepEqual(calls[3].options, { on: 'mac' });
  const unavailable = await load(async () => { throw Error('machine unavailable'); });
  await assert.rejects(unavailable(args, { on: 'offline' }), /machine unavailable/);
});

test('Git shell fallback preserves native paths, arguments, Unix tools and exit codes', async t => {
  const folder = await mkdtemp(join(tmpdir(), "devkits shell 中文 ' $(literal) & "));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const run = promisify(execFile);
  const execShell = await load(async (cmd, args, options) => {
    assert.equal(options.on, 'windows');
    if (cmd === 'sh') throw Error('cannot run sh: program not found');
    try { const { stdout, stderr } = await run(cmd, args, { cwd: folder }); return { code: 0, stdout, stderr }; }
    catch (error) { if (typeof error.code !== 'number') throw error; return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
  });
  const literal = "中文 ' $(touch INJECTED) &";
  const result = await execShell(['-c', 'cd "$1" || exit 2; printf "%s\\n" "$2" | head -c 1000; '
    + 'printf "ok\\0" | xargs -0 printf "%s"; test ! -e INJECTED || exit 3; exit 7',
  'devkits-test', folder, literal], { on: 'windows' });
  assert.equal(result.code, 7);
  assert.equal(result.stdout, literal + '\nok');
});
