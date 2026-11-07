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

## 3. Check the source

Run from the repository root as appropriate for the change:

```sh
npm test
herdr-app check ./herdr/mods/devkits
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
