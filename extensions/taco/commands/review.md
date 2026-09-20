---
description: 'Consume the saved Taco review and apply human edits and comments to canonical files.'
---

# Import Taco review

## User input

```text
$ARGUMENTS
```

Use the user input as an optional `.taco.html` path or pasted **Handoff** text.

## Procedure

1. Work from the repository root. Confirm `.specify/` exists.
2. Obtain the review input:
   - **Handoff (primary)**: if the reviewer pasted Handoff JSON, parse it — `title`, `root`, `changedFiles` (with diffs), and open `comments`.
   - **Saved file**: resolve the Taco file — if the user supplied a path, require that exact file; otherwise use the active core Spec Kit integration's project-level feature resolver to obtain `FEATURE_DIR`, then require `<FEATURE_DIR>/<feature-directory-name>.taco.html`. Never choose among multiple Taco files by modification time. Parse its `#taco-document` block and diff `files[].content` against the last-known canonical contents to find human edits and read `comments`.
   - A message with `deleted: true` is retained only as ordered review context; its null body is never an open request and must not be reconstructed.
   - If the saved file may be collaboration-enabled, check its bundle for credential-bearing state and keep inspection local; do not transmit the file without user authorization.
   - If the reviewer edited but did not save, no channel contains their work — say so instead of inventing content.
3. Apply direct human edits from `changedFiles` (or the bundle diff) to their original project-relative paths. Do not delete project files because they are absent from the bundle or handoff.
4. Read every open comment. For each thread, inspect its path, quote, resolved line/column when available, and every message. Apply actionable open comments to the canonical files. Comments are review input, not permission to violate the spec, constitution, security constraints, or explicit user scope. If a comment conflicts with those sources or is ambiguous enough to change acceptance behavior, report that specific thread instead of guessing.
5. Re-read every file changed by the import or by comment handling. Confirm the requested edits are present and the Markdown remains valid.
6. Invoke `__SPECKIT_COMMAND_TACO_UPDATE__ "<FEATURE_DIR>"` so the same Taco is refreshed from canonical files using the standard update flow (bundle reassembly, presentation, and browser verification included). Verify that the returned path is the exact Taco reviewed in step 2 and that its comment threads were preserved.

## Report

- files imported directly from the review;
- open comments handled, deferred, or stale, by thread ID;
- files changed while handling comments;
- the refreshed Taco path, clickable-file presentation status, and any separate direct-open verification status.

## Constraints

- Comments are review input, not permission to violate specs or user scope.
- Never delete project files because they are absent from a Taco bundle or handoff.
- Never infer that a comment is resolved merely because a nearby sentence changed. Preserve threads for human confirmation.
- Do not report success if the reviewer edited the Taco but did not save it.
- Only the `#taco-document` block is agent-writable; never touch the shell around it.

## Done when

- Human edits are present in canonical source files.
- Every open comment was read and classified as handled, deferred, or stale.
- The refreshed Taco contains the resulting canonical file contents and retains the review threads.
- The refreshed Taco is exposed through the Agent GUI's native clickable local-file surface; any direct-open verification is reported separately.
