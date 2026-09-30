export const HOSTED_STYLES = `/* Hosted review: the Host owns a shared saved state, so its controls sit with the document header. */
.host-status-button, .host-presence-button { max-width: min(22vw, 220px); }
.host-status-button .button-label, .host-presence-button .button-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.host-status-button.is-trouble { color: #b4232f; }
.host-status-button.is-trouble .ui-icon { color: #b4232f; }

/* In hosted mode, the save button is disabled/hidden in favor of autosave status */
.file-workspace.is-hosted .save-group { display: none !important; }

/* Presence Popover */
.host-presence-menu { display: grid; gap: 4px; min-width: 280px; max-width: 360px; padding: 6px; }
.host-presence-section { display: grid; gap: 4px; }
.host-presence-heading { margin: 6px 8px 2px; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.host-presence-divider { height: 1px; background: var(--line); margin: 6px 4px; }
.host-presence-empty, .host-presence-note { margin: 2px 8px; color: var(--muted); font-size: 11px; line-height: 1.45; }

/* Single-row user & agent items */
.host-member-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  transition: background-color 120ms ease;
}
.host-member-row:hover { background: var(--surface-2); }
.host-member-main { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; }
.host-member-name { font-size: 12px; font-weight: 500; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.host-member-action { flex-shrink: 0; }

/* Avatar for humans */
.host-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  text-transform: uppercase;
  user-select: none;
}

/* Agent item icons */
.host-agent-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--muted);
  flex-shrink: 0;
}
.host-agent-icon .ui-icon { width: 16px; height: 16px; }

/* Info icon with hover card */
.host-info-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: var(--muted);
  cursor: pointer;
  background: transparent;
  border: 0;
  padding: 0;
}
.host-info-trigger:hover { color: var(--ink); background: var(--line); }
.host-info-trigger .ui-icon { width: 14px; height: 14px; }

.host-info-card {
  display: none;
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 120;
  width: 240px;
  padding: 8px 10px;
  margin-top: 4px;
  border: 1px solid var(--line-strong);
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
.host-info-card-value { color: var(--ink); font-weight: 500; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Edit Name inline button */
.host-edit-name-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.host-edit-name-btn:hover { background: var(--line); color: var(--ink); }
.host-edit-name-btn .ui-icon { width: 12px; height: 12px; }

/* Menu separator */
.topbar-popover-divider { height: 1px; background: var(--line); margin: 4px 0; }`
