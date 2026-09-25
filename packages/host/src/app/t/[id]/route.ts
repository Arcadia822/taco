import { notFound } from 'next/navigation'
import { getStorageAdapter } from '@/lib/storage-adapter'
import { renderCanonicalTacoHtml } from '@/lib/taco-shell-template'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: pasteId } = await props.params

  const storage = getStorageAdapter()
  const storagePath = `pastes/${pasteId}.json`

  // 1. Fetch raw JSON snapshot from storage
  let rawBytes = await storage.getObject(storagePath)
  if (!rawBytes) {
    const blobStoreId = process.env.BLOB_STORE_ID
    if (blobStoreId) {
      const publicBlobUrl = `https://${blobStoreId}.public.blob.vercel-storage.com/${storagePath}`
      rawBytes = await storage.getObject(publicBlobUrl)
    }
  }

  if (!rawBytes) {
    notFound()
  }

  const parsed = JSON.parse(new TextDecoder().decode(rawBytes)) as {
    snapshot: Record<string, unknown>
    importedComments?: unknown[]
    comments?: unknown[]
  }

  const bundle = {
    ...parsed.snapshot,
    access: 'reader',
    collab: undefined,
    comments: parsed.comments || parsed.importedComments || [],
  }

  let html = renderCanonicalTacoHtml(bundle)

  // SaaS UI Bridge:
  // - 品牌名 Tacobin 国际化与链接回主页
  // - 隐藏只读模式下的添加文档/分组按钮
  // - 全语种国际化支持保存 -> 导出语义 (主按钮、快捷键提示、下拉菜单选项全面替换)
  const saasBridge = `
<style id="taco-saas-clean">
  html { scrollbar-gutter: auto !important; }
  body { background: var(--sidebar-surface) !important; margin: 0 !important; }
  .panel-layout { background: var(--sidebar-surface) !important; }

  /* 隐藏所有文件/分组新建与菜单按钮 */
  .sidebar-action-btn.add-group-btn,
  .group-actions,
  .file-actions,
  .file-menu-btn,
  .add-file-to-group-btn,
  .group-menu-btn {
    display: none !important;
  }


  /* 品牌行手势：只有 Logo 和文字为 pointer */
  .sidebar-brand-row,
  .collapsed-brand-mark {
    cursor: default;
  }
  .sidebar-brand-row .brand-mark,
  .sidebar-brand-row .brand-name,
  .collapsed-brand-mark {
    cursor: pointer !important;
  }

  .selection-comment-button {
    z-index: 9999 !important;
  }
</style>
<script id="taco-saas-script">
  (() => {
    const PASTE_ID = "${pasteId}";

    // 多语言导出文案字典表
    const EXPORT_I18N = {
      zh: { export: '导出', exportCopy: '导出副本…', exportUnpack: '解包到文件夹…', exported: '已导出', tooltip: '导出当前规范快照' },
      en: { export: 'Export', exportCopy: 'Export a copy…', exportUnpack: 'Export & unpack…', exported: 'Exported', tooltip: 'Export specification snapshot' },
      ja: { export: 'エクスポート', exportCopy: 'コピーをエクスポート…', exportUnpack: 'フォルダに展開…', exported: 'エクスポート済み', tooltip: '仕様スナップショットをエクスポート' },
      es: { export: 'Exportar', exportCopy: 'Exportar copia…', exportUnpack: 'Extraer a carpeta…', exported: 'Exportado', tooltip: 'Exportar instantánea' },
      fr: { export: 'Exporter', exportCopy: 'Exporter une copie…', exportUnpack: 'Décompresser…', exported: 'Exporté', tooltip: 'Exporter l’instantané' },
      de: { export: 'Exportieren', exportCopy: 'Kopie exportieren…', exportUnpack: 'Entpacken…', exported: 'Exportiert', tooltip: 'Snapshot exportieren' },
    };

    function getLangDict() {
      const docLang = (document.documentElement.lang || navigator.language || 'zh').toLowerCase();
      if (docLang.startsWith('en')) return EXPORT_I18N.en;
      if (docLang.startsWith('ja')) return EXPORT_I18N.ja;
      if (docLang.startsWith('es')) return EXPORT_I18N.es;
      if (docLang.startsWith('fr')) return EXPORT_I18N.fr;
      if (docLang.startsWith('de')) return EXPORT_I18N.de;
      return EXPORT_I18N.zh;
    }

    function patchDOM() {
      const dict = getLangDict();

      // 1. 品牌名称替换 Taco -> Tacobin
      const brandNodes = document.querySelectorAll('.brand-name, .collapsed-brand-name');
      brandNodes.forEach((node) => {
        if (node.textContent === 'Taco') {
          node.textContent = 'Tacobin';
        }
      });

      // 2. 主保存按钮 -> 导出按钮 (包含国际化文本、下载图标、Tooltip)
      const saveBtn = document.querySelector('.save-button');
      if (saveBtn) {
        const label = saveBtn.querySelector('.button-label');
        if (label && label.textContent !== dict.export && label.textContent !== dict.exported) {
          label.textContent = dict.export;
        }
        if (saveBtn.getAttribute('aria-label') !== dict.export) {
          saveBtn.setAttribute('aria-label', dict.export);
          saveBtn.title = dict.tooltip;
        }

        // 替换为下载图标
        const icon = saveBtn.querySelector('.ui-icon');
        if (icon && icon.dataset.icon !== 'download') {
          const downloadSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          downloadSvg.classList.add('ui-icon');
          downloadSvg.setAttribute('viewBox', '0 0 24 24');
          downloadSvg.setAttribute('fill', 'none');
          downloadSvg.setAttribute('stroke', 'currentColor');
          downloadSvg.setAttribute('stroke-width', '1.75');
          downloadSvg.setAttribute('stroke-linecap', 'round');
          downloadSvg.setAttribute('stroke-linejoin', 'round');
          downloadSvg.setAttribute('aria-hidden', 'true');
          downloadSvg.dataset.icon = 'download';
          downloadSvg.innerHTML = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>';
          icon.replaceWith(downloadSvg);
        }
      }

      // 3. 下拉菜单选项全量文案国际化 (save-more 打开后的 popover-action)
      const saveMenuActions = document.querySelectorAll('.save-menu .popover-action');
      saveMenuActions.forEach((item, index) => {
        const labelNode = item.querySelector('.sidebar-row-label') || item.lastChild;
        if (labelNode && typeof labelNode.textContent === 'string') {
          if (index === 0) {
            labelNode.textContent = dict.export;
            const icon = item.querySelector('.ui-icon');
            if (icon && icon.dataset.icon !== 'download') {
              const downloadSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
              downloadSvg.classList.add('ui-icon');
              downloadSvg.setAttribute('viewBox', '0 0 24 24');
              downloadSvg.setAttribute('fill', 'none');
              downloadSvg.setAttribute('stroke', 'currentColor');
              downloadSvg.setAttribute('stroke-width', '1.75');
              downloadSvg.setAttribute('stroke-linecap', 'round');
              downloadSvg.setAttribute('stroke-linejoin', 'round');
              downloadSvg.dataset.icon = 'download';
              downloadSvg.innerHTML = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>';
              icon.replaceWith(downloadSvg);
            }
          } else if (index === 1) {
            labelNode.textContent = dict.exportCopy;
          } else if (index === 2) {
            labelNode.textContent = dict.exportUnpack;
          }
        }
      });

      // 4. 锁定标题只读
      const bundleTitle = document.querySelector('.bundle-title');
      if (bundleTitle && !bundleTitle.disabled) {
        bundleTitle.disabled = true;
      }
      const inlineTitle = document.querySelector('.document-inline-title-text');
      if (inlineTitle && inlineTitle.contentEditable === 'true') {
        inlineTitle.contentEditable = 'false';
      }
    }

    patchDOM();
    const observer = new MutationObserver(patchDOM);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        patchDOM();
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      });
    } else {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    const timer = setInterval(patchDOM, 100);
    setTimeout(() => clearInterval(timer), 6000);

    // 浏览器端 Nickname 状态管理 (localStorage taco-author)
    function getNickname() {
      return localStorage.getItem('taco-author') || localStorage.getItem('taco-session-author') || '';
    }

    function promptNickname(force = false) {
      const current = getNickname();
      if (!current || force) {
        const input = window.prompt('请设置你在当前浏览器的评审昵称 (Nickname):', current || '');
        if (input && input.trim()) {
          const name = input.trim().slice(0, 64);
          localStorage.setItem('taco-author', name);
          sessionStorage.setItem('taco-session-author', name);
          updateNicknameDisplay();
          return name;
        }
      }
      return current;
    }

    function updateNicknameDisplay() {
      const name = getNickname() || '设置昵称';
      const badgeText = document.getElementById('saas-nickname-text');
      if (badgeText) badgeText.textContent = name;
    }

    window.addEventListener('load', () => {
      const header = document.querySelector('.workspace-header');
      if (header && !document.getElementById('taco-saas-user-bar')) {
        const bar = document.createElement('div');
        bar.id = 'taco-saas-user-bar';
        bar.innerHTML = '<button type="button" class="saas-nickname-badge" style="display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;background:rgba(255,255,255,0.06);border:1px solid var(--line);border-radius:6px;color:var(--ink);font-size:12px;font-weight:500;cursor:pointer;" title="点击修改当前浏览器评审昵称"><span>👤</span><span id="saas-nickname-text"></span></button>';
        header.insertBefore(bar, header.querySelector('.workspace-header-spacer')?.nextSibling || header.firstChild);
        updateNicknameDisplay();

        bar.querySelector('.saas-nickname-badge')?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          promptNickname(true);
        });
      }
    });

    // 全局点击代理：Logo 回主页与导出下载
    document.addEventListener('click', (e) => {
      const sidebarBrandRow = e.target.closest('.sidebar-brand-row');
      if (sidebarBrandRow) {
        const brandMark = e.target.closest('.brand-mark');
        const brandName = e.target.closest('.brand-name');
        if (brandMark || brandName) {
          e.stopPropagation();
          e.preventDefault();
          window.location.href = '/';
          return;
        }
      }
      const collapsedBrand = e.target.closest('.collapsed-brand-mark');
      if (collapsedBrand) {
        e.stopPropagation();
        e.preventDefault();
        window.location.href = '/';
        return;
      }

      // 点击主保存/导出按钮：触发下载
      const saveBtn = e.target.closest('.save-button');
      if (saveBtn) {
        e.stopPropagation();
        e.preventDefault();
        fetch(window.location.href, { cache: 'no-store' })
          .then((r) => r.text())
          .then((html) => {
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'tacobin-' + PASTE_ID.slice(0, 8) + '.taco.html';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          })
          .catch((err) => console.error('导出失败:', err));
        return;
      }
    }, true);

    // 划词在线评审支持
    document.addEventListener('selectionchange', () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        document.getElementById('saas-floating-comment-btn')?.remove();
        return;
      }

      const anchorNode = selection.anchorNode;
      const fileViewer = anchorNode?.parentElement?.closest('.file-viewer, .tiptap');
      if (!fileViewer) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;

      let btn = document.getElementById('saas-floating-comment-btn');
      if (!btn) {
        btn = document.createElement('button');
        btn.id = 'saas-floating-comment-btn';
        btn.textContent = '💬 添加评审意见';
        btn.style.cssText = 'position:fixed;z-index:99999;background:#10b981;color:#ffffff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:transform 120ms ease;';
        btn.addEventListener('mouseenter', () => btn.style.transform = 'scale(1.05)');
        btn.addEventListener('mouseleave', () => btn.style.transform = 'scale(1)');
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();

          const selectedQuote = selection.toString().trim();
          const commentBody = window.prompt('对选中文本添加评审意见:\\n\\n\"' + (selectedQuote.length > 30 ? selectedQuote.slice(0, 30) + '...' : selectedQuote) + '\"');
          if (!commentBody || !commentBody.trim()) return;

          const author = promptNickname() || 'Reviewer';
          fetch('/v1/tacos/' + PASTE_ID + '/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              body: commentBody.trim(),
              author,
              quote: selectedQuote,
            }),
          })
            .then((r) => r.json())
            .then(() => {
              const toast = document.createElement('div');
              toast.textContent = '评审已提交！正在同步...';
              toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#10b981;color:white;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;z-index:99999;';
              document.body.appendChild(toast);
              setTimeout(() => { toast.remove(); window.location.reload(); }, 1200);
            })
            .catch((err) => alert('提交失败: ' + err.message));
        });
        document.body.appendChild(btn);
      }

      btn.style.left = Math.max(8, rect.left + rect.width / 2 - 50) + 'px';
      btn.style.top = Math.max(8, rect.top - 36) + 'px';
    });
  })();
</script>
`
  html = html.replace('</head>', `${saasBridge}\n</head>`)

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
