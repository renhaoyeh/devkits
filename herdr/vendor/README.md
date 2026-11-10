# Reference sources

`everything-claude-code/` is a Git submodule of [Everything Claude Code](https://github.com/affaan-m/everything-claude-code).

After cloning Devkits, fetch the pinned source with:

```sh
git submodule update --init --recursive
```

The upstream source is available for integration and reference. Adding the submodule does not install its hooks, skills, MCP servers or account configuration. The installer bundles its source under Devkits data for the global ECC settings panel. Devkits tests are scoped to `herdr/test/*.test.js` so upstream tests do not run as part of this repository's checks.
