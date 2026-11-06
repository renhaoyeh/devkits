import { div, svg } from 'gpui-kit';
import { v_flex, h_flex, InputState, Input, TextView } from 'gpui-base';
import { appHome, readTextFile, writeTextFile, shared, setShared, theme, settings, openOverlay, closeOverlay } from 'herdr';
import { folderKey } from './model.js';
import { Button } from './components/button.js';
import { DialogTitle, DialogDescription } from './components/dialog.js';
import { DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from './components/dropdown-menu.js';

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

// Saved tasks missing from the project list are checked one by one: a task that became a subtask leaves the list but still exists.
export function reconcileSaved(saved, listed, details, project) {
  return saved.flatMap(item => {
    const task = listed.find(task => task.gid === item.gid);
    if (task) return [{ gid: item.gid, name: task.name, parent: null, moved: false }];
    const detail = details[item.gid];
    if (detail === undefined) return [item];
    if (detail === null || detail.completed) return [];
    return [{ gid: item.gid, name: detail.name, parent: detail.parent?.name || null,
      moved: !detail.parent && !detail.projects.includes(project) }];
  });
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
  const notes = task.notes.trim();
  const comments = (task.comments || []).slice(-commentLimit).map(comment => {
    const text = comment.text.length > commentLength ? `${comment.text.slice(0, commentLength)}…` : comment.text;
    return `- ${comment.author}${comment.at ? ` (${comment.at.slice(0, 10)})` : ''}: ${text.replace(/\s*\n\s*/g, ' ')}`;
  });
  return [`Work on this Asana task: ${task.name}`, task.url,
    task.parent && [`It is a subtask of: ${task.parent.name}`, task.parent.url].filter(Boolean).join('\n'),
    notes && `Description:\n${clip(notes)}`,
    comments.length && `Latest comments${task.comments.length > comments.length ? ` (${comments.length} of ${task.comments.length})` : ''}:\n${comments.join('\n')}`]
    .filter(Boolean).join('\n\n');
}

export async function readAsanaToken() {
  try { return JSON.parse(await readTextFile(tokenPath()) || 'null')?.token || null; } catch { return null; }
}

export async function saveAsanaToken(token) {
  const current = await readTextFile(tokenPath());
  await writeTextFile(tokenPath(), `${JSON.stringify({ token }, null, 2)}\n`, current);
}

// Bindings and saved tasks belong to the Devkits project folder and stay on this computer.
const projectKey = folder => JSON.stringify(['', folderKey(folder)]);
const binding = folder => shared('devkits.asana-projects')?.[projectKey(folder)] || null;
export const savedTasks = folder => shared('devkits.asana-saved')?.[projectKey(folder)] || [];
const setSavedTasks = (folder, list) => setShared('devkits.asana-saved', { ...(shared('devkits.asana-saved') || {}), [projectKey(folder)]: list });
// Bounds and positions are in zoomed pixels; the list and the preview each keep at least 320px.
export const previewWidthAt = (bounds, x, zoom) =>
  Math.round(Math.max(320, Math.min(bounds.width / zoom - 320, (bounds.x + bounds.width - x) / zoom)));
// Asana sections are free text; their names map to Linear's status kinds.
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
export const unsaveTask = (folder, gid) => setSavedTasks(folder, savedTasks(folder).filter(item => item.gid !== gid));

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
    const t = theme(), current = binding(this.folder)?.gid;
    return DropdownMenuContent('asana-project-picker', 360, t).track_focus(this.handle)
      .on_key_down((event, cx) => {
        if (event.key === 'escape') closeOverlay(this.overlay);
        else if (event.key === 'enter') this.choose(this.projects[this.index]);
        else if ((event.key === 'down' || event.key === 'up') && this.projects.length)
          this.index = (this.index + (event.key === 'down' ? 1 : this.projects.length - 1)) % this.projects.length;
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(Input.new(this.search).id('asana-project-search').accessibility_label('Search Asana projects')
        .h(32).flex_none().px(8).rounded(0).border_b(1).border_color(t.input).text_size(13))
      .child(DropdownMenuLabel(t).child('PROJECTS'))
      .child(v_flex().id('asana-project-list').flex_1().min_h(0).overflow_y_scrollbar().gap(1)
        .children(this.projects.map((project, index) => DropdownMenuItem(`asana-project-${project.gid}`, t)
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

// Asana's project as a read-only List or Board, with a preview beside it. Nothing starts until Start session is chosen.
export default class AsanaPanel {
  init(cx) {
    this.handle = cx.focus_handle();
    this.tab = shared('devkits.asana-tab') || 'mine';
    this.folder = undefined;
    this.reset();
    this.search = InputState.new({ placeholder: 'Search tasks' });
    this.search.on('change', (_event, cx) => cx.notify());
    this.tokenInput = InputState.new({ placeholder: 'Personal access token' });
    this.tokenInput.set_masked(true);
    this.tokenInput.on('submit', (_event, cx) => this.saveToken(cx));
  }

  reset() {
    this.mine = null; this.all = { tasks: [], next: null, loaded: false }; this.loadingMore = false; this.page = (this.page || 0) + 1;
    this.subtasks = new Map(); this.expanded = new Set(); this.loadedGid = null; this.loading = false;
    this.selected = null; this.cursor = null; this.detail = null; this.detailError = null; this.error = null;
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
        const missing = savedTasks(folder).filter(item => !mine.some(task => task.gid === item.gid));
        const details = Object.fromEntries(await Promise.all(missing.map(async item => {
          try { return [item.gid, await taskDetails(this.token, item.gid, gid)]; } catch { return [item.gid, undefined]; }
        })));
        // Saved tasks outside Mine that are still in this project count as listed, not moved.
        const listed = [...mine, ...Object.values(details).filter(detail => detail?.projects?.includes(gid))];
        setSavedTasks(folder, reconcileSaved(savedTasks(folder), listed, details, gid));
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

  saveToken(cx) {
    const token = this.tokenInput.value().trim();
    if (!token) return;
    cx.spawn(async cx => {
      try { await saveAsanaToken(token); this.token = token; this.needsToken = false; this.error = null; this.loadedGid = null; }
      catch (error) { this.error = error.message; }
      cx.notify();
    });
  }

  toggleSaved(task) {
    const list = savedTasks(this.folder);
    setSavedTasks(this.folder, list.some(item => item.gid === task.gid) ? list.filter(item => item.gid !== task.gid)
      : [...list, { gid: task.gid, name: task.name, parent: task.parent?.name || task.parent || null, moved: false }]);
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

  // The preview always reads the task fresh; saved entries only remember which task it was.
  show(task, cx) {
    const gid = task.gid;
    this.selected = gid; this.cursor = gid; this.detail = null; this.detailError = null;
    cx.spawn(async cx => {
      try {
        const detail = await taskDetails(this.token, gid, binding(this.folder)?.gid);
        if (this.selected !== gid) return;
        if (!detail || detail.completed) this.detailError = 'This task was completed or deleted in Asana.';
        else {
          this.detail = detail;
          if (detail.subtasks && !this.subtasks.has(gid)) this.loadSubtasks(detail, cx);
          this.loadComments(detail, cx);
        }
      } catch (error) { if (this.selected === gid) { this.detailError = error.message; if (error.unauthorized) this.fail(error); } }
      cx.notify();
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

  // Saved rows use the live task when it is still in the project; the rest keep their saved name.
  visible() {
    const query = this.search.value();
    const saved = savedTasks(this.folder);
    const base = this.tab === 'saved' ? saved.map(item => {
      const task = [...(this.mine || []), ...this.all.tasks].find(task => task.gid === item.gid);
      return task || { ...item, subtasks: 0, section: item.parent ? 'Subtasks' : item.moved ? 'Not in this project' : 'Saved' };
    }) : this.tab === 'mine' ? this.mine || [] : this.all.tasks;
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
    const nested = this.tab !== 'saved' && !this.search.value().trim() && this.view() === 'list';
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
    const saved = savedTasks(this.folder).length;
    const toggle = (id, label, active, action) => Button(id, t, { variant: 'ghost' }).h(24).px(8)
      .when(active, el => el.bg(t.selected).text_color(t.foreground))
      .accessibility_label(`${label}${active ? ', selected' : ''}`)
      .on_click((_event, cx) => { action(); cx.notify(); }).child(label);
    return h_flex().h(40).flex_none().pl(12).pr(4).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_size(12)
      .child(DropdownMenuTrigger(Button('asana-project-menu', t, { variant: 'ghost' }).h(28).px(8).gap(6).font_medium().text_color(t.foreground)
        .accessibility_label('Choose Asana project').disabled(!ready), 360,
        (_cx, at) => { if (ready) openOverlay({ mod: 'devkits', kind: 'popup', frame: 'none', width: 360, at, props: { view: 'asana-projects', folder: this.folder } }); })
        .child(div().max_w(220).truncate().child(bound?.name || 'Choose Asana project'))
        .child(glyph('chevron-down', 12).text_color(t.muted)))
      .when(ready && Boolean(bound), el => el
        .child(h_flex().gap(2)
          .child(toggle('asana-view-list', 'List', this.view() === 'list', () => setShared('devkits.asana-view', 'list')))
          .child(toggle('asana-view-board', 'Board', this.view() === 'board', () => setShared('devkits.asana-view', 'board'))))
        .child(div().w(1).h(16).bg(t.border))
        .child(h_flex().gap(2)
          .children([['mine', 'Mine'], ['all', 'All'], ['saved', `Saved${saved ? ` ${saved}` : ''}`]].map(([value, label]) =>
            toggle(`asana-tab-${value}`, label, this.tab === value, () => { this.tab = value; setShared('devkits.asana-tab', value); })))))
      .child(div().flex_1())
      .when(ready && Boolean(bound), el => el.child(Input.new(this.search).id('asana-search').accessibility_label('Search tasks')
        .w(220).h(28).px(8).rounded(0).border_b(1).border_color(t.input).text_size(12)))
      .when(ready, el => el.child(Button('asana-change-token', t, { variant: 'ghost' }).h(24).px(8)
        .on_click((_event, cx) => { this.needsToken = true; this.error = null; this.tokenInput.focus(); cx.notify(); }).child('Token')))
      .child(Button('asana-close', t, { variant: 'ghost', size: 'icon' }).accessibility_label('Close Asana tasks')
        .on_click(close).child(glyph('close')));
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

  // Section headers read as dividers, not issues: a ruled strip with a small uppercase muted label, like menu section labels.
  sectionLabel(group, t) {
    return h_flex().h(32).flex_none().px(16).gap(8).items_center().bg(t.chrome).border_t(1).border_b(1).border_color(t.border)
      .child(this.status(group.name, t, 12))
      .child(div().min_w(0).truncate().text_size(11).font_medium().text_color(t.muted).child(group.name.toUpperCase()))
      .child(div().flex_none().text_size(11).text_color(t.muted).child(String(group.tasks.length)));
  }

  // Section headers, task rows and Load more, in display order.
  listItems() {
    const nested = this.tab !== 'saved' && !this.search.value().trim();
    const items = this.groups().flatMap(group => [{ key: `section:${group.name}`, group },
      ...group.tasks.flatMap(task => [{ key: `task:${task.gid}`, task, depth: 0, section: group.name, nested },
        ...(nested && this.expanded.has(task.gid) ? (this.subtasks.get(task.gid) || []).map(sub => ({ key: `task:${sub.gid}:${task.gid}`, task: sub, depth: 1 })) : [])])]);
    if (this.tab === 'all' && this.all.next) items.push({ key: 'more' });
    return items;
  }

  // Linear's list: borderless rows with status, title, then quiet metadata on the right.
  // A plain scroll list: pages keep it to a few hundred rows, and hover then stays in GPUI instead of rebuilding rows in script each frame.
  list(t) {
    const saved = new Set(savedTasks(this.folder).map(item => item.gid));
    const row = item => {
      if (item.group) return this.sectionLabel(item.group, t);
      if (!item.task) return h_flex().id('asana-load-more').h(36).flex_none().px(16).gap(8).items_center().text_size(12).text_color(t.muted)
        .cursor_pointer().hover(el => el.bg(t.hover)).on_click((_event, cx) => this.more(cx))
        .child(glyph('chevron-down', 12)).child(this.loadingMore ? 'Loading…' : 'Load more tasks');
      const { task, depth } = item;
      return h_flex().id(`asana-${item.key}`).h(36).flex_none().pl(16 + depth * 22).pr(16).gap(10).items_center().cursor_pointer()
        .opacity(task.moved ? 0.5 : 1).accessibility_label(task.name)
        .bg(this.selected === task.gid ? t.selected : t.background).hover(el => el.bg(this.selected === task.gid ? t.selected : t.hover))
        .on_click((_event, cx) => { this.handle.focus(); this.show(task, cx); })
        .child(this.status(depth ? null : item.section, t))
        .child(div().min_w(0).truncate().text_size(13).child(task.name))
        .when(item.nested && task.subtasks > 0, el => el.child(h_flex().id(`asana-expand-${task.gid}`).h(20).px(6).gap(4).flex_none().items_center()
          .border(1).border_color(t.border).text_size(11).text_color(t.muted).cursor_pointer().hover(el => el.bg(t.hover))
          .accessibility_label(`${this.expanded.has(task.gid) ? 'Hide' : 'Show'} ${task.subtasks} subtasks`)
          .on_click((_event, cx) => { cx.stop_propagation(); this.toggleExpanded(task, cx); })
          .child(glyph(this.expanded.has(task.gid) ? 'chevron-down' : 'chevron-right', 10)).child(String(task.subtasks))))
        .when(Boolean(task.parent) && !depth, el => el.child(div().flex_none().max_w(200).truncate().text_size(12).text_color(t.muted).child(`↳ ${task.parent}`)))
        .child(div().flex_1())
        .when(saved.has(task.gid), el => el.child(glyph('star-filled', 12).text_color(t.muted)))
        .child(this.due(task, t))
        .child(this.avatar(task, t));
    };
    return v_flex().id('asana-list').flex_1().min_h(0).overflow_y_scrollbar().children(this.listItems().map(row));
  }

  board(t) {
    const saved = new Set(savedTasks(this.folder).map(item => item.gid));
    return h_flex().id('asana-board').flex_1().min_h(0).overflow_x_scrollbar().p(12).gap(12)
      .children(this.groups().map(group => v_flex().w(300).flex_none().h_full().min_h(0)
        .child(h_flex().h(32).flex_none().px(4).gap(8).items_center()
          .child(this.status(group.name, t))
          .child(div().text_size(12).font_medium().child(group.name))
          .child(div().text_size(12).text_color(t.muted).child(String(group.tasks.length))))
        .child(v_flex().id(`asana-column-${group.name}`).flex_1().min_h(0).overflow_y_scrollbar().gap(8)
          .children(group.tasks.map(task => v_flex().id(`asana-card-${task.gid}`).flex_none().p(12).gap(10).cursor_pointer()
            .bg(this.selected === task.gid ? t.selected : t.popover).border(1).border_color(this.selected === task.gid ? t.solid : t.border)
            .opacity(task.moved ? 0.5 : 1).hover(el => el.border_color(t.solid)).accessibility_label(task.name)
            .on_click((_event, cx) => { this.handle.focus(); this.show(task, cx); })
            .when(Boolean(task.parent), el => el.child(div().truncate().text_size(11).text_color(t.muted).child(`↳ ${task.parent}`)))
            .child(div().text_size(13).font_medium().child(task.name))
            .child(h_flex().gap(8).items_center()
              .child(this.status(group.name, t, 12))
              .when(task.subtasks > 0, el => el.child(h_flex().h(20).px(6).items_center().border(1).border_color(t.border)
                .text_size(11).text_color(t.muted).child(`${task.subtasks} subtasks`)))
              .child(div().flex_1())
              .when(saved.has(task.gid), el => el.child(glyph('star-filled', 12).text_color(t.muted)))
              .child(this.due(task, t))
              .child(this.avatar(task, t))))))))
      .when(this.tab === 'all' && Boolean(this.all.next), el => el.child(Button('asana-load-more', t, { variant: 'outline' }).flex_none()
        .on_click((_event, cx) => this.more(cx)).child(this.loadingMore ? 'Loading…' : 'Load more tasks')));
  }

  connect(t) {
    return v_flex().flex_1().max_w(560).p(24).gap(16)
      .child(DialogTitle().child('Connect Asana'))
      .child(DialogDescription(t).child('Paste a personal access token from the Asana developer console. It is saved only on this computer, and Devkits never changes anything in Asana.'))
      .child(Input.new(this.tokenInput).id('asana-token').accessibility_label('Asana personal access token')
        .h(36).px(10).rounded(0).border_b(1).border_color(t.input).text_size(13))
      .when(Boolean(this.error), el => el.child(div().id('asana-error').text_size(12).text_color(t.destructive || t.foreground).child(this.error)))
      .child(h_flex().child(Button('asana-save-token', t).on_click((_event, cx) => this.saveToken(cx)).child('Connect')));
  }

  // Linear's issue view: title, description and sub-issues, with properties as label and value rows.
  preview(t, startMenu) {
    const task = this.detail;
    const saved = task && savedTasks(this.folder).some(item => item.gid === task.gid);
    const subtasks = task ? this.subtasks.get(task.gid) : null;
    const width = this.previewWidth();
    const property = (label, value) => h_flex().h(28).gap(12).items_center()
      .child(div().w(80).flex_none().text_size(12).text_color(t.muted).child(label))
      .child(h_flex().flex_1().min_w(0).gap(8).items_center().text_size(13).children([].concat(value)));
    return v_flex().id('asana-preview').when(Boolean(width), el => el.w(width).flex_none()).when(!width, el => el.flex_1().min_w(0))
      .min_h(0).h_full().bg(t.background).border_l(1).border_color(t.border)
      .child(h_flex().h(40).flex_none().pl(16).pr(4).gap(6).items_center().border_b(1).border_color(t.border).text_size(12)
        .child(h_flex().flex_1().min_w(0).gap(6).items_center().text_color(t.muted)
          .child(div().flex_none().max_w(160).truncate().child(binding(this.folder)?.name || 'Asana'))
          .when(Boolean(task?.parent), el => el.child('›').child(div().id('asana-parent-crumb').min_w(0).truncate().cursor_pointer()
            .hover(el => el.text_color(t.foreground)).on_click((_event, cx) => this.show(task.parent, cx)).child(task.parent.name))))
        .when(Boolean(task), el => el
          .child(Button('asana-open', t, { variant: 'ghost' }).h(28).px(8).accessibility_label('Open in Asana')
            .on_click((_event, cx) => cx.open_url(task.url)).child('Open in Asana'))
          .child(Button('asana-save', t, { variant: 'outline' }).h(28).px(8).gap(6)
            .accessibility_label(saved ? 'Remove from Saved' : 'Save for later on this computer')
            .on_click((_event, cx) => { this.toggleSaved(task); cx.notify(); })
            .child(glyph(saved ? 'star-filled' : 'star', 12)).child(saved ? 'Saved' : 'Save for later'))
          .child(DropdownMenuTrigger(Button('asana-start', t).h(28).px(10).gap(6).accessibility_label('Start a session for this task'), 280,
            (_cx, at) => startMenu(task, at), 'end').child(glyph('plus', 12)).child('Start session')))
        .child(Button('asana-close-preview', t, { variant: 'ghost', size: 'icon' }).accessibility_label('Close preview')
          .on_click((_event, cx) => { this.selected = null; this.detail = null; cx.notify(); }).child(glyph('close'))))
      .child(v_flex().id(`asana-preview-${this.selected}`).flex_1().min_h(0).overflow_y_scrollbar().px(32).py(28).gap(24)
        .when(!task, el => el.child(div().text_size(13).text_color(this.detailError ? t.destructive || t.foreground : t.muted)
          .child(this.detailError || 'Loading…')))
        .when(Boolean(task), el => el
          .child(div().text_size(22).font_semibold().line_height('30px').child(task.name))
          .child(v_flex().gap(2)
            .child(property('Status', [this.status(task.section, t), div().child(task.section || 'No section')]))
            .child(property('Assignee', [this.avatar(task, t), div().text_color(task.assignee ? t.foreground : t.muted).child(task.assignee || 'Unassigned')]))
            .child(property('Due date', task.due ? this.due(task, t).text_size(13) : div().text_color(t.muted).child('No due date'))))
          .child(div().h(1).flex_none().bg(t.border))
          .child(task.notes.trim() ? TextView.markdown(`asana-notes-${task.gid}`, task.notes).selectable(true).scrollable(false).w_full()
            : div().text_size(13).text_color(t.muted).child('No description.'))
          .when(task.subtasks > 0, el => el.child(v_flex().gap(4)
            .child(h_flex().gap(8).items_center().text_size(13).font_medium()
              .child('Sub-issues').child(div().text_color(t.muted).font_normal().child(String(task.subtasks))))
            .child(v_flex().border(1).border_color(t.border)
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
                .child(TextView.markdown(`asana-comment-text-${comment.gid}`, comment.text).selectable(true).scrollable(false).w_full())))))));
  }

  render(project, startMenu, close, cx) {
    if (this.folder !== (project?.folder || null)) this.open(project, cx);
    this.sync(cx);
    const t = theme();
    const ready = this.needsToken === false, bound = Boolean(binding(this.folder));
    const rows = ready && bound ? this.rows() : [];
    const empty = !bound ? 'Choose the Asana project for this Devkits project from the menu above.' : this.tab === 'saved' ? 'No saved tasks.'
      : this.search.value().trim() ? 'No matching tasks.' : this.tab === 'mine' ? 'No open tasks assigned to you in this project.' : 'No open tasks in this project.';
    const status = text => div().p(12).text_size(12).text_color(t.muted).child(text);
    const stopResize = () => {
      if (!this.resizing) return;
      this.resizing = false;
      if (this.width) setShared('devkits.asana-preview-width', this.width);
    };
    return v_flex().id('asana-panel').size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .when(Boolean(this.resizing), el => el.cursor_col_resize())
      .on_mouse_move((event, cx) => {
        if (!this.resizing) return;
        this.width = previewWidthAt(event.bounds, event.position.x, settings().zoom || 1);
        cx.notify();
      })
      .on_mouse_up('left', (_event, cx) => { stopResize(); cx.notify(); })
      .on_hover((inside, cx) => { if (!inside) { stopResize(); cx.notify(); } })
      .track_focus(this.handle).on_key_down((event, cx) => this.navigate(event, cx))
      .child(this.toolbar(t, close))
      .child(h_flex().flex_1().min_h(0)
        .child(v_flex().flex_1().min_w(0).min_h(0).h_full()
          .when(this.needsToken === null || this.loading, el => el.child(status('Loading…')))
          .when(this.needsToken === true, el => el.child(this.connect(t)))
          .when(ready && Boolean(this.error), el => el.child(div().id('asana-error').p(12).text_size(12)
            .text_color(t.destructive || t.foreground).child(this.error)))
          .when(ready && !this.loading && !this.error && !rows.length, el => el.child(status(empty)))
          .when(ready && bound && rows.length > 0, el => el.child(this.view() === 'board' ? this.board(t) : this.list(t))))
        .when(Boolean(this.selected) && ready, el => el
          .child(div().id('asana-resize').w(4).h_full().flex_none().cursor_col_resize()
            .bg(this.resizing ? t.border : t.background).hover(el => el.bg(t.border))
            .accessibility_label('Resize preview')
            .on_mouse_down('left', (_event, cx) => { cx.stop_propagation(); this.width = this.previewWidth(); this.resizing = true; cx.notify(); }))
          .child(this.preview(t, startMenu))));
  }

  // The tasks and the preview split the space evenly until the divider is dragged; the dragged width is remembered.
  previewWidth() {
    return this.resizing ? this.width : shared('devkits.asana-preview-width') || null;
  }
}
