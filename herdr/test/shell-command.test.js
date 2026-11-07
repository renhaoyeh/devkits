import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { commandArgv, gitShellCommand, terminalArgv, unwrapTerminalArgv } from '../mods/devkits/shell-command.js';

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

test('Windows launcher recognition recovers literal argv through PowerShell and nested Git shells', () => {
  for (const executable of ['codex', 'claude', 'C:\\Program Files\\Codex\\codex.cmd']) {
    const command = ['env', '-u', 'API_KEY', "CODEX_HOME=C:\\Users\\測試 ' work", executable,
      '--model', 'literal $(throw INJECTED) & `text` "quoted"\r\nsecond line', '', 'trailing\\'];
    const wrapped = terminalArgv(command, 'windows');
    const powershell = ['powershell.exe', '-NoExit', '-Command',
      '& ' + wrapped.map(arg => "'" + arg.replaceAll("'", "''") + "'").join(' ')];
    assert.deepEqual(unwrapTerminalArgv(commandArgv(command, 'windows')), command);
    assert.deepEqual(unwrapTerminalArgv(wrapped), command);
    assert.deepEqual(unwrapTerminalArgv(powershell), command);
    assert.deepEqual(unwrapTerminalArgv(['C:\\bin\\pwsh.exe', ...powershell.slice(1)]), command);
  }
  for (const argv of [[], ['powershell.exe'], ['powershell.exe', '-Command', "Write-Output 'codex'"],
    ['powershell.exe', '-Command', "& 'git' '-c' 'alias.devkits-shell=!sh'; codex"],
    gitShellCommand(['-c', "exec $'codex' ; echo injected"]),
    gitShellCommand(['-c', "exec $'codex\\q'"])]) {
    assert.equal(unwrapTerminalArgv(argv), argv);
  }
});

test('Windows terminal launches preserve arguments through legacy PowerShell', { skip: process.platform !== 'win32' }, async () => {
  const literal = 'developer_instructions="# Global rules\\n\\nThese rules use \\"quoted\\" text"';
  const home = "C:\\Users\\測試 ' $(throw INJECTED)\\App Data\\account";
  const prompts = [literal, "中文 ' $(throw INJECTED) & %PATH% `literal`\r\nsecond line", 'trailing\\', ''];
  const argv = ['env', '-u', 'DEVKITS_TEST_SECRET', `CODEX_HOME=${home}`, process.execPath, '-e',
    'console.log(JSON.stringify({ args: process.argv.slice(1), home: process.env.CODEX_HOME, secret: process.env.DEVKITS_TEST_SECRET }))', '--', ...prompts];
  for (const input of [argv, commandArgv(argv, 'windows')]) {
    const command = terminalArgv(input, 'windows');
    const script = '& ' + command.map(arg => "'" + arg.replaceAll("'", "''") + "'").join(' ');
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', script],
      { env: { ...process.env, DEVKITS_TEST_SECRET: 'inherited' } });
    assert.deepEqual(JSON.parse(stdout), { args: prompts, home });
  }
  assert.equal(terminalArgv(argv, 'macos'), argv);
  assert.equal(terminalArgv(argv, 'linux'), argv);
  const terminal = ['powershell.exe'];
  assert.equal(terminalArgv(terminal, 'windows'), terminal);
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
