# Security Policy

## Supported versions

Taco is currently a prototype. Security fixes target the latest commit on the default branch; older commits and copied `.taco.html` artifacts do not receive separate maintenance guarantees.

| Version                           | Supported |
| --------------------------------- | --------- |
| Default branch                    | Yes       |
| Older commits or copied artifacts | No        |

## Reporting a vulnerability

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/Arcadia822/taco/security/advisories/new). Do not open a public issue, attach an exploit to a public discussion, or include a live Taco file containing collaboration capabilities.

Include the affected commit or version, impact, reproduction steps, and the smallest sanitized proof of concept you can provide. You should receive an acknowledgement within seven days. Disclosure timing will be coordinated after the issue has been reproduced and a remediation plan exists.

## Security model and boundaries

Taco's security claims are intentionally narrow:

- A `.taco.html` file is both document and application. Anyone who receives a capability-bearing copy may be able to read or edit the associated collaboration room. Protect it as you would the underlying specification.
- Cross-device frames are encrypted by clients with AES-GCM. The blind relay still observes connection metadata, room identifiers or token-derived values, public signing keys, timing, sizes, IP addresses, and ciphertext. End-to-end encryption does not hide that metadata.
- Signed writes and per-device revocation enforce collaboration capabilities. Self-declared display names are not account identities, and Taco does not provide SSO or organization policy.
- Markdown and unknown text are treated as untrusted content. Taco does not execute embedded HTML in its own page. Opening an HTML prototype intentionally executes that prototype in a separate browser page; inspect untrusted prototypes before opening them.
- The relay is optional and self-hosted. Operators remain responsible for Cloudflare account security, deployment configuration, logging, retention, abuse controls, availability, and cost limits.
- The cryptographic design and implementation have not received an independent security audit. Please report protocol, key-handling, browser-storage, XSS, path-validation, replay, revocation, and denial-of-service findings.

The durable artifact is the file, not the relay. Relay expiry or outage may interrupt synchronization but should not be treated as durable backup loss.
