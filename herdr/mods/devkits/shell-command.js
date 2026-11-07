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

// Read only the literal quoting emitted by our Windows launchers; never run shell text.
function launcherWords(script, ansi = false) {
  const words = [], pattern = ansi ? /\$'((?:[^'\\]|\\(?:[\\'rn]|x22))*)'/y : /'((?:[^']|'')*)'/y;
  let offset = 0;
  while (offset < script.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(script);
    if (!match) return null;
    words.push(ansi ? match[1].replace(/\\(x22|[\\'rn])/g, (_all, escape) =>
      ({ x22: '"', r: '\r', n: '\n' })[escape] ?? escape) : match[1].replaceAll("''", "'"));
    offset = pattern.lastIndex;
    if (offset === script.length) break;
    if (script[offset] !== ' ') return null;
    offset++;
  }
  return words;
}

export function unwrapTerminalArgv(argv = []) {
  for (let depth = 0; depth < 4; depth++) {
    if (/(?:^|[/\\])(?:powershell|pwsh)(?:\.exe)?$/i.test(argv[0] || '')) {
      const command = argv.findIndex(arg => /^-command$/i.test(arg));
      const script = command >= 0 && command === argv.length - 2 && argv[command + 1];
      const words = typeof script === 'string' && script.startsWith('& ') && launcherWords(script.slice(2));
      if (!words || words[0] !== 'git' || words[2] !== 'alias.devkits-shell=!sh') break;
      argv = words;
    } else if (argv[0] === 'git' && argv[1] === '-c' && argv[2] === 'alias.devkits-shell=!sh'
        && argv[3] === 'devkits-shell' && argv[4] === '-c') {
      if (argv[5] === 'exec "$@"' && argv[6] === 'devkits-command') argv = argv.slice(7);
      else {
        const words = argv.length === 6 && argv[5]?.startsWith('exec ') && launcherWords(argv[5].slice(5), true);
        if (!words?.length) break;
        argv = words;
      }
    } else break;
  }
  return argv;
}
