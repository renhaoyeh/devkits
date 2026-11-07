export const gitShellCommand = args => ['git', '-c', 'alias.devkits-shell=!sh', 'devkits-shell', ...args];

export function commandArgv(argv, platform) {
  if (platform !== 'windows' || !argv?.length ||
      !(argv[0] === 'env' || /(?:^|[/\\])(?:codex|claude)(?:\.exe|\.cmd)?$/i.test(argv[0]))) return argv;
  return gitShellCommand(['-c', 'exec "$@"', 'devkits-command', ...argv]);
}

export function terminalArgv(argv, platform) {
  const command = commandArgv(argv, platform);
  if (platform !== 'windows' || command?.[2] !== 'alias.devkits-shell=!sh') return command;
  // PowerShell 5.1 strips embedded double quotes; let Git's shell decode them instead.
  const escapes = { '\\': '\\\\', "'": "\\'", '"': '\\x22', '\r': '\\r', '\n': '\\n' };
  const script = command.map(arg => `$'${arg.replace(/[\\'"\r\n]/g, char => escapes[char])}'`).join(' ');
  return gitShellCommand(['-c', `exec ${script}`]);
}
