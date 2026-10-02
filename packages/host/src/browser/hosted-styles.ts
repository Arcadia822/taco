export const HOSTED_STYLES = `/* Hosted review: the Host owns a shared saved state, so its controls sit with the document header. */
.control-button.host-presence-button { position: relative; flex-shrink: 0; width: auto; padding: 0 4px; }
.host-avatar-stack { display: flex; align-items: center; isolation: isolate; pointer-events: none; }
.host-avatar-stack .host-presence-avatar { display: grid; place-items: center; box-sizing: border-box; width: 24px; height: 24px; min-width: 24px; border: 2px solid var(--paper); border-radius: 50%; }
.host-presence-avatar + .host-presence-avatar { margin-left: -8px; }
.host-presence-agent, .host-presence-overflow { background: var(--surface); color: var(--ink); }
.host-presence-agent .host-harness-logo { width: 16px; height: 16px; }
.host-presence-overflow { font-size: 9px; font-weight: 600; }
.host-recovery-control { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; min-width: 0; max-width: 300px; }
.host-recovery-control[hidden] { display: none; }
.host-recovery-status { color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.control-button.host-recovery-button { height: auto; min-height: 28px; white-space: normal; text-align: left; }
.host-recovery-button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
@media (max-width: 560px) { .host-recovery-control { max-width: 120px; } .host-recovery-status { display: none; } }


/* Presence Popover - aligned with .topbar-popover standards */
.host-presence-menu {
  display: grid;
  gap: 2px;
  min-width: 220px;
  max-width: 320px;
  padding: 6px;
}
.host-presence-section { display: grid; gap: 2px; }
.host-presence-heading {
  margin: 4px 8px 2px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.host-presence-divider {
  height: 1px;
  background: var(--line);
  margin: 4px 2px;
}
.host-presence-empty {
  margin: 2px 8px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.4;
}

.host-member-row { font-size: 12px; }
.host-member-row:hover { background: var(--surface-2); }
.host-member-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.host-member-name[contenteditable="plaintext-only"] { outline: 1px solid var(--line); border-radius: 3px; cursor: text; min-width: 40px; }

/* Avatar for humans - exactly matching icon size (16x16) */
.host-avatar {
  display: grid;
  place-items: center;
  width: var(--sidebar-icon-size, 16px);
  height: var(--sidebar-icon-size, 16px);
  min-width: var(--sidebar-icon-size, 16px);
  border-radius: 50%;
  color: #ffffff;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  text-transform: uppercase;
  user-select: none;
}

.host-harness-logo { width: var(--sidebar-icon-size); height: var(--sidebar-icon-size); object-fit: contain; }

/* Info icon with hover card */
.host-info-trigger {
  position: relative;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: var(--muted);
  cursor: pointer;
  background: transparent;
  border: 0;
  padding: 0;
}
.host-info-trigger:hover { color: var(--ink); background: var(--line); }
.host-info-trigger .ui-icon { width: 13px; height: 13px; }

.host-info-card {
  display: none;
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 120;
  width: 230px;
  padding: 8px 10px;
  margin-top: 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
  pointer-events: none;
}
.host-info-trigger:hover .host-info-card,
.host-info-trigger:focus-within .host-info-card {
  display: grid;
  gap: 4px;
}
.host-info-card-row { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; line-height: 1.4; }
.host-info-card-label { color: var(--muted); flex-shrink: 0; }
.host-info-card-value { color: var(--ink); font-weight: 500; text-align: right; overflow-wrap: anywhere; white-space: normal; }

/* Edit Name inline button */
.host-edit-name-btn {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  padding: 0;
}
.host-edit-name-btn:hover { background: var(--line); color: var(--ink); }
.host-edit-name-btn .ui-icon { width: 12px; height: 12px; }

/* Menu separator */
.topbar-popover-divider { height: 1px; background: var(--line); margin: 4px 2px; }

/* No listeners modal install guide */
.host-no-listeners-dialog {
  width: min(520px, calc(100vw - 32px));
  user-select: auto;
}
.host-no-listeners-dialog .confirmation-dialog-body { grid-template-columns: minmax(0, 1fr); }
.host-install-guide {
  display: grid;
  min-width: 0;
  gap: 12px;
  user-select: text;
}
.host-install-step {
  display: grid;
  min-width: 0;
  gap: 6px;
}
.host-install-step-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
}
.host-install-code-row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: var(--surface-2, var(--canvas, #f6f8fa));
  border: 1px solid var(--line);
  border-radius: 6px;
}
.host-install-code-row code {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink);
  user-select: text;
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}
.host-install-copy-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
}
.host-install-copy-btn:hover {
  background: var(--surface-hover, var(--line-light, #eee));
}
`
