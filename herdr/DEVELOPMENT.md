# Herdr Development Workflow

This is the repeatable workflow for developing the custom Herdr interface. Product design principles live in [design.md](../design.md); current behavior and installation instructions live in [README.md](README.md).

## 1. Inspect before editing

- Read `~/.config/herdr-app/AGENTS.md`. Use the accompanying `herdr.d.ts` and `gpui-kit.d.ts` as the API reference for the installed version.
- Find the affected code and callers with `rg`, then inspect the relevant layout, theme, assets, and tests. Include all affected files in the change.
- Use existing native components and patterns. Consult Herdr source when API behavior is unclear; reference projects inform design, not runtime dependencies.

## 2. Make the smallest complete change

| Concern | Source |
| --- | --- |
| Window structure and block sizes | `layouts/devkits.json` |
| Native views and interactions | `mods/devkits/main.js` |
| Workspace Interface settings | `mods/devkits/ui-settings.js`; distinct from Herdr settings and agent/account settings |
| SYSTEM sampling, settings and details | `mods/devkits-system/`; consumer SDK in `mods/devkits/components/system-monitor.js` |
| Asana and MantisBT source browsers | `mods/devkits-asana/`, `mods/devkits-mantisbt/`; Tasks adapter in `mods/devkits-tasks/task-sources.js` |
| Tasks data, progress, board, composer and execution | `mods/devkits-tasks/`; public SDK in `mods/devkits/components/tasks.js` |
| Calendar events, views and task references | `mods/devkits-calendar/` |
| Quota usage, details and token statistics | `mods/devkits-usage/`; public client in `mods/devkits/components/usage.js` |
| Shared native UI components | `mods/devkits/components/`; other mods carry copies (`COPIES`, `sync-shared.js`) |
| iOS Simulator panel | `mods/devkits-simulator/` |
| Project and thread data transformations | `mods/devkits/model.js` |
| Semantic colors | `themes/devkits.json`, `themes/devkits-light.json` |
| Icons and preview | `mods/devkits/assets/` |
| Installation | `install.js` |
| Behavior checks | `test/*.test.js` (native UI mocks and focused module tests) |

- Edit this repository first; it is the installable source. Modify only the custom layout, mod, and themes, not Herdr's bundled or generated files.
- Use `theme()` tokens. Use native async and animation APIs; do not retain a view context beyond its lifetime or use browser timers.
- Add a focused test for new nontrivial logic. Existing tests use mocked native APIs and temporary directories so they do not operate on real sessions.

SYSTEM runs as the independent `devkits-system` mod. Its `service` view is mounted in the layout; it owns hardware readers, dependencies, sampling, bounded history, settings and details. Other mods bundle the public `components/system-monitor.js` SDK through `COPIES` and instantiate `SystemMonitor({ receiver: "your-mod-name", active, openDetails })`, calling `init(cx)` and `close()` with their view lifecycle. The SDK registers expiring consumer leases and receives serialized snapshots through Herdr's native mod command bus (`run`/`nextCommand`); it never starts a reader. The service is the only sampler, including while details are open. Do not use `sessionStorage` as a cross-mod transport: the installed runtime isolates it between script contexts. Live readings/history stay in session memory; only monitoring preferences persist.

The consumer interface is `snapshot()` (data, history, error, updatedAt and selected/available widget IDs), `renderInline(t, { id })`, `renderWidgets(t, { id, style, cpuMode })` and `open(page)`. A consumer chooses its own container and renderer, or draws directly from the snapshot. Give simultaneous mounts distinct IDs. The provider exposes `service`, `inline`, `widgets` and `details` native views. Rendered elements and callbacks belong to the current native view; never retain its context. Herdr's import boundary requires SDK copies within each mod, rather than runtime imports of another mod's source.

Asana and MantisBT each have their own `main.js`, API, connection storage and UI, and can open independently. The shared `source-channel.js` SDK uses Herdr shared state for short-lived JSON requests and events, removing each request on import or close: a caller creates a request with its context/binding, opens the provider with the channel ID, then consumes binding/import/close events. Providers return task snapshots with explicit domain fields, without credentials or native callbacks. Tasks' `TaskSources` adapter owns project bindings and opens a Tasks draft on import. Only confirming that draft creates a local Todo; task/session controls remain in `devkits-tasks`. Connection files and existing preference keys remain compatible. Historical source cards use the provider's finite, read-only `read-task.js` endpoint.

Tasks runs as the independent `devkits-tasks` mod, with its always-mounted `service` view tracking input evidence and reconciling progress even when the board is closed. It owns all task records, policies, source imports, drafts and execution preparation. It publishes a project-scoped read model in `devkits.tasks.snapshot` only when its contents change. Consumers bundle `components/tasks.js`, `tasks-model.js`, `session-model.js` and `session-shell.js` through `COPIES`. `projectBoardTasks`, `threadBoardStatus`, `threadBoardTask`, `taskLinkForTab`, `sessionThreadTitle` and `listTasks` read that public model without inferring progress or writing records. Short-lived serialized requests are revalidated by the owner; callers never import the provider's state/policy/UI implementation.

The shell mounts the Tasks board as the `tasks` child of its `editor` stack. `TaskHost` consumes navigation events and owns project selection, layout, native pane focus and generic thread creation/archive/restore. Tasks supplies prepared execution arguments and task metadata after validation; it does not name shell layout blocks. Requests and navigation cross mods through Herdr shared state, not JavaScript callbacks or `sessionStorage`. Existing record, draft, archive, profile and calendar preference keys remain compatible.

Calendar runs in `devkits-calendar`, owns its event storage and UI, and uses only the public Tasks index for mentions. Opening a reference requests owner validation and waits for acknowledgement before closing; missing/deleted tasks leave Calendar open with an inline error. Creation dialogs, backdrop dismissal and range cleanup stay inside Calendar. Generic session/project transformations and the scoped Tasks/Calendar palette live in canonical shared components; the shell's old `model.js` and `shell-command.js` paths forward to these components for compatibility.

Usage runs in `devkits-usage`, which owns quota readers, profile discovery, caching, quota details, token statistics and the Claude status-line recorder. Consumers bundle `components/usage.js` and its dependencies through `COPIES`, instantiate `UsageClient({ context: () => ({ machine }), active })`, and call `init(cx)`, `render(t)` and `close()` with their view lifecycle. `snapshot()` reads display-only data; `refresh()` requests a manual rediscovery/read. The SDK also exports `openUsageDetails(account)` and `openUsageAnalytics()`. It never executes readers or queries credentials. The host retains its placement, Usage visibility switch and account-selection controls.

The layout mounts Usage's `service` view. Native command messages carry expiring client activity/machine leases and manual refreshes; each machine has one coalesced monitor. Remote contexts discover remote profiles without querying local quotas. The provider publishes sanitized per-machine snapshots in `devkits.usage.snapshot`, retaining the existing `devkits.usage-cache` five-minute Codex cache and local analytics cache. Account command lines and arbitrary reader fields are excluded from the public projection. The shared `claude-usage-hook.js` helper lets account sign-in configure the provider's recorder without importing provider UI. The status-line entry exists only at `mods/devkits-usage/claude-statusline.js`; there is no forwarding entry for the former Devkits path. Recreate sessions configured with the removed path. Existing chains/backups are preserved.

Devkits' `system-display.js` is the consumer adapter. It scopes the right-click menu to SYSTEM mounts, leaving the sidebar/status roots and unrelated controls untouched. It owns frames, resize interactions and independent sidebar/status visibility. Sidebar widgets always use Compact presentation; normalize legacy Inline/History styles without resetting visibility, CPU mode or sizing. Only the status bar uses inline metrics. `ui-settings.js` consumes its preference helpers for a persistent Interface settings dialog opened from the sidebar footer; the header gear remains bound to Herdr app settings. Its SYSTEM and USAGE pages each put feature visibility before location and presentation. SYSTEM’s enabled flag gates both mounts and their subscriptions while preserving placement/style preferences; only selected locations expose their presentation controls. Sidebar widgets retain a rows/auto sizing mode and a 2/4/6 row count, defaulting to Auto height with six rows retained for presets; there is no custom pixel-height preference or editor. Presets use native card measurements in saved order, reported through renderWidgets’ optional onWidgetSize callback. Compact CPU modes share identical row geometry, so the host reuses card heights across mode switches. Include presentation and CPU mode in the native measurement-wrapper identity to obtain fresh size callbacks even when dimensions stay unchanged. Native scroll content does not provide its intrinsic outer height. Measure plain per-card layout wrappers, rather than native Buttons, and size the viewport from those actual laid-out heights without a bottom spacer. Both modes re-evaluate when measurements arrive. Use the monitor’s rendered size when starting a drag. Dragging snaps to the nearest row count and double-click resets four rows. USAGE keeps its existing master key, with a link from agent/account Usage settings. Pass the explicit surface into SYSTEM context menus so sidebar menus never expose bottom controls or the reverse. `system-display-model.js` normalizes its separate `devkits.system-display` preferences and migrates old display fields before SYSTEM can save monitoring settings. The host calls `renderStatus(t)` and `renderSidebar(t)`, wraps its sidebar with `sidebarContainer(root)` and measures the content above the monitor with `reservedSidebarContent(root)`. SYSTEM Settings must not expose Devkits placement or widget style controls.

## 3. Check the source

Run from the repository root as appropriate for the change:

```sh
npm test
herdr-app check ./herdr/mods/devkits
herdr-app check ./herdr/mods/devkits-system
herdr-app check ./herdr/mods/devkits-asana
herdr-app check ./herdr/mods/devkits-mantisbt
herdr-app check ./herdr/mods/devkits-tasks
herdr-app check ./herdr/mods/devkits-calendar
herdr-app check ./herdr/mods/devkits-usage
herdr-app check ./herdr/mods/devkits-simulator
herdr-app check ./herdr/mods/devkits-sim-frames
```

Use the installed `herdr-app` executable if it is not on PATH (`~/.local/bin/herdr-app` on a typical macOS/Linux installation). On Windows, Node.js and Git for Windows must be available on Herdr's PATH; WSL is not required. Check the relevant companion mods when their code or layout integration changes.

A mod can import only files in its own folder, so `devkits-simulator` carries copies of the devkits components it uses. Edit `mods/devkits/components/`, never a copy, then run `npm run sync:shared`; `npm test` fails while a copy differs. `COPIES` lists which mods carry which components; add a line when a mod starts using another one. A copy edited by hand is never overwritten: keep its change with `npm run sync:shared -- --from <copy>`, or move it into the source.

The native mod check is required after mod edits. It checks initial rendering, not layout geometry, deferred rows, or later async interactions; passing it does not replace checking the app.

## 4. Update the running app safely

The default destination is `~/.config/herdr-app/`; use the configured `HERDR_APP_HOME` when applicable. Layout, mod, and theme paths mirror the corresponding source directories.

- For a first install, use `npm run install:herdr`. The installer intentionally refuses existing destinations; it is not an update command.
- Before editing, compare installed files with the source baseline and save a temporary copy of the affected installed files outside the repository. Inspect any divergence rather than overwriting it.
- After source checks pass, verify the installed files still match the saved baseline, then copy only the intended changed files. Remove obsolete assets only when the change removes their use.
- Herdr watches these files and reloads them. Do not restart the app or switch layouts just to force an update during normal validation.
- Never overwrite unrelated layouts, settings, shortcuts, account data, or session state.

## 5. Verify the running result

For the default installation:

```sh
herdr-app check ~/.config/herdr-app/mods/devkits
herdr-app check ~/.config/herdr-app/mods/devkits-system
herdr-app check ~/.config/herdr-app/mods/devkits-asana
herdr-app check ~/.config/herdr-app/mods/devkits-mantisbt
herdr-app check ~/.config/herdr-app/mods/devkits-tasks
herdr-app check ~/.config/herdr-app/mods/devkits-calendar
herdr-app check ~/.config/herdr-app/mods/devkits-usage
herdr-app check ~/.config/herdr-app/mods/devkits-simulator
herdr-app check ~/.config/herdr-app/mods/devkits-sim-frames
herdr-app status
herdr-app shot
```

`shot` prints the saved image's path; inspect that image. Use a temporary destination outside the repository when supplying an explicit path.

- Check reported errors and confirm the active layout. Inspect the app for spacing, alignment, hover and focus states, and the changed interaction.
- `shot` captures the last rendered frame; it can be stale when the app is inactive. Confirm that the frame contains the change before treating it as visual evidence.
- Do not close, restart, send input to, or otherwise disturb the user's running agents or terminals during verification. Use mocks for destructive interaction checks.
- If the update fails, restore only the affected custom files from the saved copy. Do not reset the user's sessions or global configuration.
- Report what changed, which checks passed, and any visual or interaction checks that remain unverified.
