# Implementation Plan: Taco Security Hardening

**Feature Branch**: `003-taco-security-hardening`
**Created**: 2026-08-12
**Specification**: [spec.md](spec.md)

## Objective

Create one fail-closed security boundary for content, collaboration data, capability exports, Agent inspection, prototype execution, and self-contained runtime replacement. Preserve Taco's file-first model and current collaboration protocol; do not import Bento's slide-only features.

## Architecture

### 1. Runtime content policy

Add a central security module that owns:

- supported Tiptap block types and editor HTML tags/attributes;
- safe link and image URL decisions;
- Markdown and renderer sanitization;
- bounded JSON checks for hostile or oversized input;
- stable security issue codes and the runtime security version.

All block restoration paths sanitize immediately before Tiptap parses HTML. Mermaid output receives an additional Taco-owned sanitizer after Mermaid renders and before SVG enters live DOM. Remote images do not load automatically; only explicitly embedded safe assets render.

### 2. Collaboration validation

Validate frame envelopes before dispatch, operations before CRDT application, and snapshots before merging. Rebuild the synchronized Taco document key by key, preserve only the supported document/file/node vocabulary, sanitize block HTML, and atomically reject malformed received units. Keep the receiver's `collab` object outside synchronized document state.

### 3. Capability-safe projections

Replace clone-and-delete invitation export with explicit construction of the approved collaboration capability fields. Sealed readers continue to remove all collaboration state. Add credential-free public and diagnostic projections; remove raw bundle exposure from `window.taco`.

### 4. Agent preflight and runtime identification

Expose stable validation issue codes through `window.taco.validate()` and a local CLI command that reads the inert JSON block without executing the Taco runtime. Add a machine-readable runtime security marker to the shell. Update Agent instructions so credential detection precedes complete-file inspection or transmission.

### 5. Canonical local prototype execution

Package each HTML file's canonical absolute `file:` URL and validate that its decoded pathname ends in the already validated project-relative file path. Open that exact URL in a separate page using `noopener,noreferrer`, independent of the Taco container's own location. Reject HTML with a missing or mismatched URL; never construct `data:`, Blob, iframe, inline-execution, or source-download fallbacks.

### 6. Release and recovery

Extend the shell gate to require the runtime security marker and hardened API surface. Existing Taco artifacts are refreshed through the normal pack/update flow. Reset Access continues to re-key onto a new room and receives regression coverage proving old delegated writers cannot resume.

## Verification Strategy

- Unit tests for URL, HTML, schema, frame, operation, snapshot, export, validation, and public API projections.
- Real-browser adversarial test against the production build for script execution, event handlers, navigation, unexpected requests, Mermaid SVG insertion, and prototype origin isolation.
- Baseline evidence by running the browser corpus against the pre-hardening commit in an isolated temporary worktree, without modifying the working tree.
- Existing collaboration and relay integration tests for convergence and access reset.
- `npm run check` as the complete compatibility, build, compression, shell-gate, and extension-shell synchronization gate.

## Compatibility and Migration

- Bundle format stays `taco/files` version 1.
- Existing safe Markdown and comments remain canonical.
- Existing block HTML is rebuilt through the supported Tiptap schema on open.
- Unknown non-security bundle fields remain preserved by the file parser, but synchronization and share exports use explicit projections.
- Previously generated Taco files remain on their old runtime until repacked.

## Risks

- Sanitization can damage valid Markdown structure. Tests compare canonical Markdown before and after safe open/save fixtures.
- Collaboration validation can reject future protocol additions. Protocol-version mismatch and stable rejection diagnostics make this explicit rather than silently corrupting state.
- Large data URLs can hit browser navigation limits. Prototype construction is bounded and falls back to source download.
- `file://` origins vary by browser. Hosted HTTP/HTTPS origin isolation is the normative browser gate; local behavior is tested separately where supported.
