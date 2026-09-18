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

1. Work from the repository root. Confirm `.specify/` and `.specify/extensions/taco/bin/taco.mjs` exist. If either is missing, stop with the exact missing path.
2. Resolve the feature directory:
   - If the user supplied a path, resolve that exact path and require `<path>/spec.md`.
   - When invoked as a lifecycle hook, use the exact feature directory produced or changed by the immediately preceding Spec Kit command.
   - Otherwise use the active core Spec Kit integration's project-level feature resolver and read its `FEATURE_DIR` result.
   - If these sources do not identify exactly one feature directory, stop and ask for the path. Never select by modification time.
3. Run the installed extension CLI without network access:

   ```bash
   node .specify/extensions/taco/bin/taco.mjs pack "<FEATURE_DIR>" \
     --project-root "<REPOSITORY_ROOT>" \
     [--ignore "<PATTERN>"]... \
     --json
   ```

   Do not supply `--output`: the CLI owns the canonical in-directory Taco filename. On refresh it automatically reads that existing Taco so review threads, document identity, and explicit ignores are preserved.

4. Parse the JSON response. Require a successful result, a nonzero file count, and output exactly `<FEATURE_DIR>/<FEATURE_DIRECTORY_NAME>.taco.html`.
5. Present the generated Taco to the user:
   - Always use the active Agent GUI's native clickable local-file or artifact presentation for the exact absolute output path.
   - In Codex, emit a clickable absolute file link and do not attempt to navigate Browser directly to `file://`; the user's click hands the file to Browser, like opening a local note attachment.
   - In another Agent GUI, when local HTML navigation is explicitly supported and permitted, proactively open the exact generated file and verify its expected title and document content are visible; do not ask again merely to open it. Use a separate tab rather than reloading an existing review with unsaved edits or comments. If browser tools are unavailable, navigation is prohibited, or opening fails, keep the clickable-file handoff and report the reason without bypassing the restriction.
   - Never substitute a `data:` or Blob URL, development application, different Taco, external upload, or weakened browser security setting for the local file. Keep credential-bearing files within the authorized local environment.
6. Report the absolute Taco path, embedded file count, default exclusions, explicit exclusions, preserved comment count, and presentation status. Distinguish `presented as a clickable file`, `opened`, and `opened and verified`; claim verification only after observing the expected title and content. In Codex the expected state before user interaction is clickable-file presentation. State that the reviewer must save the Taco after editing or commenting before `__SPECKIT_COMMAND_TACO_REVIEW__` can import it.

## Agent invariant

Whenever you modify any canonical artifact inside a Spec Kit feature directory outside a lifecycle hook—including specification, clarification, plan, tasks, research, data model, contracts, checklists, or recorded implementation progress—run this command before reporting that operation complete.

## Constraints

- The feature directory remains canonical; Taco is a review transport.
- Never delete feature files during update.
- Never hand-edit the generated HTML shell.
- Never add `--force` to a Taco command.
- Do not silently omit a visible unsupported path. Report the CLI failure and let the user explicitly exclude it.

## Done when

- The in-directory Taco exists at the reported path.
- Its result identifies the same feature root as the active Spec Kit feature.
- Its embedded file count is nonzero and all exclusions are reported.
- The Taco is exposed through the Agent GUI's native clickable local-file presentation. Where supported and permitted, it was proactively opened and its title and document content checked; otherwise the unavailable, prohibited, or failed browser step is reported separately.
- The reviewer has the explicit next command: `__SPECKIT_COMMAND_TACO_REVIEW__ <path-to-file.taco.html>`.
