# Design Guidelines

- Use a consistent **shadcn/ui visual language across the entire interface**, including menus, dialogs, sidebars, headers, and empty states. Styling a few controls is not enough.
- Follow shadcn Neutral colors, semantic theme tokens, subtle borders, modest corner radii, and restrained shadows. Keep hover, focus, and selection states consistent.
- Prefer compact layouts, aligned edges, and clear visual hierarchy. Avoid redundant labels when an icon or nearby context already conveys the information.
- Use Zed as the reference for project, workspace, and thread interactions. Follow its placement and behavior when relevant, rather than loosely borrowing its appearance.
- Implement the design with Herdr's native GPUI components. Do not introduce React, a webview, or runtime UI dependencies just to reproduce the style.
- Define reusable UI components in independent files under `herdr/mods/devkits/components/`, grouped by shadcn component family (for example, `dropdown-menu.js`). Screens compose these components rather than duplicating their styling.
- Follow shadcn's component names and composition: use PascalCase exports such as `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuLabel`, and `DropdownMenuSeparator`. Use the name that matches the part's role; the menu surface is `DropdownMenuContent`, not a generic `menu` helper. Keep project and session actions in their callers.
- Reuse these components for every instance of the same UI pattern. Keep shared colors, spacing, borders, radii, and interaction states in the component file; use the installed Herdr API for native behavior and accessibility.
