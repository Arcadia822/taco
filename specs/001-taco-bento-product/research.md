## Decision 1 — Files Are Canonical

**Decision**: Taco stores the feature directory as files and keeps Markdown as Markdown, unchanged.

**Evidence**: The core templates and workflows of GitHub Spec Kit treat `spec.md`, `plan.md`, and `tasks.md` as primary artifacts. The plan stage additionally creates `research.md`, `data-model.md`, `quickstart.md`, and `contracts/`; checklist output is still Markdown.

**Rejected**: Normalizing stories, requirements, tasks, and evidence into a Taco-specific JSON schema.

**Reason**: That model would lose arbitrary Markdown structure, custom presets, and unknown sections, while forcing both humans and Agents to learn a second protocol.

## Decision 2 — JSON Only as the Single-File Envelope

**Decision**: `.taco.html` uses a small JSON envelope containing the path, media type, and raw text.

**Reason**: The browser runtime needs an unambiguous, safe container format. The envelope must not interpret file semantics.

## Decision 3 — Markdown First, Generic Source Editing for Other Formats

**Decision**: v0.2 renders Markdown as WYSIWYG. YAML, JSON, and unknown text keep exact source in a generic editor; JSON gets syntax highlighting, but no format is projected into a structured form.

**Reason**: Markdown covers the primary Spec Kit artifacts. Exact source editing preserves file fidelity, while a premature YAML/OpenAPI form would just repeat the same over-modeling mistake at a smaller scale.

## Decision 4 — Derived Navigation

**Decision**: Stage navigation, the in-group directory tree, headings, and the search index are derived at load time.

**Reason**: Persisting them creates drift. They are cheap to recompute and carry no authorial intent.

The stage projection uses `spec.md`, `plan.md`, and `tasks.md` as core anchors. A feature-root `README.md` routes to Specify by convention and becomes the preferred opening document, with `spec.md` as the fallback. Known Spec Kit paths route by convention, and the entire `checklists/` directory sits under Plan because the official workflow runs Checklist after Plan and before Tasks. Other Markdown selects one of these stages via an exact `Taco scope` enum. That internal property is preserved in the Markdown but hidden from the rendered document; there is no Custom or Extensions group.

## Decision 5 — Keep Bento at the Container Layer

**Decision**: Keep the self-contained Vite build pattern and use the persistence kernel for the current Markdown editing and artifact saving.

**Reason**: The useful inheritance from Bento is file portability, not the document model of any particular Bento app.

## Decision 6 — Use a Spec Kit Extension Hook, Not a Preset or Standalone Workflow

**Decision**: Taco ships as a schema v1 Spec Kit extension. It adds two namespaced commands and registers a mandatory `after_specify` hook for artifact creation. The reverse round-trip stays an explicit review command, because importing human edits is a state-changing operation that must surface conflicts before writing.

**Evidence**: Spec Kit defines extensions as the mechanism for new commands, external integrations, and lifecycle hooks. A preset would override how existing templates behave, which would wrongly couple the Taco transport to the content of `spec.md`. A workflow could add approval gates, but requiring teams to replace their normal Spec Kit command sequence just to obtain a review artifact would widen the integration boundary. The official hook list includes `after_specify`; command files are rendered into the currently active Agent integration at install time.

**Rejected**:

- A preset that appends Taco instructions to the core spec template.
- A shell hook that silently writes back to canonical files without Agent inspection.
- A browser-only "Save & unpack" as the Agent protocol; it cannot provide deterministic, machine-readable comments or repository conflict detection.

**Compatibility boundary**: The manifest requires Spec Kit `>=0.16.0,<1.0.0`, consistent with the extension and hook behavior researched on 2026-08-10. The CLI itself uses only Node.js built-in modules and remains usable without Spec Kit.

## Sources

- [GitHub Spec Kit](https://github.com/github/spec-kit)
- [Spec template](https://github.com/github/spec-kit/blob/main/templates/spec-template.md)
- [Plan template](https://github.com/github/spec-kit/blob/main/templates/plan-template.md)
- [Tasks template](https://github.com/github/spec-kit/blob/main/templates/tasks-template.md)
- [Bento](https://github.com/nyblnet/bento)
- [Spec Kit extension reference](https://github.github.io/spec-kit/reference/extensions.html)
- [Spec Kit extension development guide](https://github.com/github/spec-kit/blob/main/extensions/EXTENSION-DEVELOPMENT-GUIDE.md)
- [Spec Kit extension publishing guide](https://github.com/github/spec-kit/blob/main/extensions/EXTENSION-PUBLISHING-GUIDE.md)
