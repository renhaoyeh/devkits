# Native workspace preview

Prepare an isolated empty project for devkits-zed:

```sh
node prepare.js
```

Use the printed home to open the preview in an HC background child terminal:

```sh
HERDR_APP_HOME=/printed/path HC_SESSION=zed-shell-copy herdr-app
```

The home contains only the shell, shared visual assets, a disposable workspace and
fresh program configuration directories. It does not install or mount Devkits
services. The README opens in the real central preview beside the real Files tree.
No agent is started automatically. Existing destinations are refused; use
`--home /new/path` to choose a persistent location.

Source: ../mods/devkits-zed. Follow ../../design.md and ../DEVELOPMENT.md for UI
work. The sample workspace includes snapshots of those instructions for reference.
The default preview contains only the workspace shell. To include the Asana popup entry, use `node prepare.js --extension devkits-asana`. Keep the user's requested preview open.
