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
   - Detect whether the active Agent GUI provides an internal browser or equivalent artifact-preview capability that can open the exact local output.
   - When available, open the absolute Taco output immediately. Reuse the existing Taco preview surface when possible instead of accumulating tabs.
   - Verify that navigation succeeded and that the displayed page is the generated Taco. Do not substitute a development application, a different Taco, or an external upload.
   - If the internal browser is unavailable or refuses local-file access, do not claim the Taco was opened. Fall back to a clickable absolute file path and state the exact limitation. Do not weaken browser security settings or upload a potentially credential-bearing Taco to obtain a preview.
6. Report the absolute Taco path, embedded file count, default exclusions, explicit exclusions, preserved comment count, and whether the internal preview opened successfully. State that the reviewer must save the Taco after editing or commenting before `__SPECKIT_COMMAND_TACO_REVIEW__` can import it.

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
- The Taco is open in the Agent GUI's internal browser when that capability is available; otherwise the fallback path and reason are explicit.
- The reviewer has the explicit next command: `__SPECKIT_COMMAND_TACO_REVIEW__ <path-to-file.taco.html>`.
