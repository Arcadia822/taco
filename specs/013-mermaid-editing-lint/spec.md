---
title: '013-mermaid-editing-lint'
feature_id: '013-mermaid-editing-lint'
created: '2026-09-28'
status: 'Frozen'
issue: 'https://github.com/Arcadia822/taco/issues/51'
linear: 'https://linear.app/castrel/issue/TACO-19'
input: |-
  TACO-19: 优化 Mermaid 编辑交互并提供编写时语法诊断（lint）
---

## 1. 背景与目标

TACO-19（GitHub #51）的标题指向 Mermaid 的编辑交互；但真实痛点经确认是**另一件事**：

> Taco 的 Agent 工作流要求 Agent 编写 Mermaid，而 Agent 侧没有任何 Mermaid 校验；写坏的图由打开浏览器的人第一个发现，人只看到一句通用错误，Agent 则完全不知情。

Taco 的 Agent 侧契约明确要求 Agent 写图：

- `skills/taco/SKILL.md:39`：流程/时序/状态设计写成 `diagrams/*.mmd`；
- `extensions/taco/policies/taco-agent-policy.md:21`：同上；
- `skills/taco/references/bundle-format.md:96`：`.mmd` 的 `mediaType` 为 `text/plain`。

而内容层的校验责任落空：

- bundle 信封校验只保证结构（`format`/`version`/`path`/`mediaType`/`comments` 等），不解析 `.mmd`；
- 落盘路径正在走向「零外部依赖、Agent 直接写 `#taco-document` 数据块」（见同期的 `specs/012-agent-taco-output-path`，TACO-9），因此**不会**有一个必需脚本替 Agent 校验内容；
- 结果：Agent 无法自查，人无法据此行动，问题也无法回流给 Agent。

**本设计的目标**：给 Agent 一个**可靠、离线、与接收方运行时一致**的 Mermaid 语法校验能力，让「写坏图」在交付前被 Agent 自己发现；同时把人侧只做到「可读的诊断」这一最小集。界面是服务人的，不为 Agent 便利重做交互。

非目标：

- 不引入新的必需打包/落盘基础设施（不集成 `pack.mjs`；该脚本已由用户决定移除）；
- 不做编辑器交互改造（预览刷新频率、失败回落源码、缩放状态源等，另开 Issue，见 §7）；
- 不改 bundle 格式、`mediaType` 或 `.mmd` 的存储方式。

## 2. 现状证据

### 2.1 已撤回的错误断言（重要）

初稿称「`classDiagram` 非法成员：`parse()` 通过、`render()` 抛 `TypeError`，证明只做 parse 不足」。**该断言错误，已撤回**：真机浏览器（pinned mermaid 12.0.0 + Taco 自身配置）下该用例 `parse` 与 `render` 均通过；当时的 `TypeError` 来自测试环境缺少 `SVGElement.getBBox` 垫片，不是 mermaid 行为。以它推导的结论一并作废。

### 2.2 直连 `parse` 且不给 DOM 会误报 12/18（根因见 §2.3，可旁路）

在**同一份 pinned mermaid 12.0.0**下做 2×2 受控矩阵（共 22 个输入＝18 个合法图 + 3 个语法无效 + 1 个未知类型）：

| 解析器来源 | DOM | 合法图正确通过 | 漏报（合法图被判无效） | 把非法当合法 |
| --- | --- | --- | --- | --- |
| shell 内嵌载荷 | 无 | 6/18 | **12** | 0 |
| shell 内嵌载荷 | jsdom | **18/18** | 0 | 0 |
| CDN 镜像 | 无 | 6/18 | **12** | 0 |
| CDN 镜像 | jsdom | **18/18** | 0 | 0 |

（上表两行 jsdom 仅为历史对照；最终方案**不需要 DOM**，见 §2.3。）

漏报的具体族：`stateDiagram-v2`（含 `[*] --> A` 与 `A --> B: go`）、`classDiagram`、`gantt`、`journey`、`mindmap`、`timeline`、`quadrantChart`、`sankey-beta`、`kanban`、`C4Context`、`pie`（带 title）。

根因见 §2.3：这些图族在 `parse` 期会走到 `sanitizeText`，而它无条件调用 DOMPurify。**因此「纯 Node 直接 parse」的实现会把 12 个正确文档判为错误**——这比不校验更糟，会成为新的阻塞源。§2.3 给出了零依赖的旁路方案，本节矩阵保留为**为什么不能裸用 parse** 的依据与回归基线。

### 2.3 DOM 依赖的真实来源：`sanitizeText` 里的 DOMPurify

早期结论曾认定「必须提供一个 DOM（jsdom）」。经代码定位，根因只有一处，且**可以旁路**，因此该结论已作废。

定位到的唯一调用点（mermaid 载荷内，行 262 附近）：

```js
vp  = (e) => (e.htmlLabels ?? e.flowchart?.htmlLabels ?? true)              // getEffectiveHtmlLabels
ujn = once(() => hpr())                                                    // 惰性注册 DOMPurify 钩子
fpr = (e) => (ujn(), My.sanitize(e))                                       // removeScript
Qdr = (e, r) => { if (vp(r)) { const i = r.securityLevel
  i === 'antiscript' || i === 'strict' || i === 'sandbox' ? e = fpr(e) : i !== 'loose' && (…) } return e }   // sanitizeMore
Ys  = (e, r) => e && (r.dompurifyConfig
  ? e = My.sanitize(Qdr(e, r), r.dompurifyConfig).toString()
  : e = My.sanitize(Qdr(e, r), { FORBID_TAGS: ['style'] }).toString(), e)  // sanitizeText
```

- `Qdr`（`sanitizeMore`）在 `htmlLabels` 为 false 时**不会**调用 `fpr`；`securityLevel` 无关。
- 但 `Ys`（`sanitizeText`）**无条件**调用 `My.sanitize(...)`，与 `securityLevel`、`htmlLabels` 都无关 —— 这就是无 DOM 时 `TypeError: My.addHook is not a function` 的唯一来源。

对照实验（同一份 pinned mermaid，18 个合法图，均无 DOM）：

| 配置 | 载荷 | 合法图正确通过 |
| --- | --- | --- |
| 不调用 `initialize` | 原样 | 6/18 |
| `initialize({ htmlLabels: false, securityLevel: 'strict' })` | 原样 | 6/18 |
| `initialize({ htmlLabels: false })` | **旁路 `sanitizeText` 中的 `My.sanitize` 调用** | **18/18** |

旁路后完整验证（无 DOM、纯 Node，0.36s）：

- 18/18 合法图通过（零误报）；
- 4 个非法输入全部报错，且**行号全部正确**：悬空箭头→第 2 行第 10 列、未闭合方括号→第 2 行第 4 列、sequence 缺冒号→第 2 行第 10 列、gitGraph 非法语句→第 3 行第 3 列；原始 `Parse error on line …` 可读；
- 未知类型 / 空内容 / 纯注释 → `false`（可归 `unknown-type`）。

**差分测试（支持旁路不改变语法判定）**：对 21 个对抗性输入分别在「旁路 + 无 DOM」与「原样 + jsdom」两种环境下执行 `parse`，逐例比较结果（含错误时的行、列、错误名），**16/16 完全一致**。该差分必须作为可复跑用例纳入 §7.1，并在**每次载荷升级（mermaid 版本或打包方式变化）后重跑**——它是旁路安全性的现行边界，不是一次性结论。覆盖：标签内含 `<b>`/`<script>`/`<br>`/`<!-- -->`/`&`/未转义 `<`/`%%`/`---`/HTML 实体、含 HTML 的 mindmap 标签、sequence 消息含 HTML、「标签内含 HTML 且括号损坏」的非法图，以及**直接针对被旁路消毒语义**的 5 例：`A["#br#<br>&lt;"]`、`A["<style>x</style>"]`、`A["#br#"]`（`#br#` 行分割占位符）、`A["<style>--> B</style>"]`（HTML 内含 Mermaid 语法）、`A["<b>--></b>"]`。**21/21 完全一致**，未发现任何使两侧判定分叉的输入。

**旁路的语义边界（必须如实记录）**：跳过的是 DOMPurify 的**标签 HTML 消毒**，**不是解析器的词法/语法分析**。注意措辞：`sanitizeText` 是在 `parse` 进行期间、构造标签值时被调用的（这正是无 DOM 时 `TypeError` 出现在 `parse` 里而非渲染里的原因），因此不能说它「发生在解析之后」。当前证据支持「不改变语法判定」，但**不构成普遍证明**：证据仅为 22 用例基线 + 16 例对抗性差分（见下），且仅在已测的图族与配置上成立。

旁路锚点（`sanitizeText` 内的那段 `My.sanitize` 表达式）在仓库内**所有 Complete shell 副本**中一致存在，实测：`skills/taco/taco-shell.html`、`extensions/taco/assets/taco-shell.html`、`skills/taco/templates/*/empty.taco.html`、`dist-single/Taco_Spec.taco.html`（各 5,343,411 字节载荷，锚点 **true**）。Lite shell 按设计不含内嵌载荷，因此校验器**始终**以 skill 自带的 Complete shell 为解析器来源，与交付物使用哪个 shell 无关。

### 2.4 jsdom 层即足，且与解析器来源无关（历史记录）

在引入旁路之前，jsdom 曾使 18/18 成立（使用 shell 内嵌载荷或 CDN 镜像结果一致）。该路径现已不必要：§2.3 的旁路在**零依赖、无 DOM** 下达到同样结果。

载荷位置与解出方式（`scripts/postbuild-compress.mjs:94` 生成，`src/mermaid-complete.ts` 运行期消费）：

```html
<script id="taco-asset-mermaid" type="taco/deflate-b64">…base64(deflate-raw)…</script>
```

实测：`skills/taco/taco-shell.html` 中该载荷解压后 5,343,555 字节，`import()` 后 `typeof parse === 'function'`。Lite shell 没有该载荷（按设计从 CDN 加载，`src/lite-cdn-loader.ts`）。

### 2.5 render 阶段只能作参考，不能作语法结论

真机 headless Chromium（pinned CDN + Taco 配置）中，**合法的 `mindmap` 源码 render 直接失败**：

```
mindmap → parse OK · render FAIL TypeError: Cannot read properties of null (reading 're')
mindmap（非法源码） → parse OK · render FAIL TypeError: Cannot read properties of null (reading 're')
```

两种输入给出**同一条**无位置信息。jsdom 下 render 对 mindmap 同样假失败。因此 render 判定必须标注为「渲染阶段失败（无位置）」，既不得上升为语法结论，也不得用来否定 `parse` 的通过。

### 2.6 渲染失败在真实浏览器留下未清理的 DOM 残留

同一真机探针记录 `body > div[id^="d"]` 数量随失败单调增长（1 → 2 → 3 → 4），且后续**成功**渲染不会清理历史残留。mermaid 在 `render()` 失败时向 `document.body` 注入 `div#d{id}` 后抛出，Taco 侧从未清理；Taco 的 id 每次自增（`src/mermaid.ts:499`），故编辑期单调累积。

### 2.7 Mermaid 错误族与可用字段（实测）

| 错误族 | 触发示例 | 可用字段 | 注意 |
| --- | --- | --- | --- |
| jison（flowchart / sequence 等） | `flowchart TD` + 悬空箭头 | `hash.line`、`hash.loc{first_line,last_line,first_column,last_column}`、`hash.token`、`hash.expected[]`；`message` 含 `Parse error on line N:` 与指示线 | **字段互相矛盾，只有 `loc.first_line` 可靠**。实测（3 个样本，含 DOM 抛出式 `parse`）：`loc.first_line` **3/3 正确**；`hash.line` 2/3（未闭合方括号给 1，实为 2）；`message` 2/3（悬空箭头说 line 3，实为 2） |
| langium（gitGraph / architecture 等） | `gitGraph` + 非法语句；`architecture-beta` + 非法行 | `result.parserErrors[0].token.{startLine,startColumn,endLine,endColumn,startOffset,endOffset}`；`message` 为 `Parsing failed:  Parse error on line 3, column 3: …` | 实测 2/2 精确（gitGraph 3,3；architecture 3,8）。**注意 `error.name` 实测为 `Error`，不是 `MermaidParseError`**——分类必须按结构（`result.parserErrors[0].token` 是否存在）判定，不能按名字。`result` 极大且自引用，**绝不可整体序列化或写日志** |
| 未识别类型 | 空内容、纯 `%%` 注释、未知图表头 | `name === 'UnknownDiagramError'`，无位置 | 与「语法错误」不是一回事 |

`parse(text, { suppressErrors: true })` 返回 `false`（无效）或 `{ diagramType, config }`（有效），**不抛异常**，也不触碰 DOM——这是 lint 的基元。

### 2.8 人侧现状（最小集要修的部分）

| # | 现象 | 证据 |
| --- | --- | --- |
| H1 | 诊断被压成一个字符串 | `src/mermaid.ts:551-553`、`src/structured-file-viewer.ts:706-708` 都只写 `labels.error`（`src/i18n.ts:128`）；实测 `.mmd` 诊断区内容就是 `["Invalid Mermaid"]` |
| H2 | 运行时不可用停在假进度 | `src/mermaid.ts:511-512` 只写 `dataset.mermaidUnavailable` 后 `return`，不清 `surface is-loading`；实测 `{className:'surface is-loading', text:'Loading'}` |
| H3 | 运行时不可用在 Markdown 块里不可恢复 | `src/tiptap-code-block.ts:495-507` 置 `mermaidUnavailable = true`，`paint()` 只在 `!isMermaid` 分支复位（`:526-533`） |
| H4 | 两入口不一致 | Markdown 未接 `onRenderError`（`src/tiptap-code-block.ts:490-513`）；`.mmd` 有独立诊断区并自动开面板（`src/structured-file-viewer.ts:701-708`） |
| H5 | `#d{id}` 残留 | §2.5 |

## 3. 需求与验收

### 3.1 需求

| 编号 | 需求 | 来源 |
| --- | --- | --- |
| R1 | Agent 能在交付前校验 `.mmd` 与 Markdown 中 Mermaid 代码块的语法 | Issue 期望 1、验收 3 |
| R2 | 校验诊断给出类别、行列（可得时）与底层原始信息 | Issue 期望 1 |
| R3 | 校验**不得**把正确图表判为错误（误报优先于漏报） | §2.2 的代价分析 |
| R4 | 校验离线可用、零新增依赖；Complete 交付物与接收方运行时同字节，Lite 交付物至少同 pinned 版本号 | FR-007a 的离线精神 |
| R5 | 「校验未运行」必须与「校验通过」可区分，绝不静默通过 | 验收 3 |
| R6 | 人侧诊断可读：类别 + 位置 + 原文，取代一句话 | Issue 验收 1、3 |
| R7 | 源码错误与运行时加载失败不互相冒充 | Issue 期望 2、验收 2 |
| R8 | 渲染失败不再累积 DOM 残留 | §2.5 |
| R9 | Markdown 代码块与 `.mmd` 两入口表现一致 | Issue 验收 1 |
| R10 | 有效图表的既有操作（主题/方向/复制/评论/全屏）不回归 | Issue 期望 3 |

### 3.2 验收条件

- **A1** 校验器对 §2.2 矩阵中的 18 个合法图**全部通过**（零误报），对 3 个语法无效输入与 1 个未知类型输入**全部报错**（零误收，其中未知类型的 `kind` 必须是 `unknown-type` 而非 `syntax`）；共 22 个输入作为可复跑回归，任何人可重放。
- **A2** 对一个含 `.mmd` 与 Markdown fence 的目录，校验器输出的位置指向**宿主文件**的真实行号（fence 需换算到 `.md` 的行号），并给出底层 `message`。
- **A3** 校验器在无法取得解析器或 DOM 时，输出明确的不可用原因、退出码区别于「有诊断」，且**不**打印通过。
- **A4** 校验器在无网络环境（断网）下对 Complete shell 场景仍然可用。
- **A5** `.mmd` 与 Markdown fence 中同一段无效源码，在人侧得到**同类**诊断（类别一致、位置一致、原文一致）。
- **A6** 运行时不可用时提示原因（`runtime` 类）且不显示为语法错误；**在编辑或模式切换之后**、无需重载文档即可重新出图（§5.1）。
- **A7** 连续 5 次渲染失败后 `document.body` 中 `div[id^="d"]` 数量不增长。
- **A8** 有效图表的既有操作逐项不回归，且每项都有对应断言或手工条目：
  - **A8-a** 主题切换后重新出图且源码被按既有规则改写；
  - **A8-b** 方向切换后重新出图；
  - **A8-c** 复制按钮复制的是当前源码；
  - **A8-d** 行评论锚点仍指向正确行；
  - **A8-e** 节点评论锚点仍指向正确节点；
  - **A8-f** 双击/按钮进全屏、全屏内缩放与退出后内联状态合理。

## 4. 方案：Agent 侧 Mermaid 校验

### 4.1 形态

新增 `skills/taco/scripts/lint-mermaid.mjs`，与既有 `checkpoints.mjs`、`png.mjs` 同目录同风格（Node ≥ 22）。**它是一次调用即可完成的校验工具，不进入落盘链路**：Agent 在写 `.mmd` 之后、交付之前自行调用，也可以在任何时候重放。

```sh
node scripts/lint-mermaid.mjs <file.mmd|file.md>...
node scripts/lint-mermaid.mjs --dir <dir> [--json] [--shell <shell.html>] [--mermaid <path>]
```

- 输入：`.mmd` 文件、含 ```` ```mermaid ```` 围栏的 `.md` 文件、`--dir` 目录（递归、忽略点目录与 `*.taco.html`）、stdin。
- 扫描范围与 Taco 的能力对齐：`.mmd` 与 `.md` 里的 Mermaid 围栏；忽略其他文件类型。
- 输出（默认人类可读；`--json` 给机器）：每条诊断含

```json
{ "file": "diagrams/flow.mmd", "line": 14, "column": 11,
  "kind": "syntax", "detail": "Parse error on line 14: Expecting 'SQE', got 'SQS'",
  "tier": "parse", "runtime": "shell-embedded@12.0.0" }
```

- 退出码：`0` 全部通过；`1` 存在诊断；`2` **校验未能完整、可信地完成**（载荷缺失、旁路锚点不匹配、输入不可读，或任一单元在 `parse` 阶段抛出非白名单异常）。三者必须可区分（R5）。
- **`2` 优先于 `1`**（审查修正）：多单元输入里可能既有真实语法诊断、又有环境的运行时异常；此时退出码取 `2`，且已收集的诊断仍须保留在 `--json` 输出中，并附显式的「结果不完整」标记（例如顶层 `complete: false` + `runtimeFailures: [...]`），调用方不得把它读成「整份扫描未开始」或「部分通过」。实现禁止在退出码为 `2` 时输出「通过」字样。
- 特例：目录/文件里**一个 Mermaid 单元都没有**时退出码为 `0`，但必须显式打印 `0 Mermaid unit(s) (nothing to validate)`，不得只打印「通过」——「没有可校验对象」与「校验通过」在输出上仍可区分。
- `--dir` 只接受目录；把文件传给 `--dir` 必须报错并提示改用位置参数（实测该误用会以退出码 2 收场，但错误信息应直接指出原因）。

### 4.2 解析器来源：skill 自带 Complete shell 的内嵌载荷写临时文件

按优先级：

1. **默认：skill 自带的 `skills/taco/taco-shell.html`** —— 取出 `#taco-asset-mermaid` 的 base64，`zlib.inflateRawSync` 解压，写入**临时 `.mjs` 文件**，再 `import(pathToFileURL(tmp))`。离线，且解析器始终来自随 skill 一起安装的 Complete shell（与交付物用哪个 shell 无关）。

**保证范围必须分开表述**（审查修正）：

| 交付物 | 保证 |
| --- | --- |
| 用 Complete shell 交付 | 校验器与接收方运行时**同字节**（同一份内嵌载荷） |
| 用 Lite shell 交付 | 仅**同 pinned 版本号**（`PINNED_VERSIONS.mermaid = '12.0.0'`）：Complete 的载荷是本地 esbuild 打包产物，Lite 在运行时从 jsdelivr/esm.sh 取 CDN 构建（`src/lite-cdn-loader.ts:16-35,101-107`、`scripts/postbuild-compress.mjs:82-99`），两者**不保证字节一致** |
| `--shell` / `--mermaid` 覆盖 | 由调用方自担，**不**提供上述任一保证 |

`--mermaid <path>` 会引入版本漂移风险，故仅作最后手段。
2. `--shell <path>`：改用指定的 Complete shell（用于核对其它副本）。
3. `--mermaid <path>`：改用本地安装的 mermaid 包入口（不推荐，会引入版本漂移）。

不用 CDN 抓取作为默认路径：jsdelivr 的 `dist/mermaid.esm.min.mjs` 是**分片**入口，单文件无法离线 `import`（实测需镜像 105 个分片、5.4 MB）。

### 4.2.1 旁路 DOMPurify 调用（零依赖的关键）

加载临时载荷后，必须精确替换 `sanitizeText` 内那段 `My.sanitize` 调用，使标签文本不再经由 DOMPurify：

```js
// 原（无 DOM 时会抛 TypeError: My.addHook is not a function）
Ys = (e, r) => e && (r.dompurifyConfig
  ? e = My.sanitize(Qdr(e, r), r.dompurifyConfig).toString()
  : e = My.sanitize(Qdr(e, r), { FORBID_TAGS: ['style'] }).toString(), e)
// 替换为
Ys = (e, r) => e && (e = String(Qdr(e, r)))
```

配套要求：

- 调用 `initialize({ htmlLabels: false, securityLevel: 'strict', layout: 'elk', … })`——与接收方渲染配置一致；`htmlLabels: false` 同时使 `Qdr` 不再调用 `removeScript`。
- **锚点断言**：替换前必须确认锚点存在，且替换次数恰为 1；不满足即按退出码 `2` 失败（「payload 结构已变化，无法安全旁路」），**绝不**在未旁路的情况下继续用无 DOM 环境校验（那会产生 §2.2 的 12/18 误报）。
- 锚点稳定性已实测：`skills/taco/taco-shell.html`、`extensions/taco/assets/taco-shell.html`、`skills/taco/templates/*/empty.taco.html`、`dist-single/Taco_Spec.taco.html` 全部命中（载荷各 5,343,411 字节）。
- 语义边界：跳过的是**标签文本的 HTML 消毒**，发生在解析之后、不影响语法判定（§2.3）。

### 4.3 运行时约束：不需要 DOM、不需要浏览器、不需要外部包

经 §4.2.1 的旁路后，校验器在**纯 Node（无 DOM）** 下即为正确：

- 合法图 18/18 通过（零误报）；
- 非法输入全部报错且行号正确（§2.3 实测）；
- 实测耗时 0.36s（22 个输入，本机）。

因此：

- **不引入 `jsdom`**（此前设计的唯一新增依赖已取消）；
- **不引入浏览器校验路径**（原 `--harness` 已删除，见 §4.4）；
- 不新增任何 npm 依赖，不联网（载荷来自本地 shell）。

`Node >= 22` 是唯一运行前提（与 `checkpoints.mjs`、`png.mjs` 相同）。

### 4.4 已删除：浏览器校验路径（`--harness`）

前一版设计提供 `--harness <out.html>`（把待校验源码与载荷写成一个页面，由 Agent 用浏览器工具读回诊断）。**该模式已删除**：

- 它存在的唯一理由是「Node 侧需要 jsdom」，而该前提已被 §4.3 取消；
- 它引入了浏览器工具可用性这一宿主差异，以及「打开页面 → 等完成标记 → 读回」的额外步骤；
- 作者原型阶段实测该路径易错：生成的页面曾因 `??` 与 `||` 混用抛 `SyntaxError` 并永久停在 running，必须真的在浏览器执行才能发现。

若将来确有「浏览器内自检」的需求，应作为独立特性评估，不在本 Issue 范围内。

### 4.4.1 诊断内核的位置与装配契约（审查修正：TS 与 Node 脚本的缺口）

诊断分类逻辑（五类分型、位置优先级、clamp）必须由**浏览器 bundle 与 Node 校验脚本共用同一份实现**；直接把内核写成 `src/*.ts` 会造成装配缺口：`lint-mermaid.mjs` 是零依赖的纯 Node 脚本，Node ≥ 22 全范围没有内置 TS 类型剥离，无法 `import` 一个 `.ts`。

采用仓库**已有先例**（`png.mjs` 的 canonical + mirror 模式）解决：

| 角色 | 路径 | 说明 |
| --- | --- | --- |
| canonical | `extensions/taco/bin/mermaid-diagnostics.mjs` | 纯 JS（**零 import**），无构建步骤 |
| 类型声明 | `extensions/taco/bin/mermaid-diagnostics.d.mts` | 手写声明，供 `tsc` 使用（`moduleResolution: bundler`） |
| skill 镜像 | `skills/taco/scripts/mermaid-diagnostics.mjs` | 与 canonical **字节一致**，随 skill 一起安装 |
| 应用侧引用 | `src/mermaid.ts` 等 → `../extensions/taco/bin/mermaid-diagnostics.mjs` | 与 `src/model.ts:1`、`src/markdown-assets.ts:2`、`src/kernel/save.ts:4` 引用 `png.mjs` 的方式一致 |
| 脚本侧引用 | `skills/taco/scripts/lint-mermaid.mjs` → `./mermaid-diagnostics.mjs` | 安装后仍然可用（同目录同级文件） |
| 镜像守护 | 扩展 `tests/skill-pack.test.ts` 的镜像断言 | 与 `png.mjs` 的字节一致断言并列 |

已验证可行（临时 worktree 实测）：`.mjs` + `.d.mts` 被 `tsc -b` 接受（exit 0），且被 vite 打进 shell bundle。

`lint-mermaid.mjs` 自身仍是 `.mjs`、零外部依赖、只使用 Node 内置模块（`node:zlib`/`node:fs`/`node:url`/`node:os`/`node:path`/`node:module`）。

### 4.5 诊断提取

`mermaid-diagnostics.mjs`（位置与装配见 §4.4.1；两个消费方共用：Node 校验脚本与人侧 UI）：

```ts
export type MermaidDiagnosticKind =
  | 'syntax'        // 解析/语法错误，可能带位置
  | 'unknown-type'  // 未识别图表类型（含空内容、纯注释）
  | 'runtime'       // 解析器/DOM/载荷不可用
  | 'render'        // 通过 parse 但渲染阶段失败（无位置）

export interface MermaidDiagnostic {
  kind: MermaidDiagnosticKind
  message: string   // 本地化后的用户消息
  detail?: string   // 底层原始文本，原样保留、不翻译
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  token?: string
  expected?: string[]
}
```

`classifyMermaidFailure` 必须**显式接收失败阶段**（`load` / `parse` / `render`），因为同一个异常形状在不同阶段含义不同：

```ts
classifyMermaidFailure(input: { stage: 'load' | 'parse' | 'render'; error?: unknown; returnedFalse?: boolean; source: string }): MermaidDiagnostic
```

分型规则（**白名单取值，绝不整体序列化 error**）：

1. `stage === 'load'` → `runtime`，`detail` 为加载失败原因（载荷缺失、CDN 不可达等），无位置。
2. `stage === 'parse'` 且异常**结构上**存在 `error.result?.parserErrors?.[0]?.token`（langium 族）→ `syntax`，取 `startLine/startColumn/endLine/endColumn`（已测 2/2 精确）。**不得按 `error.name` 判定**——实测该族在不同调用下 `name` 为 `Error`。
3. `stage === 'parse'` 且存在 `error.hash`（jison 族）→ `syntax`；位置取 `hash.loc.first_line`（+`first_column`，实测 3/3 正确），缺失时退回 `message` 的 `Parse error on line (\d+)`；两者都缺则无位置但保留 `detail`。取值后 **clamp 到所在单元的行范围**（`.mmd` 为 `[1, 行数]`，Markdown 围栏为 `[1, 围栏体行数]`），再加围栏偏移。
4. `stage === 'parse'` 且 `name === 'UnknownDiagramError'` → `unknown-type`，无位置。
5. `stage === 'parse'` 且 `returnedFalse === true`（`suppressErrors` 生效，**没有异常对象**）→ 廉价预判：空/纯空白/纯注释/无图表头 → `unknown-type`；其余 → `syntax`。此分支 `detail` **缺省**，不得声称保留了不存在的原始异常。
6. `stage === 'parse'` 的**其余非白名单异常** → `runtime`（`parse` 阶段失败意味着校验环境本身不可信，例如载荷结构变化导致的异常），退出码 `2` 且**优先于** `1`；**绝不可归为 `render`**。
7. `stage === 'render'` 的异常 → `render`，无位置；文案必须表达「渲染阶段失败」，不得写成语法错误，也不参与「语法是否有效」的判定（§2.5）。

**优先使用抛出式 `parse(source)` 并捕获**，而不是 `suppressErrors: true`：只有抛出的异常对象才带 `hash`/`result` 与原始 `message`。实测同一段悬空箭头源码，`suppressErrors` 只得到布尔 `false`（无位置、无原文），而抛出式给出完整 `Parse error on line …` 与 `hash`。规则 5 仅覆盖实现差异（CDN/桩返回布尔）的兜底。

**无 DOM 还会损坏错误诊断本身**（实测，强化 §4.3）：同一段 `flowchart TD\n  A[Start] -->` 在没有 DOM 时抛的是 `TypeError` 且 `hash`/`loc` 全空，只有装了 DOM 才还原为带行列的解析错误。即没有 DOM 不只是「合法图误报」，而是「非法图的诊断也退化成无信息的 TypeError」；按规则 6，它必须表现为「校验未运行」而不是任何语法结论。

### 4.6 位置换算

Markdown fence 的行号需要换算：定位围栏起始行，源码第 1 行对应宿主文件的 `fenceStart + 1`，据此把诊断行号映射回 `.md` 的真实行号，列号不变（fence 内未做缩进改写）。

## 5. 方案：人侧最小集

只做四件事，不重排交互、不新增任何控件。

1. **诊断精确化**：`.mmd`（`src/structured-file-viewer.ts`）与 Markdown 块（`src/tiptap-code-block.ts`）都改为呈现「类别 + 行:列 + 原始 `message`」，并支持复制原文；`render` 类明确标注「无位置信息」。取代 `labels.error` 的单句（§2.8-H1）。
2. **不互相冒充**：`runtime`（载荷/CDN 不可用）、`render`、`syntax`、`unknown-type` 四种文案独立；`unavailable` 时清除 `is-loading` 假进度并给出原因（§2.8-H2）。
3. **残留清理**：`render` 失败后按 id 精确移除 `#d{id}`；并在成功路径复查一次（§2.8-H5）。
4. **两入口一致**：Markdown 路径接上同一条诊断回调链（`src/tiptap-code-block.ts` 的 split view 需要透传，当前未接，§2.7-H4）。

顺带优化（同一条因果链，非独立目标）：`parse` 作为 `render` 的前置门——无效源码不再调用 `render()`，从源头消掉大部分失败与泄漏。

### 5.1 运行时不可用的恢复触发点（审查修正：不得新增交互）

现状问题（§2.8-H3）：`src/tiptap-code-block.ts:495-507` 置 `mermaidUnavailable = true` 后，`paint()` 只在 `!isMermaid` 分支复位它（`:526-533`），而渲染门又要求 `!mermaidUnavailable`（`:485-491`），于是该块在本会话内永久退化。

恢复必须靠**已有的**事件触发，不引入重试按钮（按钮属于 §10 的交互改造）：

| 入口 | 触发事件（全部已存在） | 行为 |
| --- | --- | --- |
| Markdown 块 | 节点视图 `update()` → `paint()`；内容变更 | `paint()` 依据 `state` 派生可用性而不是读一个单向标志位；`state === 'runtime'` 时允许再次尝试加载 |
| `.mmd` | 模式切换 / 重新进入 `paintMermaid()`（每次重建 split view，已如此） | 重建即重试 |

验收相应收紧为：**在编辑或模式切换之后**、无需重载文档即可恢复出图（A6）。「一键重试按钮」「失败回落源码」「低频编译」等仍属 §10，另开 Issue。

### 5.2 范围外附带修复：Mermaid 标签文字被描边（由用户报告）

在验证阶段由用户目视发现：图表节点标签（如 `Alice`/`Bob`）呈现为又粗又糊的重影文字。根因**不在本分支**，而是 `src/security.ts` 的 `sanitizeMermaidSvg` 既有缺陷——它用一个字符黑名单 `/[\\<>@~+]/` 丢弃选择器，把 mermaid 的标签复位规则 `#<id> text.actor > tspan { stroke: none }` 一并丢掉，于是 `tspan` 从 `.actor` 继承了 `stroke-width: 2` 的描边。

证据：问题的旧构建与新构建渲染出的 SVG **逐字节相同**（23,394 字符、同字体、同节点数），两张截图也完全一致，说明本分支未引入该问题。修复为：允许以 `#rootId` 为前缀的 `>` 后代组合器，仍禁止可逃出 SVG 的 `~`/`+` 与 `<`/`\`/`@`；`tests/security.test.ts` 增加回归断言。修复后标签计算样式回到 `stroke: none`，视觉恢复正常。

这一条**超出本 Issue 原定范围**，但因直接影响「人能否读图」而一并修复并在此记录，便于评审时决定是否拆分。

## 6. 契约与兼容

| 项 | 变化 | 兼容性 |
| --- | --- | --- |
| `skills/taco/scripts/lint-mermaid.mjs` | 新增（调用式校验工具） | 不进入落盘链路；不下落为必需步骤 |
| `extensions/taco/bin/mermaid-diagnostics.mjs` + `.d.mts`（canonical）与 `skills/taco/scripts/mermaid-diagnostics.mjs`（字节镜像） | 新增诊断模型与分型，见 §4.4.1 | 纯 JS、零 import；`tsc`/vite 均可用；镜像由测试守护 |
| `src/mermaid.ts` | 增加 parse 门与 `onDiagnostic`；移除失败残留 | 内部 |
| `src/structured-file-viewer.ts` / `src/tiptap-code-block.ts` | 诊断呈现改为结构化 | 用户可见（文案更具体） |
| bundle / `.mmd` 格式 | **无变化** | `text/plain` 与 `taco/files` v1 不变 |
| 装配流程（`pack.mjs` 等） | **不涉及** | 本设计不依赖、不修改 |

`security` 边界不变：渲染产物仍必须经 `sanitizeMermaidSvg`；安全边界拒绝另归一类文案。

## 7. 验证方案

### 7.1 校验器（脚本级，可复跑）

- **正确性矩阵**（A1）：**22 个输入**的期望表（18 个合法图 + 3 个语法无效 + 1 个未知类型），逐条断言 `kind` 与是否报错；未知类型必须断言为 `unknown-type` 而非 `syntax`。任何人可重放，且须覆盖 §2.2 点名的 11 个易漏报族。
- **无 DOM 回归（关键）**：在**不安装 jsdom、不启动浏览器**的纯 Node 环境运行全部用例，断言 18/18 通过——这是 §4.2.1 旁路生效的证明，也是「退化成直连 parse」的守门断言。
- **旁路守门**：构造函数被改写的载荷（删除锚点、或让锚点出现两次）→ 断言退出码为 `2` 且**不打印通过**，避免在未旁路状态下校验。
- **位置换算与 clamp**（A2）：构造围栏起始于第 N 行的 `.md`，断言诊断行号落在**围栏体范围内**（不得指向闭合围栏或越界）；已实测反例：悬空箭头会把未 clamp 的映射算到闭合围栏那一行。
- **字段优先级**：用固定样本锁定 §4.5 的取值顺序，并**分别断言行列的正确值**（不靠 clamp 掩盖偏差）：
  - 悬空箭头 `flowchart TD\n  A[Start] -->` → 第 **2** 行（`loc.first_line=2` ✓、`hash.line=2` ✓、`message` 说 3 ✗）；
  - 未闭合方括号 `flowchart TD\n  A[Start --> B[End]` → 第 **2** 行（`loc.first_line=2` ✓、`hash.line=1` ✗、`message` 说 2 ✓）；
  - sequence 缺冒号 `sequenceDiagram\n  Alice->>Bob hello` → 第 **2** 行；
  - langium 结构判定：gitGraph 非法语句 → 第 3 行第 3 列；`architecture-beta` 非法行 → 第 3 行第 8 列（同时断言 `error.name` 为 `Error` 时仍被正确判为 `syntax`）。
- **阶段分类**：构造 `parse` 阶段的非白名单异常 → `kind === 'runtime'` 且退出码 `2`，断言它**不**被归为 `render`。
- **抛出式优先**：断言同一段源码在抛出式 `parse` 下产出 `detail` 与非空位置；在 `suppressErrors` 布尔路径下 `detail` 缺省但 kind 仍正确。
- **不可用路径**（A3）：屏蔽/破坏载荷时退出码为 2 且不打印通过。
- **离线**（A4）：断开网络后断言仍全通过（含「载荷来自本地 shell、过程中无任何网络请求」）。
- **退出码混合场景**：同一目录内同时存在语法无效单元与 `runtime` 异常单元 → 断言退出码为 `2`、`--json` 同时含两类记录且顶层标记结果不完整。
- **退出码特例**：无 Mermaid 单元时 `0` + 显式打印 `0 Mermaid unit(s) (nothing to validate)`；`--dir` 收到文件时报错并提示改用位置参数。

### 7.2 人侧

- 四类失败（`syntax`/`unknown-type`/`render`/`runtime`）在两入口的文案与位置断言（A5、A6）；
- `#d{id}` 计数断言：连续 5 次失败后不增长（A7）；
- **A8-a~A8-f 逐项**：主题切换后重新出图（a）、方向切换后重新出图（b）、复制当前源码（c）、行评论锚点（d）、节点评论锚点（e）、双击/按钮进全屏与全屏内缩放及退出后内联状态（f）——每项给出显式断言，或列入 §7.3 手工清单并记录结果。
- 既有功能回归（**补充**，不代替 A8-a~A8-f）：`tests/mermaid-docs.test.ts`、`tests/structured-file-viewer.test.ts`、`tests/tiptap-editor.test.ts`、`tests/markdown-reconstruction.test.ts` 全绿。

### 7.3 手工确认

- 在真实浏览器中打开一个含三类问题的 `.taco.html`，逐条核对人侧文案与位置；
- A8-a~A8-f 逐项手工核对并记录（主题、方向、复制、行评论、节点评论、全屏缩放），记录与改动前的差异；
- 用 Agent 视角跑一次校验器，确认输出足以定位到「文件:行:列 + 原文」。

## 8. 影响范围

| 路径 | 角色 |
| --- | --- |
| `skills/taco/scripts/lint-mermaid.mjs`（新增） | Agent 侧校验入口 |
| `skills/taco/SKILL.md`、`references/bundle-format.md` | 记录「写图后自查」的最小指引（不改变落盘流程） |
| `extensions/taco/bin/mermaid-diagnostics.mjs` + `.d.mts`（新增，canonical） | 诊断分型与位置提取（脚本与人侧共用），装配见 §4.4.1 |
| `skills/taco/scripts/mermaid-diagnostics.mjs`（新增，字节镜像） | 随 skill 安装，供 `${SCRIPT}` 同目录引用 |
| `src/mermaid.ts` | parse 前置门、`onDiagnostic`、残留清理 |
| `src/structured-file-viewer.ts`、`src/tiptap-code-block.ts` | 诊断呈现与两入口一致 |
| `src/i18n.ts`、`src/styles.css` | 四类文案与诊断样式 |

## 9. 实现任务（设计阶段不实施）

1. **阶段一：诊断内核** — canonical `extensions/taco/bin/mermaid-diagnostics.mjs` + `.d.mts` + skill 字节镜像（装配与镜像守护见 §4.4.1）+ 单元测试（五类分型、jison 行号校准、langium 行列、不序列化 `error.result`）。
2. **阶段二：校验器** — `skills/taco/scripts/lint-mermaid.mjs`：本地 Complete shell 载荷提取 + 临时文件 + **§4.2.1 旁路（含锚点断言）** + `initialize({ htmlLabels: false, … })` + 目录/文件/stdin 输入 + fence 行号换算 + `--json` + 退出码三态。**不使用 jsdom、不使用浏览器。**
3. **阶段三：正确性基线** — 把 §2.2 矩阵固化为脚本级回归（18 合法 + 4 非法）。
4. **阶段四：人侧最小集** — parse 前置门、四类文案、残留清理、Markdown 路径接线（A5–A7）。
5. **阶段五：文档与最小指引** — SKILL.md / bundle-format.md 各加一段「写图后自查」，不改变任何落盘步骤。
6. **阶段六：回归** — 全量测试 + 手工确认（§7.3）。

## 10. 明确不做（另开 Issue）

以下问题已在此前调查中取证，但**不属于本 Issue**（界面是服务人的，不因 Agent 便利重做交互）：

1. 预览刷新频率与闪烁（`src/mermaid.ts:499-502` 每次按键同步清空预览面）；此前裁决 D1「不保留旧预览 + debounce ~800ms + 单飞」保留待用。
2. 失败时整窗回落为可编辑源码、Markdown 块内源码可达性（`src/tiptap-code-block.ts:479-480` 源码恒隐藏、`:466` 面板按钮恒隐藏、死类 `is-source-visible`）；此前裁决 D2 保留待用。
3. 全屏与内联缩放的状态副本、`restoreView()` 双调（`src/tiptap-code-block.ts:337-341,410-427`）。
4. 「实时/手动更新」开关在 Markdown 块内不可达（`src/mermaid-split-view.ts:190-212` 面板被禁用）。

## 11. 依赖取舍（已由实测收敛，无需再裁决）

前一版把 `jsdom` 列为「唯一新增依赖」，理由是「无 DOM 时 12/18 合法图误报」。经定位与实验（§2.3），该依赖**不必要**：

- 唯一 DOM 需求来自 `sanitizeText` 内无条件调用的 `DOMPurify.sanitize`；
- 旁路该调用（锚点断言 + `htmlLabels: false`）后，纯 Node **零依赖**达到 18/18、零误报，且非法输入的行号全部正确；
- 因此本设计**不新增任何 npm 依赖、不引入浏览器路径、不联网**。

结论：原先的 `jsdom` 取舍（A/B/C）作废，采用「零依赖 + 旁路」；若后续实测发现旁路在某个图族失效，再回到本节的取舍讨论。

## 12. 体积与依赖预算（prepare 估算 / develop 实测）

遵循 `AGENTS.md` 的「体积与依赖预算」。本节为 **prepare 阶段估算**，并附一次**原型实测**以把估算锚定在真实数字上（原型不等于最终实现，故同时给出区间）；develop 阶段必须按同一口径重测并把实测值回填到本节。

### 12.1 基线（2026-09-28）

| 产物 | 基线字节 |
| --- | --- |
| `dist-single/Taco_Spec.taco.html` | 2,835,255 |
| `dist-single/Taco_Spec_Lite.taco.html` | 286,281 |
| `skills/taco/taco-shell.html` | 2,730,006 |
| `skills/taco/taco-shell-lite.html` | 181,032 |
| `skills/taco/` 目录合计 | 13,968,819 |

### 12.2 原型实测方法

**（历史记录）** 体积测量时的原型把内核临时写成 `src/mermaid-diagnostics.ts`（约 3.7 KB）；最终装配改为 §4.4.1 的 canonical `.mjs` + `.d.mts` + skill 镜像，该临时路径**不是**实施结构，体积量级不受影响。执行 `node scripts/build-shells.mjs` 并与基线比较；同时实现校验器原型 `skills/taco/scripts/lint-mermaid.mjs` 并做功能冒烟（含 §4.2.1 旁路）。

### 12.3 实测结果（develop 阶段，`node scripts/build-shells.mjs`）

| 产物 | 基线 | 最终实现 | Δ | Δ% | 估算区间 |
| --- | --- | --- | --- | --- | --- |
| `dist-single/Taco_Spec.taco.html` | 2,835,255 | **2,837,783** | **+2,528 字节** | +0.089% | +0.8 ~ 3 KB ✓ |
| `dist-single/Taco_Spec_Lite.taco.html` | 286,281 | **288,632** | **+2,351 字节** | +0.821% | +1.3 ~ 4 KB ✓ |
| `skills/taco/taco-shell.html` | 2,730,006 | **2,732,534** | **+2,528 字节** | +0.093% | — |
| `skills/taco/taco-shell-lite.html` | 181,032 | **183,383** | **+2,351 字节** | **+1.299%** | **超阈值** |
| `skills/taco/` 目录合计 | 13,968,819 | **13,993,503** | **+24,684 字节** | +0.177% | +11 ~ 16 KB（超出上界） |
| 其中 `scripts/mermaid-diagnostics.mjs`（镜像） | — | 6,674 字节 | | | |
| 其中 `scripts/lint-mermaid.mjs` | — | 17,172 字节 | | | |

偏差记录：

- **Lite 越过 1% 告知阈值**（+1.299%）。Lite 载荷基数小（177 KB），而本次新增的是真实代码：共享内核、`mermaidDiagnosticNode`、四类双语文案、CSS、parse 前置门，加上渲染标签描边修复。已按 AGENTS.md 在交付说明中主动告知用户，并给出数字与可选方案。
- **skill 目录超出估算上界**（估算 +11~16 KB，实测 +24.7 KB）。原因是校验器原型（10.6 KB）在实现中长出完整 CLI 面：参数解析、退出码三态、路径与符号链接处理、帮助文本、错误分支。
- 原型阶段的一次中间测量（+2,448 / +2,289）低于最终值，差异来自随后的修复轮：Markdown 恢复路径与 retry、围栏扫描重写、参数错误出口、以及 `sanitizeMermaidSvg` 的既有缺陷修复。
- 校验器脚本未被误打进 shell（两个 shell 中都不含其内容）。

### 12.4 估算区间（develop 阶段以此为准复核）

| 影响面 | 估算 | 依据 |
| --- | --- | --- |
| Complete shell | +0.8 ~ 3 KB（+0.03% ~ 0.11%） | 原型 +788 字节；最终实现还要改 `structured-file-viewer.ts`、`tiptap-code-block.ts` 的诊断呈现与回调接线 |
| Lite shell | +1.3 ~ 4 KB（+0.5% ~ 1.4%） | 原型 +1,349 字节；同上 |
| `skills/taco/` | +11 ~ 16 KB（+0.08% ~ 0.11%） | 原型 10,601 字节；最终脚本含更多参数与错误分支 |
| `.taco.html` 产物 | 每个产物随所用 shell 同幅增长（约 +1 ~ 3 KB） | 产物内嵌整个 shell |

**阈值结论**：原型实测远低于 `AGENTS.md` 的告知阈值（任一 shell 增长 ≥1% 或 ≥32 KB）。**风险点是 Lite 的上界**：若最终实现把 Lite 推到 +1% 以上（>2,863 字节），按规则必须主动告知用户并给出数字。develop 阶段必须实测确认落点。

### 12.5 依赖与联网

| 项 | 结论 |
| --- | --- |
| 运行时新增联网 | **无**。校验器从随 skill 安装的本地 Complete shell 解出解析器载荷；shell 与产物自身的联网行为不变（Lite 仍按既有设计在文档含 Mermaid 时按需加载 pinned CDN，FR-007a/SC-004 不变） |
| 新增外部依赖 | **无**。旁路方案（§4.2.1）取消了原设计的 `jsdom`；校验器只用 Node 内置模块 |
| 新增发布包/服务 | 无。不新增 npm 包、不新增服务、不改 `.mmd` 的 `text/plain` 存储与 bundle 格式 |
| 版本漂移风险 | Complete 交付：无（同字节）。Lite 交付：仅同 pinned 版本号（12.0.0），字节一致性不保证（见 §4.2 的保证范围表） |

**取舍结论**：旁路方案使校验器**零新增依赖**（§11），同时保持零误报；不再存在需要在「依赖」与「正确性」之间二选一的情况。
