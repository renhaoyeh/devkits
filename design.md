# Design Guidelines

- Use a consistent **shadcn/ui visual language across the entire interface**, including menus, dialogs, sidebars, headers, and empty states. Styling a few controls is not enough.
- Follow shadcn Neutral colors, semantic theme tokens, subtle borders, modest corner radii, and restrained shadows. Keep hover, focus, and selection states consistent.
- Prefer compact layouts, aligned edges, and clear visual hierarchy. Avoid redundant labels when an icon or nearby context already conveys the information.
- Use Zed as the reference for project, workspace, and thread interactions. Follow its placement and behavior when relevant, rather than loosely borrowing its appearance.
- Implement the design with Herdr's native GPUI components. Do not introduce React, a webview, or runtime UI dependencies just to reproduce the style.
