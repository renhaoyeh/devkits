import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { commandArgv, gitShellCommand } from '../mods/devkits/shell-command.js';

test('Windows account and CLI commands use Git shell, preserving arguments and existing wrappers', () => {
  for (const command of ['env', 'codex', 'claude', 'C:\\Program Files\\Codex\\codex.exe', 'C:/bin/claude.cmd']) {
    const argv = [command, 'literal $(x) & 中文'];
    const wrapped = commandArgv(argv, 'windows');
    assert.deepEqual(wrapped, gitShellCommand(['-c', 'exec "$@"', 'devkits-command', ...argv]));
    assert.equal(commandArgv(wrapped, 'windows'), wrapped);
    assert.equal(commandArgv(argv, 'macos'), argv);
    assert.equal(commandArgv(argv, 'linux'), argv);
  }
  const terminal = ['powershell.exe'];
  assert.equal(commandArgv(terminal, 'windows'), terminal);
  assert.equal(commandArgv(undefined, 'windows'), undefined);
});

test('Windows legacy env launchers isolate variables and preserve native paths and prompt text', async () => {
  const literal = "中文 ' $(echo INJECTED) & %PATH% \"quoted\"\nsecond line";
  const home = "C:\\Users\\測試 ' $(x)\\App Data\\account";
  const [command, ...args] = commandArgv(['env', '-u', 'DEVKITS_TEST_SECRET', `CODEX_HOME=${home}`,
    process.execPath, '-e', 'console.log(JSON.stringify({ args: process.argv.slice(1), home: process.env.CODEX_HOME, secret: process.env.DEVKITS_TEST_SECRET }))',
    '--', literal], 'windows');
  const { stdout } = await promisify(execFile)(command, args, { env: { ...process.env, DEVKITS_TEST_SECRET: 'inherited' } });
  assert.deepEqual(JSON.parse(stdout), { args: [literal], home });
});
