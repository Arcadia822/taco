import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Tacobin — Single-File Review Space for Humans & Agents',
  description: 'Specification review space for Taco artifacts',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="dark" style={{ colorScheme: 'dark' }}>
      <head>
        <link
          rel="icon"
          type="image/svg+xml"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='15.2' cy='8.8' r='4.8' fill='%233ecf8e'/%3E%3Ccircle cx='7.2' cy='14.4' r='3.2' fill='%233b82f6'/%3E%3Ccircle cx='14.8' cy='18' r='2' fill='%23f97316'/%3E%3C/svg%3E"
        />
        {/* Directly embed authentic Taco CSS variables for perfect 1:1 fidelity */}
        <style dangerouslySetInnerHTML={{ __html: `
          :root {
            color-scheme: light;
            --paper: #ffffff;
            --surface: #ffffff;
            --sidebar-surface: #f7f7f7;
            --surface-2: #eeeeee;
            --ink: #111111;
            --muted: #666666;
            --line: rgba(0, 0, 0, .08);
            --line-strong: rgba(0, 0, 0, .14);
            --accent: #3ecf8e;
            --accent-dark: #279e67;
            --accent-soft: #eafaf2;
            --shadow: 0 16px 40px rgba(0, 0, 0, .08);
            --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            --sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
            --chrome-size: 24px;
            --chrome-gap: 8px;
            --sidebar-row-padding: 8px;
          }

          :root[data-theme="dark"] {
            color-scheme: dark;
            --paper: #171717;
            --surface: #1c1c1c;
            --sidebar-surface: #1c1c1c;
            --surface-2: #262626;
            --ink: #ededed;
            --muted: #a3a3a3;
            --line: rgba(255, 255, 255, .10);
            --line-strong: rgba(255, 255, 255, .18);
            --accent: #3ecf8e;
            --accent-dark: #6ee7b7;
            --accent-soft: #173b2b;
            --shadow: 0 18px 50px rgba(0, 0, 0, .34);
          }

          * { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: var(--sans);
            background: var(--paper);
            color: var(--ink);
            -webkit-font-smoothing: antialiased;
          }

          .control-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: var(--chrome-size);
            height: var(--chrome-size);
            padding: 0;
            border: 0;
            border-radius: 6px;
            background: transparent;
            color: var(--muted);
            cursor: pointer;
            transition: color 140ms ease, background-color 140ms ease;
          }
          .control-button:hover {
            background: var(--surface-2);
            color: var(--ink);
          }

          .ui-icon {
            display: block;
            width: 14px;
            height: 14px;
          }

          .topbar-popover {
            position: absolute;
            z-index: 100;
            display: grid;
            width: max-content;
            min-width: 140px;
            padding: 4px;
            border: 1px solid var(--line-strong);
            border-radius: 8px;
            background: var(--surface);
            box-shadow: var(--shadow);
          }

          .popover-action {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            height: 28px;
            padding: 0 8px;
            border: 0;
            border-radius: 5px;
            background: transparent;
            color: var(--ink);
            font-size: 12px;
            font-family: var(--sans);
            text-align: left;
            cursor: pointer;
            transition: background-color 120ms ease;
          }
          .popover-action:hover {
            background: var(--surface-2);
          }
          .popover-action.is-active {
            color: var(--accent-dark);
            font-weight: 600;
          }

          .lang-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 16px;
            border-radius: 3px;
            background: var(--surface-2);
            color: var(--muted);
            font-size: 10px;
            font-weight: 700;
          }
          .popover-action.is-active .lang-badge {
            background: var(--accent-soft);
            color: var(--accent-dark);
          }
        ` }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
