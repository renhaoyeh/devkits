import { div, svg } from 'gpui-kit';
import { v_flex, h_flex, InputState, Input, TextView } from 'gpui-base';
import { appHome, home, readTextFile, writeTextFile, shared, setShared, theme, settings, openOverlay, closeOverlay } from 'herdr';
import { effortLabel, folderKey, claudeModels, claudeEfforts, codexHome, codexModels, isClaudeLauncher, isCodexLauncher, sessionKind, shownOptions, orderedOptions, settingsKey } from './model.js';
import { Select, SelectState } from './components/select.js';
import { Button } from './components/button.js';
import { DialogDescription } from './components/dialog.js';
import { DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from './components/dropdown-menu.js';

// Asana owns its palette; the host theme chooses only light or dark mode.
// Reference: Asana project List view (the main canvas is #1e1f21 in dark mode).
export function asanaTheme(host = theme()) {
  const color = String(host.background || '#1e1f21').replace('#', '');
  const rgb = color.length === 3 ? color.split('').map(c => parseInt(c + c, 16))
    : [0, 2, 4].map(i => parseInt(color.slice(i, i + 2), 16));
  const light = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 150;
  return light ? {
    background: '#ffffff', chrome: '#f9f8f8', popover: '#ffffff', foreground: '#1e1f21',
    muted: '#6d6e6f', hover: '#f9f8f8', selected: '#e9f2fe', border: '#edeae9', input: '#cfcbcb',
    solid: '#4573d2', solid_foreground: '#ffffff', destructive: '#c92f54',
    working: '#f1bd6c', done: '#58a182', accent: '#4573d2', project: '#a9e5e2',
  } : {
    background: '#1e1f21', chrome: '#252628', popover: '#1e1f21', foreground: '#f5f4f3',
    muted: '#a2a0a2', hover: '#363639', selected: '#2b3b55', border: '#424244', input: '#565557',
    solid: '#4573d2', solid_foreground: '#ffffff', destructive: '#f06a6a',
    working: '#f1bd6c', done: '#5da283', accent: '#a4cafe', project: '#a9e5e2',
  };
}

// Asana controls use their own geometry inside the project's Sera shell.
const asanaButton = (id, t, options = {}) => Button(id, t, options).rounded(t.appearance === 'linear' ? 999 : 6)
  .when(options.variant === 'outline', el => el.border(1).border_color(t.input));

const api = 'https://app.asana.com/api/1.0';
const tokenPath = () => `${appHome()}/data/devkits/asana.json`;
const noteLimit = 4000;
const taskFields = 'name,due_on,assignee.name,assignee.gid,num_subtasks,permalink_url,memberships.project.gid,memberships.section.name';
const glyph = (name, size = 14) => svg(`mods/devkits/assets/icons/${name}.svg`).size(size).flex_none();

async function asanaRequest(token, path, request = fetch) {
  const response = await request(`${api}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  let body = null;
  try { body = await response.json(); } catch {}
  if (response.status === 401) throw Object.assign(new Error('Asana rejected this token. Enter a new personal access token.'), { unauthorized: true });
  if (!response.ok) throw Object.assign(new Error(body?.errors?.[0]?.message || `Asana returned ${response.status}.`), { status: response.status });
  return body || {};
}

async function asanaList(token, path, request) {
  const items = [];
  let offset = null;
  do {
    const page = await asanaRequest(token, `${path}${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`, request);
    items.push(...(page.data || []));
    offset = page.next_page?.offset || null;
  } while (offset);
  return items;
}

const normalize = (task, project) => ({
  gid: task.gid, name: task.name || 'Untitled task', url: task.permalink_url || '', due: task.due_on || null,
  assignee: task.assignee?.name || null, assigneeGid: task.assignee?.gid || null, subtasks: task.num_subtasks || 0,
  section: task.memberships?.find(item => item.project?.gid === project)?.section?.name || null,
});

// Asana stays the source of truth: Devkits only reads it and never writes back.
export async function searchProjects(token, query, request = fetch) {
  const me = (await asanaRequest(token, '/users/me?opt_fields=workspaces.name', request)).data || {};
  const lists = await Promise.all((me.workspaces || []).map(workspace => asanaRequest(token,
    `/workspaces/${workspace.gid}/typeahead?resource_type=project&count=20&opt_fields=name&query=${encodeURIComponent(query)}`, request)
    .then(page => (page.data || []).map(project => ({ gid: project.gid, name: project.name, workspace: workspace.name, workspaceGid: workspace.gid })))));
  return lists.flat();
}

// All: one page of the project's open tasks at a time; `next` continues it.
export async function projectTasksPage(token, project, offset = null, request = fetch) {
  const more = offset ? `&offset=${encodeURIComponent(offset)}` : '';
  const page = await asanaRequest(token, `/projects/${project}/tasks?completed_since=now&limit=100&opt_fields=${taskFields}${more}`, request);
  return { tasks: (page.data || []).map(task => normalize(task, project)), next: page.next_page?.offset || null };
}

export async function projectWorkspace(token, project, request = fetch) {
  return (await asanaRequest(token, `/projects/${project}?opt_fields=workspace.gid`, request)).data?.workspace?.gid || null;
}

// Mine: Asana returns only the tasks assigned to the token owner; those in this project are kept.
export async function myProjectTasks(token, project, workspace, request = fetch) {
  return (await asanaList(token, `/tasks?assignee=me&workspace=${workspace}&completed_since=now&limit=100&opt_fields=${taskFields}`, request))
    .filter(task => task.memberships?.some(item => item.project?.gid === project)).map(task => normalize(task, project));
}

export async function openSubtasks(token, parent, request = fetch) {
  return (await asanaList(token, `/tasks/${parent}/subtasks?limit=100&opt_fields=completed,${taskFields}`, request))
    .filter(task => !task.completed).map(task => normalize(task));
}

// Resolves null when the task was deleted.
export async function taskDetails(token, gid, project, request = fetch) {
  try {
    const task = (await asanaRequest(token, `/tasks/${gid}?opt_fields=notes,completed,projects.gid,parent.name,parent.permalink_url,${taskFields}`, request)).data;
    return { ...normalize({ ...task, gid }, project), notes: task.notes || '', completed: Boolean(task.completed),
      projects: (task.projects || []).map(item => item.gid),
      parent: task.parent ? { gid: task.parent.gid, name: task.parent.name || 'Untitled task', url: task.parent.permalink_url || '' } : null };
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export const filterTasks = (tasks, query) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return tasks.filter(task => words.every(word => [task.name, task.section, task.assignee, task.parent]
    .filter(Boolean).join(' ').toLowerCase().includes(word)));
};

const clip = text => text.length > noteLimit ? `${text.slice(0, noteLimit)}…` : text;

// Comments are the task's stories of the comment kind, oldest first, as Asana shows them.
export async function taskComments(token, gid, request = fetch) {
  return (await asanaList(token, `/tasks/${gid}/stories?limit=100&opt_fields=resource_subtype,text,created_at,created_by.name,created_by.gid`, request))
    .filter(story => story.resource_subtype === 'comment_added' && story.text?.trim())
    .map(story => ({ gid: story.gid, author: story.created_by?.name || 'Someone', authorGid: story.created_by?.gid || null,
      text: story.text.trim(), at: story.created_at || null }));
}

export function relativeTime(at, now = Date.now()) {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) return '';
  const minutes = Math.floor((now - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  const date = new Date(time), year = new Date(now).getFullYear();
  return `${months[date.getMonth()]} ${date.getDate()}${date.getFullYear() === year ? '' : `, ${date.getFullYear()}`}`;
}

const commentLimit = 5, commentLength = 500;

// The prompt carries the latest comments, which often hold the decisions the description lacks.
export function taskPrompt(task) {
  const notes = (task.notes || '').trim();
  const source = task.asana || task, stories = source.comments || [];
  const comments = stories.slice(-commentLimit).map(comment => {
    const text = comment.text.length > commentLength ? `${comment.text.slice(0, commentLength)}…` : comment.text;
    return `- ${comment.author}${comment.at ? ` (${comment.at.slice(0, 10)})` : ''}: ${text.replace(/\s*\n\s*/g, ' ')}`;
  });
  return [`Work on this ${task.asana || !task.source || task.source === 'asana' ? 'Asana ' : ''}task: ${task.name}`, source.url,
    source.parent && [`It is a subtask of: ${source.parent.name}`, source.parent.url].filter(Boolean).join('\n'),
    notes && `Description:\n${task.source === 'local' ? notes : clip(notes)}`,
    comments.length && `Latest comments${stories.length > comments.length ? ` (${comments.length} of ${stories.length})` : ''}:\n${comments.join('\n')}`,
    task.note?.trim() && `My instructions:\n${task.note.trim()}`]
    .filter(Boolean).join('\n\n');
}

export async function readAsanaToken() {
  try { return JSON.parse(await readTextFile(tokenPath()) || 'null')?.token || null; } catch { return null; }
}

export async function saveAsanaToken(token) {
  const current = await readTextFile(tokenPath());
  await writeTextFile(tokenPath(), `${JSON.stringify({ token }, null, 2)}\n`, current);
}

// Bindings belong to the Devkits project folder and stay on this computer.
const projectKey = folder => JSON.stringify(['', folderKey(folder)]);
const binding = folder => shared('devkits.asana-projects')?.[projectKey(folder)] || null;
// Bounds and positions are in zoomed pixels; the list and the preview each keep at least 320px.
export const previewWidthAt = (bounds, x, zoom) =>
  Math.round(Math.max(320, Math.min(bounds.width / zoom - 320, (bounds.x + bounds.width - x) / zoom)));
// Asana sections are free text; infer a status for task properties.
export const statusKind = section => /done|complete|closed|shipped|released|resolved/i.test(section || '') ? 'done'
  : /progress|doing|review|testing|qa|active|started|wip/i.test(section || '') ? 'started'
    : /backlog|later|icebox|someday|idea|triage/i.test(section || '') ? 'backlog' : 'todo';
// Linear gives each person a steady color; white initials stay readable on all of these in both themes.
const avatarColors = ['#e5484d', '#f76b15', '#c27c0e', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f'];
export const avatarColor = key => avatarColors[[...(key || '')].reduce((hash, char) => (hash * 31 + char.codePointAt(0)) >>> 0, 0) % avatarColors.length];
export const initials = name => name.split(/\s+/).filter(Boolean).map(word => [...word][0]).join('').slice(0, 2).toUpperCase();
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Asana due dates are calendar days; compare them with today's local date.
export function dueLabel(due, now = new Date()) {
  if (!due) return { text: '', overdue: false };
  const [year, month, day] = due.split('-').map(Number);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return { text: `${months[month - 1]} ${day}${year === now.getFullYear() ? '' : `, ${year}`}`, overdue: due < today };
}

// The Asana project menu: a dropdown under the toolbar's project button, searched with Asana's typeahead.
export class AsanaProjectPicker {
  init(target, cx) {
    this.folder = target.folder;
    this.overlay = target.overlay;
    this.projects = []; this.index = 0; this.loading = true; this.error = null;
    this.handle = cx.focus_handle();
    this.search = InputState.new({ placeholder: 'Search Asana projects' });
    this.search.on('change', (_event, cx) => { this.index = 0; this.find(cx); });
    this.search.on('submit', () => this.choose(this.projects[this.index]));
    this.search.focus();
    this.find(cx);
  }

  find(cx) {
    const query = this.search.value();
    this.loading = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const token = await readAsanaToken();
        if (!token) throw new Error('Connect Asana first.');
        const projects = await searchProjects(token, query);
        if (this.search.value() !== query) return;
        this.projects = projects; this.error = null;
      } catch (error) { if (this.search.value() === query) this.error = error.message; }
      if (this.search.value() === query) this.loading = false;
      cx.notify();
    });
  }

  choose(project) {
    if (!project) return;
    setShared('devkits.asana-projects', { ...(shared('devkits.asana-projects') || {}), [projectKey(this.folder)]: { gid: project.gid, name: project.name, workspace: project.workspaceGid } });
    closeOverlay(this.overlay);
  }

  render() {
    const t = asanaTheme(), current = binding(this.folder)?.gid;
    return DropdownMenuContent('asana-project-picker', 360, t).rounded(8).shadow_lg().overflow_hidden().p(8).font_family('Arial').track_focus(this.handle)
      .on_key_down((event, cx) => {
        if (event.key === 'escape') closeOverlay(this.overlay);
        else if (event.key === 'enter') this.choose(this.projects[this.index]);
        else if ((event.key === 'down' || event.key === 'up') && this.projects.length)
          this.index = (this.index + (event.key === 'down' ? 1 : this.projects.length - 1)) % this.projects.length;
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(Input.new(this.search).id('asana-project-search').accessibility_label('Search Asana projects')
        .h(36).flex_none().px(10).rounded(6).border(1).border_color(t.input).bg(t.background).text_color(t.foreground).text_size(13))
      .child(DropdownMenuLabel(t).text_size(12).child('Projects'))
      .child(v_flex().id('asana-project-list').flex_1().min_h(0).overflow_y_scrollbar().gap(1)
        .children(this.projects.map((project, index) => DropdownMenuItem(`asana-project-${project.gid}`, t).rounded(4)
          .bg(this.index === index ? t.selected : t.popover)
          .on_hover((inside, cx) => { if (inside) { this.index = index; cx.notify(); } })
          .on_click(() => this.choose(project))
          .child(glyph('list-todo').text_color(t.muted))
          .child(div().flex_1().min_w(0).truncate().child(project.name))
          .child(div().flex_none().text_size(11).text_color(t.muted).child(project.workspace))
          .child(div().size(14).flex_none().when(project.gid === current, el => el.child(glyph('check'))))))
        .when(this.loading && !this.projects.length, el => el.child(div().p(8).text_size(12).text_color(t.muted).child('Searching…')))
        .when(Boolean(this.error), el => el.child(div().p(8).text_size(12).text_color(t.destructive || t.foreground).child(this.error)))
        .when(!this.loading && !this.error && !this.projects.length, el => el.child(div().p(8).text_size(12).text_color(t.muted).child('No matching projects.'))));
  }
}

// Read-only source selection. Confirm the import in the Tasks composer.
export default class AsanaPanel {
  init(cx) {
    this.handle = cx.focus_handle();
    this.tab = shared('devkits.asana-tab') === 'all' ? 'all' : 'mine';
    this.folder = undefined;
    this.reset();
    this.search = InputState.new({ placeholder: 'Search tasks' });
    this.search.on('change', (_event, cx) => cx.notify());
    this.selects = { agent: new SelectState(cx), model: new SelectState(cx), effort: new SelectState(cx) };
    this.codexModels = new Map();
    this.tokenInput = InputState.new({ placeholder: 'Personal access token' });
    this.tokenInput.set_masked(true);
    this.tokenInput.on('change', (_event, cx) => { this.tokenCopied = false; cx.notify(); });
    this.tokenInput.on('submit', (_event, cx) => this.saveToken(cx));
  }

  reset() {
    this.mine = null; this.all = { tasks: [], next: null, loaded: false }; this.loadingMore = false; this.page = (this.page || 0) + 1;
    this.subtasks = new Map(); this.expanded = new Set(); this.loadedGid = null; this.loading = false;
    this.selected = null; this.cursor = null; this.detail = null; this.detailError = null; this.error = null;
    this.detailRequest = null;
  }

  fail(error) {
    this.error = error.message;
    if (error.unauthorized) { this.needsToken = true; this.loadedGid = null; this.tokenInput.focus(); }
  }

  // The token is unknown (null) until it has been read, so nothing else shows before then.
  // Each Devkits project keeps its own list, selection and preview while another project is shown.
  open(project, cx) {
    const keys = ['mine', 'all', 'subtasks', 'expanded', 'loadedGid', 'selected', 'cursor', 'detail', 'detailError', 'error'];
    this.states ||= new Map();
    if (this.folder) this.states.set(this.folder, { ...Object.fromEntries(keys.map(key => [key, this[key]])),
      // Unfinished loads are dropped when the project changes, so they start again on return.
      loadedGid: this.loading ? null : this.loadedGid, query: this.search.value() });
    this.folder = project?.folder || null;
    this.reset();
    const saved = this.states.get(this.folder);
    if (saved) Object.assign(this, Object.fromEntries(keys.map(key => [key, saved[key]])));
    this.search.set_value(saved?.query || '');
    if (!this.folder) return;
    if (this.selected && !this.detail && this.token) this.show({ gid: this.selected }, cx);
    if (this.token) { this.needsToken = false; return; }
    this.needsToken = null;
    cx.spawn(async cx => {
      this.token = await readAsanaToken();
      this.needsToken = !this.token;
      if (this.needsToken) this.tokenInput.focus();
      cx.notify();
    });
  }

  // Loads whenever the bound Asana project differs from the one shown, including after the project menu changes it.
  // Mine loads first and is small; All loads a page only when it is shown, and more on request.
  sync(cx) {
    const bound = binding(this.folder), gid = bound?.gid || null;
    if (this.needsToken !== false) return;
    if (gid !== this.loadedGid) {
      const folder = this.folder;
      this.reset(); this.loadedGid = gid;
      if (!gid) return;
      this.load(cx, async () => {
        let workspace = bound.workspace;
        if (!workspace) {
          workspace = await projectWorkspace(this.token, gid);
          setShared('devkits.asana-projects', { ...(shared('devkits.asana-projects') || {}), [projectKey(folder)]: { ...bound, workspace } });
        }
        const mine = await myProjectTasks(this.token, gid, workspace);
        if (this.folder !== folder || this.loadedGid !== gid) return;
        this.mine = mine;
      });
    }
    if (gid && this.tab === 'all' && !this.all.loaded) this.more(cx);
  }

  load(cx, work) {
    const folder = this.folder, gid = this.loadedGid;
    this.loading = true;
    cx.spawn(async cx => {
      try { await work(); } catch (error) { if (this.loadedGid === gid && this.folder === folder) this.fail(error); }
      if (this.loadedGid === gid && this.folder === folder) this.loading = false;
      cx.notify();
    });
  }

  more(cx) {
    if (this.loadingMore || (this.all.loaded && !this.all.next)) return;
    const request = this.page, gid = this.loadedGid;
    this.loadingMore = true;
    cx.spawn(async cx => {
      try {
        const page = await projectTasksPage(this.token, gid, this.all.next);
        if (this.page === request) this.all = { tasks: [...this.all.tasks, ...page.tasks], next: page.next, loaded: true };
      } catch (error) { if (this.page === request) this.fail(error); }
      if (this.page === request) this.loadingMore = false;
      cx.notify();
    });
  }

  openSettings(cx) {
    this.settingsOpen = true;
    this.tokenCopied = false;
    this.tokenInput.set_value(this.token || '');
    this.error = null;
    cx.notify();
  }

  saveToken(cx) {
    const token = this.tokenInput.value().trim();
    if (this.tokenBusy) return;
    if (!token) { this.error = 'Enter a personal access token.'; cx.notify(); return; }
    if (token === this.token && this.needsToken === false) {
      this.settingsOpen = false; this.tokenInput.set_value(''); this.error = null; cx.notify(); return;
    }
    this.tokenBusy = true;
    cx.spawn(async cx => {
      try { await saveAsanaToken(token); this.token = token; this.needsToken = false; this.settingsOpen = false; this.states?.clear(); this.reset(); this.tokenInput.set_value(''); }
      catch (error) { this.error = error.message; }
      this.tokenBusy = false; cx.notify();
    });
  }

  copyToken(cx) {
    const token = this.tokenInput.value().trim();
    if (!token) return;
    cx.write_to_clipboard(token);
    this.tokenCopied = true;
    cx.notify();
  }

  clearToken(cx) {
    if (this.tokenBusy) return;
    this.tokenBusy = true;
    cx.spawn(async cx => {
      try {
        await saveAsanaToken('');
        this.token = null; this.needsToken = true; this.states?.clear(); this.reset();
        this.settingsOpen = true; this.tokenInput.set_value('');
      } catch (error) { this.error = error.message; }
      this.tokenBusy = false; cx.notify();
    });
  }

  toggleExpanded(task, cx) {
    if (this.expanded.delete(task.gid)) { cx.notify(); return; }
    this.expanded.add(task.gid);
    if (!this.subtasks.has(task.gid)) this.loadSubtasks(task, cx);
    cx.notify();
  }

  loadSubtasks(task, cx) {
    this.subtasks.set(task.gid, null);
    cx.spawn(async cx => {
      try { this.subtasks.set(task.gid, (await openSubtasks(this.token, task.gid)).map(sub => ({ ...sub, parent: task.name }))); }
      catch (error) { this.subtasks.delete(task.gid); this.expanded.delete(task.gid); this.fail(error); }
      cx.notify();
    });
  }

  // Keep the selected preview and its pending read; changing sources reads fresh.
  show(task, cx) {
    const gid = task.gid;
    if (this.selected === gid && (this.detail || this.detailRequest)) return;
    const request = { folder: this.folder, gid };
    this.detailRequest = request;
    this.selected = gid; this.cursor = gid; this.detail = null; this.detailError = null;
    cx.spawn(async cx => {
      try {
        const detail = await taskDetails(this.token, gid, binding(this.folder)?.gid);
        if (this.detailRequest !== request || this.selected !== gid || this.folder !== request.folder) return;
        if (!detail || detail.completed) this.detailError = 'This task was completed or deleted in Asana.';
        else {
          this.detail = detail;
          if (detail.subtasks && !this.subtasks.has(gid)) this.loadSubtasks(detail, cx);
          this.loadComments(detail, cx);
        }
      } catch (error) { if (this.detailRequest === request) { this.detailError = error.message; if (error.unauthorized) this.fail(error); } }
      finally { if (this.detailRequest === request) { this.detailRequest = null; cx.notify(); } }
    });
    cx.notify();
  }

  // Comments arrive after the preview opens; Start session uses them once they are in.
  loadComments(detail, cx) {
    cx.spawn(async cx => {
      try {
        const comments = await taskComments(this.token, detail.gid);
        if (this.detail === detail) this.detail = { ...detail, comments };
      } catch (error) { if (this.detail === detail) this.detail = { ...detail, comments: [], commentsError: error.message }; }
      cx.notify();
    });
  }

  visible() {
    const query = this.search.value();
    const base = this.tab === 'mine' ? this.mine || [] : this.all.tasks;
    return filterTasks(base, query);
  }

  // Sections keep Asana's order, as in its List and Board views.
  groups() {
    const groups = [];
    for (const task of this.visible()) {
      const name = task.section || 'No section';
      let group = groups.find(group => group.name === name);
      if (!group) groups.push(group = { name, tasks: [] });
      group.tasks.push(task);
    }
    return groups;
  }

  rows() {
    const nested = !this.search.value().trim() && this.view() === 'list';
    return this.groups().flatMap(group => group.tasks.flatMap(task => [{ task, depth: 0 },
      ...(nested && this.expanded.has(task.gid) ? (this.subtasks.get(task.gid) || []).map(sub => ({ task: sub, depth: 1 })) : [])]));
  }

  view() { return shared('devkits.asana-view') === 'board' ? 'board' : 'list'; }

  navigate(event, cx) {
    const rows = this.rows();
    const index = rows.findIndex(row => row.task.gid === this.cursor);
    const row = rows[index];
    if (event.key === 'down' || event.key === 'up') {
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'down' ? 1 : -1)))];
      if (!next) return;
      this.show(next.task, cx);
    } else if (event.key === 'escape' && this.selected) { this.selected = null; this.detail = null; }
    else if ((event.key === 'right' || event.key === 'left') && row?.task?.subtasks && !row.depth
      && this.expanded.has(row.task.gid) === (event.key === 'left')) this.toggleExpanded(row.task, cx);
    else return;
    cx.stop_propagation(); cx.notify();
  }

  toolbar(t, close) {
    const ready = this.needsToken === false;
    const bound = binding(this.folder);
    const toggle = (id, label, active, action) => asanaButton(id, t, { variant: 'ghost' }).h(28).px(10)
      .when(active, el => el.bg(t.selected).text_color(t.accent))
      .accessibility_label(`${label}${active ? ', selected' : ''}`)
      .on_click((_event, cx) => { action(); cx.notify(); }).child(label);
    const tab = (id, label, active, action) => div().id(id).h(36).px(4).gap(6).flex().items_center()
      .border_b(2).border_color(active ? t.muted : t.background).text_size(14)
      .text_color(active ? t.foreground : t.muted).cursor_pointer().hover(el => el.bg(t.hover))
      .accessibility_label(`${label}${active ? ', selected' : ''}`)
      .on_mouse_down('left', (_event, cx) => cx.stop_propagation())
      .on_click((_event, cx) => { action(); cx.notify(); })
      .child(glyph(label === 'List' ? 'list-todo' : 'columns-3', 14)).child(label);
    return v_flex().flex_none().bg(t.background)
      .child(h_flex().h(56).px(24).gap(12).items_center()
        .child(div().size(32).rounded(6).bg(t.project).flex().items_center().justify_center()
          .child(glyph('list-todo', 20).text_color('#1e1f21')))
        .child(DropdownMenuTrigger(asanaButton('asana-project-menu', t, { variant: 'ghost' }).h(36).px(4).gap(8).text_size(20).font_semibold().text_color(t.foreground)
          .accessibility_label('Choose Asana project').disabled(!ready)
          .on_mouse_down('left', (_event, cx) => cx.stop_propagation()), 360,
          (_cx, at) => { if (ready) openOverlay({ mod: 'devkits', kind: 'popup', frame: 'none', width: 360, at,
            props: { view: 'asana-projects', folder: this.folder } }); }, 'start', { x: 0, y: 4 })
          .child(div().max_w(400).truncate().child(bound?.name || 'Choose Asana project'))
          .child(glyph('chevron-down', 14).text_color(t.muted)))
        .child(div().flex_1())
        .when(this.needsToken !== null && !this.settingsOpen, el => el.child(asanaButton('asana-settings', t, { variant: 'ghost', size: 'icon' })
          .disabled(this.tokenBusy).accessibility_label('Asana settings')
          .on_click((_event, cx) => this.openSettings(cx))
          .child(glyph('gear', 14))))
        .child(asanaButton('asana-close', t, { variant: 'ghost', size: 'icon' }).rounded(6).accessibility_label('Close Asana tasks')
          .on_mouse_down('left', (_event, cx) => cx.stop_propagation()).on_click(close).child(glyph('close'))))
      .when(ready && Boolean(bound) && !this.settingsOpen, el => el
        .child(h_flex().h(36).px(24).gap(20).items_center().border_b(1).border_color(t.border)
          .child(tab('asana-view-list', 'List', this.view() === 'list', () => setShared('devkits.asana-view', 'list')))
          .child(tab('asana-view-board', 'Board', this.view() === 'board', () => setShared('devkits.asana-view', 'board'))))
        .child(h_flex().h(56).px(24).gap(8).items_center()
          .on_mouse_down('left', (_event, cx) => cx.stop_propagation()).border_b(1).border_color(t.border)
          .children([['mine', 'Mine'], ['all', 'All']].map(([value, label]) =>
            toggle(`asana-tab-${value}`, label, this.tab === value, () => { this.tab = value; setShared('devkits.asana-tab', value); })))
          .child(div().flex_1())
          .child(Input.new(this.search).id('asana-search').accessibility_label('Search tasks')
            .w(200).h(30).px(10).rounded(6).border(1).border_color(t.input).bg(t.background).text_color(t.foreground).text_size(12))
          ));
  }

  status(section, t, size = 14) {
    const kind = statusKind(section);
    return glyph({ done: 'circle-check', started: 'circle-half', backlog: 'circle-dashed', todo: 'circle' }[kind], size)
      .text_color(kind === 'done' ? t.done : kind === 'started' ? t.working : t.muted);
  }

  avatar(task, t, size = 18) {
    if (!task.assignee) return glyph('circle-dashed', size - 2).text_color(t.muted).accessibility_label('Unassigned');
    return div().size(size).flex_none().rounded_full().overflow_hidden().bg(avatarColor(task.assigneeGid || task.assignee))
      .flex().items_center().justify_center().accessibility_label(task.assignee)
      .child(div().text_size(Math.round(size / 2)).font_medium().text_color('#ffffff').child(initials(task.assignee)));
  }

  due(task, t) {
    const due = dueLabel(task.due);
    return div().flex_none().text_size(12).text_color(due.overdue ? t.destructive || t.ansi1 : t.muted).child(due.text);
  }

  // Asana section headings sit between ruled task groups.
  sectionLabel(group, t) {
    return h_flex().h(52).flex_none().px(24).gap(8).items_center().border_b(1).border_color(t.border)
      .child(glyph('chevron-down', 12).text_color(t.muted))
      .child(div().min_w(0).truncate().text_size(16).font_semibold().child(group.name))
      .child(div().flex_none().text_size(12).text_color(t.muted).child(String(group.tasks.length)));
  }

  // Section headers, task rows and Load more, in display order.
  listItems() {
    const nested = !this.search.value().trim();
    const items = this.groups().flatMap(group => [{ key: `section:${group.name}`, group },
      ...group.tasks.flatMap(task => [{ key: `task:${task.gid}`, task, depth: 0, section: group.name, nested },
        ...(nested && this.expanded.has(task.gid) ? (this.subtasks.get(task.gid) || []).map(sub => ({ key: `task:${sub.gid}:${task.gid}`, task: sub, depth: 1 })) : [])])]);
    if (this.tab === 'all' && this.all.next) items.push({ key: 'more' });
    return items;
  }

  // Asana's task table keeps assignees and due dates in aligned columns.
  // A plain scroll list: pages keep it to a few hundred rows, and hover then stays in GPUI instead of rebuilding rows in script each frame.
  list(t) {
    const row = item => {
      if (item.group) return this.sectionLabel(item.group, t);
      if (!item.task) return h_flex().id('asana-load-more').h(36).flex_none().px(16).gap(8).items_center().text_size(12).text_color(t.muted)
        .cursor_pointer().hover(el => el.bg(t.hover)).on_click((_event, cx) => this.more(cx))
        .child(glyph('chevron-down', 12)).child(this.loadingMore ? 'Loading…' : 'Load more tasks');
      const { task, depth } = item;
      return h_flex().id(`asana-${item.key}`).h(38).flex_none().pl(24 + depth * 22).pr(24).gap(10).items_center().border_b(1).border_color(t.border).cursor_pointer()
        .accessibility_label(task.name)
        .bg(this.selected === task.gid ? t.selected : t.background).hover(el => el.bg(this.selected === task.gid ? t.selected : t.hover))
        .on_click((_event, cx) => { this.handle.focus(); this.show(task, cx); })
        .child(glyph('circle-check', 16).text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(13).child(task.name))
        .when(item.nested && task.subtasks > 0, el => el.child(h_flex().id(`asana-expand-${task.gid}`).h(20).px(6).gap(4).flex_none().items_center()
          .rounded(4).border(1).border_color(t.border).text_size(11).text_color(t.muted).cursor_pointer().hover(el => el.bg(t.hover))
          .accessibility_label(`${this.expanded.has(task.gid) ? 'Hide' : 'Show'} ${task.subtasks} subtasks`)
          .on_click((_event, cx) => { cx.stop_propagation(); this.toggleExpanded(task, cx); })
          .child(glyph(this.expanded.has(task.gid) ? 'chevron-down' : 'chevron-right', 10)).child(String(task.subtasks))))
        .when(Boolean(task.parent) && !depth, el => el.child(div().flex_none().max_w(200).truncate().text_size(12).text_color(t.muted).child(`↳ ${task.parent}`)))
        .child(h_flex().w(120).h_full().pl(12).border_l(1).border_color(t.border).flex_none().items_center().child(this.avatar(task, t, 24)))
        .child(h_flex().w(120).h_full().pl(12).border_l(1).border_color(t.border).flex_none().items_center().child(this.due(task, t)));
    };
    return v_flex().id('asana-list').flex_1().min_h(0)
      .child(h_flex().h(34).px(24).gap(10).flex_none().items_center().border_b(1).border_color(t.border).text_size(12).text_color(t.muted)
        .child(div().flex_1().child('Task name'))
        .child(div().w(120).h_full().pl(12).border_l(1).border_color(t.border).flex_none().flex().items_center().child('Assignee'))
        .child(div().w(120).h_full().pl(12).border_l(1).border_color(t.border).flex_none().flex().items_center().child('Due date')))
      .child(v_flex().id('asana-list-rows').flex_1().min_h(0).overflow_y_scrollbar().children(this.listItems().map(row)));
  }

  board(t) {
    return h_flex().id('asana-board').flex_1().min_h(0).overflow_x_scrollbar().bg(t.chrome).p(24).gap(16)
      .children(this.groups().map(group => v_flex().w(300).flex_none().h_full().min_h(0)
        .child(h_flex().h(40).flex_none().px(4).gap(8).items_center()
          .child(this.status(group.name, t))
          .child(div().text_size(12).font_medium().child(group.name))
          .child(div().text_size(12).text_color(t.muted).child(String(group.tasks.length))))
        .child(v_flex().id(`asana-column-${group.name}`).flex_1().min_h(0).overflow_y_scrollbar().gap(8)
          .children(group.tasks.map(task => v_flex().id(`asana-card-${task.gid}`).flex_none().p(16).gap(12).rounded(8).cursor_pointer()
            .bg(this.selected === task.gid ? t.selected : t.background).border(1).border_color(this.selected === task.gid ? t.solid : t.border)
            .hover(el => el.border_color(t.solid)).accessibility_label(task.name)
            .on_click((_event, cx) => { this.handle.focus(); this.show(task, cx); })
            .when(Boolean(task.parent), el => el.child(div().truncate().text_size(11).text_color(t.muted).child(`↳ ${task.parent}`)))
            .child(div().text_size(13).font_medium().child(task.name))
            .child(h_flex().gap(8).items_center()
              .child(this.status(group.name, t, 12))
              .when(task.subtasks > 0, el => el.child(h_flex().h(20).px(6).items_center().rounded(4).border(1).border_color(t.border)
                .text_size(11).text_color(t.muted).child(`${task.subtasks} subtasks`)))
              .child(div().flex_1())
              .child(this.due(task, t))
              .child(this.avatar(task, t))))))))
      .when(this.tab === 'all' && Boolean(this.all.next), el => el.child(asanaButton('asana-load-more', t, { variant: 'outline' }).flex_none()
        .on_click((_event, cx) => this.more(cx)).child(this.loadingMore ? 'Loading…' : 'Load more tasks')));
  }

  connect(t, close) {
    const back = cx => { this.settingsOpen = false; this.tokenInput.set_value(''); this.error = null; cx.notify(); };
    return v_flex().flex_1().max_w(560).p(32).gap(16)
      .child(h_flex().child(asanaButton('asana-settings-back', t, { variant: 'ghost' }).gap(6).disabled(this.tokenBusy)
        .on_click((_event, cx) => this.token ? back(cx) : close()).child(glyph('chevron-right', 14)).child(this.token ? 'Back to tasks' : 'Close')))
      .child(div().text_size(24).font_semibold().child('Asana settings'))
      .child(div().text_size(14).font_medium().child('Personal access token'))
      .child(DialogDescription(t).child(this.token ? 'Your saved token is masked below. Replace it to change accounts, or clear it below.'
        : 'No token is saved. Paste a personal access token from the Asana developer console to connect.'))
      .child(h_flex().gap(8).items_center()
        .child(Input.new(this.tokenInput).id('asana-token').accessibility_label('Asana personal access token')
        .flex_1().min_w(0).h(36).px(10).rounded(6).border(1).border_color(t.input).bg(t.background).text_color(t.foreground).text_size(13))
        .child(asanaButton('asana-copy-token', t, { variant: 'outline' }).w(80).h(36).disabled(!this.tokenInput.value().trim())
          .accessibility_label('Copy personal access token').on_click((_event, cx) => this.copyToken(cx))
          .child(this.tokenCopied ? 'Copied' : 'Copy')))
      .when(Boolean(this.error), el => el.child(div().id('asana-error').text_size(12).text_color(t.destructive).child(this.error)))
      .child(h_flex().gap(8)
        .child(asanaButton('asana-save-token', t).disabled(this.tokenBusy).on_click((_event, cx) => this.saveToken(cx)).child(this.tokenBusy ? 'Saving…' : this.token ? 'Save token' : 'Connect'))
        .child(asanaButton('asana-cancel-token', t, { variant: 'outline' }).disabled(this.tokenBusy)
          .on_click((_event, cx) => this.token ? back(cx) : close()).child('Cancel'))
        .when(Boolean(this.token), el => el.child(asanaButton('asana-clear-token', t, { variant: 'outline' }).text_color(t.destructive)
          .disabled(this.tokenBusy).on_click((_event, cx) => this.clearToken(cx)).child('Clear saved token'))));
  }

  // Asana's task detail pane, with properties followed by description and activity.
  preview(t, importTask) {
    const task = this.detail;
    const subtasks = task ? this.subtasks.get(task.gid) : null;
    const width = this.previewWidth();
    const property = (label, value) => h_flex().h(36).gap(12).items_center()
      .child(div().w(112).flex_none().text_size(12).text_color(t.muted).child(label))
      .child(h_flex().flex_1().min_w(0).gap(8).items_center().text_size(13).children([].concat(value)));
    return v_flex().id('asana-preview').when(Boolean(width), el => el.w(width).flex_none()).when(!width, el => el.flex_1().min_w(0))
      .min_h(0).h_full().bg(t.background).border_l(1).border_color(t.border)
      .child(h_flex().h(48).flex_none().pl(16).pr(8).gap(6).items_center().border_b(1).border_color(t.border).text_size(12)
        .child(h_flex().flex_1().min_w(0).gap(6).items_center().text_color(t.muted)
          .child(div().flex_none().max_w(160).truncate().child(binding(this.folder)?.name || 'Asana'))
          .when(Boolean(task?.parent), el => el.child('›').child(div().id('asana-parent-crumb').min_w(0).truncate().cursor_pointer()
            .hover(el => el.text_color(t.foreground)).on_click((_event, cx) => this.show(task.parent, cx)).child(task.parent.name))))
        .when(Boolean(task), el => el
          .child(asanaButton('asana-open', t, { variant: 'ghost' }).h(28).px(8).accessibility_label('Open in Asana')
            .on_click((_event, cx) => cx.open_url(task.url)).child('Open in Asana')))
        .child(asanaButton('asana-close-preview', t, { variant: 'ghost', size: 'icon' }).accessibility_label('Close preview')
          .on_click((_event, cx) => { this.selected = null; this.detail = null; cx.notify(); }).child(glyph('close'))))
      .child(v_flex().id(`asana-preview-${this.selected}`).flex_1().min_h(0).overflow_y_scrollbar().px(32).py(28).gap(24)
        .when(!task, el => el.child(div().text_size(13).text_color(this.detailError ? t.destructive || t.foreground : t.muted)
          .child(this.detailError || 'Loading…')))
        .when(Boolean(task), el => el
          .child(div().text_size(24).font_semibold().line_height('32px').child(task.name))
          .child(v_flex().gap(2)
            .child(property('Status', [this.status(task.section, t), div().child(task.section || 'No section')]))
            .child(property('Assignee', [this.avatar(task, t), div().text_color(task.assignee ? t.foreground : t.muted).child(task.assignee || 'Unassigned')]))
            .child(property('Due date', task.due ? this.due(task, t).text_size(13) : div().text_color(t.muted).child('No due date'))))
          .child(div().text_size(12).text_color(t.muted).child('Description'))
          .child(task.notes.trim() ? TextView.markdown(`asana-notes-${task.gid}`, task.notes).selectable(true).scrollable(false).w_full()
            : div().text_size(13).text_color(t.muted).child('No description.'))
          .when(task.subtasks > 0, el => el.child(v_flex().gap(4)
            .child(h_flex().gap(8).items_center().text_size(13).font_medium()
              .child('Subtasks').child(div().text_color(t.muted).font_normal().child(String(task.subtasks))))
            .child(v_flex().rounded(6).overflow_hidden().border(1).border_color(t.border)
              .when(!subtasks, el => el.child(div().p(12).text_size(12).text_color(t.muted).child('Loading…')))
              .children((subtasks || []).map((sub, index) => h_flex().id(`asana-subtask-${sub.gid}`).h(36).flex_none().px(12).gap(10).items_center()
                .when(index > 0, el => el.border_t(1).border_color(t.border))
                .cursor_pointer().hover(el => el.bg(t.hover))
                .on_click((_event, cx) => this.show(sub, cx))
                .child(this.status(null, t))
                .child(div().flex_1().min_w(0).truncate().text_size(13).child(sub.name))
                .child(this.due(sub, t))
                .child(this.avatar(sub, t)))))))
          .child(v_flex().gap(12)
            .child(h_flex().gap(8).items_center().text_size(13).font_medium()
              .child('Activity').when(Boolean(task.comments?.length), el => el.child(div().text_color(t.muted).font_normal().child(String(task.comments.length)))))
            .when(!task.comments, el => el.child(div().text_size(12).text_color(t.muted).child('Loading comments…')))
            .when(Boolean(task.commentsError), el => el.child(div().text_size(12).text_color(t.destructive || t.foreground).child(task.commentsError)))
            .when(Boolean(task.comments) && !task.comments.length && !task.commentsError, el => el.child(div().text_size(12).text_color(t.muted).child('No comments.')))
            .children((task.comments || []).map(comment => h_flex().id(`asana-comment-${comment.gid}`).gap(10).items_start()
              .child(this.avatar({ assignee: comment.author, assigneeGid: comment.authorGid }, t, 22))
              .child(v_flex().flex_1().min_w(0).gap(4)
                .child(h_flex().gap(8).items_center().text_size(12)
                  .child(div().font_medium().child(comment.author))
                  .child(div().text_color(t.muted).child(relativeTime(comment.at))))
                .child(TextView.markdown(`asana-comment-text-${comment.gid}`, comment.text).selectable(true).scrollable(false).w_full())))))))
      .when(Boolean(task), el => el.child(v_flex().flex_none().p(12).gap(8).border_t(1).border_color(t.border).bg(t.chrome)
        .child(h_flex().items_center().justify_end()
          .child(asanaButton('asana-import', t).h(28).px(10).accessibility_label('Import into Tasks')
            .disabled(!task.comments && !task.commentsError)
            .on_click(() => importTask(task)).child('Import into Tasks')))));
  }

  // Remembers the last agent, model and effort; a model or effort the chosen agent lacks falls back to Default.
  session(agents) {
    const saved = shared('devkits.asana-session') || {};
    const agent = agents.find(agent => agent.key === saved.agent) || agents[0] || null;
    const models = this.modelsFor(agent);
    const model = models.find(item => item.key === saved.model) ? saved.model : null;
    const profile = this.profileFor(agent);
    const efforts = this.effortsFor(agent, model || profile.model);
    return { agent, models, model, efforts, effort: efforts.includes(saved.effort) ? saved.effort : null };
  }

  // Only the models and efforts Manage leaves checked are offered.
  profileFor(agent) {
    const stored = shared('devkits.profile-sessions')?.[settingsKey(agent)] || {};
    const hidden = shared('devkits.session-options')?.[sessionKind(agent)] || {};
    return { model: hidden.models?.includes(stored.model) ? null : stored.model,
      effort: hidden.efforts?.includes(stored.effort) ? null : stored.effort };
  }

  modelsFor(agent) {
    const options = shared('devkits.session-options')?.[sessionKind(agent)];
    return shownOptions(orderedOptions(this.allModels(agent), options?.order), options?.models);
  }

  allModels(agent) {
    if (isClaudeLauncher(agent)) return claudeModels;
    if (!isCodexLauncher(agent)) return [];
    const dir = codexHome(agent, home());
    if (!this.codexModels.has(dir)) {
      this.codexModels.set(dir, []);
      this.cx?.spawn(async cx => { this.codexModels.set(dir, codexModels(await readTextFile(`${dir}/models_cache.json`) || '')); cx.notify(); });
    }
    return this.codexModels.get(dir);
  }

  effortsFor(agent, model) {
    const hidden = shared('devkits.session-options')?.[sessionKind(agent)]?.efforts;
    if (isClaudeLauncher(agent)) return shownOptions(claudeEfforts, hidden);
    if (!isCodexLauncher(agent)) return [];
    const models = model ? this.allModels(agent) : this.modelsFor(agent);
    const levels = model ? models.find(item => item.key === model)?.efforts || [] : models.flatMap(item => item.efforts);
    return shownOptions([...new Set(levels)], hidden);
  }

  launchRow(task, agents, start, t) {
    const current = this.session(agents);
    const remember = change => setShared('devkits.asana-session', { ...(shared('devkits.asana-session') || {}), ...change });
    const option = (key, label) => ({ key, label, color: key === 'default' ? t.muted : t.foreground });
    // Default is the agent profile's own model and effort from Manage, named when it has one.
    const profile = this.profileFor(current.agent);
    const defaultEffort = this.effortsFor(current.agent, current.model || profile.model).includes(profile.effort) ? profile.effort : null;
    const fallback = { model: profile.model && (this.allModels(current.agent).find(item => item.key === profile.model)?.label || profile.model),
      effort: defaultEffort && effortLabel(defaultEffort) };
    const pick = (id, name, label, value, options, onChange) => Select(id, this.selects[name], value || 'default',
      [option('default', fallback[name] ? `Default (${fallback[name]})` : 'Default'), ...options], label, onChange, t, { width: 168, prefix: label, boxed: t.appearance !== 'linear', radius: 6 });
    return h_flex().gap(8).items_center().flex_wrap()
      .when(agents.length > 0, el => el.child(Select('asana-agent', this.selects.agent, current.agent.key,
        agents.map(agent => ({ key: agent.key, label: agent.name, color: t.foreground,
          icon: agent.icon || 'agent', iconTint: agent.icon ? Boolean(agent.tint) : true })), 'Agent',
        key => remember({ agent: key, model: null, effort: null }), t, { width: 200, prefix: 'Agent', boxed: t.appearance !== 'linear', radius: 6 })))
      .when(current.models.length > 0, el => el.child(pick('asana-model', 'model', 'Model', current.model,
        current.models.map(model => option(model.key, model.label)), key => remember({ model: key === 'default' ? null : key }))))
      .when(current.efforts.length > 0, el => el.child(pick('asana-effort', 'effort', 'Effort', current.effort,
        current.efforts.map(effort => option(effort, effortLabel(effort))), key => remember({ effort: key === 'default' ? null : key }))))
      .child(div().flex_1())
      .child(asanaButton('asana-start', t).h(28).px(10).gap(6).disabled(!current.agent).accessibility_label('Start a session for this task')
        .on_click((_event, cx) => { if (current.agent) start(current.agent, task, {
          model: current.model || profile.model || null,
          effort: current.effort || defaultEffort,
        }, cx); })
        .child(glyph('plus', 12)).child('Start session'));
  }

  render(project, importTask, close, cx) {
    this.cx = cx;
    try { return this.panel(project, importTask, close, cx); } finally { this.cx = null; }
  }

  panel(project, importTask, close, cx) {
    if (this.folder !== (project?.folder || null)) this.open(project, cx);
    this.sync(cx);
    // A thread's Asana link asks for its task; the preview shows it once the token is known.
    const focus = shared('devkits.asana-focus');
    if (focus && this.needsToken === false && folderKey(focus.folder) === folderKey(this.folder)) {
      setShared('devkits.asana-focus', null);
      if (this.selected !== focus.gid) this.show({ gid: focus.gid }, cx);
    }
    const t = asanaTheme();
    const ready = this.needsToken === false && !this.settingsOpen, bound = Boolean(binding(this.folder));
    const rows = ready && bound ? this.rows() : [];
    const empty = !bound ? 'Choose the Asana project for this Devkits project from the menu above.'
      : this.search.value().trim() ? 'No matching tasks.' : this.tab === 'mine' ? 'No open tasks assigned to you in this project.' : 'No open tasks in this project.';
    const status = text => div().p(12).text_size(12).text_color(t.muted).child(text);
    const stopResize = () => {
      if (!this.resizing) return;
      this.resizing = false;
      if (this.width) setShared('devkits.asana-preview-width', this.width);
    };
    return v_flex().id('asana-panel').size_full().min_h(0).rounded(10).shadow_xl().overflow_hidden().font_family('Arial').border(1).border_color(t.border).bg(t.background).text_color(t.foreground)
      .on_mouse_down('right', (_event, cx) => cx.stop_propagation())
      .on_click((_event, cx) => cx.stop_propagation())
      .on_scroll_wheel((_event, cx) => cx.stop_propagation())
      .when(Boolean(this.resizing), el => el.cursor_col_resize())
      .on_mouse_move((event, cx) => {
        if (!this.resizing) return;
        this.width = previewWidthAt(event.bounds, event.position.x, settings().zoom || 1);
        cx.notify();
      })
      .on_mouse_up('left', (_event, cx) => { stopResize(); cx.notify(); })
      .on_hover((inside, cx) => { if (!inside) { stopResize(); cx.notify(); } })
      .track_focus(this.handle).on_key_down((event, cx) => {
        if (!this.settingsOpen && this.needsToken === false) this.navigate(event, cx);
      })
      .child(this.toolbar(t, close))
      .child(h_flex().flex_1().min_h(0)
        .on_mouse_down('left', (_event, cx) => cx.stop_propagation())
        .child(v_flex().flex_1().min_w(0).min_h(0).h_full()
          .when(this.needsToken === null || (this.loading && !this.settingsOpen), el => el.child(status('Loading…')))
          .when(this.needsToken === true || this.settingsOpen, el => el.child(this.connect(t, close)))
          .when(ready && Boolean(this.error), el => el.child(div().id('asana-error').p(12).text_size(12)
            .text_color(t.destructive || t.foreground).child(this.error)))
          .when(ready && !this.loading && !this.error && !rows.length, el => el.child(status(empty)))
          .when(ready && bound && rows.length > 0, el => el.child(this.view() === 'board' ? this.board(t) : this.list(t))))
        .when(Boolean(this.selected) && ready, el => el
          .child(div().id('asana-resize').w(4).h_full().flex_none().cursor_col_resize()
            .bg(this.resizing ? t.border : t.background).hover(el => el.bg(t.border))
            .accessibility_label('Resize preview')
            .on_mouse_down('left', (_event, cx) => { cx.stop_propagation(); this.width = this.previewWidth(); this.resizing = true; cx.notify(); }))
          .child(this.preview(t, importTask))));
  }

  // The tasks and the preview split the space evenly until the divider is dragged; the dragged width is remembered.
  previewWidth() {
    return this.resizing ? this.width : shared('devkits.asana-preview-width') || null;
  }
}
