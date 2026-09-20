---
description: 'Create or refresh the Taco for the active Spec Kit feature.'
---

# Update Taco review artifact

## User input

```text
$ARGUMENTS
```

The user input may contain one feature-directory path followed by repeatable `--ignore <feature-relative-path-or-glob>` options. This command is also invoked by mandatory lifecycle hooks, where input is normally empty.

## Procedure

1. Work from the repository root. Confirm `.specify/` and `.specify/extensions/taco/assets/taco-shell.html` exist. If either is missing, stop with the exact missing path.
2. Resolve the feature directory:
   - If the user supplied a path, resolve that exact path and require `<path>/spec.md`.
   - When invoked as a lifecycle hook, use the exact feature directory produced or changed by the immediately preceding Spec Kit command.
   - Otherwise use the active core Spec Kit integration's project-level feature resolver and read its `FEATURE_DIR` result.
   - If these sources do not identify exactly one feature directory, stop and ask for the path. Never select by modification time.
3. Assemble the bundle without any CLI:
   - Copy the shell to `<FEATURE_DIR>/<FEATURE_DIRECTORY_NAME>.taco.html`.
   - Read every file under the feature directory (apply requested `--ignore` patterns; default-skip dotfiles, lockfiles, and build noise).
   - Build `files[]` as `{ path, mediaType, content, sourceHash? }` with raw on-disk contents (PNG as data URI). Report every excluded path; never silently drop a visible one.
   - If the existing `<FEATURE_DIR>/<feature-name>.taco.html` is present, read its `#taco-document` bundle first and carry over `docId`, `comments`, `navigation`, and `packOptions` — review threads, document identity, and human-authored sidebar state survive every refresh this way. For a new Taco, mint a fresh `docId` and set `root` to the feature directory path.
   - Replace the content of the `#taco-document` block with the new JSON (`<` escaped as `\u003c`); update `<title>` to the bundle title. Touch nothing else in the shell.
4. Present the generated Taco to the user:
   - Always use the active Agent GUI's native clickable local-file or artifact presentation for the exact absolute output path.
   - When local HTML navigation is explicitly supported and permitted, proactively open the exact generated file and verify its expected title and document content are visible; do not ask again merely to open it. Use a separate tab rather than reloading an existing review with unsaved edits or comments. If browser tools are unavailable, navigation is prohibited (in Codex, do not autonomously navigate to `file://`), or opening fails, keep the clickable-file handoff and report the reason without bypassing the restriction.
   - Never substitute a `data:` or Blob URL, development application, different Taco, external upload, or weakened browser security setting for the local file. Keep credential-bearing files within the authorized local environment.
5. Report the absolute Taco path, embedded file count, exclusions, preserved comment count, and presentation status. Distinguish `presented as a clickable file`, `opened`, and `opened and verified`; claim verification only after observing the expected title and content. State that the reviewer must save (⌘S) the Taco after editing or commenting before `__SPECKIT_COMMAND_TACO_REVIEW__` can consume it.

## Agent invariant

Whenever you modify any canonical artifact inside a Spec Kit feature directory outside a lifecycle hook—including specification, clarification, plan, tasks, research, data model, contracts, checklists, or recorded implementation progress—run this command before reporting that operation complete.

## Constraints

- The feature directory remains canonical; Taco is a review transport.
- Never delete feature files during update.
- Only the `#taco-document` block is agent-writable; never touch the shell around it.
- Preserve `docId`, `comments`, and `navigation` from any existing bundle; never fabricate comments or hashes.

## Done when

- The in-directory Taco exists at the reported path with a valid `taco/files` v1 bundle.
- Its bundle `root` matches the feature directory and its embedded file count is nonzero with all exclusions reported.
- The Taco is exposed through the Agent GUI's native clickable local-file presentation. Where supported and permitted, it was proactively opened and its title and document content checked; otherwise the unavailable, prohibited, or failed browser step is reported separately.
- The reviewer has the explicit next command: `__SPECKIT_COMMAND_TACO_REVIEW__ <path-to-file.taco.html>`.
