'use client'

import React, { useEffect, useRef, useState } from 'react'
import localFont from 'next/font/local'
import './home.css'
import { AgentTerminal, type AgentRun } from '../components/agent-terminal'
import { TacoPixelBackground } from '../components/taco-pixel-background'
// Installation commands live in docs/agent-installation.md and install-commands.ts

const geist = localFont({
  src: './fonts/Geist-Variable.woff2',
  variable: '--font-geist',
  display: 'swap',
  weight: '400 700',
})
const firaCode = localFont({
  src: './fonts/FiraCode-Variable.woff2',
  variable: '--font-fira-code',
  display: 'swap',
  weight: '400 700',
})

// 与 Taco 代码块复制按钮一致（src/tiptap-code-block.ts：iconPaths / codeBlockIcon / copyText）
const COPY_ICON_PATHS = {
  copy: <><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>,
  check: <path d="m20 6-11 11-5-5" />,
} as const

const writeClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand?.('copy')
  textarea.remove()
  if (!copied) throw new Error('Clipboard is unavailable')
}

type CopyLabels = { copy: string; copied: string; copyFailed: string }

function CopyIconButton({ text, labels }: { text: string; labels: CopyLabels }) {
  const [state, setState] = useState<'idle' | 'success' | 'error'>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const onClick = () => {
    window.clearTimeout(timer.current)
    writeClipboard(text).then(
      () => setState('success'),
      () => setState('error'),
    ).finally(() => {
      timer.current = window.setTimeout(() => setState('idle'), 1600)
    })
  }

  const label = state === 'success' ? labels.copied : state === 'error' ? labels.copyFailed : labels.copy
  return (
    <button
      type="button"
      className={`tiptap-code-block-button agent-prompt__copy${state === 'success' ? ' is-success' : state === 'error' ? ' is-error' : ''}`}
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <svg
        className="tiptap-code-block-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {COPY_ICON_PATHS[state === 'success' ? 'check' : 'copy']}
      </svg>
    </button>
  )
}

type LocaleCode = 'zh-Hans' | 'en'

// 每种语言一套演示数据：public/demo/<locale>/…（修改前）与 …/after/…（Agent 改完后）
const DEMO_TACO = 'taco-guide.taco.html'
const TRACE_TACO_ID = 'b89dc5c7-3996-4ab6-b446-3508e4d0af6e'
const TRACE_HOST = 'https://taco.arcadia-han.com'
// Taco 在 ≤1080px 时收起评论栏：窗口更窄时按 1200px 渲染再等比缩小，否则 1:1
const DEMO_MIN_WIDTH = 1200

function ScaledTaco({ src, title }: { src: string; title: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const scale = box ? Math.min(1, box.width / DEMO_MIN_WIDTH) : 1
  return (
    <div ref={hostRef} className="scaled-taco">
      {box && (
        <iframe
          src={src}
          title={title}
          onLoad={(event) => {
            const doc = event.currentTarget.contentDocument
            if (!doc) return
            // The landing demo is editable, but must never write or download a copy.
            doc.addEventListener('click', (click) => {
              if (!(click.target as Element).closest?.('.save-button, .save-menu button')) return
              click.preventDefault()
              click.stopImmediatePropagation()
            }, true)
            doc.addEventListener('keydown', (key) => {
              if (!(key.metaKey || key.ctrlKey) || key.key.toLowerCase() !== 's') return
              key.preventDefault()
              key.stopImmediatePropagation()
            }, true)
          }}
          style={{ width: box.width / scale, height: box.height / scale, transform: `scale(${scale})` }}
        />
      )}
    </div>
  )
}

const I18N = {
  'zh-Hans': {
    eyebrow: 'Agent 与人协作',
    h1: '跟 Agent 把设计过清楚，不费力。',
    desc: '清晰易读、便于版本管理、支持一键 Handoff 的单文件设计评审工作区。',
    tryBtn: '试用 Taco',
    tryUrl: '/demo/zh-Hans/taco-guide.taco.html',
    downloadBtn: '下载 Taco',
    downloadUrl: 'https://github.com/Arcadia822/taco/releases/download/taco-docs/Taco_Docs.zh-Hans.taco.html',
    forAgent: 'For Agent',
    agentPrompt:
      '读取 https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md ，按其中步骤安装 Taco skill 与 taco-cli（需要时创建目录）；完成后回复 Installed taco. 并简短说明如何生成一份 Taco。',
    copy: '复制',
    copied: '已复制',
    copyFailed: '复制失败',
    scrollDown: '向下滚动',
    section2Eyebrow: '02 / 评审交接',
    section2Title: '评审直接在文档里做，Agent 接着就改',
    section2Lead: '打开 Taco，你可以：',
    section2Points: [
      '划词评论，讨论就挂在原文旁边',
      '直接修改：Markdown 所见即所得，JSON/YAML 编辑高亮源码，Mermaid 编辑源码并预览图表；单页 HTML 在本地与托管评审中均以沙箱只读展示',
      '回复评论，最终由你确认并解决讨论线程',
      '点「交接改动」，把改动和评论一键交给 Agent',
    ],
    section2Tip: '试试窗口右上角的「交接改动」，左边的 Agent 会重跑一遍。',
    section1Eyebrow: '03 / 一个文件',
    section1Title: '一个文件，带齐所有东西',
    section1Desc: '一个 .taco.html 就是完整的交接件：文档、阅读应用和评论线程一起入库或发送。审阅者双击即可阅读、编辑、划词评论；保存后，下一位审阅者或 Agent 接手的仍是同一份上下文。本地评审无需安装或登录。',
    section1FileSize: 'Complete 示例',
    section1BreakdownTitle: 'Complete shell + Taco 指南内容',
    section1Tree: [
      ['应用', '约 2.7 MB（内嵌 Tiptap、highlight.js/lowlight、Mermaid）'],
      ['文件', '10 篇文档（Markdown、Mermaid、OpenAPI）'],
      ['评论', '4 条待确认与讨论线程'],
      ['导航与检查点', '5 阶段依赖图与入口配置'],
    ],
    section1ShellSizeTitle: 'Shell 大小（不含文档）',
    section1ShellSizes: ['Complete：约 2.7 MB（内嵌完整编辑器、代码高亮、Mermaid 渲染库及样式）', 'Lite：约 190 KB（运行时从公共 CDN 加载编辑器库）'],
    section1Online: '联网依赖',
    section1OnlineItems: ['Complete：无需联网，所有编辑器与渲染依赖均已内置；Lite 在启动时从公共 CDN 加载，不可用时回退为 Markdown 源码编辑'],
    sectionCpEyebrow: '04 / 阶段进度',
    sectionCpTitle: '检查点：文档状态与依赖图',
    sectionCpDesc: '为项目定义文档依赖关系，查看每个阶段的进度和下一步建议。状态随 Taco 文件一起交接；重命名或删除必需文件后，原要求会显示为未创建。检查点不会锁定内容或阻止跨阶段编辑。',
    sectionCpPoints: [
      ['依赖图 (DAG)', '定义规范到任务的串并行阶段依赖，支持多分支与汇合'],
      ['阶段任务要求', '为检查点文件配置可选指令，右侧面板自动展示编写规范'],
      ['4 级生命周期', 'todo、in_progress、complete 与 freeze 状态追踪'],
      ['下一步建议', '根据已标记的前序阶段推导 frontier，供人与 Agent 参考'],
      ['无需内容锁', '状态保存在数据块中，不做哈希校验或强制门禁'],
    ],
    sectionCpDocInstruction: '不超过 5 步，从安装到第一次交接。',
    sectionCpBadge: 'CHECKPOINTS DAG',
    sectionCpDemoTemplate: 'Taco 文档站',
    sectionCpStage1: '01 概览',
    sectionCpStage2: '02 开始',
    sectionCpStage3: '03 架构与接口',
    sectionCpDoc1: '概览.md',
    sectionCpDoc2: '开始/快速开始.md',
    sectionCpDoc3: '开始/常见问题.md',
    sectionCpDoc4: '架构/Tacobin-API.yaml',
    section4Eyebrow: '05 / TACOBIN 协作空间',
    section4Title: 'Tacobin：为团队连接 Taco 与 Agent',
    section4Desc:
      '本地 Taco 可直接离线评审；当需要跨成员在线评审或生成分享链接时，Agent 可通过已安装的 taco-cli 发布到 Tacobin。访客在网页里共享编辑与评论并自动保存；保存失败可重试，冲突时保留草稿。仅当评审者显式点击「交接」且有 Agent 在线监听时，才产生 review.handed_off 事件；普通评论和自动保存不会唤醒 Agent。',
    section4AgentTitle: 'FOR AGENT',
    section4AgentPrompt:
      '阅读 https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md 的托管评审说明。先用 taco-cli publish <file.taco.html> --host <origin> --dry-run 核对公开内容，再发布并保存 URL、tacoId 和 revisionId；运行 taco-cli subscribe <tacoId> --host <origin> 等待 review.handed_off 事件。收到交接后用 taco-cli handoff 拉取快照、更新源文件，并通过 taco-cli update <tacoId> <file.taco.html> 原地更新同一链接。',
    section3Eyebrow: '06 / SPEC KIT 集成',
    section3Title: '原生支持 GitHub Spec Kit 工作流',
    section3DescBefore: '已为 ',
    section3DescAfter: ' 做好完整集成。按需安装 Taco 扩展插件后，Agent 在每个规范生命周期（specify、plan、tasks 等）自动更新单文件容器，人类审查随时跟进。',
    section3Cmd: 'specify extension add taco --from https://github.com/Arcadia822/taco/releases/latest/download/taco-extension.zip',
    creditsEyebrow: '07 / SHOUTOUT',
    creditsBackToTop: '回到顶部',
    creditsTitlePrefix: '感谢',
    creditsTitleEnd: '。',
    creditsDescription: 'Taco 的灵感与核心代码来自 Bento 项目。感谢 nyblnet 将它开源，让 Taco 得以在此基础上继续生长。',
    creditsContact: '保持联系',
    pageNavAria: '页面导航',
    pageDotAria: (page: number) => `跳转到第 ${page} 页`,
    langSwitchAria: '切换语言',
    tracePublish: '发布 Taco，拿到分享地址',
    traceSubscribe: '用 tacoId 订阅这份文档的评审',
    traceEvent: '交接事件到达；Agent 拉取完整快照',
    agent: {
      title: 'agent · ~/taco',
      defaultHandoff: [
        '我已在 Taco 评审页面完成了修改与评论，请同步以下变更：',
        '- 文档标题: "Taco 文档"',
        '',
        '## 评论',
        '- [taco/概览.md:22] 原文: "Taco 把一个议题的整组文档打包成一个可以直接在浏览器里打开的文件。"',
        '  - **arcadia**: 这里补一段默认使用边界吧：说明只有多文件复杂设计且需要人评审拍板，或用户主动要求时才打包 Taco；日常探索聊天和简单修改直接在对话与代码里完成。',
        '- [taco/功能/Taco.md:76] 原文: "Lite 的 CDN 不可用时，Markdown 仍可按源码编辑。"',
        '  - **mo**: Lite 和 Complete 默认推荐哪个？表格里看不出结论。',
        '  - **arcadia**: 放进仓库、联网评审用 Lite；要发给可能离线的人用 Complete。已经写进常见问题，你看这样清楚吗？',
        '- [taco/功能/Tacobin.md:29] 原文: "评论和自动保存都不等于交接，不会唤醒 Agent。"',
        '  - **lin**: 评审者写完评论就关页面的情况会很多。自动保存成功后，是否应该在页面上提示「尚未交接」？',
        '  - **arcadia**: 同意这是风险。先记下来，等第二轮审阅体验一起设计提示方式。',
        '- [taco/路线图.md:23] 原文: "全局讨论列表"',
        '  - **mo**: 全局讨论里能不能新建不挂在任何文档上的议题？比如整体架构方向这种讨论。',
      ].join('\n'),
      reviewTarget: '剪贴板交接反馈',
      firstHit: '[open] taco/概览.md:22 > Taco 把一个议题的整组文档打包成一个可以直接在浏览器里打开的文件。',
      moreHits: '… 另有 3 条评论：功能/Taco.md、功能/Tacobin.md、路线图.md',
      readTarget: 'taco/概览.md',
      editedTarget: 'taco/概览.md',
      editStats: '(+1',
      diffLine: '默认情况下，仅在多文件复杂设计需要人评审拍板，或你主动要求时，Agent 才会打包 Taco…',
      refreshCmd: `node skills/taco/scripts/pack.mjs --dir docs/taco-guide/zh-Hans/taco --out ${DEMO_TACO}`,
      refreshOutput: '原地刷新完成 · docId、4 条打开评论与 Checkpoints 均已保留',
      placeholder: '粘贴 Taco 交接内容…',
      pasted: (lines: number) => `[已粘贴 ${lines} 行]`,
      summary: '已在《概览》补上默认使用边界说明并刷新 Taco；评论保持打开，待你确认。另外 3 条涉及产品取舍，留给你拍板。',
      replay: '重来一次',
    },
    demoEditedFile: 'taco/概览.md',
    demoViewerTitle: 'Taco 演示：Taco 文档',
    footerLeft: 'Taco Specification & Tacobin Platform',
    footerRight: '© 2026 STENCIL LABS / ARCADIA',
  },
  en: {
    eyebrow: 'AGENT - HUMAN COLLABORATION',
    h1: 'Work through the design\nwith your agent, seamlessly.',
    desc: 'A single-file design review workspace that stays easy to read, versions cleanly in your repo, and hands off in one click.',
    tryBtn: 'Try Taco',
    tryUrl: '/demo/en/taco-guide.taco.html',
    downloadBtn: 'Download Taco',
    downloadUrl: 'https://github.com/Arcadia822/taco/releases/download/taco-docs/Taco_Docs.en.taco.html',
    forAgent: 'For Agent',
    agentPrompt:
      'Fetch https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md and follow it to install the Taco skill and taco-cli, creating the directories if needed. Then reply Installed taco. plus a short summary of how to make a Taco.',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Could not copy',
    scrollDown: 'Scroll down',
    section2Eyebrow: '02 / Review handoff',
    section2Title: 'Review right in the doc. Your agent takes it from there.',
    section2Lead: 'In Taco you can:',
    section2Points: [
      'Select text to comment — the discussion stays next to the source',
      'Edit in place: WYSIWYG Markdown, syntax-highlighted JSON/YAML source, and Mermaid diagram preview; single-page HTML stays read-only in a sandbox in local and hosted reviews',
      'Reply to threads and resolve them once you confirm the changes',
      'Hit Handoff to send every edit and open comment to your agent in one click',
    ],
    section2Tip: 'Try Handoff at the window’s top right — the agent on the left replays.',
    section1Eyebrow: '03 / One file',
    section1Title: 'One file carries everything.',
    section1Desc: 'One .taco.html is the whole handoff: docs, the reader app and review threads travel together in your repo or as a shared file. Reviewers double-click to read, edit and comment in context; once saved, the next reviewer or agent gets that same context. No install or account for local review.',
    section1FileSize: 'Complete example',
    section1BreakdownTitle: 'COMPLETE SHELL + TACO GUIDE CONTENT',
    section1Tree: [
      ['App', 'about 2.7 MB (bundles Tiptap, highlight.js/lowlight, Mermaid)'],
      ['Files', '10 docs (Markdown, Mermaid, OpenAPI)'],
      ['Comments', '4 open review and discussion threads'],
      ['Navigation & Checkpoints', '5-stage graph and entry manifest'],
    ],
    section1ShellSizeTitle: 'SHELL SIZE (EXCLUDES DOCUMENTS)',
    section1ShellSizes: ['Complete: about 2.7 MB (bundles full editor, syntax highlighter, Mermaid renderer, and styles)', 'Lite: about 190 KB (loads editor libraries from public CDN at runtime)'],
    section1Online: 'NETWORK DEPENDENCIES',
    section1OnlineItems: ['Complete: needs no network — all editor and rendering dependencies are bundled inline; Lite loads from public CDNs at startup, falling back to Markdown source editing if unavailable'],
    sectionCpEyebrow: '04 / DOCUMENT PROGRESS',
    sectionCpTitle: 'Checkpoints: Document Status & Dependencies',
    sectionCpDesc: 'Define document dependencies and see stage progress and suggested next steps. A renamed or deleted required file remains visible as uncreated. Status travels with the Taco file; checkpoints do not lock content or block out-of-order edits.',
    sectionCpPoints: [
      ['DAG Stages', 'Define serial and parallel dependencies from spec to tasks with fan-in'],
      ['Document Instructions', 'Configure optional instructions per checkpoint file and view requirements in the right panel'],
      ['4-State Lifecycle', 'Track documents through todo, in_progress, complete, and freeze'],
      ['Suggested Next Steps', 'Derive a frontier from marked predecessors for people and agents to consider'],
      ['No Content Lock', 'State lives in the data block without hash checks or enforced gates'],
    ],
    sectionCpDocInstruction: 'At most 5 steps from installation to the first handoff.',
    sectionCpBadge: 'CHECKPOINTS DAG',
    sectionCpDemoTemplate: 'Taco documentation site',
    sectionCpStage1: '01 Overview',
    sectionCpStage2: '02 Start',
    sectionCpStage3: '03 Architecture & API',
    sectionCpDoc1: 'Overview.md',
    sectionCpDoc2: 'Start/Quickstart.md',
    sectionCpDoc3: 'Start/FAQ.md',
    sectionCpDoc4: 'Architecture/Tacobin-API.yaml',
    section4Eyebrow: '05 / TACOBIN SPACE',
    section4Title: 'Tacobin: Shared Review Relay for Teams & Agents',
    section4Desc:
      'Local Taco files work offline; when reviewers are across the team, your agent publishes the Taco to Tacobin via taco-cli for a shareable link. Visitors edit and comment in the browser with real-time autosave. Only when a reviewer clicks Handoff with an active agent listener does Tacobin record review.handed_off — ordinary comments and autosaves never wake the agent.',
    section4AgentTitle: 'FOR AGENT',
    section4AgentPrompt:
      'Read the hosted-review section of https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md. Dry-run the public payload with taco-cli publish <file.taco.html> --host <origin> --dry-run, publish the Taco, and keep taco-cli subscribe <tacoId> --host <origin> running for review.handed_off. Fetch the snapshot with taco-cli handoff, update canonical files, and push subsequent rounds in place with taco-cli update <tacoId> <file.taco.html>.',
    section3Eyebrow: '06 / SPEC KIT INTEGRATION',
    section3Title: 'Built-in GitHub Spec Kit Integration',
    section3DescBefore: 'Full integration ready on request. Installing the optional Taco extension equips ',
    section3DescAfter: ' with automatic single-file container refreshes across all lifecycle hooks.',
    section3Cmd: 'specify extension add taco --from https://github.com/Arcadia822/taco/releases/latest/download/taco-extension.zip',
    creditsEyebrow: '07 / SHOUTOUT',
    creditsBackToTop: 'Back to Top',
    creditsTitlePrefix: 'Thank you,',
    creditsTitleEnd: '.',
    creditsDescription: 'Taco’s inspiration and core code come from Bento. Thank you to nyblnet for making it open source and giving Taco a place to begin.',
    creditsContact: 'Keep in touch',
    tracePublish: 'Publish the Taco and get a share URL',
    pageNavAria: 'Page navigation',
    pageDotAria: (page: number) => `Scroll to page ${page}`,
    langSwitchAria: 'Switch Language',
    traceSubscribe: 'Subscribe to reviews using its tacoId',
    traceEvent: 'Handoff arrives; the agent fetches the full snapshot',
    agent: {
      title: 'agent · ~/taco',
      defaultHandoff: [
        'I have completed modifications and comments in the Taco review page. Please sync the following changes:',
        '- Document title: "Taco Docs"',
        '',
        '## Comments',
        '- [taco/Overview.md:22] Quote: "Taco packs every document for one topic into a file you open directly in a browser."',
        '  - **arcadia**: Let’s add a short paragraph right after this on when Taco is used by default: only when a multi-file complex design needs human review, or when the user asks for one — exploratory chat and simple fixes stay in the chat and repo.',
        '- [taco/Features/Taco.md:76] Quote: "If Lite\'s CDN is unavailable, Markdown can still be edited as source."',
        '  - **mo**: Which one do we recommend by default, Lite or Complete? The table doesn\'t say.',
        '  - **arcadia**: Lite for committing to a repository and online review; Complete for recipients who may be offline. Added to the FAQ — does that look clear to you?',
        '- [taco/Features/Tacobin.md:29] Quote: "Comments and autosave are not a handoff, and they do not wake the agent."',
        '  - **lin**: Plenty of reviewers will comment and just close the tab. After autosave succeeds, should the page say "not handed off yet"?',
        '  - **arcadia**: Agreed, that\'s a real risk. Logging it for now; we\'ll design the prompt together with the second review round.',
        '- [taco/Roadmap.md:23] Quote: "Global discussions list"',
        '  - **mo**: Can the global discussions list hold topics that aren\'t attached to any document, like overall architecture direction?',
      ].join('\n'),
      reviewTarget: 'pasted review feedback',
      firstHit: '[open] taco/Overview.md:22 > Taco packs every document for one topic into a file you open directly in a browser.',
      moreHits: '… +3 more: Features/Taco.md, Features/Tacobin.md, Roadmap.md',
      readTarget: 'taco/Overview.md',
      editedTarget: 'taco/Overview.md',
      editStats: '(+1',
      diffLine: 'By default, your agent packs a Taco only when a multi-file complex design needs human review…',
      refreshCmd: `node skills/taco/scripts/pack.mjs --dir docs/taco-guide/en/taco --out ${DEMO_TACO}`,
      refreshOutput: 'Refreshed in place · docId, 4 open threads and Checkpoints preserved',
      placeholder: 'Paste a Taco handoff…',
      pasted: (lines: number) => `[Pasted text · ${lines} lines]`,
      summary: 'Added the default scope paragraph to Overview and refreshed the Taco; left the comment thread open for you to confirm. The other 3 are product calls — they are yours.',
      replay: 'Replay',
    },
    demoEditedFile: 'taco/Overview.md',
    demoViewerTitle: 'Taco demo: Taco Docs',
    footerLeft: 'Taco Specification & Tacobin Platform',
    footerRight: '© 2026 STENCIL LABS / ARCADIA',
  },
}

export default function HomePage() {
  const [locale, setLocale] = useState<LocaleCode>('zh-Hans')
  const [activeSection, setActiveSection] = useState(0)
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null)
  const [agentDone, setAgentDone] = useState(false)

  // 嵌入的 Taco 点「交接改动」后会同源 postMessage 交接文本；只接受本页 demo iframe 发来的消息
  const demoFrameHost = useRef<HTMLDivElement | null>(null)

  // 指针在窗框或终端上滚轮时，页面本身不动；终端正文仍可自己滚动
  const demoStage = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const stage = demoStage.current
    if (!stage) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const transcript = (event.target as Element).closest('.mui-terminal__body')
      if (transcript) transcript.scrollTop += event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.data?.type !== 'taco:handoff' || typeof event.data.text !== 'string') return
      if (event.source !== demoFrameHost.current?.querySelector('iframe')?.contentWindow) return
      setAgentDone(false)
      setAgentRun({ id: Date.now(), handoff: event.data.text })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    const savedLocale = localStorage.getItem('taco-locale')
    const nextLocale: LocaleCode = savedLocale === 'en' || savedLocale === 'zh-Hans'
      ? savedLocale
      : navigator.language.startsWith('en') ? 'en' : 'zh-Hans'
    setLocale(nextLocale)
    document.documentElement.lang = nextLocale
  }, [])

  // The same marker previews a partial wheel gesture and follows real scroll during a page turn.
  const indicatorRef = useRef<HTMLDivElement | null>(null)
  const markerRef = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    let distance = 0
    let lastWheelAt = 0
    let locked = false
    let preview: number | null = null
    let direction = 0
    let resetTimer: number | undefined
    const sections = document.querySelectorAll<HTMLElement>('.snap-page')

    const positionMarker = (position: number) => {
      const dots = indicatorRef.current?.querySelectorAll('.page-dot')
      const step = dots && dots.length > 1 ? dots[1].offsetTop - dots[0].offsetTop : 21
      if (markerRef.current) markerRef.current.style.transform = `translateY(${position * step}px) scale(1.45)`
    }
    const getScrollPosition = () => {
      const scrollY = window.scrollY
      if (!sections.length) return 0
      for (let i = 0; i < sections.length - 1; i++) {
        const curr = sections[i].offsetTop
        const next = sections[i + 1].offsetTop
        if (scrollY < next) {
          const progress = next > curr ? (scrollY - curr) / (next - curr) : 0
          return i + Math.min(1, Math.max(0, progress))
        }
      }
      return sections.length - 1
    }
    const syncScroll = () => {
      const actual = getScrollPosition()
      if (preview !== null && (direction > 0 ? actual >= preview : actual <= preview)) preview = null
      positionMarker(preview === null ? actual : direction > 0 ? Math.max(actual, preview) : Math.min(actual, preview))
      const viewportCenter = window.scrollY + window.innerHeight / 2
      if (indicatorRef.current) {
        const show = actual > 0.05 && viewportCenter < sections[sections.length - 1].offsetTop
        indicatorRef.current.classList.toggle('is-visible', show)
        indicatorRef.current.setAttribute('aria-hidden', String(!show))
        indicatorRef.current.toggleAttribute('inert', !show)
      }
      for (let index = sections.length - 1; index >= 0; index--) {
        if (sections[index].offsetTop <= viewportCenter) {
          setActiveSection(index)
          break
        }
      }
    }
    const onWheel = (event: WheelEvent) => {
      if (window.matchMedia('(max-width: 900px)').matches || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || (event.target instanceof Node && demoStage.current?.contains(event.target))) return
      event.preventDefault()
      const now = performance.now()
      if (now - lastWheelAt > 380) {
        distance = 0
        locked = false
      }
      lastWheelAt = now
      if (locked) return
      const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1)
      if (Math.sign(delta) !== Math.sign(distance)) distance = 0
      distance += Math.sign(delta) * Math.min(Math.abs(delta), 120)
      direction = Math.sign(distance)
      const actual = getScrollPosition()
      const current = Math.round(actual)
      preview = Math.min(5, Math.max(0, current + direction * Math.min(Math.abs(distance) / 160, 1)))
      positionMarker(preview)
      window.clearTimeout(resetTimer)
      resetTimer = window.setTimeout(() => {
        distance = 0
        preview = null
        locked = false
        syncScroll()
      }, Math.abs(distance) >= 160 ? 900 : 380)
      if (Math.abs(distance) < 160) return
      const targetIndex = Math.min(sections.length - 1, Math.max(0, current + direction))
      const targetSection = sections[targetIndex]
      const top = targetSection ? targetSection.offsetTop : targetIndex * window.innerHeight
      window.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      distance = 0
      locked = true
    }
    syncScroll()
    window.addEventListener('scroll', syncScroll, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('resize', syncScroll)
    return () => {
      window.clearTimeout(resetTimer)
      window.removeEventListener('scroll', syncScroll)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', syncScroll)
    }
  }, [])

  const t = I18N[locale]

  const switchLocale = (next: LocaleCode) => {
    setLocale(next)
    localStorage.setItem('taco-locale', next)
    document.documentElement.lang = next
    setLangMenuOpen(false)
  }

  const scrollToPage = (idx: number) => {
    const sections = document.querySelectorAll<HTMLElement>('.snap-page')
    const target = sections[idx]
    const top = target ? target.offsetTop : idx * window.innerHeight
    window.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  return (
    <div id="top" className={`home-root ${geist.variable} ${firaCode.variable}`} data-background-muted={activeSection > 0 && activeSection < 6}>
      {/* Continuous page position, including a wheel gesture before the next page turns. */}
      <div ref={indicatorRef} className="page-indicator" aria-label={t.pageNavAria} aria-hidden="true">
        <span className="page-indicator__track" aria-hidden="true" />
        {[0, 1, 2, 3, 4, 5, 6].map((idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => scrollToPage(idx)}
            className="page-dot"
            aria-current={activeSection === idx ? 'step' : undefined}
            aria-label={t.pageDotAria(idx + 1)}
          />
        ))}
        <span ref={markerRef} className="page-indicator__marker" aria-hidden="true" />
      </div>
      <TacoPixelBackground />

      {/* 顶部纯粹 Header */}
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          background: 'transparent',
        }}
      >
        <div
          style={{
            width: '100%',
            padding: '0 10%',
            height: '56px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxSizing: 'border-box',
          }}
        >
          {/* Logo */}
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
            onClick={() => scrollToPage(0)}
          >
            <svg viewBox="0 0 24 24" style={{ width: '22px', height: '22px', display: 'block' }}>
              <circle cx="15.2" cy="8.8" r="4.8" fill="#3ecf8e" />
              <circle cx="7.2" cy="14.4" r="3.2" fill="#3b82f6" />
              <circle cx="14.8" cy="18" r="2" fill="#f97316" />
            </svg>
            <span
              style={{
                fontSize: '15px',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: '#fff',
              }}
            >
              Taco
            </span>
          </div>

          {/* Right actions (Taco 原生 control-button icon 规范) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* GitHub 官方 Repo 图标按钮 */}
            <a
              href="https://github.com/Arcadia822/taco"
              target="_blank"
              rel="noopener noreferrer"
              className="control-button"
              title="GitHub"
              aria-label="GitHub"
              style={{ textDecoration: 'none' }}
            >
              <svg className="ui-icon" viewBox="0 0 24 24" fill="currentColor">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
            </a>

            {/* 语言切换 Icon Button 与 Popover */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="control-button"
                title={t.langSwitchAria}
                aria-label={t.langSwitchAria}
                onClick={() => setLangMenuOpen(!langMenuOpen)}
              >
                <svg
                  className="ui-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18" />
                  <path d="M12 3a15 15 0 0 1 0 18" />
                  <path d="M12 3a15 15 0 0 0 0 18" />
                </svg>
              </button>

              {langMenuOpen && (
                <div
                  className="topbar-popover"
                  style={{
                    right: 0,
                    top: '32px',
                    position: 'absolute',
                  }}
                >
                  <button
                    type="button"
                    className={`popover-action ${locale === 'zh-Hans' ? 'is-active' : ''}`}
                    onClick={() => switchLocale('zh-Hans')}
                  >
                    <span className="lang-badge">简</span>
                    <span>简体中文</span>
                  </button>
                  <button
                    type="button"
                    className={`popover-action ${locale === 'en' ? 'is-active' : ''}`}
                    onClick={() => switchLocale('en')}
                  >
                    <span className="lang-badge">EN</span>
                    <span>English</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ================= PAGE 0: HERO 首屏 ================= */}
      <section className="snap-page snap-page--hero">

        <div style={{ width: '100%', position: 'relative', zIndex: 10 }}>
          <div style={{ maxWidth: '820px' }}>
            {/* Eyebrow */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '11px',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: '#3ecf8e',
                fontFamily: 'var(--mono)',
                marginBottom: '20px',
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  background: '#3ecf8e',
                  borderRadius: '1px',
                  display: 'inline-block',
                }}
              />
              <span>{t.eyebrow}</span>
            </div>

            {/* H1 Display Typography (参考 omp 70px 极简断行与色彩层次) */}
            <h1
              style={{
                fontSize: 'clamp(2rem, 4.2vw, 3.5rem)',
                fontWeight: 600,
                lineHeight: 1.12,
                letterSpacing: '-0.02em',
                margin: '0 0 20px',
                color: '#ffffff',
                whiteSpace: 'pre-line',
                width: 'max-content',
                maxWidth: 'min(80vw, 1160px)',
              }}
            >
              {t.h1}
            </h1>

            {/* Subtitle */}
            <p
              style={{
                fontSize: 'clamp(15px, 1.8vw, 17px)',
                lineHeight: 1.65,
                color: '#a1a1aa',
                margin: '0 0 36px',
              }}
            >
              {t.desc}
            </p>

            {/* 主操作：试用 / 下载 */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
              <a href={t.tryUrl} target="_blank" rel="noopener noreferrer" className="cta-btn cta-btn--primary">
                {t.tryBtn}
                <svg className="cta-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14m-6-6 6 6-6 6" />
                </svg>
              </a>
              <a href={t.downloadUrl} download className="cta-btn cta-btn--ghost">
                {t.downloadBtn}
                <span aria-hidden="true">↓</span>
              </a>
            </div>

            {/* 给 Agent 的单行安装 Prompt */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div className="agent-prompt">
                <span className="agent-prompt__label">{t.forAgent}</span>
                <code className="agent-prompt__text">{t.agentPrompt}</code>
                <CopyIconButton text={t.agentPrompt} labels={t} />
              </div>
            </div>
          </div>
        </div>

        {/* 底部滚动提示 */}
        <button type="button" className="scroll-hint" onClick={() => scrollToPage(1)}>
          <span>{t.scrollDown}</span>
          <svg className="scroll-hint__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </section>

      {/* ================= PAGE 1: 评审交接 —— 真实 Taco + 浮层 Agent ================= */}
      <section className="snap-page snap-page--demo">
        <div className="demo-copy">
          <div
            style={{
              fontSize: '11px',
              letterSpacing: '0.24em',
              textTransform: 'uppercase',
              color: '#3ecf8e',
              fontFamily: 'var(--mono)',
              marginBottom: '8px',
            }}
          >
            {t.section2Eyebrow}
          </div>
          <h2
            style={{
              fontSize: 'clamp(24px, 2.6vw, 34px)',
              fontWeight: 600,
              letterSpacing: '-0.03em',
              lineHeight: 1.2,
              margin: '0 0 10px',
              color: '#fff',
            }}
          >
            {t.section2Title}
          </h2>
          <p className="demo-lead">{t.section2Lead}</p>
          <ul className="demo-points">
            {t.section2Points.map((point) => <li key={point}>{point}</li>)}
          </ul>
          <p className="demo-tip">{t.section2Tip}</p>
        </div>

        <div ref={demoStage} className="demo-stage">
          <div className="browser-window">
            <div className="browser-window__bar">
              <span className="browser-window__dots" aria-hidden="true">
                <span style={{ background: '#ef4444' }} />
                <span style={{ background: '#eab308' }} />
                <span style={{ background: '#22c55e' }} />
              </span>
              <span className="browser-window__title">{DEMO_TACO}</span>
            </div>
            <div ref={demoFrameHost} className="browser-window__screen">
              <ScaledTaco
                key={`${locale}-${agentDone ? 'after' : 'before'}`}
                src={
                  agentDone
                    ? `/demo/${locale}/after/${DEMO_TACO}?embed&theme=dark&lang=${locale}#${encodeURIComponent(t.demoEditedFile)}`
                    : `/demo/${locale}/${DEMO_TACO}?embed&pending&theme=dark&lang=${locale}`
                }
                title={t.demoViewerTitle}
              />
            </div>
          </div>

          <AgentTerminal
            run={agentRun ?? { id: 0, handoff: t.agent.defaultHandoff }}
            animate={agentRun !== null}
            done={agentDone}
            labels={t.agent}
            onDone={() => setAgentDone(true)}
            onReplay={() => {
              setAgentRun(null)
              setAgentDone(false)
            }}
          />
        </div>
      </section>

      {/* ================= PAGE 2: 03 / 一个文件自洽 ================= */}
      <section className="snap-page">
        <div style={{ width: '100%' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '48px',
              alignItems: 'center',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '11px',
                  letterSpacing: '0.24em',
                  textTransform: 'uppercase',
                  color: '#3ecf8e',
                  fontFamily: 'var(--mono)',
                  marginBottom: '16px',
                }}
              >
                {t.section1Eyebrow}
              </div>
              <h2
                style={{
                  fontSize: 'clamp(32px, 4.5vw, 48px)',
                  fontWeight: 600,
                  letterSpacing: '-0.035em',
                  lineHeight: 1.1,
                  margin: '0 0 20px',
                  color: '#fff',
                }}
              >
                {t.section1Title}
              </h2>
              <p
                style={{
                  fontSize: '16px',
                  lineHeight: 1.7,
                  color: '#a1a1aa',
                  margin: 0,
                  maxWidth: '520px',
                }}
              >
                {t.section1Desc}
              </p>
            </div>

            <div
              style={{
                background: '#09090b',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '32px',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                fontFamily: 'var(--mono)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="bundle-card__dot" aria-hidden="true" />
                <span style={{ color: '#fff', fontSize: '13px', fontWeight: 600 }}>{DEMO_TACO}</span>
                <strong className="bundle-card__size" style={{ marginLeft: 'auto', fontSize: '12px' }}>{t.section1FileSize}</strong>
              </div>

              <div className="bundle-card__tree">
                <div className="bundle-card__online-title">{t.section1BreakdownTitle}</div>
                {t.section1Tree.map(([key, value], index) => (
                  <div key={key} className="bundle-card__row">
                    <span className="bundle-card__branch">{index === t.section1Tree.length - 1 ? '└──' : '├──'}</span>
                    <span className="bundle-card__key">{key}</span>
                    <span className="bundle-card__value">{value}</span>
                  </div>
                ))}
              </div>

              <div className="bundle-card__online">
                <div className="bundle-card__online-title">{t.section1ShellSizeTitle}</div>
                {t.section1ShellSizes.map((item) => <div key={item}>· {item}</div>)}
              </div>

              <div className="bundle-card__online">
                <div className="bundle-card__online-title">{t.section1Online}</div>
                {t.section1OnlineItems.map((item) => <div key={item}>· {item}</div>)}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= PAGE 3: 进阶能力 1 - CHECKPOINTS 阶段进度 ================= */}
      <section className="snap-page snap-page--checkpoints">
        <div style={{ width: '100%' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '48px',
              alignItems: 'center',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '11px',
                  letterSpacing: '0.24em',
                  textTransform: 'uppercase',
                  color: '#3ecf8e',
                  fontFamily: 'var(--mono)',
                  marginBottom: '16px',
                }}
              >
                {t.sectionCpEyebrow}
              </div>
              <h2
                style={{
                  fontSize: 'clamp(32px, 4.5vw, 48px)',
                  fontWeight: 600,
                  letterSpacing: '-0.035em',
                  lineHeight: 1.15,
                  margin: '0 0 20px',
                  color: '#fff',
                }}
              >
                {t.sectionCpTitle}
              </h2>
              <p
                style={{
                  fontSize: '16px',
                  lineHeight: 1.7,
                  color: '#a1a1aa',
                  margin: '0 0 28px',
                  maxWidth: '520px',
                }}
              >
                {t.sectionCpDesc}
              </p>

              <div className="cp-feature-list">
                {t.sectionCpPoints.map(([title, desc]) => (
                  <div key={title} className="cp-feature-item">
                    <span className="cp-feature-item__bullet" aria-hidden="true" />
                    <div>
                      <strong className="cp-feature-item__title">{title}</strong>
                      <span className="cp-feature-item__desc">{desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 拟态 Checkpoint DAG 图与阶段卡片 */}
            <div className="cp-card">
              <div className="cp-card__header">
                <div className="cp-card__badge-row">
                  <span className="cp-card__badge">{t.sectionCpBadge}</span>
                  <span className="cp-card__template">{t.sectionCpDemoTemplate}</span>
                </div>
                <span className="cp-card__status-summary">1 / 3 Freeze</span>
              </div>

              <div className="cp-graph-container">
                {/* 节点 1: 概览 (Freeze) */}
                <div className="cp-node cp-node--freeze">
                  <div className="cp-node__header">
                    <span className="cp-node__dot" aria-hidden="true" />
                    <span className="cp-node__title">{t.sectionCpStage1}</span>
                    <span className="cp-node__status">freeze</span>
                  </div>
                  <div className="cp-node__docs">
                    <div className="cp-doc-item">
                      <span className="cp-doc-item__icon cp-doc-item__icon--freeze" />
                      <span className="cp-doc-item__path">{t.sectionCpDoc1}</span>
                    </div>
                  </div>
                </div>

                <div className="cp-edge-down" aria-hidden="true">
                  <span className="cp-edge-line" />
                </div>

                {/* 节点 2: 开始 (Complete / Frontier) */}
                <div className="cp-node cp-node--complete is-frontier">
                  <div className="cp-node__header">
                    <span className="cp-node__dot" aria-hidden="true" />
                    <span className="cp-node__title">{t.sectionCpStage2}</span>
                    <span className="cp-node__status">complete</span>
                    <span className="cp-node__frontier-tag">FRONTIER</span>
                  </div>
                  <div className="cp-node__docs">
                    <div className="cp-doc">
                      <div className="cp-doc-item">
                        <span className="cp-doc-item__icon cp-doc-item__icon--complete" />
                        <span className="cp-doc-item__path">{t.sectionCpDoc2}</span>
                      </div>
                      <p className="cp-doc-instruction">{t.sectionCpDocInstruction}</p>
                    </div>
                    <div className="cp-doc-item">
                      <span className="cp-doc-item__icon cp-doc-item__icon--complete" />
                      <span className="cp-doc-item__path">{t.sectionCpDoc3}</span>
                    </div>
                  </div>
                </div>

                <div className="cp-edge-down" aria-hidden="true">
                  <span className="cp-edge-line cp-edge-line--dashed" />
                </div>

                {/* 节点 3: 架构与接口 (Todo) */}
                <div className="cp-node cp-node--todo">
                  <div className="cp-node__header">
                    <span className="cp-node__dot" aria-hidden="true" />
                    <span className="cp-node__title">{t.sectionCpStage3}</span>
                    <span className="cp-node__status">todo</span>
                  </div>
                  <div className="cp-node__docs">
                    <div className="cp-doc-item">
                      <span className="cp-doc-item__icon cp-doc-item__icon--todo" />
                      <span className="cp-doc-item__path">{t.sectionCpDoc4}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= PAGE 4: 进阶能力 2 - TACOBIN 协作空间 ================= */}
      <section className="snap-page snap-page--tacobin">
        <div style={{ width: '100%', margin: 'auto 0' }}>
          <div className="tacobin-layout"
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 7fr)',
              gap: '40px',
              alignItems: 'center',
            }}
          >
            {/* 说明与 Agent 指引 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <div
                  style={{
                    fontSize: '11px',
                    letterSpacing: '0.24em',
                    textTransform: 'uppercase',
                    color: '#3ecf8e',
                    fontFamily: 'var(--mono)',
                    marginBottom: '12px',
                  }}
                >
                  {t.section4Eyebrow}
                </div>
                <h2
                  style={{
                    fontSize: 'clamp(26px, 3.6vw, 40px)',
                    fontWeight: 600,
                    letterSpacing: '-0.03em',
                    lineHeight: 1.15,
                    margin: '0 0 14px',
                    color: '#fff',
                  }}
                >
                  {t.section4Title}
                </h2>
                <p
                  style={{
                    fontSize: '14px',
                    lineHeight: 1.65,
                    color: '#a1a1aa',
                    margin: 0,
                  }}
                >
                  {t.section4Desc}
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="agent-prompt" style={{ width: '100%', maxWidth: '100%' }}>
                  <span className="agent-prompt__label">{t.section4AgentTitle}</span>
                  <code className="agent-prompt__text">{t.section4AgentPrompt}</code>
                  <CopyIconButton text={t.section4AgentPrompt} labels={t} />
                </div>
              </div>
            </div>

            {/* 示例终端：Agent 发起发布与订阅，接收 Tacobin 评审事件 */}
            <div className="workflow-terminal">
              <div className="workflow-terminal__bar">
                <span className="browser-window__dots" aria-hidden="true">
                  <span style={{ background: '#ef4444' }} />
                  <span style={{ background: '#eab308' }} />
                  <span style={{ background: '#22c55e' }} />
                </span>
              </div>
              <div className="workflow-terminal__body">
                <div className="workflow-terminal__step">
                  <div className="workflow-terminal__agent"><span>AGENT / 01</span>{t.tracePublish}</div>
                  <div className="workflow-terminal__command"><span>$</span><code>taco-cli publish {DEMO_TACO}</code></div>
                  <div className="workflow-terminal__output workflow-terminal__output--url"><span>url</span><code>{TRACE_HOST}/t/{TRACE_TACO_ID}</code></div>
                  <div className="workflow-terminal__output"><span>tacoId</span><code>{TRACE_TACO_ID}</code></div>
                </div>
                <div className="workflow-terminal__step">
                  <div className="workflow-terminal__agent"><span>AGENT / 02</span>{t.traceSubscribe}</div>
                  <div className="workflow-terminal__command"><span>$</span><code>taco-cli subscribe {TRACE_TACO_ID}</code></div>
                  <div className="workflow-terminal__log"><span>ready</span><code>{'{"kind":"ready","mode":"live","cursor":"0"}'}</code></div>
                </div>
                <div className="workflow-terminal__step">
                  <div className="workflow-terminal__agent"><span>AGENT / 03</span>{t.traceEvent}</div>
                  <div className="workflow-terminal__log"><span>event</span><code>{JSON.stringify({ kind: 'event', type: 'review.handed_off', tacoId: TRACE_TACO_ID, data: { handoffId: '63e82d37-a037-46f9-90d8-c752500169ed' } })}</code></div>
                  <div className="workflow-terminal__command"><span>$</span><code>taco-cli handoff {TRACE_TACO_ID} 63e82d37-a037-46f9-90d8-c752500169ed</code></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= PAGE 5: 进阶能力 3 - SPEC KIT 集成 ================= */}
      <section className="snap-page">
        <div style={{ width: '100%' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '48px',
              alignItems: 'center',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '11px',
                  letterSpacing: '0.24em',
                  textTransform: 'uppercase',
                  color: '#3ecf8e',
                  fontFamily: 'var(--mono)',
                  marginBottom: '16px',
                }}
              >
                {t.section3Eyebrow}
              </div>
              <h2
                style={{
                  fontSize: 'clamp(32px, 4.5vw, 48px)',
                  fontWeight: 600,
                  letterSpacing: '-0.035em',
                  lineHeight: 1.1,
                  margin: '0 0 20px',
                  color: '#fff',
                }}
              >
                {t.section3Title}
              </h2>
              <p
                style={{
                  fontSize: '16px',
                  lineHeight: 1.7,
                  color: '#a1a1aa',
                  margin: 0,
                  maxWidth: '520px',
                }}
              >
                {t.section3DescBefore}
                <a className="spec-kit-link" href="https://github.com/github/spec-kit" target="_blank" rel="noopener noreferrer">Spec Kit</a>
                {t.section3DescAfter}
              </p>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              {/* Spec Kit 安装组件 (与首页风格严格一致) */}
              <div className="agent-prompt" style={{ width: '100%', maxWidth: '100%' }}>
                <span className="agent-prompt__label">SPEC KIT</span>
                <code className="agent-prompt__text">{t.section3Cmd}</code>
                <CopyIconButton text={t.section3Cmd} labels={t} />
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div
                  style={{
                    background: '#09090b',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontFamily: 'var(--mono)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ color: '#3ecf8e' }}>●</span>
                    <span style={{ color: '#fff', fontSize: '13px' }}>speckit.taco.update</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#71717a' }}>HOOKS: SPECIFY / PLAN / TASKS</span>
                </div>

                <div
                  style={{
                    background: '#09090b',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontFamily: 'var(--mono)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ color: '#3b82f6' }}>●</span>
                    <span style={{ color: '#fff', fontSize: '13px' }}>speckit.taco.review</span>
                  </div>
                  <span style={{ fontSize: '11px', color: '#71717a' }}>DIFF & COMMENT HANDOFF</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="snap-page snap-page--credits" aria-labelledby="credits-title">
        <div className="credits-content">
          <p className="credits-eyebrow">{t.creditsEyebrow}</p>
          <h2 id="credits-title">{t.creditsTitlePrefix} <span className="credits-brand"><img src="/bento-logo.svg" width="112" height="112" alt="" />Bento{t.creditsTitleEnd}</span></h2>
          <p className="credits-description">{t.creditsDescription}</p>
          <a className="credits-source" href="https://github.com/nyblnet/bento" target="_blank" rel="noopener noreferrer">nyblnet / bento <span aria-hidden="true">↗</span></a>
          <footer className="credits-contact">
            <p>{t.creditsContact}</p>
            <nav aria-label={t.creditsContact}>
              <a href="https://x.com/arcadia822" target="_blank" rel="noopener noreferrer" aria-label="X: @arcadia822">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932 6.064-6.933ZM17.61 20.644h2.039L6.486 3.24H4.298L17.61 20.644Z" /></svg>
                <span>@arcadia822 ↗</span>
              </a>
              <a href="https://github.com/Arcadia822" target="_blank" rel="noopener noreferrer" aria-label="GitHub: @Arcadia822">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" /></svg>
                <span>@Arcadia822 ↗</span>
              </a>
            </nav>
            <a className="credits-back-to-top" href="#top">↑ {t.creditsBackToTop}</a>
          </footer>
        </div>
      </section>
    </div>
  )
}
