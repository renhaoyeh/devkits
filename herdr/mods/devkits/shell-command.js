export const gitShellCommand = args => ['git', '-c', 'alias.devkits-shell=!sh', 'devkits-shell', ...args];

export function commandArgv(argv, platform) {
  if (platform !== 'windows' || !argv?.length ||
      !(argv[0] === 'env' || /(?:^|[/\\])(?:codex|claude)(?:\.exe|\.cmd)?$/i.test(argv[0]))) return argv;
  return gitShellCommand(['-c', 'exec "$@"', 'devkits-command', ...argv]);
}
