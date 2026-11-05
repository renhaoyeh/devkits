# Herdr

A native Herdr layout and GPUI mod with shadcn styling and a Zed-inspired project and thread sidebar.

## Install

Requires Herdr App and Node.js 22+. Run from the repository root:

```sh
npm run install:herdr
herdr-app check ~/.config/herdr-app/mods/devkits
herdr-app do layout.switch --name devkits
```

If `herdr-app` is not on PATH, use `~/.local/bin/herdr-app`.
The installer adds the custom layout, mod, and themes to `~/.config/herdr-app/` and refuses to overwrite existing files. For updates or a custom `HERDR_APP_HOME`, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Use

The top-right usage bar follows **Add session → Manage…** visibility and ordering, including Terminal. Every visible entry keeps a meter track. Local Codex accounts show separate **5h** and **Week** used meters for the windows actually returned; a weekly-only account shows only **Week**. Each meter keeps its used percentage beside the reset time: countdowns use hours/minutes below a day and days/hours for longer waits, such as **Resets in 6d 21h** (updated every minute). An elapsed reset shows **Reset due** until fresh data arrives; missing reset times show a dash. The fill follows usage, turning amber at 70% and red at 90% (green below 70%). These colors also apply in account details. Claude and other providers show **Not supported**. Unavailable quotas keep a gray track with an explanation. Click an entry for all quota windows, used and remaining percentages, reset times, the last update, or an error explanation. The details dialog uses the same relative reset countdowns for every quota window, updated every minute while open. Data refreshes every minute and after visibility changes. Only visible local Codex launchers are queried, using a temporary stdio app-server that stops after the request. Remote usage is marked unsupported. Node.js must remain on PATH; no devkit CLI is required.

Click the project name at the top and choose **Open folder…**. Opening a folder does not start a session; use the project's **+** to choose an agent or terminal. Close a workspace through its **⋯** menu.

Click the folder icon at the right of the status bar to toggle project files. The file tree appears on the right; the read-only preview appears on the left. `.md` and `.markdown` files open as a rendered Markdown reading preview with selectable text and scrolling. Other text files use a code preview with syntax highlighting, line numbers, soft wrapping, selection, and copying. Soft wrapping fits long lines to the preview width without changing file contents. Use arrow keys and Enter in the tree; click the status bar folder icon again or select a session in the sidebar to return to terminals. Local filesystem changes automatically update the tree and current preview, preserving expanded folders and selection. Remote folders, or local folders where native watching is unavailable, update every 10 seconds. Listing uses `sh` on the project's machine (macOS/Linux); `.git` and special files are omitted. Lists are limited to 500 entries per folder and 5,000 total, previews to 400,000 characters, and reads to Herdr's 1 MiB limit. Binary and unreadable files show an explanation.

Choose **Add session → Manage…** to open a large dialog and show or hide Terminal and individual installed agents or accounts. Terminal, built-in agents, and **Your accounts** have separate sections in both the dialog and menu. Drag a handle to reorder within a section; leave the dialog or press Escape to cancel a drag. Alternatively, select a row and press Alt + Up/Down to reorder. Visibility and order are saved across projects and app restarts; hiding an entry does not remove its account or stop running sessions. New entries appear after the saved entries in their section, and number shortcuts follow the visible agent order. Choose **Done** or press Escape to close the dialog.

For a local project, open **Add session → Manage…** and choose **+ Add account** on the **Codex** row. Name the account and continue with ChatGPT in your browser. Names accept 1–48 printable characters, including Chinese and uppercase letters. Completing or cancelling sign-in returns to Manage; a connected account appears as **Codex · name**, ready to show, hide, or reorder. It does not start a work session automatically.

The inline permissions Select on the Codex row and each custom Codex account sets that launcher's default for new sessions. It shows names without subtitles: **Default** (neutral), **Read only** (blue), **Workspace** (green), **Full access** (red), with explanations in tooltips. **Default** keeps its existing command and Codex configuration; **Read only** uses `--sandbox read-only --ask-for-approval on-request`; **Workspace** uses `--sandbox workspace-write --ask-for-approval on-request`; **Full access** uses `--sandbox danger-full-access --ask-for-approval never`, allowing commands outside the sandbox without approval. These flags follow the [official Codex CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli). The setting is saved per launcher, replaces conflicting permission flags, and does not change existing sessions, account credentials, other agents or Codex config files.

Login runs inside the plugin using the official `codex app-server`, without a devkit CLI or wrapper. Each new account has a fixed, automatically allocated ID and its own `data/devkits/codex/<id>/` under Herdr's config directory. The display name is never used as a path or command argument; `Work` and `work` stay separate even on case-insensitive disks. Existing account entries retain their original paths, and the default `.codex` directory is not copied. Codex stores and refreshes its credentials. The temporary server listens only on a random localhost port and stops when login finishes, fails, times out, or the dialog closes. If adding the menu entry fails, retrying in the same dialog reuses the ID and credentials, even if the display name changes. Codex currently marks WebSocket transport as experimental.

Account entries are merged into `programs.json` with an atomic compare-and-swap. Existing entries are preserved; duplicate labels and concurrent settings changes are not overwritten. These local account entries are hidden from remote project menus.

On a row in **Your accounts**, choose **Remove** and confirm to run `codex logout` against that account's dedicated Devkits directory, then remove its menu entry and saved visibility/order preferences. History and project files are kept. Running sessions are not closed, but may require sign-in again. Built-in agents cannot be removed this way. External or shared credential directories are rejected. Logout failures keep the entry; if logout succeeds but settings cannot be updated, the dialog explains the partial result and allows a retry.

To return to Herdr's default layout:

```sh
herdr-app do layout.switch --name main
```

See [design guidelines](../design.md) and the [development workflow](DEVELOPMENT.md) for further changes.
