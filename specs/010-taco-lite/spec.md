---
title: 'Taco Lite: on-demand dependencies with editable source fallback'
feature_id: 'TACO-16'
created: '2026-09-24'
status: 'Draft'
input: |-
  Keep reading, comments, and editing. Load heavy libraries externally on demand like Mermaid; if import fails, fall back to editable Markdown source. Remove Share from both full and Lite. Recommend the complete pack for offline use and the minimal pack for online use.
---

## Goal

Offer a smaller initial `.taco.html` for connected review without removing editing or comments. Keep the complete shell as the offline-capable choice. The two distinct shell builds preserve the same local review workflow.

## User scenarios and acceptance

### Connected review

A reviewer opens a Lite Taco, reads documents, selects text to comment, and edits Markdown. On opening, Lite inspects the embedded bundle's file types and starts loading the corresponding external libraries **during initial loading**, in parallel where independent, before a matching document is first rendered; it must not defer the first dependency request until file selection/rendering. Do not fetch libraries for file types absent from the bundle. Keep the loading screen visible while the rich editor loads. During that wait, show neither raw Markdown nor the rich editor; mount the rich editor only after successful import and the editable Markdown source only after the import has failed. A bounded failure path keeps the shell responsive if a provider stalls. The resulting edits and comments follow the same save and Handoff contracts as the complete shell. Other supported file types retain their current viewing and editing behavior.

### Import failure or offline Lite review

If an external rich-editor import fails, Markdown opens in an **editable plain-text source editor** when the bundle is writable; a read-only bundle remains read-only. The reviewer sees a clear fallback state, can edit, select text for comments, save, and hand off without losing input. Unavailable syntax highlighting must not block source editing. Failure of one external provider may trigger another equivalent, version-pinned provider; failure of all providers must reach this fallback instead of a blank document or a read-only error. A switch in mode must not silently discard unsaved work.

### Offline complete review

An agent preparing a Taco for a recipient who may open it without network access selects the complete, dependency-containing pack. Rich editing, local comments, save, and Handoff remain available offline without fetching external modules. The current complete shell remains the default until Lite is implemented and verified.

### Pack selection guidance

The installation documentation and installable agent skill must recommend the complete pack when the **recipient's opening environment** may be offline and the Lite pack when reliable network access is expected. Installation-time connectivity alone is not a valid selector. The guide must explain Lite's editable source fallback and the complete pack's size/offline trade-off; do not silently replace an existing complete Taco with a Lite one.

## Shared functionality boundary

Share-related functionality is removed from **both** complete and Lite packs; it is not merely hidden in Lite. This includes Share UI and dedicated sharing/online collaboration code, configuration, deployment paths, copy, and tests no longer relevant after the removal. Preserve local document identity and review metadata, Markdown editing, local comments, save, and Handoff. Identify callers and persistent data dependencies before deleting code so existing local review files remain usable. The product has not yet established a Share use case.

## Delivery constraints

- Build and publish distinct complete and Lite shell artifacts. An `editable: false` configuration does not qualify as Lite: today's read-only Markdown still instantiates Tiptap.
- Use public ESM CDNs for the external libraries; do not require Taco to host, publish, or operate a dependency artifact or CDN. Pin exact package versions and choose browser-importable URLs whose transitive imports resolve through that provider. Validate the whole import graph, styles, CORS, and security policy from an actual `file:`-opened Taco.
- A fallback public provider may generate a different module graph; validate each provider independently for the same pinned library versions and supported behavior. On a provider failure, retry the complete editor load through another verified provider rather than mixing modules from both; if neither works, use editable Markdown source. The user-facing target is a fast open in both mainland China and the United States; measure actual Taco open-to-usable time and import success in both locations, rather than optimizing a CDN location or promising a particular provider.
- Preserve full review behavior over an aggressive size target. After the empty Lite shell measured 222,792 bytes (217.6 KiB), the user chose to relax the former <100 KiB target rather than remove functionality. Enforce **<225 KiB (230,400 bytes)** on the compressed, empty Lite shell; report initial HTML bytes separately from total dynamically transferred bytes, and measure both complete and Lite builds.
- Only the bundled `#taco-document` data and escaped `<title>` may vary when agents package either shell. Existing `docId`, comments, navigation, canonical HTML `file:` URLs, and saved review state must survive refresh.

## Verification

- Exercise connected Lite rich editing, text selection/comment anchoring, save, and Handoff in an actual browser. Verify boot starts only the imports required by the embedded file types before the corresponding first render; opening a later file of a type already present in the bundle must not start its first dependency fetch. During a stalled import, the loading screen remains visible and there is no Markdown source editor; after success there is exactly one rich editor.
- Block external imports and exercise editable Markdown fallback, comments, save, Handoff, and read-only permissions in an actual browser; verify no source editor appears before both providers fail, the loading screen then dismisses, and no user input is lost during failure.
- Exercise complete-shell rich editing offline. Check that neither pack exposes Share entry points or initializes Share-only services, while local review behavior remains intact.
- Check the empty Lite size against the revised 225 KiB limit and ensure its JS payload does not contain the large editor/collaboration libraries. Record full import-graph bytes, failed-provider behavior, and open-to-usable time from mainland China and the United States before claiming that either region opens quickly.

## Verification evidence (2026-09-25, rebased onto main)

- `npm run check`: 39 Vitest files / 385 tests passed; TypeScript, format check, dual builds, and shell gates passed. After the deferred-loading fix, the empty Lite shell is **201,528 bytes** (<230,400); the built Lite shell with its sample document is 306,218 bytes; the built Complete shell is 2,836,434 bytes.
- Local Chromium opened both variants via `file:`. Complete edited Markdown and rendered Mermaid with the network disabled and no external requests. Lite edited Markdown, anchored a comment, saved a serialized bundle containing the edit, and performed Handoff; with CDN imports blocked it exposed writable Markdown source, preserved comments and Handoff, and displayed a failure notice. A sealed reader copy kept that source read-only.
- A stalled jsDelivr request started the esm.sh backup after **748 ms** in Chromium, and the rich editor loaded. After rebasing, with one provider permitted and cache disabled, the Markdown fixture loaded through jsDelivr in 1,491 ms with 1,021,999 CDN response bytes (276 requests), or through esm.sh in 2,081 ms with 941,104 bytes (576 requests). Those bytes exclude the initial HTML; these timings are from the local test environment, **not** measurements from mainland China or the United States. No regional speed claim is established.
- Lite startup regression: the initial fix replaced a temporary Markdown source editor with the rich editor, but raw Markdown must never appear while the CDN import is pending. The loading screen now remains until that import settles; during loading there is no source or rich editor, success mounts one rich editor, and failure mounts writable source with an error notice. Browser `file:` checks confirmed the pending/success and offline pending/failure states, while the selected `spec.md` row remained visible. The Complete shell still opened its rich editor offline without CDN requests.

## Lossless size review (2026-09-25)

- Reviewed the full Lite shell build graph without removing editor, Mermaid, comments, save, Handoff, or offline Complete behavior. The Lite rich adapter bundles Taco's own editor implementation while keeping npm packages external; the largest local modules implement document properties, Mermaid editing, and code-block controls, so omitting them would change behavior.
- Reused select-control construction in the editor, removed an unused icon, simplified equivalent Mermaid DOM operations, and kept partial-label defaults and GitHub JSON own-property checks intact. The shell builder now minifies splash CSS, removes redundant whitespace outside the document block, and chooses bounded lossless deflate settings. Embedded Mermaid's third-party license notices remain present.
- `npm run check`: 39 Vitest files / 385 tests passed; TypeScript, format check, dual builds, and shell gates passed. Empty Lite shell **200,664 bytes** (was 201,418; −754), sample-document Lite **305,464 bytes** (was 306,218; −754), and sample-document Complete **2,830,970 bytes** (was 2,836,434; −5,464). External CDN transfers are unchanged by this HTML-only size comparison; the figures do not include them.

## Shared Lite runtime module (2026-09-25)

- The Lite build compiles its runtime and rich-editor adapter together into three embedded, compressed ESM payloads: core runtime, one shared Taco module, and the editor adapter. The bootstrap gives both entries the same local Blob module URL; the shared module is part of the `.taco.html`, with no published Taco dependency artifact or network import. The core and shared modules have no external imports; the adapter keeps its pinned, hedged CDN dependencies. Complete retains its independent offline build.
- `npm run check`: 39 test files / 385 tests, dual shell gates, and generated mirrors passed. Empty Lite shell **187,373 bytes**, down **13,291 bytes** from the prior 200,664-byte shell and beyond the 8 KiB experiment gate. The built Lite sample is **292,173 bytes**, down 13,291 bytes; the Complete sample remains **2,830,970 bytes**. These are HTML byte sizes, not full CDN transfer totals.
- Actual `file:` browser checks: the connected Lite mounted one rich editor and propagated an edit to Handoff; with external imports blocked it displayed loading with no source editor, then mounted writable source with an error and propagated an edit to Handoff. Complete mounted its rich editor offline without the Lite shared-module payload. A Lite Save Copy download validated with no stale Blob URL serialized into the shell, and reopened with the rich editor. Screenshot capture timed out; DOM and interaction checks succeeded. Cross-region startup and total import-graph transfer remain unmeasured for this revision.

## Lite payload encoding (2026-09-25)

- The Lite shell stores its four compressed runtime/CSS/editor payloads as ASCII radix-85 instead of Base64. The alphabet excludes `<` so payloads cannot close an HTML script element. Both the boot loader and deferred editor adapter decode before the existing `deflate-raw` decompression. Complete keeps its existing Base64 payloads.
- The empty Lite shell is **176,891 bytes**, down **10,482 bytes** from 187,373 after decoder overhead; the bundled sample is **281,691 bytes**, down 10,482. Complete remains **2,830,970 bytes**. The smaller HTML does not reduce the Lite CDN editor import graph.
- Actual `file:` browser checks mounted one connected rich editor and handed off an edit, held the loading splash until offline import failure then exposed writable source and handed off an edit, and mounted Complete rich editing offline. A Lite Save Copy downloaded and reopened with a rich editor; the saved HTML retained the radix-85 payloads without a stale Blob URL.
- Standalone HTML source files are already rejected by the bundle parser and packer. SVG files have no dedicated renderer; they use generic source view. The DOMPurify dependency remains necessary for Markdown/editor HTML and generated Mermaid SVG sanitization. Dropping those security boundaries would remove distinct supported review features, not merely standalone HTML/SVG file support.
