---
title: "Review with anchored comments"
---

Select text and start a discussion attached to it, reply and revise messages, and keep review history when messages are deleted or a thread is resolved.

## Sub-features

- `comments/selection`: create a comment from rich or source text selection.
- `comments/author`: enter the reviewer's name when first submitting.
- `comments/thread`: reply, resolve/reopen, edit a message and delete a message or thread.
- `comments/panel`: toggle the right panel without dropping unsubmitted drafts.
- `comments/anchor`: follow quote/anchor position; report lost positions after source changes.

## How to get to it (user POV)

- Select document text, then click the floating Comment control.
- In a source editor, select source text and choose Comment; code/diagram views may offer whole-block comment controls.
- Choose Comments in the right panel; use Reply, Resolve/Reopen or message edit/delete controls on a card.
- Use the rightmost header panel toggle; Escape closes the panel when no dialog/menu/editor handler takes precedence.
- Choose the card's quote to locate its text in the document.

## Driving it with Playwright

Preconditions: doctor passes, file is editable, run uses a fresh identity/context. Use an authored scenario through `verify.mjs --scenario tmp/verify-taco-comments.mjs`; capture before and after each transition.

- **Select and submit.** Click `.ProseMirror`, go to its end, press Enter and type a unique paragraph. Press `ControlOrMeta+Shift+ArrowLeft` to select the last word; click `.selection-comment-button`; fill `.comment-composer textarea.comment-input` and click `.comment-composer button.comment-submit`. If `dialog.author-name-dialog` appears, fill `input.author-name-input` with `Verification Reviewer` and confirm using `.control-button-primary`. Require an `article.comment-thread[data-thread-id]`, the entered body and a quote from the selected source; observe the matching thread in `getReviewHandoff().comments`.
- **Source selection.** Open a JSON/plain-text fixture, click `textarea.source-editor-input`, then use Home/Shift+End to select a real line and click `.selection-comment-button`. Submit through the same composer. Check the resulting quote and path, not just comment count.
- **Reply/status.** Capture the actual thread ID. Scope all actions to its `article.comment-thread`; click its button named `Reply`, fill that card's `textarea.comment-input`, and submit with its `button.comment-submit`. Click `Resolve`, require `.is-resolved` and API status, then click `Reopen` and require `open` again. Save/reopen and compare the message history.
- **Edit/delete message.** Select the exact `.comment-message[data-message-id]` belonging to the current author. Click its action whose accessible name starts `Edit`; fill `.comment-message-editor textarea.comment-input`, submit its `.comment-submit`, and require updated body/timestamp in the read-only handoff. Before clicking `.comment-message-delete`, register `page.once('dialog', dialog => dialog.accept())` for its native confirmation. Require a tombstone for that message while replies survive. Separately test the thread's `Delete thread` control with its own pre-registered native confirmation handler; it has different semantics.
- **Draft/panel.** Enter a distinctive unsent draft in the composer; toggle `.comment-toggle` closed/open and verify the same draft, focus/caret where applicable. In a separate step press Escape with no active dialog/menu and require closed panel. Click `.comment-toggle` to reopen the panel, then select `getByRole('tab', { name: 'Comments', exact: true })`.
- **Anchor.** Click `.comment-quote-button` and observe visible anchor text. Edit/remove its source and verify placement updates or `.comment-stale-group` reports the lost position; do not silently reattach a quote in the harness.

## Gotchas

- Message controls depend on identity and write permission. Use the actual author dialog; injecting identity state skips that user path.
- Deleted messages are retained history, never open feedback. Thread deletion is distinct from message deletion.
- Scrolling can reposition cards; select by thread/message ID after repaint, not screen coordinates or card index.
- Whole-document comments exposed by API are not evidence of a user-accessible entry in this standalone shell. Do not invoke internal `startDocumentComment()` as a user action.
- Clipboard handoff or visible cards alone do not prove saved comments. Download and reopen the Taco to inspect persisted threads.
