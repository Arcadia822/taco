// Builds the new-user documentation Tacos (TACO-11) from docs/taco-guide/<locale>/taco
// into tmp/taco-guide/Taco_文档.taco.html and tmp/taco-guide/Taco_Docs.taco.html.
// Tacobin hosts them with its own shell; these local builds are for preview.
// Usage: node docs/taco-guide/build.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'

const here = import.meta.dirname
const repo = resolve(here, '../..')
const pack = resolve(repo, 'skills/taco/scripts/pack.mjs')
const DATA = /(<script\b(?=[^>]*\bid=["']taco-document["'])[^>]*>)([\s\S]*?)(<\/script>)/i

const T = (day, hour = 8) => `2026-10-0${day}T0${hour}:00:00.000Z`

const LOCALES = {
  'zh-Hans': {
    title: 'Taco 文档',
    template: 'Taco 文档站',
    entry: '概览.md',
    stages: {
      overview: ['概览', ['概览.md']],
      start: ['开始', ['开始/01-快速开始.md', '开始/02-常见问题.md']],
      features: ['功能', ['功能/01-Taco.md', '功能/02-Taco-Skill.md', '功能/03-Tacobin.md']],
      guides: ['指南', ['指南/01-本地评审.md', '指南/02-在线评审.md', '指南/03-检查点.md']],
      architecture: ['架构', ['架构/01-技术架构.md', '架构/02-系统组件.mmd', '架构/03-评审往返.mmd', '架构/04-数据模型.mmd', '架构/05-数据块示例.json', '架构/06-Tacobin-API.yaml', '架构/07-安全.md']],
      roadmap: ['路线图', ['路线图.md', '路线图/下一阶段.md']],
    },
    todo: ['架构/06-Tacobin-API.yaml', '路线图/下一阶段.md'],
    inProgress: ['路线图.md'],
    frozen: ['概览.md'],
    instructions: {
      '概览.md': '一屏讲清定位、三个特点与三个组成部分；不要求读者操作也能读懂。',
      '开始/01-快速开始.md': '不超过 5 步，从安装到第一次交接；细节链接到指南。',
      '功能/01-Taco.md': '只写已实现的能力；每项能力指明本站中可以看到的示例文件。',
      '功能/03-Tacobin.md': '讲清 taco-cli 与 Tacobin 的分工；强调评论与自动保存不等于交接。',
      '架构/06-Tacobin-API.yaml': '与服务端实现逐条核对后补全请求与响应 schema；未实现的接口不得写入。',
      '路线图/下一阶段.md': '列出下一阶段的议题；每个议题写清要解决的问题、依赖哪些已有能力，并标注哪些需要人来决策。不写已完成的内容。',
    },
    comments: [
      ['概览.md', '它没有服务端、没有数据库', 'resolved', [
        ['lin', '为什么不直接做成 SaaS？团队评审放在网页上不是更方便吗？', 1, 1],
        ['arcadia', '文档要跟代码在同一个仓库、同一段历史里，Agent 也要能直接读写。单文件是底座；需要在线评审时再用 Tacobin，两者不冲突。', 1, 2],
        ['lin', '明白了，那这里保留现在的说法。', 1, 3]]],
      ['功能/01-Taco.md', 'Lite 的 CDN 不可用时，Markdown 仍可按源码编辑。', 'resolved', [
        ['mo', 'Lite 和 Complete 默认推荐哪个？表格里看不出结论。', 2, 1],
        ['arcadia', '放进仓库、联网评审用 Lite；要发给可能离线的人用 Complete。已经写进指南的常见问题。', 2, 2]]],
      ['架构/02-系统组件.mmd', 'BIN["Tacobin<br/>taco-host/1"]', 'resolved', [
        ['mo', 'Tacobin 会长期保存正文吗？要不要在图上标出来？', 2, 3],
        ['arcadia', '发布时保存一份不可变基线，仓库仍是事实来源。这一点写在 Tacobin 页的「边界」里，图上不再加。', 2, 4]]],
      ['指南/02-在线评审.md', '评论和自动保存都不是交接。', 'open', [
        ['lin', '评审者写完评论就关页面的情况会很多。自动保存成功后，是否应该在页面上提示「尚未交接」？', 3, 1],
        ['arcadia', '同意这是风险。先记下来，等第二轮审阅体验一起设计提示方式。', 3, 2]]],
      ['路线图.md', '全局讨论列表', 'open', [
        ['mo', '全局讨论里能不能新建不挂在任何文档上的议题？比如整体架构方向这种讨论。', 3, 3]]],
    ],
  },
  en: {
    title: 'Taco Docs',
    template: 'Taco documentation site',
    entry: 'Overview.md',
    stages: {
      overview: ['Overview', ['Overview.md']],
      start: ['Start', ['Start/01-Quickstart.md', 'Start/02-FAQ.md']],
      features: ['Features', ['Features/01-Taco.md', 'Features/02-Taco-Skill.md', 'Features/03-Tacobin.md']],
      guides: ['Guides', ['Guides/01-Local-Review.md', 'Guides/02-Online-Review.md', 'Guides/03-Checkpoints.md']],
      architecture: ['Architecture', ['Architecture/01-Architecture.md', 'Architecture/02-System.mmd', 'Architecture/03-Review-Loop.mmd', 'Architecture/04-Data-Model.mmd', 'Architecture/05-Bundle-Example.json', 'Architecture/06-Tacobin-API.yaml', 'Architecture/07-Security.md']],
      roadmap: ['Roadmap', ['Roadmap.md', 'Roadmap/Next-Phase.md']],
    },
    todo: ['Architecture/06-Tacobin-API.yaml', 'Roadmap/Next-Phase.md'],
    inProgress: ['Roadmap.md'],
    frozen: ['Overview.md'],
    instructions: {
      'Overview.md': 'Explain the positioning, three differentiators, and three parts on one screen; readable without any interaction.',
      'Start/01-Quickstart.md': 'At most 5 steps from installation to the first handoff; link details to the guides.',
      'Features/01-Taco.md': 'Describe implemented capabilities only; for each, point to an example file on this site.',
      'Features/03-Tacobin.md': 'Explain how taco-cli and Tacobin divide the work; stress that comments and autosave are not a handoff.',
      'Architecture/06-Tacobin-API.yaml': 'Complete request and response schemas after checking each endpoint against the server; never add endpoints that do not exist.',
      'Roadmap/Next-Phase.md': 'List next-phase topics; for each, state the problem, the existing capabilities it depends on, and whether it needs a human decision. Leave out finished work.',
    },
    comments: [
      ['Overview.md', 'There is no server and no database', 'resolved', [
        ['lin', 'Why not just build a SaaS? Wouldn\'t team review be easier on a website?', 1, 1],
        ['arcadia', 'Docs need to live in the same repository and history as the code, and agents need to read and write them directly. The single file is the foundation; Tacobin adds online review when you need it. The two don\'t compete.', 1, 2],
        ['lin', 'Makes sense, let\'s keep the wording as is.', 1, 3]]],
      ['Features/01-Taco.md', 'If Lite\'s CDN is unavailable, Markdown can still be edited as source.', 'resolved', [
        ['mo', 'Which one do we recommend by default, Lite or Complete? The table doesn\'t say.', 2, 1],
        ['arcadia', 'Lite for committing to a repository and online review; Complete for recipients who may be offline. It\'s now in the guide\'s common questions.', 2, 2]]],
      ['Architecture/02-System.mmd', 'BIN["Tacobin<br/>taco-host/1"]', 'resolved', [
        ['mo', 'Does Tacobin keep the content long term? Should the diagram say so?', 2, 3],
        ['arcadia', 'Publishing stores an immutable baseline, and the repository stays the source of truth. That\'s under Limits on the Tacobin page, so the diagram stays as is.', 2, 4]]],
      ['Guides/02-Online-Review.md', 'Comments and autosave are not a handoff.', 'open', [
        ['lin', 'Plenty of reviewers will comment and just close the tab. After autosave succeeds, should the page say "not handed off yet"?', 3, 1],
        ['arcadia', 'Agreed, that\'s a real risk. Logging it for now; we\'ll design the prompt together with the second review round.', 3, 2]]],
      ['Roadmap.md', 'Global discussions list', 'open', [
        ['mo', 'Can the global discussions list hold topics that aren\'t attached to any document, like overall architecture direction?', 3, 3]]],
    ],
  },
}

const ORDER = ['overview', 'start', 'features', 'guides', 'architecture', 'roadmap']
const AFTER = { overview: [], start: ['overview'], features: ['start'], guides: ['start'], architecture: ['start'], roadmap: ['features', 'guides', 'architecture'] }

for (const [locale, cfg] of Object.entries(LOCALES)) {
  const dir = resolve(here, locale, 'taco')
  const outDir = resolve(repo, 'tmp/taco-guide')
  mkdirSync(outDir, { recursive: true })
  const out = resolve(outDir, `${cfg.title.replaceAll(' ', '_')}.taco.html`)
  rmSync(out, { force: true })
  execFileSync('node', [pack, '--dir', dir, '--out', out, '--title', cfg.title, '--root', 'taco', '--entry', cfg.entry], { stdio: 'pipe' })

  let html = readFileSync(out, 'utf8')
  const bundle = JSON.parse(html.match(DATA)[2].replaceAll('<\\/', '</').replaceAll('<\\!--', '<!--'))
  const full = (p) => `taco/${p}`
  const day = (p) => (p.startsWith(cfg.stages.guides[1][0].split('/')[0]) || p.startsWith(cfg.stages.architecture[1][0].split('/')[0]) || cfg.stages.roadmap[1].includes(p) ? 3 : 2)

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

  const content = (p) => bundle.files.find((f) => f.path === full(p)).content
  let n = 0
  bundle.comments = cfg.comments.map(([path, exact, status, messages], index) => {
    const text = content(path)
    const start = text.indexOf(exact)
    if (start < 0 || text.indexOf(exact, start + 1) >= 0) throw new Error(`${locale} anchor not unique: ${path}: ${exact}`)
    const msgs = messages.map(([author, body, d, h]) => ({ id: `message-${++n}`, author, authorId: `demo-${author}`, body, createdAt: T(d, h) }))
    return {
      id: `thread-${index + 1}`,
      anchor: {
        path: full(path),
        position: { start, end: start + exact.length },
        quote: { exact, prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(start + exact.length, start + exact.length + 32) },
      },
      status,
      messages: msgs,
      createdAt: msgs[0].createdAt,
      updatedAt: msgs.at(-1).createdAt,
    }
  })

  const json = JSON.stringify(bundle, null, 2).replaceAll('</', '<\\/').replaceAll('<!--', '<\\!--')
  html = html.replace(DATA, (_m, open, _body, close) => `${open}${json}${close}`)
  writeFileSync(`${out}.tmp`, html)
  renameSync(`${out}.tmp`, out)
  process.stdout.write(`${locale}: ${out} (${html.length} chars)\n`)
}
