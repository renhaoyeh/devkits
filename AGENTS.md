# Development Guidelines

Read and follow [design.md](design.md) before making UI or interaction changes. Keep design decisions there rather than duplicating them here.

## Structure and Scope

- Keep each tool's implementation, assets, installation, and tests in its own directory. Herdr-related files belong under `herdr/`.
- Centralize SVG icons in `herdr/mods/devkits/assets/icons/`; keep other visual assets under the mod's `assets/` directory. Reuse existing assets and remove unused ones.
- Prefer the smallest complete change that fits the existing structure. Avoid unsolicited features, dependencies, abstractions, and duplicate controls.
- Treat reference projects as design references; do not add service connections or external infrastructure unless requested.

## Herdr Development

Follow [herdr/DEVELOPMENT.md](herdr/DEVELOPMENT.md) for native API references, implementation, safe live updates, and validation.

## Commit Messages

- Use Conventional Commits: `<type>(<optional scope>): <description>`.
- Use an English imperative description and a type such as `feat`, `fix`, `refactor`, `docs`, `test`, or `chore`; for example, `refactor(herdr): extract shared dropdown menu components`.
