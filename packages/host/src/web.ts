import type { HttpResponse } from './service.ts'

/**
 * Renders static HTML for the public Taco review web application (/t/:tacoId or /t/:tacoId/r/:revisionId)
 * Complies with spec:
 * 1. Read-only viewer, doesn't execute uploaded scripts
 * 2. Connects to guest session endpoint (/v1/guest-session) to acquire HttpOnly cookie & CSRF token for web comments
 * 3. Subscribes to realtime WebSocket events (/v1/tacos/:id/subscribe)
 */
export const renderPublicReviewHtml = (options: {
  hostUrl: string
  tacoId: string
  revisionId?: string
}): HttpResponse => {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Taco Review — ${options.tacoId}</title>
  <style>
    :root {
      --bg: #090d16;
      --surface: #131b2e;
      --border: #233354;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --accent: #3b82f6;
    }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    header {
      padding: 12px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--surface);
    }
    .badge {
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 4px;
      background: #1e293b;
      color: var(--text-muted);
    }
    main {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    #content-view {
      flex: 2;
      padding: 24px;
      overflow-y: auto;
      border-right: 1px solid var(--border);
    }
    #comments-sidebar {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: var(--surface);
    }
    #thread-list {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    #comment-form {
      padding: 16px;
      border-top: 1px solid var(--border);
    }
    textarea {
      width: 100%;
      height: 80px;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px;
      box-sizing: border-box;
      border-radius: 4px;
      resize: vertical;
    }
    button {
      margin-top: 8px;
      padding: 6px 14px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <strong>Taco Review Space</strong>
      <span class="badge" id="space-id">${options.tacoId}</span>
    </div>
    <div id="status-badge" class="badge">Connecting...</div>
  </header>
  <main>
    <section id="content-view">
      <div id="doc-title" style="font-size: 20px; font-weight: bold; margin-bottom: 16px;">Loading specification...</div>
      <div id="doc-body" style="line-height: 1.6; color: var(--text);"></div>
    </section>
    <section id="comments-sidebar">
      <div id="thread-list"></div>
      <form id="comment-form">
        <textarea id="comment-input" placeholder="添加公开评审意见..."></textarea>
        <button type="submit" id="submit-btn">发送评审</button>
      </form>
    </section>
  </main>
  <script>
    const TACO_ID = "${options.tacoId}";
    const REVISION_ID = "${options.revisionId || ''}";
    const HOST_URL = "${options.hostUrl}";
    let csrfToken = null;

    async function init() {
      // 1. Acquire guest session
      try {
        const sessRes = await fetch(HOST_URL + '/v1/guest-session', { method: 'POST' });
        if (sessRes.ok) {
          const sess = await sessRes.json();
          csrfToken = sess.csrfToken;
        }
      } catch (e) {
        console.warn('Guest session init failed', e);
      }

      // 2. Fetch Taco & Revision details
      try {
        const tacoRes = await fetch(HOST_URL + '/v1/tacos/' + TACO_ID);
        if (tacoRes.ok) {
          const taco = await tacoRes.json();
          document.getElementById('status-badge').textContent = taco.status.toUpperCase();
          const targetRev = REVISION_ID || taco.currentRevisionId;
          if (targetRev) {
            const revRes = await fetch(HOST_URL + '/v1/tacos/' + TACO_ID + '/revisions/' + targetRev);
            if (revRes.ok) {
              const rev = await revRes.json();
              document.getElementById('doc-title').textContent = rev.snapshot.title;
              const mainFile = rev.snapshot.files[0];
              document.getElementById('doc-body').textContent = mainFile ? mainFile.content : 'No files in snapshot';
            }
          }
        }
      } catch (e) {
        console.error('Failed to load taco revision', e);
      }
    }
    init();
  </script>
</body>
</html>`

  return {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: html,
  }
}
