# Checkpoints and document status

Read this reference when creating, modifying, inspecting, or reporting a Taco Checkpoint graph or its document statuses. Decide whether a graph is needed using `SKILL.md` and the project's review policy first. The bundled SDD graph is an example, not a required template.

`checkpoints` is optional and lives at the top level, beside `navigation`. Without it, no Checkpoint is shown. Its v1 shape is `{ version: 1, template?: string, nodes: [{ id, title, after: string[], documents: [{ path, optional?: boolean, instruction?: string }] }], documents: [{ path, status, updatedAt }] }`. `nodes` defines a directed acyclic graph; `after` names predecessor node IDs. A referenced document path is the **full bundle path** under `root/` and may refer to a not-yet-created file. A path belongs to at most one node; omit `optional` for a required document. `instruction` is an optional string providing authoring constraints, task context, or requirements specific to that document. When present, the reviewer sees an `Instruction` tab in the right panel and an Agent authoring or editing that file MUST inspect and follow that instruction. `template` is a stored configuration display name; preserve it on refresh. The header does not display or edit it, and it does not change graph derivation. `documents` is the separate status table, with at most one record per path; omit a record for default `todo`.

Creating or renaming a file does not add it to `nodes[].documents`; Checkpoint membership is defined only by explicit node document paths. An ordinary file may belong to a Checkpoint category through `navigation.groups` with id `checkpoint-<node id>`: this only places the file in that sidebar group without adding DAG membership or status tracking. Creating a file from a Checkpoint group's add button selects that category by default without changing `nodes`.

Sidebar Rename and Delete apply to Checkpoint-owned files too. They do not rewrite `nodes[].documents`: renaming leaves the old required path as an uncreated placeholder and makes the renamed file an ordinary file unless another node references its new path; deleting leaves the required path uncreated. Both remove the old path's status record so the missing requirement returns to `todo`. The entry and navigation group paths follow a rename or are cleared on deletion.

The shared Taco and Tacobin header shows only the filename on document pages or the localized Checkpoints label on the Checkpoints page. Taco title, configuration name, breadcrumb paths, and Category switching are not header controls. Preserve their stored bundle values on refresh. Hosted content refresh and Handoff preserve the current Checkpoints page. Local Handoff carries unsaved status edits; hosted Handoff waits for autosave and uses saved Host state. Save remains available for a local Taco copy.

Statuses are `todo`, `in_progress`, `complete`, and `freeze`. On an actual status change, write or replace that path's status record with `updatedAt` in valid RFC3339 **UTC** (`new Date().toISOString()`, e.g. `2026-09-23T09:00:00.000Z`). `freeze` is a label, not a content lock or an approval; **do not calculate or verify a content/definition hash for Checkpoint state**. Do not modify the document's frontmatter to store status. Preserve unknown bundle fields and any invalid `checkpoints` value verbatim on refresh rather than silently dropping status data.

Read the saved `#taco-document` JSON directly to inspect or update persisted status. In an open browser tab, `window.taco.getCheckpoints()` returns the derived state including **unsaved** edits. The bundled, browser-independent reader accepts a saved artifact: `node scripts/checkpoints.mjs <file.taco.html>` relative to the installed skill (or `node skills/taco/scripts/checkpoints.mjs <file.taco.html>` in this checkout). It prints JSON derived by the **same `resolveCheckpoints` protocol implementation** as the browser; it cannot observe unsaved browser edits. Its `valid` flag, `nodes`, `documents`, `layout`, `frontier`, and `unlinked` fields are derived, not stored. If invalid, inspect `error`; do not replace the raw definition. `getReviewHandoff()` reports status changes in `checkpointChanges` as `{ path, from, to }`, display-name edits in `checkpointTemplateChange`, and new node members in `checkpointDocumentAdditions`.

Use `frontier` as a suggestion for the next work, not as an enforced gate: a node is available when its predecessors aggregate to `freeze`, and frontier excludes already-frozen nodes. Optional documents do not affect aggregation if required documents exist. When drafting or editing a Checkpoint document, **always read its `instruction` first** (available in `checkpoints.nodes[].documents[].instruction` or `window.taco.getCheckpoints()`) and satisfy all stated requirements and constraints. When every document needed for a Checkpoint reaches `complete`, invite human review before marking `freeze`; the human and Agent may nevertheless set any status. Missing referenced files appear as Checkpoint placeholders, not as `files[]` entries; their sidebar rows and placeholder pages do not show status controls before the files are created.

## Project Checkpoint convention

Before creating a **new** requirement Taco, find the project's Checkpoint convention and follow it. Refreshing an existing Taco never re-triages or re-applies a template: preserve its `checkpoints` definition and status table as above.

### Precedence

Use the first source that applies. The project root is the directory holding `.git` (a directory, or a `gitdir:` file in a worktree), found by walking up as in `references/output-path.md`. If the repository has more than one `.taco/`, use the one closest to the working directory and name it in your report.

1. **The user's instruction in this request**: requiring or forbidding Checkpoints, or naming a template or graph.
2. **An installed Spec Kit extension** (`.specify/extensions/taco/`): follow the extension's own convention.
3. **`.taco/` decision record and templates**: read the first line of `.taco/README.md` (see *Decision record*), then the templates:
   - first line *adopted*, or no README but templates exist: if at least one template meets the *Template contract*, triage (below); otherwise say in your reply that no usable template exists and why, and go to step 4;
   - first line *declined*: use no `.taco/` template, even if one exists; say in your reply that the record and the leftover template disagree, and go to step 4;
   - any other first line is unrecognized, even when it reads like approval (`Checkpoints: yes`): say so in your reply, use ordinary Taco review with no template, do not suggest, do not rewrite the README, and stop here;
   - neither README nor templates: go to step 4.
4. **Other project process conventions**: `AGENTS.md`/`CLAUDE.md`, `CONTRIBUTING*`, `.github/pull_request_template.md`, or an established `specs/` or `docs/adr/` layout. Let it decide this request's documents and review order, and cite the file and line. Do not ask the project to adopt `.taco/`.
5. **This skill's bundled examples** (`templates/spec/` and the others): reference only, never a default structure.

If nothing applies, consider a suggestion (below). Once `.taco/README.md` records a decision, adopted or declined, never ask again whether to adopt project templates. Asking which template fits this request, or clarifying the user's instruction, is still allowed.

### Triage

An adopted template is an **option**, not an obligation. For every new requirement:

1. Collect the candidates and when each applies. With a README, use the templates it lists and their stated scope. Without one, list every `.taco/*.taco.html` that meets the contract and infer scope from its title, nodes, and `instruction`s; say in your reply that the decision record is missing, but do not create or edit the README.
2. Match them against this request's review needs: named review milestones, staged reviews, or sign-off by different roles.
3. Choose one template, or none. Small changes — copy edits, a single-point fix — usually get none and an ordinary Taco without `checkpoints`.
4. State the choice and the reason in your reply ("using `Feature_Checkpoints`: design and plan are reviewed separately" or "no template: single-file copy edit"). The user may overrule it.
5. When exactly one template's stated scope fits, use it without asking. Ask which one to use only when the scopes cannot settle between several templates.

Triage writes nothing; `.taco/README.md` holds only the project-level decision.

### Using a template: copy the definition, not the runtime

1. **Validate** the template before anything else. With the script: run `node scripts/checkpoints.mjs <template.taco.html>` (relative to the installed skill) and require `valid: true` and non-empty `nodes` — the reader also reports `valid: true` for a bundle with no `checkpoints` at all — then read `root` from the data block (the reader does not print it) and require `feature`. Without the script, check every `validateCheckpoints` rule by hand: `checkpoints` is an object with `version` 1, an optional string `template`, a `nodes` array, and a `documents` array; each node has a unique non-empty string `id`, a non-empty string `title`, an `after` array of non-empty ids with no duplicates that all name existing nodes and form no cycle, and a `documents` array; each document reference has a safe path under the template `root/` that appears only once across all nodes, an optional boolean `optional`, and an optional string `instruction`. `parseBundle` does not check `checkpoints`, so its success proves nothing here. A failing template is broken: say so in your reply with the failing rule (or the reader's `error`), skip it for this request, and do not repair it — never drop or rewrite the offending path to make it pass.
2. **Copy only `checkpoints.nodes`.** The new Taco gets a fresh `docId` (`crypto.randomUUID()`) and inherits nothing else from the template: not its `docId`, `title`, `files`, `comments`, `navigation`, or status records.
3. **Map paths.** The template `root` is always `feature`. Strip the `feature/` prefix from each document path and prepend this request's `root/` (`feature/plan.md` with `root: "specs/018-search"` becomes `specs/018-search/plan.md`), then re-run the path checks against the new `root`. A template whose `root` is not `feature` does not meet the contract: report it and skip it; do not edit it.
4. **Keep and reset.** Copy each node's `id`, `title`, and `after`, and each document's `optional` and `instruction`, exactly as the validated template has them — never dedupe, reorder, or otherwise normalize them; if a value looks wrong, the template failed step 1. Set `checkpoints.template` to the template's title and `checkpoints.documents` to `[]`.
5. **Pack** with this skill's current shell, chosen as `SKILL.md` *Locate the shell* describes.
6. **Treat its nodes as scheduled.** The nodes and documents of the template chosen for this request count as deliberately scheduled work. Their `not created` placeholders, and the `checkpoint-document-missing` warnings `window.taco.validate()` reports for them, are expected; do not remove them as a transplanted structure. This exception covers only the chosen `.taco/` template, never this skill's bundled examples.
7. **Write documents** after reading each one's `instruction`, and use `frontier` to suggest the next node.

For "which documents, which hard requirements, what next", run `node <skill>/scripts/checkpoints.mjs <file.taco.html>` on the requirement Taco (or the template) and read `nodes[].documents[].path`, `documents[].instruction`, and `frontier`.

### Suggesting a convention once

Suggest a project template only when all of these hold:

- the working directory is inside a repository;
- no precedence step above applied and `.taco/README.md` does not exist;
- this request's **review needs** call for staged review: named review milestones, more than one review stage, or sign-off by different roles. Never use the number of documents as the signal. A copy edit or single-point fix has no staged review, so it gets no suggestion and no spec/plan/tasks set.

Ask once, and at most once per session. Give the evidence (which review need triggered it, which locations you checked), what accepting writes (`.taco/README.md` and one template Taco), what declining writes (`.taco/README.md` only), and that you will not ask again and the user can edit or delete the file to change it.

- **Accepted**: write `.taco/README.md` with the *adopted* first line, then draft a template from repository evidence and give it to the user to confirm.
- **Declined**: write `.taco/README.md` with the *declined* first line; use ordinary Taco review now.
- **No clear answer**: write nothing and use ordinary Taco review; a later session may suggest again.

Write the files only; never commit them for the user. Never edit `AGENTS.md` or other project process files for this.

### Template contract

A project template is an ordinary Taco at `.taco/<Normalized_Title>.taco.html` (file name per `references/output-path.md`), packed with the Lite shell unless the user wants offline use. Its block has `root: "feature"`, `files: []`, and `checkpoints` with `nodes` whose document paths all start with `feature/`, plus `documents: []`. Writing it after the user confirms is an explicit destination (L0); `.taco/` is not one of the template directories `SKILL.md` forbids writing into. Hidden paths and `*.taco.html` are excluded from packaging, so `.taco/` never enters a requirement Taco. An empty template loads normally, not in Recovery mode: the body shows an empty-files notice, the sidebar lists the Checkpoint groups with placeholder rows, and the Checkpoints entry opens the graph.

### Decision record

`.taco/README.md` is a short note, not a schema. Its **first line** is exactly one of:

```text
Checkpoint 模板：采用（YYYY-MM-DD）
Checkpoint 模板：不采用（YYYY-MM-DD）
```

*Adopted* (`采用`) and *declined* (`不采用`) refer to these lines; the date is the day the user answered. When adopted, list each template file and the requests it fits, add the user's words or reason, and say how to change the decision (edit or delete the file) or a template (ask the Agent). Read rules:

- A first line matching neither form is unrecognized: report it, use ordinary review, and use no `.taco/` template.
- *Adopted* with no template that meets the contract (missing, unparsable, or `root` not `feature`): report it, continue with precedence step 4, and fall back to ordinary review. Do not rebuild the template or suggest again.
- *Declined*: see precedence step 3.

### Changing templates and instructions

`instruction` is read-only in the page. To view one, select the document in the Checkpoints graph or its placeholder row in the sidebar, then open the right panel's `Instruction` tab; the graph cards themselves do not show instruction text. During ordinary work, leave `.taco/` untouched: templates, their `instruction`s, and the README. The only exceptions are recording the user's answer to the one-time suggestion (above) and an explicit request to refine the process; when refining, edit only the `.taco/` template asked about and list the nodes, documents, or `instruction`s you changed. A template change never rewrites requirement Tacos already generated from it.
