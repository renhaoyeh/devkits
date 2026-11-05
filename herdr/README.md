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

Click the project name at the top and choose **Open folder…**. Opening a folder does not start a session; use the project's **+** to choose an agent or terminal. Close a workspace through its **⋯** menu.

Choose **Add session → Manage…** to open a large dialog and show or hide Terminal and individual installed agents or accounts. Terminal, built-in agents, and **Your accounts** have separate sections in both the dialog and menu. Drag a handle to reorder within a section; leave the dialog or press Escape to cancel a drag. Alternatively, select a row and press Alt + Up/Down to reorder. Visibility and order are saved across projects and app restarts; hiding an entry does not remove its account or stop running sessions. New entries appear after the saved entries in their section, and number shortcuts follow the visible agent order. Choose **Done** or press Escape to close the dialog.

For a local project, open **Add session → Manage…** and choose **+ Add account** on the **Codex** row. Name the account and continue with ChatGPT in your browser. Names accept 1–48 printable characters, including Chinese and uppercase letters. Completing or cancelling sign-in returns to Manage; a connected account appears as **Codex · name**, ready to show, hide, or reorder. It does not start a work session automatically.

Login runs inside the plugin using the official `codex app-server`, without a devkit CLI or wrapper. Each new account has a fixed, automatically allocated ID and its own `data/devkits/codex/<id>/` under Herdr's config directory. The display name is never used as a path or command argument; `Work` and `work` stay separate even on case-insensitive disks. Existing account entries retain their original paths, and the default `.codex` directory is not copied. Codex stores and refreshes its credentials. The temporary server listens only on a random localhost port and stops when login finishes, fails, times out, or the dialog closes. If adding the menu entry fails, retrying in the same dialog reuses the ID and credentials, even if the display name changes. Codex currently marks WebSocket transport as experimental.

Account entries are merged into `programs.json` with an atomic compare-and-swap. Existing entries are preserved; duplicate labels and concurrent settings changes are not overwritten. These local account entries are hidden from remote project menus.

On a row in **Your accounts**, choose **Remove** and confirm to run `codex logout` against that account's dedicated Devkits directory, then remove its menu entry and saved visibility/order preferences. History and project files are kept. Running sessions are not closed, but may require sign-in again. Built-in agents cannot be removed this way. External or shared credential directories are rejected. Logout failures keep the entry; if logout succeeds but settings cannot be updated, the dialog explains the partial result and allows a retry.

To return to Herdr's default layout:

```sh
herdr-app do layout.switch --name main
```

See [design guidelines](../design.md) and the [development workflow](DEVELOPMENT.md) for further changes.
