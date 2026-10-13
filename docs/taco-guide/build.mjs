// Builds the new-user documentation Tacos (TACO-11 / TACO-38) from docs/taco-guide/<locale>/taco.
// Each build writes the baseline guide to tmp/taco-guide/<title>.taco.html (preview and GitHub
// Release download) and packages/host/public/demo/<locale>/taco-guide.taco.html (Try Taco and
// homepage review demo before state), plus the post-handoff demo state to
// packages/host/public/demo/<locale>/after/taco-guide.taco.html.
// Usage: node docs/taco-guide/build.mjs
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'

const here = import.meta.dirname
const repo = resolve(here, '../..')
const pack = resolve(repo, 'skills/taco/scripts/pack.mjs')
const DATA = /(<script\b(?=[^>]*\bid=["']taco-document["'])[^>]*>)([\s\S]*?)(<\/script>)/i

const T = (day, hour = 8) => `2026-10-0${day}T0${hour}:00:00.000Z`

const LOCALES = {
  'zh-Hans': {
    docId: 'taco-guide-zh-hans',
    title: 'Taco 文档',
    template: 'Taco 文档站',
    entry: '概览.md',
    stages: {
      overview: ['概览', ['概览.md']],
      start: ['开始', ['开始/快速开始.md', '开始/常见问题.md']],
      features: ['功能', ['功能/Taco.md', '功能/Taco-Skill.md', '功能/Tacobin.md']],
      architecture: ['架构', ['架构/技术架构.md', '架构/系统组件.mmd', '架构/Tacobin-API.yaml']],
      roadmap: ['路线图', ['路线图.md', '路线图/下一阶段.md']],
    },
    todo: ['架构/Tacobin-API.yaml', '路线图/下一阶段.md'],
    inProgress: ['路线图.md'],
    frozen: ['概览.md'],
    instructions: {
      '概览.md': '一屏讲清定位、三个特点与三个组成部分；不要求读者操作也能读懂。',
      '开始/快速开始.md': '不超过 5 步，从安装到第一次交接。',
      '功能/Taco.md': '只写已实现的能力；每项能力指明本站中可以看到的示例文件。',
      '功能/Tacobin.md': '讲清 taco-cli 与 Tacobin 的分工；强调评论与自动保存不等于交接。',
      '架构/Tacobin-API.yaml': '与服务端实现逐条核对后补全请求与响应 schema；未实现的接口不得写入。',
      '路线图/下一阶段.md': '列出下一阶段的议题；每个议题写清要解决的问题、依赖哪些已有能力，并标注哪些需要人来决策。不写已完成的内容。',
    },
    comments: [
      ['概览.md', 'Taco 把一个议题的整组文档打包成一个可以直接在浏览器里打开的文件。', 'open', [
        ['arcadia', '这里补一段默认使用边界吧：说明只有多文件复杂设计且需要人评审拍板，或用户主动要求时才打包 Taco；日常探索聊天和简单修改直接在对话与代码里完成。', 3, 1]]],
      ['功能/Taco.md', 'Lite 的 CDN 不可用时，Markdown 仍可按源码编辑。', 'open', [
        ['mo', 'Lite 和 Complete 默认推荐哪个？表格里看不出结论。', 2, 1],
        ['arcadia', '放进仓库、联网评审用 Lite；要发给可能离线的人用 Complete。已经写进常见问题，你看这样清楚吗？', 2, 2]]],
      ['功能/Tacobin.md', '评论和自动保存都不等于交接，不会唤醒 Agent。', 'open', [
        ['lin', '评审者写完评论就关页面的情况会很多。自动保存成功后，是否应该在页面上提示「尚未交接」？', 3, 2],
        ['arcadia', '同意这是风险。先记下来，等第二轮审阅体验一起设计提示方式。', 3, 3]]],
      ['路线图.md', '全局讨论列表', 'open', [
        ['mo', '全局讨论里能不能新建不挂在任何文档上的议题？比如整体架构方向这种讨论。', 3, 4]]],
    ],
    afterEdit: {
      path: '概览.md',
      anchor: 'Agent 改回仓库里的源文件，再刷新同一个 Taco，评论线程和文档身份都保留。',
      addition: '默认情况下，仅在多文件复杂设计需要人评审拍板，或你主动要求时，Agent 才会打包 Taco；探索性聊天与简单修复直接在对话和代码中完成，不会仅因单篇内容较长就生成 Taco。',
      reply: ['agent', '已在该段下方补上默认使用边界说明，并刷新当前 Taco。评论保留打开，待你确认。', 3, 5],
    },
  },
  en: {
    docId: 'taco-guide-en',
    title: 'Taco Docs',
    template: 'Taco documentation site',
    entry: 'Overview.md',
    stages: {
      overview: ['Overview', ['Overview.md']],
      start: ['Start', ['Start/Quickstart.md', 'Start/FAQ.md']],
      features: ['Features', ['Features/Taco.md', 'Features/Taco-Skill.md', 'Features/Tacobin.md']],
      architecture: ['Architecture', ['Architecture/Architecture.md', 'Architecture/System.mmd', 'Architecture/Tacobin-API.yaml']],
      roadmap: ['Roadmap', ['Roadmap.md', 'Roadmap/Next-Phase.md']],
    },
    todo: ['Architecture/Tacobin-API.yaml', 'Roadmap/Next-Phase.md'],
    inProgress: ['Roadmap.md'],
    frozen: ['Overview.md'],
    instructions: {
      'Overview.md': 'Explain the positioning, three differentiators, and three parts on one screen; readable without any interaction.',
      'Start/Quickstart.md': 'At most 5 steps from installation to the first handoff.',
      'Features/Taco.md': 'Describe implemented capabilities only; for each, point to an example file on this site.',
      'Features/Tacobin.md': 'Explain how taco-cli and Tacobin divide the work; stress that comments and autosave are not a handoff.',
      'Architecture/Tacobin-API.yaml': 'Complete request and response schemas after checking each endpoint against the server; never add endpoints that do not exist.',
      'Roadmap/Next-Phase.md': 'List next-phase topics; for each, state the problem, the existing capabilities it depends on, and whether it needs a human decision. Leave out finished work.',
    },
    comments: [
      ['Overview.md', 'Taco packs every document for one topic into a file you open directly in a browser.', 'open', [
        ['arcadia', 'Let’s add a short paragraph right after this on when Taco is used by default: only when a multi-file complex design needs human review, or when the user asks for one — exploratory chat and simple fixes stay in the chat and repo.', 3, 1]]],
      ['Features/Taco.md', 'If Lite\'s CDN is unavailable, Markdown can still be edited as source.', 'open', [
        ['mo', 'Which one do we recommend by default, Lite or Complete? The table doesn\'t say.', 2, 1],
        ['arcadia', 'Lite for committing to a repository and online review; Complete for recipients who may be offline. Added to the FAQ — does that look clear to you?', 2, 2]]],
      ['Features/Tacobin.md', 'Comments and autosave are not a handoff, and they do not wake the agent.', 'open', [
        ['lin', 'Plenty of reviewers will comment and just close the tab. After autosave succeeds, should the page say "not handed off yet"?', 3, 2],
        ['arcadia', 'Agreed, that\'s a real risk. Logging it for now; we\'ll design the prompt together with the second review round.', 3, 3]]],
      ['Roadmap.md', 'Global discussions list', 'open', [
        ['mo', 'Can the global discussions list hold topics that aren\'t attached to any document, like overall architecture direction?', 3, 4]]],
    ],
    afterEdit: {
      path: 'Overview.md',
      anchor: 'The agent updates the source files in the repository and refreshes the same Taco, keeping the comment threads and the document identity.',
      addition: 'By default, your agent packs a Taco only when a multi-file complex design needs human review, or when you explicitly ask for one; exploratory chat and simple fixes stay in the conversation and repository, never triggered by length alone.',
      reply: ['agent', 'Added the default scope paragraph right below and refreshed this Taco. Leaving the thread open for you to confirm.', 3, 5],
    },
  },
}

const ORDER = ['overview', 'start', 'features', 'architecture', 'roadmap']
const AFTER = { overview: [], start: ['overview'], features: ['start'], architecture: ['start'], roadmap: ['features', 'architecture'] }
const full = (p) => `taco/${p}`

function buildComments(bundle, commentSpecs, locale) {
  const content = (p) => {
    const file = bundle.files.find((f) => f.path === full(p))
    if (!file) throw new Error(`${locale} missing file for comment: ${p}`)
    return file.content
  }
  return commentSpecs.map(([path, exact, status, messages], index) => {
    const text = content(path)
    const start = text.indexOf(exact)
    if (start < 0 || text.indexOf(exact, start + 1) >= 0) {
      throw new Error(`${locale} anchor not unique: ${path}: ${exact}`)
    }
    const msgs = messages.map(([author, body, d, h], mi) => ({
      id: `message-${index + 1}-${mi + 1}`,
      author,
      authorId: `demo-${author}`,
      body,
      createdAt: T(d, h),
    }))
    return {
      id: `thread-${index + 1}`,
      anchor: {
        path: full(path),
        position: { start, end: start + exact.length },
        quote: {
          exact,
          prefix: text.slice(Math.max(0, start - 32), start),
          suffix: text.slice(start + exact.length, start + exact.length + 32),
        },
      },
      status,
      messages: msgs,
      createdAt: msgs[0].createdAt,
      updatedAt: msgs.at(-1).createdAt,
    }
  })
}

function embedBundle(shellHtml, bundle) {
  const json = JSON.stringify(bundle, null, 2).replaceAll('<', '\\u003c')
  JSON.parse(json)
  return shellHtml.replace(DATA, (_m, open, _body, close) => `${open}${json}${close}`)
}

function writeAtomic(targetPath, content) {
  const tmpPath = `${targetPath}.tmp`
  writeFileSync(tmpPath, content, 'utf8')
  renameSync(tmpPath, targetPath)
}

for (const [locale, cfg] of Object.entries(LOCALES)) {
  const dir = resolve(here, locale, 'taco')
  const outDir = resolve(repo, 'tmp/taco-guide')
  mkdirSync(outDir, { recursive: true })
  const out = resolve(outDir, `${cfg.title.replaceAll(' ', '_')}.taco.html`)
  rmSync(out, { force: true })
  execFileSync('node', [pack, '--dir', dir, '--out', out, '--title', cfg.title, '--root', 'taco', '--entry', cfg.entry], { stdio: 'pipe' })

  const packedHtml = readFileSync(out, 'utf8')
  const bundle = JSON.parse(packedHtml.match(DATA)[2].replaceAll('<\\/', '</').replaceAll('<\\!--', '<!--'))
  bundle.docId = cfg.docId
  const day = (p) => (p.startsWith(cfg.stages.architecture[1][0].split('/')[0]) || cfg.stages.roadmap[1].includes(p) ? 3 : 2)

  // Checkpoint node ids are prefixed so nodes in the same layout level sort into reading order.
  const nodes = ORDER.map((key, index) => ({
    id: `${index + 1}-${key}`,
    title: cfg.stages[key][0],
    after: AFTER[key].map((dep) => `${ORDER.indexOf(dep) + 1}-${dep}`),
    documents: cfg.stages[key][1].map((p) => (cfg.instructions[p] ? { path: full(p), instruction: cfg.instructions[p] } : { path: full(p) })),
  }))
  const documents = ORDER.flatMap((key) => cfg.stages[key][1])
    .filter((p) => !cfg.todo.includes(p))
    .map((p) => ({
      path: full(p),
      status: cfg.frozen.includes(p) ? 'freeze' : cfg.inProgress.includes(p) ? 'in_progress' : 'complete',
      updatedAt: T(day(p)),
    }))
  bundle.checkpoints = { version: 1, template: cfg.template, nodes, documents }
  bundle.navigation = { version: 1, entry: full(cfg.entry), groups: [] }
  bundle.comments = buildComments(bundle, cfg.comments, `${locale}:before`)

  const beforeHtml = embedBundle(packedHtml, bundle)
  writeAtomic(out, beforeHtml)
  const demoDir = resolve(repo, 'packages/host/public/demo', locale)
  mkdirSync(demoDir, { recursive: true })
  const beforeDemoPath = resolve(demoDir, 'taco-guide.taco.html')
  writeAtomic(beforeDemoPath, beforeHtml)

  // Derive the post-handoff ("after") bundle from the same identity and baseline.
  const afterBundle = structuredClone(bundle)
  const editedPath = full(cfg.afterEdit.path)
  const targetFile = afterBundle.files.find((f) => f.path === editedPath)
  if (!targetFile) throw new Error(`${locale}: missing afterEdit target ${editedPath}`)
  const anchorIndex = targetFile.content.indexOf(cfg.afterEdit.anchor)
  if (anchorIndex < 0 || targetFile.content.indexOf(cfg.afterEdit.anchor, anchorIndex + 1) >= 0) {
    throw new Error(`${locale}: afterEdit anchor not unique in ${editedPath}`)
  }
  targetFile.content = targetFile.content.replace(
    cfg.afterEdit.anchor,
    `${cfg.afterEdit.anchor}\n\n${cfg.afterEdit.addition}`,
  )
  targetFile.sourceHash = createHash('sha256').update(targetFile.content, 'utf8').digest('hex')
  delete targetFile.blocks

  const afterCommentSpecs = cfg.comments.map(([path, exact, status, messages], idx) =>
    idx === 0 ? [path, exact, status, [...messages, cfg.afterEdit.reply]] : [path, exact, status, messages],
  )
  afterBundle.comments = buildComments(afterBundle, afterCommentSpecs, `${locale}:after`)

  const afterDemoDir = resolve(demoDir, 'after')
  mkdirSync(afterDemoDir, { recursive: true })
  const afterDemoPath = resolve(afterDemoDir, 'taco-guide.taco.html')
  const afterHtml = embedBundle(packedHtml, afterBundle)
  writeAtomic(afterDemoPath, afterHtml)

  process.stdout.write(
    `${locale}: ${out} + ${beforeDemoPath} (${beforeHtml.length} chars) + ${afterDemoPath} (${afterHtml.length} chars)\n`,
  )
}
