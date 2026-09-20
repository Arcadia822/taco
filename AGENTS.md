# Taco document routing

Write new Taco Markdown metadata as leading YAML frontmatter. Put the document title in `title`; do not add an H1 solely to repeat that title, and do not imitate YAML with a heading such as `## title: "..."`. New specs begin their body at H2 or lower.

Stage placement comes from the file tree itself: `spec.md`, `plan.md`, and `tasks.md` route by filename, and known Spec Kit convention paths such as `research.md`, `data-model.md`, `quickstart.md`, `contracts/`, and `checklists/` route by Taco's built-in rules. Every other document stays Unassigned until a reviewer groups it with Taco's built-in Category control, which records the grouping in the Taco file's navigation manifest.

Classification is a Taco capability, not a document property: do not write a routing or scope key into documents. The deprecated `taco_scope` property and the legacy `**Taco scope**: ...` form are not read and must not be generated.

# Taco contributor agent rules

These instructions apply to Agents working in the Taco source repository.

When a user asks an agent to install, use, package, or review Taco, read `README.md`, `docs/agent-installation.md`, and `extensions/taco/README.md` before acting.

- Taco currently ships from source. Build `dist-single/Taco_Spec.taco.html`; do not invent an npm package or treat a development-server URL as the product.
- Install `extensions/taco/` only into the exact initialized Spec Kit project named or confirmed by the user.
- Keep the feature directory canonical. Use the Taco CLI or installed extension commands instead of hand-editing the generated HTML shell.
- Package HTML prototypes only through the Taco CLI so each receives its validated canonical `file:` URL; never substitute a `data:` or Blob preview URL.
- Present a generated `.taco.html` through the Agent GUI's native clickable file/artifact surface. In Codex, return a clickable absolute file link and let the user's click open it in Browser; do not attempt autonomous `file://` navigation or substitute a `data:` URL.
- Preview every review import with `sync --dry-run --json`; never use `--force` without explicit authorization for the exact conflict paths.
- Treat collaboration-enabled Taco files as potentially credential-bearing. Follow `docs/agent-installation.md` before sending their contents to any external model, service, log, or ticket.
