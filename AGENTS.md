# Taco document routing

When adding Markdown documents to a Taco feature directory, use exactly one of these internal metadata declarations:

```md
**Taco scope**: spec
**Taco scope**: plan
**Taco scope**: tasks
```

`Taco scope` is an enum. The only valid values are `spec`, `plan`, and `tasks`; do not write prose such as `extends \`spec.md\`` and do not append comments. Place the declaration in the document's leading metadata block. Taco preserves it in canonical Markdown but hides it in the rendered document.

The sidebar has only the three default stage groups. `spec.md`, `plan.md`, and `tasks.md` are routed by filename. Known Spec Kit convention paths such as `research.md`, `data-model.md`, `quickstart.md`, `contracts/`, and `checklists/` are routed by Taco's built-in rules. Every other Markdown document needs a valid `Taco scope` value to appear in a stage. Invalid or missing values do not create custom or extension groups.

# Taco agent onboarding

When a user asks an agent to install, use, package, or review Taco, read `README.md`, `docs/agents.md`, and `extensions/taco/README.md` before acting.

- Taco currently ships from source. Build `dist-single/Taco_Spec.taco.html`; do not invent an npm package or treat a development-server URL as the product.
- Install `extensions/taco/` only into the exact initialized Spec Kit project named or confirmed by the user.
- Keep the feature directory canonical. Use the Taco CLI or installed extension commands instead of hand-editing the generated HTML shell.
- Preview every review import with `sync --dry-run --json`; never use `--force` without explicit authorization for the exact conflict paths.
- Treat collaboration-enabled Taco files as potentially credential-bearing. Follow `docs/agents.md` before sending their contents to any external model, service, log, or ticket.
