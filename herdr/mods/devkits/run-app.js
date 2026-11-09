import { div } from 'gpui-kit';
import { h_flex, v_flex, InputState, Input } from 'gpui-base';
import { exec, run, spaces, terminals, shared, setShared, props, notify, openOverlay, closeOverlay, readTextFile } from 'herdr';
import { DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from './components/dropdown-menu.js';
import { Button } from './components/button.js';
import { glyph } from './components/icon.js';

// Run (F5): each project runs the command chosen for it in the header's run menu (this computer
// only): a package.json script or a typed command. {udid} is the simulator chosen in the simulator
// panel, else the first booted one. The command names its project tab and runs in a login shell
// as in the user's terminals, which stays open afterwards for the output.
const RUNS = 'devkits.run-commands';
const RECENT_RUNS = 'devkits.run-history';
const RECENT_LIMIT = 10;
const RUN_SHELL = '"${SHELL:-/bin/zsh}" -lic "$1"; exec "${SHELL:-/bin/zsh}" -l';
const MENU_WIDTH = 320;

export const savedRun = folder => (folder && shared(RUNS)?.[folder]) || null;
const shownProject = () => spaces().find(s => s.active);

function recentRuns(folder) {
  const history = shared(RECENT_RUNS)?.[folder];
  const commands = Array.isArray(history) ? history : [];
  return [...new Set(commands.filter(command => typeof command === 'string' && command.trim()))].slice(0, RECENT_LIMIT);
}

function rememberRun(folder, command) {
  setShared(RECENT_RUNS, { ...(shared(RECENT_RUNS) || {}),
    [folder]: [command, ...recentRuns(folder).filter(recent => recent !== command)].slice(0, RECENT_LIMIT) });
}

// Match our launch wrapper, including when Herdr prepends its own login shell.
const isRunTerminal = terminal => {
  const argv = (terminal.argv || []).slice(-5);
  return argv.length === 5 && argv[0] === 'sh' && argv[1] === '-c' && argv[2] === RUN_SHELL && argv[3] === 'sh';
};

// package.json's scripts through the project's package manager.
export async function projectScripts(folder) {
  const text = await readTextFile(`${folder}/package.json`).catch(() => null);
  let pkg = null;
  try { pkg = text && JSON.parse(text); } catch {}
  const files = (await exec('ls', ['-A', folder]).catch(() => null))?.stdout?.split('\n') ?? [];
  const pm = /^(bun|pnpm|yarn|npm)@/.exec(pkg?.packageManager ?? '')?.[1]
    ?? (files.includes('bun.lock') || files.includes('bun.lockb') ? 'bun' : files.includes('pnpm-lock.yaml') ? 'pnpm'
      : files.includes('yarn.lock') ? 'yarn' : 'npm');
  return Object.keys(pkg?.scripts ?? {}).map(name => `${pm} run ${name}`);
}

// The simulator panel's choice, else the first booted simulator.
export async function simulatorId() {
  const chosen = shared('devkits.simulator-device');
  if (chosen) return chosen;
  const r = await exec('xcrun', ['simctl', 'list', 'devices', 'booted', '-j']).catch(() => null);
  if (r?.code !== 0) return null;
  return Object.values(JSON.parse(r.stdout).devices ?? {}).flat()[0]?.udid ?? null;
}

// In the shown project, replacing the previous run (and its dev server) so a second press starts over.
export async function runApp() {
  const space = shownProject();
  const warn = body => notify({ title: 'Run', body, level: 'warning' });
  if (!space?.folder || space.machine) return warn('Choose a project on this Mac first.');
  const template = savedRun(space.folder);
  if (!template) return warn(`Choose what ${space.name} runs from the run menu at the top.`);
  let command = template;
  if (template.includes('{udid}')) {
    const udid = await simulatorId();
    if (!udid) return warn('Choose a simulator in the simulator panel first.');
    command = template.replaceAll('{udid}', udid);
  }
  const previous = new Set(terminals().filter(terminal => terminal.labels?.['herdr.space'] === space.id && isRunTerminal(terminal))
    .map(terminal => terminal.labels?.['herdr.tab']));
  for (const tab of space.tabs.filter(tab => previous.has(tab.id))) run('tab.close', { id: tab.id });
  run('devkits.reveal-conversation');
  run('tab.new', { space: space.id, folder: space.folder, name: command, argv: ['sh', '-c', RUN_SHELL, 'sh', command] });
  rememberRun(space.folder, template);
}

// The header's run button, showing the command it runs, and the arrow that opens the run menu.
export function RunControls(t) {
  const space = shownProject(), saved = savedRun(space?.folder), local = Boolean(space?.folder) && !space?.machine;
  return h_flex().h_full().min_w(0).max_w('100%').items_center()
    .child(Button('run-project', t, { variant: 'ghost' }).flex_shrink(1).min_w(0).h_full().px(10).gap(6).rounded(0).max_w(280)
      .accessibility_label('Run').tooltip(saved ? `Run ${saved} (F5)` : 'Choose what this project runs')
      .when(!local, el => el.opacity(0.5))
      .on_click((_event, cx) => { if (saved) runApp(); else openMenu(cx, undefined, space); })
      .child(glyph('play', 12))
      .child(div().min_w(0).truncate().text_color(saved ? t.foreground : t.muted).child(saved || 'Run…')))
    .child(DropdownMenuTrigger(Button('run-menu', t, { variant: 'ghost', size: 'icon' }).h_full().w(24).rounded(0)
      .accessibility_label('Choose what runs').tooltip('Choose what runs').when(!local, el => el.opacity(0.5))
      .child(glyph('chevron-down', 12)), MENU_WIDTH, (cx, at) => openMenu(cx, at, space), 'end', { x: 0, y: 9 }));
}

function openMenu(_cx, at, space) {
  if (!space?.folder || space.machine) return;
  openOverlay({ mod: 'devkits', kind: 'popup', frame: 'none', width: MENU_WIDTH, ...(at ? { at } : {}),
    props: { view: 'run-menu', folder: space.folder, name: space.name } });
}

// Recent commands, package.json scripts, and a typed command for one project.
export class RunMenu {
  init(cx) {
    this.handle = cx.focus_handle(); this.handle.focus();
    this.folder = props().folder;
    this.scripts = null;
    this.input = InputState.new({ placeholder: 'Custom command; {udid} is the simulator' });
    this.input.on('submit', () => { const command = this.input.value().trim(); if (command) this.choose(command); });
    cx.spawn(async cx => {
      this.scripts = this.folder ? await projectScripts(this.folder).catch(() => []) : [];
      cx.notify();
    });
  }

  choose(command) {
    if (this.folder) {
      rememberRun(this.folder, command);
      setShared(RUNS, { ...(shared(RUNS) || {}), [this.folder]: command });
    }
    closeOverlay(props().overlay);
  }

  removeRecent(command) {
    setShared(RECENT_RUNS, { ...(shared(RECENT_RUNS) || {}),
      [this.folder]: recentRuns(this.folder).filter(recent => recent !== command) });
  }

  render(t) {
    const saved = savedRun(this.folder), recent = recentRuns(this.folder), scripts = this.scripts ?? [];
    const recentHeight = Math.min(160, recent.length * 32);
    const listHeight = Math.min(240, scripts.length * 32);
    const message = this.scripts == null ? 'Loading…' : !scripts.length ? 'No package.json scripts' : null;
    const height = 10 + 28 + (recent.length ? recentHeight : 30) + 9 + 28 + (message ? 30 : 0) + listHeight + 9 + 28 + 36;
    const row = (id, command) => DropdownMenuItem(id, t).on_click(() => this.choose(command))
      .child(div().flex_1().min_w(0).truncate().child(command))
      .when(saved === command, el => el.child(glyph('check')));
    return DropdownMenuContent('run-commands', height, t)
      .track_focus(this.handle)
      .on_key_down(event => { if (event.key === 'escape') closeOverlay(props().overlay); })
      .child(DropdownMenuLabel(t).child('RECENT'))
      .when(!recent.length, el => el.child(div().px(8).py(6).text_size(12).text_color(t.muted).child('No recent commands')))
      .when(recent.length > 0, el => el
        .child(v_flex().id('run-recent-list').h(recentHeight).flex_none().overflow_y_scrollbar()
          .when(recent.length * 32 > recentHeight, el => el.pr(12))
          .children(recent.map((command, i) => row(`run-recent-${i}`, command)
            .child(Button(`remove-run-recent-${i}`, t, { variant: 'row', size: 'icon-sm' }).size(24)
              .accessibility_label(`Remove ${command} from recent commands`)
              .on_click((_event, cx) => { cx.stop_propagation(); this.removeRecent(command); cx.notify(); })
              .child(glyph('close', 12)))))))
      .child(DropdownMenuSeparator(t))
      .child(DropdownMenuLabel(t).child('SCRIPTS'))
      .when(Boolean(message), el => el.child(div().px(8).py(6).text_size(12).text_color(t.muted).child(message)))
      .when(scripts.length > 0, el => el
        .child(v_flex().id('run-command-list').h(listHeight).flex_none().overflow_y_scrollbar()
          .when(scripts.length * 32 > listHeight, el => el.pr(12))
          .children(scripts.map((command, i) => row(`run-command-${i}`, command)))))
      .child(DropdownMenuSeparator(t))
      .child(DropdownMenuLabel(t).child('CUSTOM · ENTER TO USE'))
      .child(h_flex().h(36).flex_none().px(8).items_center()
        // The input element takes no flex sizing of its own, so a wrapper fills the row.
        .child(div().flex_1().min_w(0).child(Input.new(this.input).id('run-custom').accessibility_label('Custom run command')
          .h(28).px(6).rounded(0).border_b(1).border_color(t.input).text_size(12))));
  }
}
