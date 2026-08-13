# Tasks: Taco Security Hardening

## Phase 1 - Policy and schemas

- [x] T001 Add the centralized runtime security policy, issue codes, input bounds, URL policy, and HTML/SVG sanitizers
- [x] T002 Validate and rebuild embedded Taco blocks before editor restoration
- [x] T003 Prevent passive external image requests while preserving canonical Markdown sources
- [x] T004 Sanitize Mermaid SVG after rendering and before live DOM insertion

## Phase 2 - Collaboration boundary

- [x] T005 Validate collaboration frame envelopes before dispatch
- [x] T006 Validate operation arrays atomically before CRDT application
- [x] T007 Validate sync state and rebuild snapshots key by key before merge
- [x] T008 Preserve receiver-local collaboration capabilities during every remote projection
- [x] T009 Add malformed-frame recovery and subsequent-valid-edit tests

## Phase 3 - Capabilities and Agent surfaces

- [x] T010 Replace invitation clone-and-delete logic with an explicit capability allowlist
- [x] T011 Scan every share/export variant for current, unknown, and legacy credential fields
- [x] T012 Add credential-free runtime validation with `collab-secrets-present`
- [x] T013 Remove raw bundle access from `window.taco` and expose only bounded file and validation APIs
- [x] T014 Add a local inert CLI validation command and perform it before Agent content inspection

## Phase 4 - Prototype and runtime replacement

- [x] T015 Replace generated prototype documents with the validated canonical local `file:` URL
- [x] T016 Reject missing or mismatched HTML source URLs without a generated or download fallback
- [x] T017 Add the machine-readable runtime security version to source and generated shells
- [x] T018 Extend the shell gate for the security marker and hardened public API
- [x] T019 Document old self-contained runtime replacement and access-reset behavior

## Phase 5 - Adversarial verification and release

- [x] T020 Add hostile HTML, SVG, URL, CSS, paste, CRDT operation, and snapshot fixtures
- [ ] T021 Run the real-browser corpus against the pre-hardening baseline and record failures — three targeted baseline regressions were recorded in an isolated worktree; the complete old browser build was not exercised
- [x] T022 Run the same corpus against the hardened production artifact and require zero execution, navigation, and unapproved requests
- [x] T023 Verify canonical local-file targeting and no-opener link attributes independently of the Taco container location
- [x] T024 Run relay integration proving old-invitation rejection and new-editor acceptance in the replacement room
- [x] T025 Run `npm run check`, refresh this Taco, and record exact evidence in the specification
