**Taco scope**: plan

## Intent

Taco should feel like a calm local reference manual, not a project-management dashboard. The shell follows Castrel's compact app chrome; the document body follows the familiar docs/wiki reading model.

## Surfaces

- **Paper**: a white document background.
- **File sidebar**: a light-neutral app surface with compact tree rows.
- **Document**: a reading column up to 900px wide.
- **Document properties**: a compact two-column key/value surface at the top of the Markdown, using the same quiet border, corner radius, and code treatment as tables, but without the extra height of table rows.
- **Document outline**: an untitled, quiet column on the right inside the Markdown editing surface, for H1–H3 navigation.
- **Source**: a dark monospace surface, distinct from the rendered body.

## Typography

- UI, document, and headings: the system sans-serif font.
- Source: the system monospace font.

No remote fonts are loaded.

## Color Roles

- `--paper`: app background
- `--surface`: documents, dialogs, and menus
- `--sidebar-surface`: the file navigation panel and the softened editor surface
- `--ink`: primary text
- `--muted`: metadata and secondary navigation
- `--line`: borders
- `--accent`: focus and dirty-state signal
- `--focus`: the keyboard focus ring

The product mark redraws the three circles from `mdi:chart-bubble` as separate
SVG shapes. The largest bubble uses mint green `#3ecf8e`, the medium bubble uses blue
`#3b82f6`, and the smallest bubble uses coral `#f97316`. These fixed brand
colors do not change between light and dark appearances.

The selected file uses a low-contrast neutral surface and medium text. Format is conveyed by document shape, not by a colored badge. Color is never the only status signal.

## Density

- Left panel: 252px; an optional 326px global right panel is reserved for comments.
- Header: 40px fixed height, transparent surface; all direct children use 8px spacing.
- Header title: the bundle title immediately followed by a softened root-relative file path, with no separator glyph.
- Header actions: when a Markdown file is open, a reusable 24px-tall WYSIWYG/Markdown text segmented control, 24px ghost icon buttons with 16px line icons, and a 24px primary Save split button.
- Sidebar brand, stages, folders, and files: one shared 24px row primitive with a 24×24 leading slot, 8px spacing, a 12px label, and a 6px corner radius.
- Body: a relaxed 1.7 line height.
- Wide tables and code blocks scroll instead of widening the entire viewport.

## Sidebar Behavior

- The sidebar is divided into the Specify, Plan, and Tasks expansion regions.
- Within each stage, the core artifact stays first, immediately followed by the rest of the routed documents, with no auxiliary role grouping.
- Real subdirectories keep their expansion behavior but use the same left alignment as every other row; nesting adds no visual indentation.
- Sidebar sections use no divider lines.
- The collapse control lives inside its own sidebar Header.
- Once the file sidebar is closed, its reopen control moves into the workspace Header.
- The left collapsed state also restores the compact Taco brand in the workspace Header, matching Castrel's shell transition.
- A closed file sidebar is removed from keyboard and accessibility navigation until it is reopened.

## Motion

Panel transitions use a restrained drawer curve. File-renderer changes use a quiet 220ms cross-fade with only a 2px vertical shift; the Header path updates immediately, with no spatial motion. Auxiliary-surface changes keep a short opacity-plus-shift transition to preserve context without delaying navigation. Every pointer-operated button has instant, subtle press feedback; high-frequency tree rows use a reduced scale response. Stage and folder expansion animate their caret, icon, and content together as a single state change. Popovers appear from their trigger, and transient surfaces exit faster than they enter. Keyboard tools stay instant. `prefers-reduced-motion` removes spatial motion while keeping the instant state changes.
