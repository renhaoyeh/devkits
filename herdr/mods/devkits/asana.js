import { div } from 'gpui-kit';
import { v_flex, h_flex, InputState, Input } from 'gpui-base';
import { appHome, readTextFile, writeTextFile } from 'herdr';
import { Button } from './components/button.js';
import { DialogContent, DialogTitle, DialogDescription, DialogFooter } from './components/dialog.js';
import { DropdownMenuItem, DropdownMenuLabel } from './components/dropdown-menu.js';

const api = 'https://app.asana.com/api/1.0';
const tokenPath = () => `${appHome()}/data/devkits/asana.json`;
const noteLimit = 4000;

async function asanaGet(token, path, request = fetch) {
  const response = await request(`${api}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  let body = null;
  try { body = await response.json(); } catch {}
  if (response.status === 401) throw Object.assign(new Error('Asana rejected this token. Enter a new personal access token.'), { unauthorized: true });
  if (!response.ok) throw new Error(body?.errors?.[0]?.message || `Asana returned ${response.status}.`);
  return body?.data || [];
}

// Asana is the source of truth: Devkits reads open tasks assigned to you and never writes back.
export async function assignedTasks(token, request = fetch) {
  const me = await asanaGet(token, '/users/me?opt_fields=workspaces.name', request);
  const lists = await Promise.all((me.workspaces || []).map(workspace => asanaGet(token,
    `/tasks?assignee=me&workspace=${workspace.gid}&completed_since=now&limit=100&opt_fields=name,notes,permalink_url,due_on,projects.name`, request)
    .then(tasks => tasks.map(task => ({ gid: task.gid, name: task.name || 'Untitled task', notes: task.notes || '',
      url: task.permalink_url || '', due: task.due_on || null,
      project: task.projects?.map(project => project.name).filter(Boolean).join(', ') || workspace.name })))));
  return lists.flat().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.name.localeCompare(b.name));
}

export const filterTasks = (tasks, query) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return tasks.filter(task => words.every(word => `${task.name} ${task.project}`.toLowerCase().includes(word)));
};

export function taskPrompt(task) {
  const notes = task.notes.trim();
  return [`Work on this Asana task: ${task.name}`, task.url,
    notes && `Description:\n${notes.length > noteLimit ? `${notes.slice(0, noteLimit)}…` : notes}`].filter(Boolean).join('\n\n');
}

export async function readAsanaToken() {
  try { return JSON.parse(await readTextFile(tokenPath()) || 'null')?.token || null; } catch { return null; }
}

export async function saveAsanaToken(token) {
  const current = await readTextFile(tokenPath());
  await writeTextFile(tokenPath(), `${JSON.stringify({ token }, null, 2)}\n`, current);
}

export default class AsanaTasks {
  init(cx) {
    this.tasks = [];
    this.index = 0;
    this.task = null;
    this.search = InputState.new({ placeholder: 'Search tasks' });
    this.search.on('change', (_event, cx) => { this.index = 0; cx.notify(); });
    this.search.on('submit', (_event, cx) => { this.choose?.(this.index); cx.notify(); });
    this.tokenInput = InputState.new({ placeholder: 'Personal access token' });
    this.tokenInput.set_masked(true);
    this.tokenInput.on('submit', (_event, cx) => this.saveToken(cx));
    this.loading = true;
    cx.spawn(async cx => {
      this.token = await readAsanaToken();
      if (this.token) await this.load(cx); else { this.needsToken = true; this.loading = false; this.tokenInput.focus(); }
      cx.notify();
    });
  }

  async load(cx) {
    this.loading = true; this.error = null; cx.notify();
    try {
      this.tasks = await assignedTasks(this.token);
      this.needsToken = false;
      this.search.focus();
    } catch (error) {
      this.error = error.message;
      if (error.unauthorized) { this.needsToken = true; this.tokenInput.focus(); }
    }
    this.loading = false;
  }

  saveToken(cx) {
    const token = this.tokenInput.value().trim();
    if (!token || this.loading) return;
    cx.spawn(async cx => {
      try { await saveAsanaToken(token); this.token = token; await this.load(cx); }
      catch (error) { this.error = error.message; this.loading = false; }
      cx.notify();
    });
  }

  // `agents` are the visible Add session launchers; `start(agent, task)` opens the thread.
  render(t, agents, start, close, handle) {
    const tasks = this.task ? [] : filterTasks(this.tasks, this.search.value());
    const rows = this.task ? agents : tasks;
    const choose = index => {
      if (this.task) { if (agents[index]) start(agents[index], this.task); }
      else if (tasks[index]) { this.task = tasks[index]; this.index = 0; handle.focus(); }
    };
    this.choose = choose;
    return DialogContent('asana-tasks', t).accessibility_label('Start a session from an Asana task')
      .track_focus(handle).on_key_down((event, cx) => {
        if (event.key === 'escape') { if (this.task) { this.task = null; this.search.focus(); } else close(); }
        else if (event.key === 'enter') choose(this.index);
        else if (event.key === 'down' && rows.length) this.index = (this.index + 1) % rows.length;
        else if (event.key === 'up' && rows.length) this.index = (this.index + rows.length - 1) % rows.length;
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(DialogTitle().child(this.task ? this.task.name : 'Asana task'))
      .child(DialogDescription(t).child(this.task ? 'Choose who works on this task. The task name and description start the session.'
        : this.needsToken ? 'Paste a personal access token from the Asana developer console. It is saved only on this computer.'
          : 'Open tasks assigned to you.'))
      .when(this.needsToken && !this.task, el => el.child(Input.new(this.tokenInput).id('asana-token')
        .accessibility_label('Asana personal access token').h(36).px(10).rounded(0).border_b(1).border_color(t.input).text_size(13)))
      .when(!this.needsToken && !this.task, el => el.child(Input.new(this.search).id('asana-search')
        .accessibility_label('Search tasks').h(36).px(10).rounded(0).border_b(1).border_color(t.input).text_size(13)))
      .when(Boolean(this.error), el => el.child(div().id('asana-error').text_size(12).text_color(t.destructive || t.foreground).child(this.error)))
      .child(v_flex().id('asana-list').flex_1().min_h(0).overflow_y_scroll().gap(1)
        .when(Boolean(this.task), el => el.child(DropdownMenuLabel(t).child('START WITH')))
        .children(rows.map((row, index) => DropdownMenuItem(this.task ? `asana-agent-${row.key}` : `asana-task-${row.gid}`, t)
          .h(this.task ? 32 : 44).bg(this.index === index ? t.selected : t.popover)
          .on_hover((inside, cx) => { if (inside) { this.index = index; cx.notify(); } })
          .on_click((_event, cx) => { choose(index); cx.notify(); })
          .when(Boolean(this.task), el => el.child(div().flex_1().min_w(0).truncate().child(row.name)))
          .when(!this.task, el => el.child(v_flex().flex_1().min_w(0).gap(2)
            .child(div().truncate().child(row.name))
            .child(div().truncate().text_size(11).text_color(t.muted).child([row.project, row.due && `Due ${row.due}`].filter(Boolean).join(' · ')))))))
        .when(this.loading, el => el.child(div().p(8).text_size(12).text_color(t.muted).child('Loading tasks…')))
        .when(!this.loading && !this.needsToken && !this.task && !this.error && !tasks.length, el => el
          .child(div().p(8).text_size(12).text_color(t.muted).child(this.tasks.length ? 'No matching tasks.' : 'No open tasks assigned to you.')))
        .when(Boolean(this.task) && !agents.length, el => el.child(div().p(8).text_size(12).text_color(t.muted).child('No agents available.'))))
      .child(DialogFooter()
        .when(Boolean(this.task), el => el.child(Button('asana-back', t, { variant: 'outline' })
          .on_click((_event, cx) => { this.task = null; this.index = 0; this.search.focus(); cx.notify(); }).child('Back')))
        .when(!this.task && !this.needsToken, el => el.child(Button('asana-change-token', t, { variant: 'outline' })
          .on_click((_event, cx) => { this.needsToken = true; this.error = null; this.tokenInput.focus(); cx.notify(); }).child('Change token')))
        .when(this.needsToken && !this.task, el => el.child(Button('asana-save-token', t).disabled(Boolean(this.loading))
          .on_click((_event, cx) => this.saveToken(cx)).child('Connect')))
        .child(Button('asana-cancel', t, { variant: 'outline' }).on_click(close).child('Cancel')));
  }
}
