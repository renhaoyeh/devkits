# Devkits

A native Herdr workspace with a Zed-inspired project and thread sidebar and shadcn/ui Sera styling. This recipe describes the interface; the files beside it are its implementation. Read the installed Herdr guide and matching type declarations before adapting it for a different Herdr version.

## What you see

- A project and thread sidebar, agent profiles with local quota meters, and a settings footer.
- The active thread's native terminal panes in the main workspace.
- Native panels for files, Git changes and history, and token statistics.
- Light and dark Devkits themes and an optional iOS Simulator panel on macOS.

See [README.md](README.md) for the current interactions and optional features, and [design.md](../design.md) for design decisions when adapting the interface.

## Built from

Install the complete bundle, keeping these paths relative to the Herdr home:

| Source in this directory | Installed path |
| --- | --- |
| `layouts/devkits.json` | `layouts/devkits.json` |
| `mods/devkits/` | `mods/devkits/` |
| `mods/devkits-simulator/` | `mods/devkits-simulator/` |
| `mods/devkits-sim-frames/` | `mods/devkits-sim-frames/` |
| `themes/devkits.json` | `themes/devkits.json` |
| `themes/devkits-light.json` | `themes/devkits-light.json` |

The layout references the companion mods, themes, and preview asset. Keep their names and paths together. The simulator mods use `place: "none"` so Herdr does not dock them automatically.

## Add it to Herdr

Read `~/.config/herdr-app/AGENTS.md` first, using `HERDR_APP_HOME` instead when configured. Inspect the bundle's code and assets before installing it; mods are executable code. Use the installed `herdr.d.ts` and `gpui-kit.d.ts` as the API reference.

Get the source from https://github.com/renhaoyeh/devkits, or use the checkout supplied by the user. Requires Herdr App and Node.js 22+. On Windows, keep Node.js and Git for Windows on Herdr's PATH; WSL is not required.

For a first install, run from the repository root:

```sh
npm run install:herdr
```

No `npm install` is needed. The installer uses Node built-ins and honors `HERDR_APP_HOME`. It adds only the bundle listed above and refuses existing destinations. If those paths already exist, inspect the differences rather than deleting them or bypassing that refusal. For a requested update, follow [DEVELOPMENT.md](DEVELOPMENT.md) to compare, back up, and selectively update custom files.

## Watch out

- Add Devkits alongside the person's layouts. Preserve global settings, shortcuts, account data, and sessions.
- Node.js must remain available for runtime helpers. Agent CLIs are needed only for the agents the person uses; iOS Simulator features require macOS and Xcode.
- Installing the layout does not require signing into accounts, connecting Asana, installing plugins, or starting agents. Those are optional actions described in the README.
- The layout hot reloads. Do not restart Herdr or its core, or disturb existing terminals, to install or validate it.
- Do not edit Herdr's generated guides, type declarations, or bundled mods. For compatibility fixes, work from this repository's source and follow its development instructions.

## Done when

Using the resolved Herdr home in place of the default paths below:

```sh
herdr-app check ~/.config/herdr-app/mods/devkits
herdr-app check ~/.config/herdr-app/mods/devkits-simulator
herdr-app check ~/.config/herdr-app/mods/devkits-sim-frames
herdr-app do layout.switch --name devkits
herdr-app status
```

All three mod checks pass before switching. The running window shows Devkits without new file or mod errors, and existing sessions remain available. Capture and inspect `herdr-app shot` to verify the visible result. If no window is running, report file installation and check results, and tell the person to select Devkits when they open Herdr; leave the visual check explicitly unverified.
