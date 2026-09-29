export const HOSTED_STYLES = `/* Hosted review: the Host owns a shared saved state, so its controls sit with the document header. */
.host-status-button, .host-author-button, .host-listeners-button { max-width: min(22vw, 220px); }
.host-status-button .button-label, .host-author-button .button-label, .host-listeners-button .button-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.host-status-button.is-trouble { color: #b4232f; }
.host-status-button.is-trouble .ui-icon { color: #b4232f; }
.host-listeners-menu { display: grid; gap: 2px; min-width: 240px; }
.host-listeners-heading { margin: 4px 8px 2px; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.host-listeners-empty, .host-listeners-time, .host-listeners-note { margin: 2px 8px; color: var(--muted); font-size: 11px; line-height: 1.45; }
.host-listener-row { cursor: default; }
.host-listener-meta { display: inline-flex; align-items: center; gap: 6px; min-width: 0; color: var(--muted); font-size: 10px; }
.host-listener-model-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.host-listener-seen { white-space: nowrap; }
.host-listener-row .ui-icon { width: 14px; height: 14px; }`
