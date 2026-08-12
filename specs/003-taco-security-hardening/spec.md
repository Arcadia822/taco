# Feature Specification: Taco Security Hardening

**Feature Branch**: `003-taco-security-hardening`
**Created**: 2026-08-12
**Status**: Implemented; browser-origin execution verification partially blocked by the automation environment
**Input**: Audit Bento 1.0.17's security release and apply the relevant protections to Taco without importing unrelated Bento product features.

## Security Objective

Taco must treat every document, clipboard fragment, collaboration frame, generated diagram, and packaged prototype as untrusted input. Untrusted content must not execute code, trigger an unapproved network request, navigate the Taco page, gain Taco-origin authority, or acquire collaboration credentials merely because it appears inside a Taco.

This feature adapts the security principles from Bento 1.0.17 rather than copying Bento's slide-specific implementation. Taco has no free-form slide SVG model, password-protected template export, iOS host, or collaboration blob store. It does have Markdown, Tiptap block HTML, CRDT snapshots and operations, self-contained HTML prototypes, Agent APIs, and file-held collaboration capabilities; those are the boundaries covered here.

Reference evidence:

- [Bento 1.0.17 security announcement](https://github.com/nyblnet/bento/discussions/290)
- [Bento untrusted-document hardening](https://github.com/nyblnet/bento/pull/277)
- [Bento collaboration-secret detection](https://github.com/nyblnet/bento/pull/280)

## User Scenarios & Testing

### User Story 1 - Open and edit untrusted content without granting code execution (Priority: P1)

As a reviewer, I can open a Taco and edit or paste Markdown without document content executing in the Taco application page, silently contacting an external origin, or navigating me away from the document.

**Why this priority**: The application page can hold collaboration capabilities and retained browser permissions. Content execution in that page crosses the document/application boundary and can compromise more than the visible specification.

**Independent Test**: Drive the production Taco in a real browser with an adversarial corpus through initial open, clipboard paste, editor restoration, Mermaid rendering, collaboration delivery, save, and reopen; observe script execution, network traffic, navigation, and the resulting canonical document.

**Acceptance Scenarios**:

1. **Given** Markdown or stored block HTML containing scripts, event attributes, dangerous URL schemes, active forms, refresh metadata, base URLs, executable SVG, CSS imports, or external paint references, **When** Taco opens or restores the content, **Then** none of those constructs executes, fetches, submits, or navigates in the Taco page.
2. **Given** the same hostile constructs arrive through a paste, a collaboration operation, or a collaboration snapshot, **When** Taco projects them into the editor, **Then** the same security result applies as on initial open.
3. **Given** a Mermaid block contains hostile syntax or a renderer returns hostile SVG, **When** Taco renders the diagram, **Then** only the supported inert diagram vocabulary reaches live DOM; failure leaves the editable source available.
4. **Given** sanitization removes unsupported content, **When** the user continues editing and saves, **Then** Taco remains usable and does not silently replace unrelated canonical text.
5. **Given** a normal external link, **When** the user deliberately activates it, **Then** it may open with opener isolation; merely displaying the document must not activate the link or contact its target.

---

### User Story 2 - Reject malformed collaboration state before it mutates the document (Priority: P1)

As a collaborator, I expect a malformed or adversarial peer payload to be rejected without crashing my session, changing paths or access state, or leaving a partially applied document.

**Why this priority**: Encryption proves that a frame came from someone holding a room capability. It does not make that collaborator's content structurally safe or non-hostile.

**Independent Test**: Send malformed operations and snapshots through both BroadcastChannel and the encrypted online transport, then verify deterministic rejection, unchanged local state, continued editing, and structured diagnostics that contain no document content or credentials.

**Acceptance Scenarios**:

1. **Given** a collaboration frame with an unknown frame type, unknown node kind, invalid required field, invalid enum, unsafe path, duplicate identity, or wrong primitive type, **When** Taco receives it, **Then** it is rejected before store mutation.
2. **Given** one invalid operation among otherwise valid operations in the same received unit, **When** validation runs, **Then** Taco applies none of that unit.
3. **Given** an invalid frame is rejected, **When** the user continues editing or receives a later valid frame, **Then** the session remains operational.
4. **Given** a remote block contains HTML outside Taco's supported editor schema, **When** it is accepted into the document, **Then** the stored and rendered block is rebuilt from the supported schema rather than retaining unknown tags or attributes.
5. **Given** a peer attempts to transmit collaboration credentials as document fields, **When** the remote state is applied, **Then** the receiving Taco preserves its own local collaboration capability and does not adopt the peer-supplied credential fields.

---

### User Story 3 - Export only the capability intended for each copy (Priority: P1)

As a Taco owner, I can create an editor invitation or sealed read-only copy knowing that the output contains exactly the capability required for that role and no leftover private material from the working file.

**Why this priority**: A self-contained file looks like a document but can also be a bearer credential. An export that retains one unintended key can grant access after the visible document has left the owner's control.

**Independent Test**: Seed a working bundle with all current credential fields plus unknown and legacy-looking secret fields, exercise every save and share export path, and compare each output against an explicit capability inventory.

**Acceptance Scenarios**:

1. **Given** an owner working Taco, **When** an editor invitation is created, **Then** the output contains the room read capability, owner public key, one newly issued delegated editor capability, required sync state, and no owner private key, previous invitation private key, device key, unknown credential field, or legacy private field.
2. **Given** any writable Taco, **When** a sealed read-only copy is created, **Then** the output contains no `collab` object or collaboration credential and enforces `access: reader`.
3. **Given** a normal save or working-copy save retains collaboration capabilities by design, **When** the user chooses it, **Then** the UI identifies it as a credential-bearing working copy rather than a safe share export.
4. **Given** a future field is added under `collab`, **When** an existing share export runs, **Then** the field is excluded unless that export's explicit capability allowlist has been intentionally updated and tested.
5. **Given** a JSON, debug, Agent, validation, or error-reporting surface, **When** it reports document state, **Then** it does not expose room keys, signing private keys, invitations, device keys, or raw collaboration state.

---

### User Story 4 - Detect credential-bearing files before an Agent reads them (Priority: P1)

As a user asking an Agent to inspect a Taco, I receive a mechanical warning before the Agent reads or transmits a collaboration-capable file, so the file is not mistaken for ordinary Markdown or inert JSON.

**Why this priority**: Documentation that appears after the file has already been attached cannot prevent credential disclosure.

**Independent Test**: Run the Agent-facing inspection flow against an owner Taco, editor invitation, sealed reader, and offline Taco; verify the status code, ordering, output redaction, and prescribed stop/continue behavior.

**Acceptance Scenarios**:

1. **Given** a Taco containing a room key, owner private key, or delegated invitation, **When** the Agent-facing validator inspects it locally, **Then** it reports `collab-secrets-present` before returning file content.
2. **Given** a sealed read-only or never-shared Taco with no collaboration credential, **When** it is inspected, **Then** the validator does not report `collab-secrets-present`.
3. **Given** the warning is reported, **When** no user authorization exists to transmit the file externally, **Then** the Agent may reason locally but must not upload, paste, attach, log, or ticket the complete Taco.
4. **Given** credentials were already sent to an external system, **When** the validator later sees a cleaned file, **Then** it still states that stripping is not revocation and directs the user to reset access.
5. **Given** browser code uses the public `window.taco` API, **When** it lists, reads, or searches files, **Then** no method or property returns collaboration credentials; validation reports issue codes without returning secret values.

---

### User Story 5 - Open an HTML prototype without granting Taco-origin authority (Priority: P1)

As a reviewer, I can deliberately run a self-contained HTML prototype in a separate page without allowing that prototype to access the Taco page, Taco-origin storage, collaboration channels, or retained application permissions.

**Why this priority**: `noopener` removes the direct opener reference but a same-origin Blob still inherits the creating HTTP or HTTPS origin. A hostile prototype must not become same-origin application code merely because the user clicked Preview.

**Independent Test**: Open an adversarial prototype from a hosted production Taco and verify in a real browser that it executes as prototype content but has an opaque or otherwise isolated origin and cannot access the opener, Taco storage, Taco BroadcastChannels, the Agent API, or the Taco DOM.

**Acceptance Scenarios**:

1. **Given** a prototype that probes `window.opener`, localStorage, IndexedDB, BroadcastChannel, cookies, service workers, and the Taco Agent API, **When** it opens, **Then** it cannot read or mutate Taco-origin state.
2. **Given** a prototype contains JavaScript, **When** the user explicitly opens it, **Then** its code may execute only inside the isolated prototype context and cannot execute in the Taco application page.
3. **Given** the prototype is never opened, **When** its card is displayed, **Then** no prototype code runs and no prototype-requested network access occurs.
4. **Given** the browser cannot provide the required isolated execution context, **When** the user requests preview, **Then** Taco refuses execution and offers the canonical source or a download instead of silently weakening isolation.
5. **Given** the prior product specification required a same-origin `text/html` Blob, **When** this feature is implemented, **Then** this feature's origin-isolation requirement supersedes that mechanism while retaining a separate-page, explicit-action experience.

---

### User Story 6 - Replace vulnerable self-contained runtimes and recover exposed access (Priority: P2)

As a maintainer or user, I can identify and replace old Taco runtimes and reset collaboration access when a credential-bearing copy may already have escaped.

**Why this priority**: Each Taco carries its own application runtime. Updating source or the extension shell does not patch files already distributed.

**Independent Test**: Build the hardened runtime, refresh an old feature Taco, inspect both files' runtime/security versions, and exercise access reset against an existing room and newly shared copies.

**Acceptance Scenarios**:

1. **Given** a Taco built before this hardening release, **When** it is validated, **Then** its runtime is reported as outdated without executing its embedded document content.
2. **Given** the hardened source build completes, **When** the extension shell is synchronized, **Then** the standalone artifact and packaged extension contain the same hardened runtime.
3. **Given** an old Taco is refreshed from canonical files, **When** the new Taco opens, **Then** its content, comments, and safe identity state are preserved while the hardened runtime replaces the old shell.
4. **Given** a credential-bearing Taco was sent to a chat, ticket, Agent, or unintended recipient, **When** the owner resets access, **Then** new room and key material is minted, old copies cannot authorize writes to the replacement room, and the user is told to re-share new copies.
5. **Given** plaintext document content was already disclosed, **When** access is reset, **Then** Taco does not claim that rotation retracts the disclosed content.

## Requirements

### Trust-Boundary Requirements

- **FR-001**: Taco MUST treat embedded bundle JSON, Markdown, stored block HTML, clipboard data, comments, collaboration operations, collaboration snapshots, Mermaid source and output, and HTML prototypes as untrusted input.
- **FR-002**: Content that reaches live Taco DOM MUST be created from an explicit supported schema or sanitized by an allowlist appropriate to its HTML, URL, SVG, and CSS context.
- **FR-003**: The same security policy MUST cover initial parsing, paste, editor restoration, local collaboration, online collaboration, save/reopen, and derived rendering; no ingress path may bypass it.
- **FR-004**: Taco MUST NOT rely on a denylist of known event attributes, dangerous tags, URL schemes, or CSS constructs as the primary executable-content boundary.
- **FR-005**: Unsupported keys, tags, attributes, enums, node kinds, and primitive types MUST be rejected or dropped before they reach live DOM or canonical collaboration state.
- **FR-006**: Security rejection MUST fail closed for the affected received unit, preserve the last valid local document, and leave unrelated local editing usable.
- **FR-007**: Error and diagnostic output MUST identify the rejected boundary and stable issue code without including document bodies or credentials.

### Rendering and Network Requirements

- **FR-008**: Initial Markdown rendering, Tiptap restoration, paste, and CRDT-delivered block rendering MUST execute zero document-supplied scripts and event handlers.
- **FR-009**: Taco content MUST NOT create active forms, `javascript:` or equivalent executable URLs, automatic navigation, base-URL retargeting, executable embedded documents, or author-controlled CSS capable of external fetches in the Taco page.
- **FR-010**: Displaying a document MUST NOT make author-controlled network requests. Explicit external-link activation, explicit isolated prototype execution, explicit Mermaid enablement, and enabled online collaboration are the only feature-defined exceptions.
- **FR-011**: Mermaid output MUST pass a Taco-owned SVG and URL security boundary after rendering and before insertion with `innerHTML`; Mermaid's configured security level alone MUST NOT be the final trust boundary.
- **FR-012**: Security tests MUST exercise the real production rendering paths in a browser, including event dispatch and network/navigation observation; source inspection and DOM string assertions alone are insufficient.

### Collaboration Input Requirements

- **FR-013**: Every received collaboration frame MUST be structurally validated before dispatch according to its frame type.
- **FR-014**: Every received operation and snapshot MUST be validated against Taco's document, file, block, comment, presence, and sync-state schemas before store mutation.
- **FR-015**: Validation MUST enforce safe paths, uniqueness constraints, required fields, finite numeric bounds, supported enums, supported node kinds, and JSON-compatible acyclic data.
- **FR-016**: A received unit containing an invalid member MUST be rejected atomically; Taco MUST NOT apply the remaining members of that unit.
- **FR-017**: Remote document projection MUST preserve the receiving file's local `collab` capability and MUST NOT adopt peer-supplied credential state.
- **FR-018**: A malformed authorized collaborator payload MUST be treated as untrusted input rather than as proof that the payload is safe.

### Credential and Export Requirements

- **FR-019**: Taco MUST maintain one explicit capability inventory for every output variant: owner working file, working copy, editor invitation, and sealed read-only copy.
- **FR-020**: Share exports MUST be constructed from per-variant allowlists; cloning a working document and deleting a short list of known secrets is insufficient.
- **FR-021**: An editor invitation MUST contain only the room read capability, owner public key, a newly issued delegated writer capability, required protocol/version state, and explicitly approved synchronization state.
- **FR-022**: A sealed read-only copy MUST remove the complete `collab` object and enforce `access: reader` at the parser, editor, comment, store, and save boundaries.
- **FR-023**: Unknown or legacy-looking private fields MUST NOT survive into a share export.
- **FR-024**: Normal Save and working-copy Save may preserve the current file's capability, but the product MUST distinguish them from share-safe exports before the file is produced.
- **FR-025**: Unused or future JSON/debug export paths MUST either be removed from production reachability or use an explicitly credential-free projection.
- **FR-026**: Automated tests MUST scan every production-reachable export path for all current credential shapes and representative unknown/legacy private fields.

### Agent Inspection Requirements

- **FR-027**: Taco MUST provide a local, non-mutating validation surface that reports stable issue codes, including `collab-secrets-present`, without returning credential values.
- **FR-028**: `collab-secrets-present` MUST be reported whenever a Taco contains a room decryption key, owner private key, or delegated invitation private material.
- **FR-029**: The public `window.taco` Agent API MUST remain bounded to credential-free validation, file listing, file reading, and search; it MUST NOT expose the raw bundle or collaboration object.
- **FR-030**: Agent installation and review instructions MUST perform credential detection before reading or transmitting the complete Taco and MUST state that local inspection is allowed while external transmission requires user authorization.
- **FR-031**: Credential removal MUST NOT be described as revocation. When exposure may already have occurred, the product and Agent instructions MUST direct the owner to reset access.

### Prototype Isolation Requirements

- **FR-032**: HTML prototype execution MUST occur only after explicit user action and in a separate, origin-isolated browsing context.
- **FR-033**: Prototype code MUST NOT access the Taco opener, DOM, `window.taco`, localStorage, sessionStorage, IndexedDB, cookies, service workers, BroadcastChannels, or retained file handles belonging to the Taco origin.
- **FR-034**: If an isolated execution context cannot be created, Taco MUST refuse execution and offer source viewing or download; it MUST NOT fall back to a same-origin Blob page.
- **FR-035**: Selecting or displaying a prototype card MUST NOT parse the prototype as live DOM, run code, or initiate author-controlled network requests.

### Release and Recovery Requirements

- **FR-036**: The hardened runtime MUST carry a machine-readable security/runtime version that local validation can compare without executing embedded document content.
- **FR-037**: The production build MUST update both `dist-single/Taco_Spec.taco.html` and `extensions/taco/assets/taco-shell.html`, and the shell gate MUST verify their hardened security invariants.
- **FR-038**: Refreshing an existing Taco MUST replace its runtime while preserving canonical file content, comments, safe document identity, and conflict baselines.
- **FR-039**: Project and Agent documentation MUST state that previously generated self-contained Taco files remain on their old runtime until refreshed.
- **FR-040**: Reset Access MUST mint new room and key material, disconnect the current document from the prior room, prevent old delegated writers from writing to the replacement room, and require new share copies. It does not destroy plaintext or prevent already distributed old copies from continuing independently in their prior room.
- **FR-041**: The release record MUST distinguish fixed Taco surfaces from Bento-specific non-applicable items and from separately audited relay behavior.

## Key Entities

- **Untrusted document input**: Any content or state supplied by a file, paste, collaborator, renderer, Agent, or imported artifact, regardless of whether it came through an encrypted channel.
- **Supported content schema**: The exact Taco editor and collaboration vocabulary allowed to enter canonical state or live DOM.
- **Capability inventory**: The complete field-level description of credentials intentionally present in one output variant.
- **Credential-bearing Taco**: A Taco containing a room decryption key, signing private key, or delegated invitation private material.
- **Sealed reader**: A standalone read-only Taco containing no collaboration capability.
- **Isolated prototype context**: A separate execution environment without Taco-origin authority or an opener relationship.
- **Security/runtime version**: A value identifying which self-contained security boundary a Taco carries.

## Edge Cases

- A valid editor may intentionally add hostile text; valid collaboration authorization does not bypass content sanitization.
- Unknown bundle fields may continue to be preserved for format compatibility only when they never enter an executable, credential, path, or access-control context.
- A Markdown code fence containing HTML, SVG, or JavaScript remains inert source and must not be confused with executable embedded content.
- A relative Markdown link may navigate inside the Taco. An absolute external link requires a user click and opener isolation.
- A document containing an external image URL must not fetch it merely by opening the document; the source and alt text remain available.
- A Mermaid diagram that cannot pass the output allowlist degrades to editable Mermaid source rather than a partially sanitized misleading diagram.
- A collaboration payload rejected after decryption may be malicious, corrupt, or from a newer incompatible version; diagnostics do not assign intent.
- A normal working-copy save can intentionally retain owner capability. It is not a sealed share copy and must not be labeled as one.
- A cleaned Taco cannot prove that an earlier credential-bearing copy was never transmitted.
- Access reset cannot retract plaintext content already copied elsewhere.
- `file://` origin behavior varies by browser. Prototype isolation must be verified for both supported local-file behavior and hosted HTTP/HTTPS behavior without assuming that `file://` is safer.

## Success Criteria

- **SC-001**: In a real Chromium security rig, every payload in the executable-content corpus produces zero script/event execution, zero automatic navigation, and zero unapproved network requests across open, paste, remote operation, remote snapshot, Mermaid, save, and reopen paths.
- **SC-002**: Every retained security regression has evidence that the pre-hardening build fails its asserted boundary and the hardened build passes it.
- **SC-003**: All malformed collaboration fixtures are rejected before mutation; the local document remains byte-for-byte equivalent to its pre-frame canonical projection and accepts a subsequent valid edit.
- **SC-004**: Export tests prove exact field equality with the declared capability inventory for owner, working copy, editor invitation, and sealed reader outputs, with zero undeclared credential fields.
- **SC-005**: Owner and editor files report `collab-secrets-present` before content access; sealed readers and never-shared files do not; no validation output contains a secret value.
- **SC-006**: The public Agent API exposes zero collaboration fields while preserving file listing, file reading, search, and validation issue reporting.
- **SC-007**: An adversarial prototype executes in its isolated page but cannot access any Taco-origin storage, channel, opener, application API, or DOM in the browser verification matrix.
- **SC-008**: `npm run check` passes the complete repository test suite, production build, compression, shell gate, and extension-shell synchronization with the hardened runtime.
- **SC-009**: A refreshed pre-hardening Taco preserves every canonical file and review thread while reporting the new security/runtime version.
- **SC-010**: Relay integration proves that an old delegated invitation cannot authorize a write to the replacement room and that a newly shared editor can write there.

## Verification Discipline

- Use adversarial browser tests against production code paths, not only unit tests or source-pattern checks.
- For each vulnerability regression, demonstrate failure on the selected pre-hardening baseline before accepting the fix.
- Keep security policies centralized and test the policy directly as well as every production call site.
- Treat a passing standard unit suite as compatibility evidence, not as proof that hostile browser behavior was exercised.
- Record exact fixed surfaces, non-applicable Bento surfaces, and unverified relay claims in the release evidence.

## Out of Scope

- Bento's dark interface, hidden slides, toolbar changes, and other non-security 1.0.17 features.
- Porting Bento's slide SVG, shape, table, thumbnail, PDF, password-envelope, iOS host, or blob-store implementation into Taco.
- Claiming that Bento 1.0.17 fixes or validates Taco's relay; relay authorization and deployment remain a separate audit boundary except for Reset Access verification required here.
- Preventing a deliberately opened isolated prototype from contacting networks on its own behalf; the boundary is that it cannot inherit Taco-origin authority or Taco data.
- Retracting plaintext content or credentials already received by an external party.
- Git history rewriting when no committed secret is found.
- A general cryptographic redesign, accounts, SSO, or organization policy.

## Implementation and Verification Record

### Fixed Taco surfaces

- Centralized editor HTML, URL, raster-image, Mermaid SVG, JSON-size, runtime-version, and stable issue-code policy.
- Sanitized initial Markdown restoration, stored blocks, paste/schema projection, remote operations, remote snapshots, and Mermaid output before live DOM insertion.
- Bounded, type-specific collaboration frame validation; atomic operation/snapshot rejection; receiver-local access, capability, and compatibility metadata preservation; CSS-safe presence values.
- Explicit invitation capability allowlist, complete sealed-reader removal, credential-bearing working-copy confirmation, credential-free Agent file projection, and removal of raw `window.taco.bundle` access.
- Inert local `taco validate` preflight with `collab-secrets-present` and `runtime-security-outdated`, plus Agent review instructions that run it before complete content inspection or transmission.
- Bounded opaque-origin `data:text/html;base64` prototype documents with CSP, `noopener noreferrer`, no referrer, and inert source fallback instead of same-origin Blob execution.
- Security runtime marker `1`, shell-gate checks, production single-file rebuild, and synchronized extension shell.

### Pre-hardening baseline evidence

Baseline commit: `26bec76` in an isolated detached worktree.

- Passive remote-image regression failed because the old Markdown renderer retained `https://attacker.test/pixel` as a live `img.src`.
- Capability projection regression failed because an unknown `collab.futurePrivate` field survived an editor invitation export.
- Prototype-origin regression failed because the old card produced `blob:https://taco.test/prototype` rather than an opaque-origin `data:` document.

The temporary worktree was removed after the evidence run.

### Hardened evidence

- `npm run check`: format check passed; 20 test files passed and one relay file was intentionally skipped in the standard gate; 126 tests passed and two relay tests skipped there; TypeScript, Vite single-file build, compression, shell gate, and extension-shell synchronization passed. The two relay tests also passed separately with `TACO_RELAY_TEST=1`. The shell gate reported a 690 KB artifact and 1064 KB inflated runtime.
- Hosted browser corpus: `security-browser.taco.html` loaded through HTTP in the Codex Chromium browser with no error overlay or console warning/error. The attack marker remained absent; live authored `script`, `meta`, `base`, `form`, `input`, event attributes, executable links, and external images were all absent. The HTTP server received only the Taco request and no `attack-style` or `attack-pixel` request.
- Production prototype entry: the generated URL used `data:text/html;base64`, CSP appeared before prototype markup, and the link carried `_blank`, `noopener noreferrer`, and `no-referrer`.
- Local relay integration: two tests passed. Existing per-device revocation returned 403 on retry, an old delegated invitation returned 403 against the replacement room, and a newly issued editor wrote successfully to that room.
- Runtime replacement preflight: the pre-refresh feature Taco reported `runtime-security-outdated`; the final packaging step replaces that shell and revalidates the marker.

### Verification limitation

The Codex browser security policy refused automation of the final `data:` navigation. Unit tests verify the URL construction, CSP placement, size bound, inert fallback, and link isolation attributes; hosted Chromium verified the production link. Direct observation inside the opened opaque-origin page, including `location.origin`, storage exceptions, and `window.opener`, remains a manual browser check. No claim is made that this blocked action was executed.

### Bento 1.0.17 scope record

Applied to Taco: untrusted live-DOM policy, collaboration structure validation, capability-bearing-file detection, capability-safe share projections, and self-contained runtime replacement.

Not applicable to Taco: Bento slide SVG/shape/table/thumbnail/PDF boundaries, password-envelope export, iOS host integration, hidden-slide behavior, and collaboration blob-store implementation. The local relay authorization tests above do not constitute a production relay deployment or independent cryptographic audit.
