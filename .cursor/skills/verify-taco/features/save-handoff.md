---
title: "Save Taco and hand off review"
---

Persist the reviewed file or a copy, unpack to an explicitly selected directory, and send review feedback through clipboard or an active local listener.

## Sub-features

- `save/main-keyboard-menu`: Save from header, Cmd/Ctrl+S or Save menu.
- `save/copy`: Save a copy/download and cancel fallback confirmation.
- `save/unpack`: Save and unpack files into a permitted scratch directory.
- `handoff/clipboard`: copy a review containing unsaved changes and comments.
- `handoff/listener`: send the in-memory review to a local listener and inspect its receipt.

## How to get to it (user POV)

- Click Save or press Cmd/Ctrl+S; open its adjacent menu for Save, Save a copy… or Save & unpack.
- Confirm Download This Taco? when in-place writing is unavailable, or cancel it.
- Click Handoff or choose an option in its adjacent menu.
- A listener-enabled Taco uses Handoff to deliver to its subscribed agent; otherwise the standalone path copies review text.

## Driving it with Playwright

Preconditions: doctor passes; create a visible unique edit first. The helper's context accepts downloads and grants no directory handles. Run `node .cursor/skills/verify-taco/scripts/verify.mjs --scenario .cursor/skills/verify-taco/scripts/edit-save.mjs` to prove the default Save download path.

- **Download Save.** At the production file-access boundary only, run `page.evaluate(() => { window.showSaveFilePicker = undefined })` to select the supported download fallback. Start `page.waitForEvent('download')` before clicking `button.save-button`; confirm `dialog.confirmation-dialog[open] .control-button-primary`. Save the download under `outDir`. Parse its inert bundle and reopen using `await reopen(path)`. Require the edit in both bundle and rendered UI, preserved `docId`, and unchanged original artifact hash. Capture before, edited and reopened states.
- **Keyboard and menu Save.** Repeat in independent baseline runs using `page.keyboard.press('ControlOrMeta+s')`; separately click `button.save-more` and `.save-menu`'s button named `Save`. Confirm the same output content. Never report all three entry points verified by the main-button scenario.
- **Copy/cancel.** Click `.save-more` and `.save-menu`'s button named `Save a copy…`. Observe the actual accessible name from the current snapshot if locale differs. Capture and cancel the download confirmation, then assert no download event/file was produced. Repeat with confirm and reopen the copy. The original input must remain byte-identical.
- **Unpack.** Through the same menu choose Save & unpack. On unsupported browsers require the visible unsupported message and no filesystem writes. Actual directory-write verification requires a user-selected disposable directory and listing/comparing its files after completion; browser API stubs cannot establish native permission or filesystem behavior.
- **Clipboard Handoff.** Grant `clipboard-read` and `clipboard-write` to this owned origin with `context.grantPermissions`, then click `.copy-review-main`. Read `navigator.clipboard.readText()` and save it under `outDir`; compare actual copied review against the observed `getReviewHandoff()` changed files/comments. Also exercise `.copy-review-more` options when their behavior changes. Permission-denial coverage must require failure feedback and no claimed success.
- **Listener Handoff.** Reuse the existing repo-root `/scripts/smoke-local-toolbox.mjs` recipe with its documented CLI argument override after building the CLI. Start a listener for a disposable Taco only, use its exact emitted ready URL/hash, click Handoff and inspect the actual receipt's changed files/comment history. The browser must be allowed to reach that listener's owned origin in this specific scenario; the default runner blocks extra origins. Retain a sanitized receipt and stop only the started listener PID. Do not expose its token or use a live user's review.

## Gotchas

- Headless Chromium exposes `showSaveFilePicker`; it can wait forever unless the intended fallback is explicitly chosen. This boundary override proves download behavior only.
- Saved/downloaded content and filename are the side effects; a success toast alone is not proof.
- Header Save does not reset the review handoff baseline. Unsaved edits can be handed off before saving.
- The default runner blocks outbound origins and has no listener. CLI/Host handoff is unverified until its real receipt is observed.
- A command named dry-run may still fetch capabilities or open a browser. Record actual requests, outputs and file/ref changes for that command; never infer safety from the flag name.
