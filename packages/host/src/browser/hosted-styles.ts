export const HOSTED_STYLES = `/* Hosted review: the Host owns a shared saved state, so its controls sit with the document header. */
.host-presence-button { flex-shrink: 0; }

/* In hosted mode, the save button is disabled/hidden in favor of autosave status */
.file-workspace.is-hosted .save-group { display: none !important; }

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
.host-presence-empty, .host-presence-note {
  margin: 2px 8px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.4;
}

/* Single-row user & agent items - perfectly aligned with .sidebar-row and .popover-action standards */
.host-member-row {
  display: grid;
  grid-template-columns: var(--sidebar-icon-size, 16px) minmax(0, 1fr) auto;
  align-items: center;
  column-gap: var(--chrome-gap, 8px);
  width: 100%;
  height: var(--chrome-size, 24px);
  min-height: var(--chrome-size, 24px);
  padding: 0 var(--sidebar-row-padding, 8px);
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink);
  font-size: 12px;
  font-weight: 400;
  text-align: left;
  transition: background-color 120ms ease, color 120ms ease;
}
.host-member-row:hover { background: var(--surface-2); }
.host-member-row .sidebar-row-icon {
  display: grid;
  place-items: center;
  width: var(--sidebar-icon-size, 16px);
  height: var(--sidebar-icon-size, 16px);
  min-width: var(--sidebar-icon-size, 16px);
}
.host-member-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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

/* Agent item icons */
.host-agent-icon {
  display: grid;
  place-items: center;
  width: var(--sidebar-icon-size, 16px);
  height: var(--sidebar-icon-size, 16px);
  min-width: var(--sidebar-icon-size, 16px);
  color: var(--muted);
}
.host-agent-icon .ui-icon { width: 14px; height: 14px; }

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
.host-info-card-value { color: var(--ink); font-weight: 500; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

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
.topbar-popover-divider { height: 1px; background: var(--line); margin: 4px 2px; }`
