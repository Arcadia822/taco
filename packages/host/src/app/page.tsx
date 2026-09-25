'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Fira_Code, Geist } from 'next/font/google'
import './home.css'
import { AgentTerminal, type AgentRun } from '../components/agent-terminal'
import { TacoPixelBackground } from '../components/taco-pixel-background'

const geist = Geist({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-geist' })
const firaCode = Fira_Code({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-fira-code' })

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
const DEMO_TACO = '008-taco-host-contract.taco.html'
const DEMO_EDITED_FILE = 'specs/008-taco-host-contract/data-model.mmd'
const TRACE_TACO_ID = '8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001'
const TRACE_HOST = 'https://tacobin.arcadia-han.com'
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
    h1: '一个议题的完整设计，一个文件装下。',
    desc: '人和 Agent 都能顺手地阅读、修改和评论。单个文件放在代码仓库里，跟代码一起做版本管理。',
    tryBtn: '试用 Taco',
    tryUrl: 'https://taco-spec-zh-cn.arcadia822.chatgpt.site',
    downloadBtn: '下载 Taco',
    comingSoon: '即将推出',
    forAgent: 'For Agent',
    forSkill: 'Skill',
    agentPrompt:
      '阅读 https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md ，按其中步骤为我安装 Taco；安装完成后，向我介绍 Taco 怎么用。',
    skillCmd: 'npx skills@latest add arcadia822/taco --skill=taco',
    copy: '复制',
    copied: '已复制',
    copyFailed: '复制失败',
    scrollDown: '向下滚动',
    section1Eyebrow: '04 / 一个文件',
    section1Title: '一个文件，带齐所有东西',
    section1Desc: '一个 .taco.html 就是完整的交接件：文档、阅读应用和评论线程一起入库或发送。审阅者双击即可阅读、编辑、划词评论；保存后，下一位审阅者或 Agent 接手的仍是同一份上下文。本地评审无需安装或登录。',
    sectionCpEyebrow: '03 / 阶段进度',
    sectionCpTitle: 'Checkpoints：文档状态与依赖图',
    sectionCpDesc: '为项目定义文档依赖关系，查看每个阶段的进度和下一步建议。状态随 Taco 文件一起交接，方便人与 Agent 对齐工作；它不会锁定内容或阻止跨阶段编辑。',
    sectionCpPoints: [
      ['依赖图 (DAG)', '定义规范到任务的串并行阶段依赖，支持多分支与汇合'],
      ['4 级生命周期', 'todo、in_progress、complete 与 freeze 状态追踪'],
      ['下一步建议', '根据已标记的前序阶段推导 frontier，供人与 Agent 参考'],
      ['无需内容锁', '状态保存在数据块中，不做哈希校验或强制门禁'],
    ],
    sectionCpBadge: 'CHECKPOINTS DAG',
    sectionCpDemoTemplate: '008 宿主协议规范',
    sectionCpStage1: '01 规范定义',
    sectionCpStage2: '02 架构与模型',
    sectionCpStage3: '03 接口契约',
    section1FileSize: '约 719 KB',
    section1Tree: [
      ['应用', '编辑器、渲染器、样式与运行时全内联'],
      ['文件', '4 个文件：spec、data-model、流程图、OpenAPI'],
      ['评论', '跨文件评审意见与状态'],
      ['导航', '分类与入口映射清单'],
    ],
    section1Online: '可选依赖（需联网）',
    section1OnlineItems: ['Mermaid 渲染库：打开图表时从 jsDelivr 加载，离线时显示源码', '实时协作中继：可选'],
    section2Eyebrow: '02 / 评审交接',
    section2Title: '评审直接在文档里做，Agent 接着就改',
    section2Lead: '打开 Taco，你可以：',
    section2Points: [
      '划词评论，讨论就挂在原文旁边',
      '直接修改：Markdown 所见即所得，YAML 和 Mermaid 改源码、实时预览',
      '回复、解决评论线程',
      '点「交接改动」，把改动和评论整理成一段话交给 Agent',
    ],
    section2Tip: '试试窗口右上角的「交接改动」，左边的 Agent 会重跑一遍。',
    section3Eyebrow: '05 / SPEC KIT 集成',
    section3Title: '原生支持 GitHub Spec Kit 工作流',
    section3DescBefore: '已为 ',
    section3DescAfter: ' 做好完整集成。安装 Taco 扩展插件后，Agent 在每个规范生命周期（specify、plan、tasks 等）自动更新单文件容器，人类审查随时跟进。',
    section3Cmd: 'specify extension add taco --from https://github.com/Arcadia822/taco/releases/latest/download/taco-extension.zip',
    section4Eyebrow: '06 / TACOBIN 协作空间',
    section4Title: 'Tacobin：为团队连接 Taco 与 Agent',
    section4Desc:
      '本地单文件适合自洽存档；当需要团队多人在线评审、生成可分享链接，或让终端 Agent 实时订阅评审事件流时，使用 taco-cli 一键推送到 Tacobin 空间。',
    section4CliTitle: 'CLI',
    section4CliCmd: 'npm install -g @tacobin/cli',
    section4AgentTitle: 'FOR AGENT',
    section4AgentPrompt:
      '阅读 https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md 并安装 taco-cli，再运行 taco-cli skills read taco 获取内置发布与评审指南。将当前 Taco 发布到 Tacobin，使用返回的 tacoId 运行 subscribe 监听评审事件。',
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
    traceEvent: '有人评论，事件回到 Agent 的终端',
    traceComment: '请补充失败分支',
    agent: {
      title: 'agent · ~/taco',
      defaultHandoff: [
        '我已在 Taco 评审页面完成了修改与评论，请同步以下变更：',
        '- 文档标题: "008-taco-host-contract"',
        '',
        '## 评论',
        '- [specs/008-taco-host-contract/spec.md:5] 原文: "匿名可发布，最小流程不含登录"',
        '  - **arcadia**: 匿名发布自动发的 ApiKey 有效期多久、怎么回收？请在 data-model.mmd 里把相关字段补上。',
        '- [specs/008-taco-host-contract/data-model.mmd:32] 原文: "string kind "comment | confirm | feedback-done""',
        '  - **lin**: spec 说确认与反馈完成属于评审数据、不冒充正文评论。confirm / feedback-done 和 comment 放在同一个 kind 里合适吗？',
        '- [specs/008-taco-host-contract/flows/anonymous-publish.mmd:5] 原文: "D["先安全保存 Key"]"',
        '  - **arcadia**: 这里缺失败分支：Key 没落盘就不能继续上传正文，应该直接失败退出。',
        '- [specs/008-taco-host-contract/contracts/openapi.yaml:71] 原文: "description: 幂等键冲突"',
        '  - **lin**: 409 的响应体要带上已存在的 tacoId 和 revisionId，CLI 才能按幂等键恢复。',
      ].join('\n'),
      firstHit: '[open] spec.md:5:32 > 匿名可发布，最小流程不含登录',
      moreHits: '… 另有 3 条：data-model.mmd、anonymous-publish.mmd、openapi.yaml',
      diffLine: 'datetime expiresAt "默认 90 天，每次成功鉴权顺延"',
      checkpointHit: '节点 architecture 达成聚合 complete，等待测试与接口契约推进',
      placeholder: '粘贴 Taco 交接内容…',
      pasted: (lines: number) => `[已粘贴 ${lines} 行]`,
      summary: '已在 data-model.mmd 给 ApiKey 补上 expiresAt、lastUsedAt，给匿名 User 补上 reclaimAt，这条评论已解决。另外 3 条涉及设计取舍，留给你拍板。',
      replay: '重来一次',
    },
    demoViewerTitle: 'Taco 演示：008-taco-host-contract',
    footerLeft: 'Taco Specification & Tacobin Platform',
    footerRight: '© 2026 STENCIL LABS / ARCADIA',
  },
  en: {
    eyebrow: 'AGENT - HUMAN COLLABORATION',
    h1: 'The whole design doc, in one file.',
    desc: 'Easy for humans and agents to read, edit, and comment. Lives in your repo, versioned with your code.',
    tryBtn: 'Try Taco',
    tryUrl: 'https://taco-spec-en.arcadia822.chatgpt.site',
    downloadBtn: 'Download Taco',
    comingSoon: 'Coming soon',
    forAgent: 'For Agent',
    forSkill: 'Skill',
    agentPrompt:
      'Read https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md and install Taco for me by following it. When done, walk me through how to use Taco.',
    skillCmd: 'npx skills@latest add arcadia822/taco --skill=taco',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Could not copy',
    scrollDown: 'Scroll down',
    section1Eyebrow: '04 / One file',
    section1Title: 'One file carries everything.',
    section1Desc: 'One .taco.html is the whole handoff: docs, the reader app and review threads travel together in your repo or as a shared file. Reviewers double-click to read, edit and comment in context; once saved, the next reviewer or agent gets that same context. No install or account for local review.',
    sectionCpEyebrow: '03 / DOCUMENT PROGRESS',
    sectionCpTitle: 'Checkpoints: Document Status & Dependencies',
    sectionCpDesc: 'Define document dependencies for a project and see each stage’s progress and suggested next steps. Status travels with the Taco file so people and agents can coordinate; it does not lock content or block out-of-order edits.',
    sectionCpPoints: [
      ['DAG Stages', 'Define serial and parallel dependencies from spec to tasks with fan-in'],
      ['4-State Lifecycle', 'Track documents through todo, in_progress, complete, and freeze'],
      ['Suggested Next Steps', 'Derive a frontier from marked predecessors for people and agents to consider'],
      ['No Content Lock', 'State lives in the data block without hash checks or enforced gates'],
    ],
    sectionCpBadge: 'CHECKPOINTS DAG',
    sectionCpDemoTemplate: '008 Host Protocol',
    sectionCpStage1: '01 Specification',
    sectionCpStage2: '02 Architecture & Model',
    sectionCpStage3: '03 API Contract',
    section1FileSize: 'about 719 KB',
    section1Tree: [
      ['App', 'inlined editor, renderers, styling and runtime'],
      ['Files', '4 files: spec, data model, flowchart, OpenAPI'],
      ['Comments', 'cross-file review threads and status'],
      ['Navigation', 'categories and entry manifest'],
    ],
    section1Online: 'OPTIONAL DEPENDENCIES',
    section1OnlineItems: ['Mermaid renderer — loaded from jsDelivr when a diagram opens; offline shows the source', 'Live collaboration relay — optional'],
    section2Eyebrow: '02 / Review handoff',
    section2Title: 'Review right in the doc. Your agent takes it from there.',
    section2Lead: 'In Taco you can:',
    section2Points: [
      'Select text to comment — the discussion stays next to the source',
      'Edit in place: WYSIWYG Markdown, live-previewed YAML and Mermaid',
      'Reply to and resolve threads',
      'Hit Handoff to pack every edit and comment into one message for your agent',
    ],
    section2Tip: 'Try Handoff at the window’s top right — the agent on the left replays.',
    section3Eyebrow: '05 / SPEC KIT INTEGRATION',
    section3Title: 'Built-in GitHub Spec Kit Integration',
    section3DescBefore: 'Full integration ready out of the box. Installing the Taco extension equips ',
    section3DescAfter: ' with automatic single-file container refreshes across all lifecycle hooks.',
    section3Cmd: 'specify extension add taco --from https://github.com/Arcadia822/taco/releases/latest/download/taco-extension.zip',
    section4Eyebrow: '06 / TACOBIN SPACE',
    section4Title: 'Tacobin: Collaborative Relay for Teams & Agents',
    section4Desc:
      'While single-file Tacos excel at self-contained local governance, Tacobin provides cloud sharing, web reviews, and live event streaming back to your terminal agent via taco-cli.',
    section4CliTitle: 'CLI',
    section4CliCmd: 'npm install -g @tacobin/cli',
    section4AgentTitle: 'FOR AGENT',
    section4AgentPrompt:
      'Read https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md and install taco-cli, then run taco-cli skills read taco for its publishing and review guide. Publish the current Taco to Tacobin; use the returned tacoId with subscribe to stream review events.',
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
    traceEvent: 'A review comment lands in the agent terminal',
    traceComment: 'Please cover the failure path',
    agent: {
      title: 'agent · ~/taco',
      defaultHandoff: [
        'I have completed modifications and comments in the Taco review page. Please sync the following changes:',
        '- Document title: "008-taco-host-contract"',
        '',
        '## Comments',
        '- [specs/008-taco-host-contract/spec.md:5] Quote: "anonymous publishing works and the minimal flow has no login"',
        '  - **arcadia**: How long does the ApiKey issued for anonymous publishing last, and how is it reclaimed? Please add the fields to data-model.mmd.',
        '- [specs/008-taco-host-contract/data-model.mmd:32] Quote: "string kind "comment | confirm | feedback-done""',
        '  - **lin**: The spec says confirmations and feedback-done are review data, not body comments. Should confirm / feedback-done really share one kind with comment?',
        '- [specs/008-taco-host-contract/flows/anonymous-publish.mmd:5] Quote: "D["Store the key safely first"]"',
        '  - **arcadia**: Missing failure branch: if the key is not persisted, never upload content — fail and exit.',
        '- [specs/008-taco-host-contract/contracts/openapi.yaml:71] Quote: "description: Idempotency key conflict"',
        '  - **lin**: The 409 body should return the existing tacoId and revisionId so the CLI can recover with the idempotency key.',
      ].join('\n'),
      firstHit: '[open] spec.md:5:106 > anonymous publishing works and the minimal flow has no login',
      moreHits: '… +3 more: data-model.mmd, anonymous-publish.mmd, openapi.yaml',
      diffLine: 'datetime expiresAt "90 days by default, extended on each successful auth"',
      checkpointHit: 'Node architecture aggregated to complete, awaiting test & API contracts',
      pasted: (lines: number) => `[Pasted text · ${lines} lines]`,
      summary: 'Added expiresAt and lastUsedAt to ApiKey and reclaimAt to anonymous Users in data-model.mmd and resolved that thread. The other 3 are design calls — they are yours.',
      replay: 'Replay',
    },
    demoViewerTitle: 'Taco demo: 008-taco-host-contract',
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
                width: 'max-content',
                maxWidth: '80vw',
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
              <button type="button" disabled className="cta-btn cta-btn--ghost" title={t.comingSoon}>
                {t.downloadBtn}
                <span aria-hidden="true">↓</span>
              </button>
            </div>

            {/* 给 Agent 的单行安装 Prompt 与 Skill 安装行 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div className="agent-prompt">
                <span className="agent-prompt__label">{t.forAgent}</span>
                <code className="agent-prompt__text">{t.agentPrompt}</code>
                <CopyIconButton text={t.agentPrompt} labels={t} />
              </div>

              <div className="agent-prompt">
                <span className="agent-prompt__label">{t.forSkill}</span>
                <code className="agent-prompt__text">{t.skillCmd}</code>
                <CopyIconButton text={t.skillCmd} labels={t} />
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
                    ? `/demo/${locale}/after/${DEMO_TACO}?embed&theme=dark&lang=${locale}#${encodeURIComponent(DEMO_EDITED_FILE)}`
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
            tacoFile={DEMO_TACO}
            labels={t.agent}
            onDone={() => setAgentDone(true)}
            onReplay={() => {
              setAgentRun(null)
              setAgentDone(false)
            }}
          />
        </div>
      </section>

      {/* ================= PAGE 2: 特性 02 - CHECKPOINTS 阶段门禁 ================= */}
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
                {/* 节点 1: 规范定义 (Freeze) */}
                <div className="cp-node cp-node--freeze">
                  <div className="cp-node__header">
                    <span className="cp-node__dot" aria-hidden="true" />
                    <span className="cp-node__title">{t.sectionCpStage1}</span>
                    <span className="cp-node__status">freeze</span>
                  </div>
                  <div className="cp-node__docs">
                    <div className="cp-doc-item">
                      <span className="cp-doc-item__icon cp-doc-item__icon--freeze" />
                      <span className="cp-doc-item__path">spec.md</span>
                    </div>
                  </div>
                </div>

                <div className="cp-edge-down" aria-hidden="true">
                  <span className="cp-edge-line" />
                </div>

                {/* 节点 2: 架构与模型 (Complete / Frontier) */}
                <div className="cp-node cp-node--complete is-frontier">
                  <div className="cp-node__header">
                    <span className="cp-node__dot" aria-hidden="true" />
                    <span className="cp-node__title">{t.sectionCpStage2}</span>
                    <span className="cp-node__status">complete</span>
                    <span className="cp-node__frontier-tag">FRONTIER</span>
                  </div>
                  <div className="cp-node__docs">
                    <div className="cp-doc-item">
                      <span className="cp-doc-item__icon cp-doc-item__icon--complete" />
                      <span className="cp-doc-item__path">data-model.mmd</span>
                    </div>
                    <div className="cp-doc-item">
                      <span className="cp-doc-item__icon cp-doc-item__icon--complete" />
                      <span className="cp-doc-item__path">flows/anonymous-publish.mmd</span>
                    </div>
                  </div>
                </div>

                <div className="cp-edge-down" aria-hidden="true">
                  <span className="cp-edge-line cp-edge-line--dashed" />
                </div>

                {/* 节点 3: 接口契约 (Todo) */}
                <div className="cp-node cp-node--todo">
                  <div className="cp-node__header">
                    <span className="cp-node__dot" aria-hidden="true" />
                    <span className="cp-node__title">{t.sectionCpStage3}</span>
                    <span className="cp-node__status">todo</span>
                  </div>
                  <div className="cp-node__docs">
                    <div className="cp-doc-item">
                      <span className="cp-doc-item__icon cp-doc-item__icon--todo" />
                      <span className="cp-doc-item__path">contracts/openapi.yaml</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= PAGE 3: 特性 01 - 真正单文件自洽 ================= */}
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
                {t.section1Tree.map(([key, value], index) => (
                  <div key={key} className="bundle-card__row">
                    <span className="bundle-card__branch">{index === t.section1Tree.length - 1 ? '└──' : '├──'}</span>
                    <span className="bundle-card__key">{key}</span>
                    <span className="bundle-card__value">{value}</span>
                  </div>
                ))}
              </div>

              <div className="bundle-card__online">
                <div className="bundle-card__online-title">{t.section1Online}</div>
                {t.section1OnlineItems.map((item) => <div key={item}>· {item}</div>)}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= PAGE 3: 特性 03 - 原生 SPEC KIT 路由 ================= */}
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

      {/* ================= PAGE 4: 05 / TACOBIN 介绍与接入 ================= */}
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
            {/* 说明、Agent 指引与 CLI 安装命令 */}
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

              {/* Agent 指引在前，CLI 命令在后 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="agent-prompt" style={{ width: '100%', maxWidth: '100%' }}>
                  <span className="agent-prompt__label">{t.section4AgentTitle}</span>
                  <code className="agent-prompt__text">{t.section4AgentPrompt}</code>
                  <CopyIconButton text={t.section4AgentPrompt} labels={t} />
                </div>
                <div className="agent-prompt" style={{ width: '100%', maxWidth: '100%' }}>
                  <span className="agent-prompt__label">{t.section4CliTitle}</span>
                  <code className="agent-prompt__text">{t.section4CliCmd}</code>
                  <CopyIconButton text={t.section4CliCmd} labels={t} />
                </div>
              </div>

            </div>

            {/* 示例终端：Agent 发起发布与订阅，Shell 输出 URL 和评审事件 */}
            <div className="workflow-terminal">
              <div className="workflow-terminal__bar">
                <span className="browser-window__dots" aria-hidden="true">
                  <span style={{ background: '#ef4444' }} />
                  <span style={{ background: '#eab308' }} />
                  <span style={{ background: '#22c55e' }} />
                </span>
              </div>
              <div className="workflow-terminal__body">
                <div className="workflow-terminal__env"><span>$</span><code>export TACO_HOST_URL={TRACE_HOST}</code></div>
                <div className="workflow-terminal__step">
                  <div className="workflow-terminal__agent"><span>AGENT / 01</span>{t.tracePublish}</div>
                  <div className="workflow-terminal__command"><span>$</span><code>taco-cli publish design.taco.html</code></div>
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
                  <div className="workflow-terminal__log"><span>event</span><code>{JSON.stringify({ kind: 'event', type: 'comment.created', data: { body: t.traceComment } })}</code></div>
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
