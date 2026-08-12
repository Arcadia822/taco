# Specification Quality Checklist: Taco Security Hardening

**Purpose**: Validate that the security hardening specification is complete, bounded, and testable before planning implementation
**Created**: 2026-08-12
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] The specification describes observable security outcomes rather than copying Bento implementation code.
- [x] Bento-specific surfaces and Taco-applicable surfaces are explicitly separated.
- [x] Every P1 user story has an independent adversarial test.
- [x] Security claims distinguish real-browser evidence from unit-test evidence.
- [x] Scope, superseded behavior, and non-goals are explicit.

## Trust-Boundary Completeness

- [x] Initial bundle parsing, Markdown, stored block HTML, paste, CRDT operations, snapshots, Mermaid, saves, and HTML prototypes are covered.
- [x] Rendering requirements cover script execution, event handlers, dangerous URLs, active forms, CSS/SVG fetches, automatic navigation, and unapproved network requests.
- [x] Collaboration validation is required before mutation and defines atomic rejection.
- [x] Authorized collaborators remain untrusted content producers.
- [x] Malformed-input rejection preserves the last valid document and continued usability.

## Credential Completeness

- [x] Owner, working-copy, editor-invitation, and sealed-reader capability inventories are required.
- [x] Share exports use allowlists rather than clone-and-delete denylisting.
- [x] Unknown and legacy private fields are covered by regression tests.
- [x] Agent, JSON, debug, validation, and error surfaces are prohibited from returning credentials.
- [x] `collab-secrets-present` behavior is defined for credential-bearing and credential-free files.
- [x] Credential stripping is explicitly distinguished from access reset.

## Prototype and Release Completeness

- [x] Prototype isolation covers opener, origin storage, channels, application APIs, DOM, and retained permissions.
- [x] Lack of browser isolation fails closed to source or download.
- [x] The new isolation requirement explicitly supersedes the prior same-origin Blob mechanism.
- [x] Self-contained artifacts are recognized as independently versioned runtimes that require refresh.
- [x] Standalone and extension shell synchronization is required.
- [x] Access reset and old-writer rejection are covered without claiming plaintext retraction.

## Verification Readiness

- [x] Success criteria require a real browser and observable execution, request, navigation, origin, and storage results.
- [x] Each retained regression must be shown to fail on the selected pre-hardening baseline.
- [x] Exact export-field equality is testable.
- [x] The standard repository check remains required but is not treated as sufficient security evidence.
- [x] No unresolved clarification marker remains.
- [x] Relay scope is bounded rather than being implicitly declared secure by the Bento release.
