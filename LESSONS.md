# Agent Development & Review Lessons Learned (LESSONS.md)

This document tracks high-frequency failure modes, architectural pitfalls, and regressions encountered during human-agent collaboration in Taco.

Guided by the principle **Encode Lessons in Structure**:

1. When an error or unexpected friction occurs, record it here with concrete evidence and root causes.
2. **Escalation Protocol**: Any lesson triggered **3 or more times** (`occurrences >= 3`) MUST be escalated to a structural mechanism:
   - A hard CI static gate or pre-commit hook (e.g. `npm run check`, `package.json`, `.githooks/`), OR
   - A type-level impossibility (making illegal states unrepresentable), OR
   - A binding rule in `AGENTS.md`.

---

## Escalation Index

| ID                                                                          | Title                                             | Occurrences |    Status     | Structural Mechanism                                                  |
| :-------------------------------------------------------------------------- | :------------------------------------------------ | :---------: | :-----------: | :-------------------------------------------------------------------- |
| [LESSON-001](#lesson-001-local-dependency-drift-pollutes-test-runs)         | Local Dependency Drift Pollutes Test Runs         |      3      | **Escalated** | Enforce clean lockfile check in CI (`npm ci`) & `npm run check`       |
| [LESSON-002](#lesson-002-version-triples-desync-across-release-surfaces)    | Version Triples Desync Across Release Surfaces    |      3      | **Escalated** | `scripts/sync-skill-version.mjs` & `tests/agent-instructions.test.ts` |
| [LESSON-003](#lesson-003-tiptap-prosemirror-crash-on-markdown-code-in-bold) | Tiptap ProseMirror Crash on Markdown Code-in-Bold |      2      |    Active     | Lexer markdown scanner / `tests/markdown-emphasis-code.test.ts`       |
| [LESSON-004](#lesson-004-headless-mermaid-execution-fails-without-dom-mock) | Headless Mermaid Execution Fails Without DOM Mock |      2      |    Active     | `skills/taco/scripts/lint-mermaid.mjs` & DOM mock in headless lint    |

---

## Lessons Register

### LESSON-001: Local Dependency Drift Pollutes Test Runs

- **ID**: `LESSON-001`
- **Category**: `dependencies`
- **Occurrences**: 3
- **Status**: `escalated`
- **Enforcement**: `CI npm ci check & lockfile comparison`

#### Symptom

Local tests fail with unexpected errors (e.g. editor marks or sanitization failures) despite unchanged application code. In PR #54 wrap-up, local `node_modules` drifted to Tiptap 3.31.3 and DOMPurify 3.4.16 while `package-lock.json` pinned 3.29.2 and 3.4.13.

#### Root Cause

Ad-hoc package installations (`npm install --no-save` or package additions without synchronized lockfiles) upgrade transitive dependencies in local `node_modules`, diverging from CI.

#### Prevention & Escalation

- Always restore clean lockfile state via `npm ci` before debugging local-only test regressions.
- CI strictly uses `npm ci` without `--force` or `--legacy-peer-deps`.
- Guard rule formalized in `AGENTS.md` and repository CI.

---

### LESSON-002: Version Triples Desync Across Release Surfaces

- **ID**: `LESSON-002`
- **Category**: `release`
- **Occurrences**: 3
- **Status**: `escalated`
- **Enforcement**: `scripts/sync-skill-version.mjs`, `packages/cli/src/help.ts dynamic import`, `tests/agent-instructions.test.ts`

#### Symptom

Release or build failures where `skills/taco/VERSION`, `package.json`, and CLI binaries report mismatched version strings.

#### Root Cause

Version numbers were previously maintained manually across disjoint configuration files (`package.json`, `packages/cli/package.json`, `skills/taco/VERSION`, `extensions/taco/extension.yml`).

#### Prevention & Escalation

- `package.json` is the sole canonical version authority.
- `scripts/sync-skill-version.mjs` runs during `npm run build` to keep `skills/taco/VERSION` identical.
- CLI dynamically imports package metadata using JSON import attributes (`import pkg from '../package.json' with { type: 'json' }`).
- Regression suite in `tests/agent-instructions.test.ts` asserts parity.

---

### LESSON-003: Tiptap ProseMirror Crash on Markdown Code-in-Bold

- **ID**: `LESSON-003`
- **Category**: `editor`
- **Occurrences**: 2
- **Status**: `active`
- **Enforcement**: `tests/markdown-emphasis-code.test.ts`

#### Symptom

Taco editor throws `Invalid collection of marks for node text: bold,code` and falls back to raw source mode when encountering inline code wrapped inside bold delimiters (e.g. `**\`--flag\`**`).

#### Root Cause

ProseMirror schema mark configuration excludes `code` marks inside `bold` marks, throwing an unhandled parse error when constructing document slices from markdown AST tokens.

#### Prevention & Escalation

- Automated regression suite added in `tests/markdown-emphasis-code.test.ts`.
- Authors and agents must avoid nesting inline code inside bold markup, or sanitize tokens prior to schema hydration.

---

### LESSON-004: Headless Mermaid Execution Fails Without DOM Mock

- **ID**: `LESSON-004`
- **Category**: `rendering`
- **Occurrences**: 2
- **Status**: `active`
- **Enforcement**: `skills/taco/scripts/lint-mermaid.mjs`, `tests/mermaid-lint.test.ts`

#### Symptom

Valid Mermaid diagrams fail parse validation with `TypeError: My.addHook is not a function` when executed in headless Node environments without a full DOM.

#### Root Cause

`DOMPurify.sanitize()` unconditionally relies on DOM hooks (`addHook`). In headless environments without DOM emulation, DOMPurify stubs crash.

#### Prevention & Escalation

- Specialized Mermaid lint tool (`skills/taco/scripts/lint-mermaid.mjs`) bypasses headless DOMPurify hook crashes by safely patching sanitization stubs.
- Verifiable via `tests/mermaid-lint.test.ts`.
