# Taco document routing

Write new Taco Markdown metadata as leading YAML frontmatter. Put the document title in `title`; do not add an H1 solely to repeat that title, and do not imitate YAML with a heading such as `## title: "..."`. New specs begin their body at H2 or lower.

For an otherwise-unassigned Markdown document that needs explicit routing, use exactly one of these YAML properties:

```md
---
taco_scope: spec
---

---

taco_scope: plan
---

---

taco_scope: tasks
---
```

`taco_scope` is an open text enum. The only values that route a file are `spec`, `plan`, and `tasks`. Other values remain canonical YAML but are invalid for routing. Do not generate the legacy `**Taco scope**: ...` form.

The sidebar has only the three default stage groups. `spec.md`, `plan.md`, and `tasks.md` are routed by filename. Known Spec Kit convention paths such as `research.md`, `data-model.md`, `quickstart.md`, `contracts/`, and `checklists/` are routed by Taco's built-in rules. Every other Markdown document needs a valid `taco_scope` value to appear in a stage. Invalid or missing values do not create custom or extension groups.

# Taco contributor agent rules

These instructions apply to Agents working in the Taco source repository.

When a user asks an agent to install, use, package, or review Taco, read `README.md`, `docs/agent-installation.md`, and `extensions/taco/README.md` before acting.

- Taco currently ships from source. Build `dist-single/Taco_Spec.taco.html`; do not invent an npm package or treat a development-server URL as the product.
- Installing Taco means installing the `skills/taco/` skill. The Spec Kit extension in `extensions/taco/` is an optional, explicitly requested project-level integration and is never part of the default installation.
- Keep the installable skill consistent with its canonical source: `skills/taco/taco-shell.html` is the production shell with its `#taco-document` block emptied to `<script type="application/taco+json" id="taco-document"></script>` and a generic `<title>`, and `skills/taco/templates/` is a generated, byte-identical mirror of `extensions/taco/templates/`. Do not hand-edit either mirror; regenerate it.
- Install `extensions/taco/` only into the exact initialized Spec Kit project named or confirmed by the user.
- Keep the reviewed directory canonical. Assemble or refresh a `.taco.html` by copying the shell and writing the `taco/files` v1 bundle JSON into the `#taco-document` block — that data block is the only agent-writable part of the file. Never modify the shell's HTML, CSS, or scripts, and preserve `docId`, `comments`, and `navigation` across every refresh. Data-block-only editing is the supported workflow; the CLI is not required.
- Preserve canonical `file:` URLs in packaged HTML. Every `.html` or `.htm` entry keeps the absolute canonical `file:` URL that identifies it; the optional CLI's `pack` validates it, and any missing or mismatched value is a packaging error. Never substitute a `data:` or Blob preview URL, and never rewrite an existing URL while editing the data block.
- Present a generated `.taco.html` through the Agent GUI's native clickable file/artifact surface, and open it in the user's browser whenever the host permits local `file://` navigation. Report `presented as a clickable file`, `opened`, or `opened and verified` truthfully: a headless boot check is internal evidence and is not user-visible presentation. In Codex, return a clickable absolute file link and let the user's click open it in Browser; do not attempt autonomous `file://` navigation or substitute a `data:` URL. Use a separate tab so an existing unsaved review survives.
- Conflict boundary: when the optional extension CLI is installed, preview every review import with `sync --dry-run --json` and stop on any conflict; never use `--force` without explicit authorization for the exact conflict paths. When importing through Handoff or a saved file without the CLI, diff the received content against the canonical files yourself and stop on any change you cannot attribute. Never resolve a conflict by silently choosing one side.
- Treat collaboration-enabled Taco files as potentially credential-bearing. Follow `docs/agent-installation.md` before sending their contents to any external model, service, log, or ticket. Local inspection remains allowed, and revocation or key reset is an explicit user action.
