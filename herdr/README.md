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

To return to Herdr's default layout:

```sh
herdr-app do layout.switch --name main
```

See [design guidelines](../design.md) and the [development workflow](DEVELOPMENT.md) for further changes.
