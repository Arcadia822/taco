---
title: 'Taco Lite: on-demand dependencies with editable source fallback'
feature_id: 'TACO-16'
created: '2026-09-24'
status: 'Draft'
input: |-
  Keep reading, comments, and editing. Load heavy libraries externally on demand like Mermaid; if import fails, fall back to editable Markdown source. Remove Share from both full and Lite. Recommend the complete pack for offline use and the minimal pack for online use.
---

## Goal

Offer a smaller initial `.taco.html` for connected review without removing editing or comments. Keep the complete shell as the offline-capable choice. The Lite shell and its external dependency service do not exist yet; this document defines the intended behavior, not a shipped capability.

## User scenarios and acceptance

### Connected review

A reviewer opens a Lite Taco, reads documents, selects text to comment, and edits Markdown. The rich editor's large dependencies load on demand from version-pinned external modules rather than being embedded in the initial HTML. The resulting edits and comments follow the same save and Handoff contracts as the complete shell. Other supported file types retain their current viewing and editing behavior.

### Import failure or offline Lite review

If an external rich-editor import fails, Markdown opens in an **editable plain-text source editor** when the bundle is writable; a read-only bundle remains read-only. The reviewer sees a clear fallback state, can edit, select text for comments, save, and hand off without losing input. Unavailable syntax highlighting must not block source editing. Failure of one external provider may trigger another equivalent, version-pinned provider; failure of all providers must reach this fallback instead of a blank document or a read-only error. A switch in mode must not silently discard unsaved work.

### Offline complete review

An agent preparing a Taco for a recipient who may open it without network access selects the complete, dependency-containing pack. Rich editing, local comments, save, and Handoff remain available offline without fetching external modules. The current complete shell remains the default until Lite is implemented and verified.

### Pack selection guidance

The installation documentation and installable agent skill must recommend the complete pack when the **recipient's opening environment** may be offline and the minimal Lite pack when reliable network access is expected. Installation-time connectivity alone is not a valid selector. The guide must explain Lite's editable source fallback and the complete pack's size/offline trade-off; it must not claim Lite ships before it does.

## Shared functionality boundary

Share-related functionality is removed from **both** complete and Lite packs; it is not merely hidden in Lite. This includes Share UI and dedicated sharing/online collaboration code, configuration, deployment paths, copy, and tests no longer relevant after the removal. Preserve local document identity and review metadata, Markdown editing, local comments, save, and Handoff. Identify callers and persistent data dependencies before deleting code so existing local review files remain usable. The product has not yet established a Share use case.

## Delivery constraints

- Build and publish distinct complete and Lite shell artifacts. An `editable: false` configuration does not qualify as Lite: today's read-only Markdown still instantiates Tiptap.
- Use public ESM CDNs for the external libraries; do not require Taco to host, publish, or operate a dependency artifact or CDN. Pin exact package versions and choose browser-importable URLs whose transitive imports resolve through that provider. Validate the whole import graph, styles, CORS, and security policy from an actual `file:`-opened Taco.
- A fallback public provider may generate a different module graph; validate each provider independently for the same pinned library versions and supported behavior. On a provider failure, retry the complete editor load through another verified provider rather than mixing modules from both; if neither works, use editable Markdown source. Measure latency and availability in mainland China and overseas before claiming regional performance.
- The compressed, empty Lite shell target is **under 100 KiB**. Report initial HTML bytes separately from total dynamically transferred bytes, and measure both complete and Lite builds.
- Only the bundled `#taco-document` data and escaped `<title>` may vary when agents package either shell. Existing `docId`, comments, navigation, canonical HTML `file:` URLs, and saved review state must survive refresh.

## Verification

- Exercise connected Lite rich editing, text selection/comment anchoring, save, and Handoff in an actual browser.
- Block external imports and exercise editable Markdown fallback, comments, save, Handoff, and read-only permissions in an actual browser; verify no user input is lost during failure.
- Exercise complete-shell rich editing offline. Check that neither pack exposes Share entry points or initializes Share-only services, while local review behavior remains intact.
- Check the empty Lite size and ensure its JS payload does not contain the large editor/collaboration libraries. Record full import-graph bytes and regional measurements before promising cross-region performance.
