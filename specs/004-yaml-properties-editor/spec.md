---
title: "Feature Specification: YAML Properties Editor"
feature_branch: "004-yaml-properties-editor"
created: "2026-08-13"
status: "Complete"
taco_scope: "spec"
---

## Objective

Taco must recognize YAML frontmatter at the beginning of a Markdown file and present it as an Obsidian-style property table above the document body. Users edit properties through structured controls while the original Markdown file remains canonical YAML plus Markdown text.

The feature replaces YAML-as-heading imitations such as `## title: "Example"` and new Agent-authored `**Key**: value` metadata with real frontmatter. A document title belongs in the `title` property, not in an H1 added only to name the file.

## User Scenarios & Testing

### User Story 1 — Read frontmatter as document properties (Priority: P1)

As a reviewer, I see a compact property table at the top of a Markdown document instead of raw YAML delimiters and key-value lines mixed into the body.

**Why this priority**: Frontmatter is document metadata. Rendering it as ordinary prose obscures the distinction between file properties and authored body content.

**Independent Test**: Open Markdown fixtures containing valid frontmatter with scalar, list, empty, quoted, and nested values; verify the property component and the untouched document body independently of editing.

**Acceptance Scenarios**:

1. **Given** a Markdown file begins at byte zero with a valid `---` YAML frontmatter block, **When** Taco opens it, **Then** Taco renders one property component before the document body and does not render the delimiters as body text.
2. **Given** frontmatter contains `title`, `status`, `tags`, dates, booleans, numbers, nulls, or custom keys, **When** it is displayed, **Then** every top-level key appears once in source order with a readable value representation.
3. **Given** a frontmatter value is a flat scalar list, **When** it is displayed, **Then** each item is shown as a removable chip without converting the value to a comma-separated string.
4. **Given** a value is a nested mapping or nested sequence, **When** it is displayed, **Then** Taco shows a compact structured/raw value editor and preserves the complete YAML value; it does not flatten or discard nested data.
5. **Given** a Markdown file has no frontmatter, **When** Taco opens it, **Then** no empty property table is shown and the body renders normally.
6. **Given** frontmatter exists, **When** Taco derives the in-document outline, **Then** property keys and values do not appear as H1–H3 outline entries.

---

### User Story 2 — Edit properties without leaving the document view (Priority: P1)

As an author, I can edit, add, and remove YAML properties in the table and save the result back to the same Markdown file.

**Why this priority**: A read-only projection would force users to switch representations and would reproduce the current split between metadata display and canonical editing.

**Independent Test**: Edit each supported value type, add and remove properties, save, reopen, and compare the resulting YAML and body content with the intended changes.

**Acceptance Scenarios**:

1. **Given** a scalar property, **When** the user edits its value and leaves the field, **Then** the corresponding YAML value and `files[].content` update immediately in memory and the Taco becomes dirty.
2. **Given** a flat list property, **When** the user adds, edits, reorders, or removes an item, **Then** the YAML remains a sequence and no unrelated property changes.
3. **Given** the user chooses `Add property`, **When** they provide a unique non-empty key and value, **Then** the new entry is appended to the frontmatter and becomes editable in place.
4. **Given** the user removes a property, **When** the removal is confirmed, **Then** only that key is removed and an undo action can restore it during the current editing session.
5. **Given** a Markdown file has no frontmatter, **When** the user adds its first property, **Then** Taco creates a valid frontmatter block at the first byte without modifying the body.
6. **Given** the final property is removed, **When** the document serializes, **Then** Taco removes the now-empty delimiters and leaves the body at the beginning of the file.
7. **Given** the user edits a property, **When** Taco serializes the Markdown, **Then** key order, unedited values, YAML comments, and body bytes remain unchanged wherever the edited value does not require local normalization.

---

### User Story 3 — Keep `title` synchronized with Taco file UI (Priority: P1)

As an author, I can change a Markdown file's title either in the property table or in Taco's file-title UI and see one synchronized value everywhere.

**Why this priority**: Two independently editable title values would create immediate drift and make the property component less trustworthy than the raw file.

**Independent Test**: Edit `title` from each surface, including a titleless file and a file whose stored display title disagrees with frontmatter, then save and reopen.

**Acceptance Scenarios**:

1. **Given** frontmatter contains `title`, **When** Taco opens the file, **Then** that value supplies the editable file display title used by the document header and sidebar title surfaces.
2. **Given** the user edits `title` in the property table, **When** the edit commits, **Then** the file-title UI and local `files[].title` projection update in the same transaction.
3. **Given** the user edits the file title from Taco's existing title UI, **When** the edit commits, **Then** Taco updates or creates the frontmatter `title` property in the same transaction.
4. **Given** frontmatter `title` and a legacy `files[].title` disagree on load, **When** the file is writable, **Then** frontmatter is canonical and the UI projection adopts it without rewriting the file until the user edits or saves.
5. **Given** the `title` property is removed or empty, **When** Taco renders the file, **Then** the UI uses the existing filename-derived fallback and does not invent an H1.
6. **Given** the bundle title in the workspace header, **When** a file's `title` changes, **Then** the bundle title and `.taco.html` filename remain unchanged; document title and bundle title are separate concepts.

---

### User Story 4 — Edit `taco_scope` as an open enum with honest validation (Priority: P1)

As an author, I receive valid routing choices for `taco_scope` but can still type and preserve another YAML value when working in a text-first document.

**Why this priority**: Taco has only three stages, but silently coercing or deleting an authored value would violate the file-first editing model.

**Independent Test**: Select each valid value, type invalid and empty values, save and reopen, then compare both the YAML and stage projection.

**Acceptance Scenarios**:

1. **Given** the `taco_scope` row, **When** the user edits it, **Then** Taco offers `spec`, `plan`, and `tasks` in an accessible combobox.
2. **Given** the user types a value outside that enum, **When** the field commits, **Then** Taco preserves the exact YAML scalar and marks the row invalid instead of coercing, deleting, or rejecting the edit.
3. **Given** `taco_scope` is invalid, **When** the property table renders, **Then** the row has an invalid icon, text explanation, and `aria-invalid="true"`; color or animation alone is insufficient.
4. **Given** an otherwise-unassigned Markdown file has a valid `taco_scope`, **When** stage navigation is derived, **Then** the file enters the selected stage.
5. **Given** an otherwise-unassigned Markdown file has an invalid or empty `taco_scope`, **When** navigation is derived, **Then** the file remains unassigned and no custom stage is created.
6. **Given** a core or built-in convention path such as `spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/`, or `checklists/`, **When** it also contains `taco_scope`, **Then** built-in routing continues to win while an invalid authored value is still visibly reported.

---

### User Story 5 — Author new Taco documents with YAML metadata instead of title headings (Priority: P1)

As a user delegating specification work to an Agent, I receive documents whose metadata is valid frontmatter rather than fake headings or bold prose.

**Why this priority**: The editor cannot establish a coherent metadata model if Agent prompts continue generating H1 titles and legacy property syntax.

**Independent Test**: Install the Taco Spec Kit extension into a clean initialized Spec Kit project, run `speckit.specify`, and inspect the generated `spec.md` before packaging.

**Acceptance Scenarios**:

1. **Given** an Agent creates a new Taco specification document, **When** it needs a document title, **Then** it writes `title` in leading YAML frontmatter and does not add an H1 solely to repeat that title.
2. **Given** an Agent creates a non-convention Markdown document that needs stage routing, **When** it declares the route, **Then** it writes `taco_scope: spec|plan|tasks` in the same frontmatter.
3. **Given** a document already contains an authored H1 as body content, **When** an Agent updates metadata, **Then** it preserves that H1 unless the user explicitly requests a content migration.
4. **Given** a legacy document uses leading `**Key**: value` metadata, **When** an Agent makes an unrelated edit, **Then** it preserves the legacy form and does not silently convert it.
5. **Given** Taco contributor, installation, update, and review instructions, **When** this feature ships, **Then** all relevant Agent-facing prompts describe the same YAML metadata contract and no longer instruct Agents to create `**Taco scope**` declarations.
6. **Given** Taco is installed into an initialized Spec Kit project, **When** installation merges Taco's persistent authoring policy into the target project's `AGENTS.md`, **Then** that policy explicitly applies to later core commands including `speckit.specify`, regardless of which compatible Agent runs them.
7. **Given** the installed policy is active, **When** `speckit.specify` creates `spec.md`, **Then** the file begins with YAML frontmatter containing `title`, contains no ATX or Setext H1 used as the document title, and begins body structure at H2.
8. **Given** an Agent needs to express the title while generating a spec, **When** it writes the file, **Then** it writes a real YAML property between `---` delimiters and never imitates metadata with a heading such as `## title: "Example"`.
9. **Given** Taco installation reports success, **When** its installation verification runs, **Then** verification confirms the target project contains the persistent no-H1/YAML-title policy; documentation in the Taco source repository alone is not sufficient.

## Functional Requirements

### Canonical parsing and serialization

- **FR-001**: Taco MUST recognize YAML frontmatter only when an opening `---` begins at the first byte, ignoring an optional UTF-8 BOM, and a closing `---` terminates the block before the Markdown body.
- **FR-002**: Frontmatter and Markdown body MUST remain one canonical `files[].content` string. Taco MUST NOT persist a parallel property object as an independent source of truth.
- **FR-003**: The YAML parser MUST use a safe schema that cannot construct executable language objects, resolve external resources, or execute custom tags.
- **FR-004**: Taco MUST preserve all valid YAML values, including unsupported nested structures, without lossy coercion.
- **FR-005**: Editing one property MUST limit normalization to the smallest affected YAML range. Unedited keys, order, comments, quoting, and body text MUST remain unchanged whenever structurally possible.
- **FR-006**: Property edits MUST participate in the existing dirty-state, save, save-copy, unpack, collaboration, and conflict-baseline flows.

### Property component

- **FR-007**: Valid frontmatter MUST render as one compact two-column property component above the body, visually comparable to Obsidian Properties rather than a generic bordered data grid.
- **FR-008**: Each row MUST expose a property key, editable value, type-appropriate control, and discoverable remove action. The component MUST expose an `Add property` action.
- **FR-009**: Scalar strings, numbers, booleans, nulls, and flat scalar sequences MUST have structured editors. Nested values MUST remain editable through a lossless structured/raw value surface.
- **FR-010**: The property component MUST support keyboard navigation, visible focus, programmatic labels, and validation text that is not communicated by color alone.
- **FR-011**: The layout MUST remain usable at narrow widths without causing document-level horizontal overflow; values may wrap or open a focused editor when necessary.
- **FR-012**: Property rows MUST NOT enter the H1–H3 outline, full-text heading navigation, or Markdown body selection-comment surface.

### Reserved properties

- **FR-013**: `title` MUST be a string property and the canonical Markdown-file display title. Taco MUST synchronize it bidirectionally with the existing file-title UI and the local `files[].title` projection.
- **FR-014**: `title` MUST NOT rename `files[].path`, the on-disk Markdown filename, comment anchor paths, the bundle title, or the `.taco.html` filename.
- **FR-015**: `taco_scope` MUST be an open enum editor whose valid exact lowercase values are `spec`, `plan`, and `tasks`.
- **FR-016**: Invalid `taco_scope` values MUST remain editable and serializable but MUST NOT influence routing or create a new stage.
- **FR-017**: Built-in filename and directory routing MUST take precedence over `taco_scope`; validation feedback and routing effect are separate concerns.
- **FR-018**: `tags`, when represented as a flat YAML sequence, SHOULD use a chip editor that preserves item boundaries and order.

### Invalid and legacy input

- **FR-019**: Invalid or unterminated frontmatter MUST NOT disappear or partially project into editable rows. Taco MUST show the original source, identify the parse location, and keep the Markdown body recoverable.
- **FR-020**: A syntactically valid YAML document containing a semantically invalid reserved value, such as `taco_scope: design`, MUST use row-level validation rather than whole-frontmatter failure.
- **FR-021**: Existing leading `**Key**: value` property blocks MUST remain readable and round-trippable for compatibility, but newly authored Agent output MUST use YAML frontmatter.
- **FR-022**: Taco MUST NOT automatically migrate legacy property blocks, remove existing H1 content, or add frontmatter during an unrelated edit.
- **FR-023**: If both YAML and legacy metadata define a reserved property, YAML MUST control Taco behavior, the legacy text MUST remain preserved, and Taco MUST show a duplicate-source warning without silently deleting either value.

### Agent contract

- **FR-024**: Taco's repository policy, installation guide, installed extension commands, and relevant prompt tests MUST instruct Agents to use YAML frontmatter for new document metadata.
- **FR-025**: Installing the Taco Spec Kit extension MUST merge a durable Taco Markdown authoring policy into the exact target project's `AGENTS.md`. The installed policy MUST govern subsequent Spec Kit authoring commands, including `speckit.specify`; keeping the rule only in Taco contributor documentation or a post-generation hook does not satisfy this requirement.
- **FR-026**: Agent instructions MUST distinguish a document `title` from the Taco bundle title and MUST prohibit ATX and Setext H1 headings that only duplicate frontmatter `title`.
- **FR-027**: The installed policy MUST give Agents an unambiguous new-spec shape: a leading `---` YAML mapping containing `title`, followed by a Markdown body whose first heading is H2 or lower. Heading-shaped text such as `## title: "..."` MUST NOT be treated as metadata.
- **FR-028**: Agent instructions MUST use `taco_scope` for new stage metadata and MUST stop generating the legacy `**Taco scope**: ...` form after this feature is implemented.
- **FR-029**: Core files and known convention paths MUST NOT require `taco_scope`; Agents add it only when an otherwise-unassigned Markdown file needs explicit stage routing.
- **FR-030**: The installation flow MUST verify that the target project's persistent Agent policy contains the YAML-title and no-H1 rules before declaring installation complete.
- **FR-031**: An automated clean-project integration fixture MUST install Taco, invoke the effective `speckit.specify` workflow, and reject generated `spec.md` output that lacks YAML `title`, represents `title` as a heading, or contains a document-title H1.
- **FR-032**: A post-`specify` hook MAY diagnose non-conforming output, but the installed authoring prompt MUST prevent the H1 during generation. Taco MUST NOT claim conformance by silently deleting an authored H1 after generation.

## Key Entities

- **YAML frontmatter**: The delimited YAML mapping at the beginning of a Markdown file; it remains part of canonical Markdown source.
- **Property row**: A UI projection of one top-level YAML key and value, with a key-aware or type-aware editor.
- **Reserved property**: A property with Taco behavior beyond generic editing. The initial reserved properties are `title` and `taco_scope`; `tags` receives presentation specialization without routing semantics.
- **File title projection**: The synchronized `files[].title` and UI value derived from frontmatter `title`; it is not an independent source of truth for Markdown files.
- **Invalid reserved value**: Valid YAML that Taco cannot apply semantically. It remains canonical text and receives local validation feedback.
- **Legacy property block**: The existing leading `**Key**: value` Markdown convention retained for compatibility but not used for new Agent-authored documents.
- **Installed authoring policy**: The persistent Taco Markdown rules merged into a target Spec Kit project's `AGENTS.md`; these rules influence future core Spec Kit document generation, not only Taco-specific commands.

## Edge Cases

- A horizontal rule later in the body is not frontmatter.
- A closing delimiter inside a quoted block scalar does not terminate frontmatter incorrectly.
- Duplicate YAML keys produce a parse/validation error and are not silently collapsed.
- A key containing spaces or non-ASCII characters remains editable and round-trippable.
- YAML aliases, anchors, explicit tags, multiline scalars, and comments remain safe and preserved even when the structured UI cannot offer a specialized control.
- A date-looking scalar remains a YAML scalar and is not shifted by timezone conversion.
- An empty string, null, missing value, and deleted property remain distinguishable.
- Editing frontmatter may shift body offsets; existing quote-based comment re-anchoring must continue to locate body comments.
- A read-only Taco shows the same property component without edit, add, remove, or combobox mutation controls.
- Concurrent edits to different properties converge without replacing the Markdown body; conflicting edits to the same scalar follow the existing collaboration conflict model.
- Search may match canonical frontmatter values, but property rows do not become body headings or outline entries.

## Success Criteria

- **SC-001**: Valid frontmatter fixtures covering every supported scalar, flat list, nested value, comments, quoting, Unicode, and multiline syntax reopen with semantically identical YAML and byte-identical Markdown body content.
- **SC-002**: Editing one scalar changes only that property's YAML range in at least 95% of fixtures that do not require structural normalization; no test changes unrelated body bytes.
- **SC-003**: Editing `title` from either surface produces the same frontmatter, file-title UI, and local `files[].title` value before save and after reopen.
- **SC-004**: Every valid `taco_scope` value routes an otherwise-unassigned Markdown file correctly; every invalid value is preserved, visibly marked invalid, and produces no custom stage.
- **SC-005**: Automated accessibility checks find no unlabeled property control, keyboard trap, color-only validation state, or document-level horizontal overflow in the property component.
- **SC-006**: Agent instruction regression tests find YAML `title` and `taco_scope` guidance and reject newly generated H1-only titles or `**Taco scope**` metadata.
- **SC-007**: Legacy property fixtures remain byte-for-byte stable after unrelated edits and saves.
- **SC-008**: In a clean initialized Spec Kit project, Taco installation followed by `speckit.specify` produces a `spec.md` with a parseable YAML `title`, no document-title H1, and an H2-or-lower first body heading; the installed Taco update workflow still accepts the generated file.

## Implementation Evidence

- The safe frontmatter parser, atomic Tiptap property node, reserved-property validation, title synchronization, open-enum routing, legacy duplicate warning, and Agent policy are covered by repository tests.
- `npm run check` validates formatting, the complete Vitest suite, TypeScript, the production single-file build, the shell size/security gate, and synchronization of the extension shell.
- The production artifact remains a local file. In Codex, the Agent presents that file as a clickable link; the user's click hands it to Browser because autonomous `file://` navigation is blocked by the host.

## Out of Scope

- A general-purpose YAML IDE or schema language.
- Automatic inference of organization-specific property types from key names.
- Automatic migration of existing H1 titles or `**Key**: value` metadata.
- File renaming, bundle-title changes, or `.taco.html` filename changes caused by document `title`.
- Querying, sorting, filtering, or database-style views across properties in multiple files.
- Making invalid `taco_scope` values valid by creating custom Taco stages.
- Requiring frontmatter on every Markdown file.
