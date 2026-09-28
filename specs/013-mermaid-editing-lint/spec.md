---
title: '013-mermaid-editing-lint'
feature_id: '013-mermaid-editing-lint'
created: '2026-09-28'
status: 'Draft'
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

### 2.2 决定性发现：没有 DOM 的 Mermaid 校验是错的

在**同一份 pinned mermaid 12.0.0**下做 2×2 受控矩阵（共 22 个输入＝18 个合法图 + 3 个语法无效 + 1 个未知类型）：

| 解析器来源 | DOM | 合法图正确通过 | 漏报（合法图被判无效） | 把非法当合法 |
| --- | --- | --- | --- | --- |
| shell 内嵌载荷 | 无 | 6/18 | **12** | 0 |
| shell 内嵌载荷 | jsdom | **18/18** | 0 | 0 |
| CDN 镜像 | 无 | 6/18 | **12** | 0 |
| CDN 镜像 | jsdom | **18/18** | 0 | 0 |

漏报的具体族：`stateDiagram-v2`（含 `[*] --> A` 与 `A --> B: go`）、`classDiagram`、`gantt`、`journey`、`mindmap`、`timeline`、`quadrantChart`、`sankey-beta`、`kanban`、`C4Context`、`pie`（带 title）。

根因已定位（无 DOM 下调用不带 `suppressErrors` 的 `parse` 取栈）：

```
TypeError: My.addHook is not a function
    at setupDompurifyHooks (.../mermaid.mjs)
```

这些图族在解析期要经 DOMPurify 处理标签 HTML，而 DOMPurify 在缺少 DOM 时只能退化为残缺桩（无 `addHook`）。**因此「纯 Node 直接 parse」的实现会把 12 个正确文档判为错误**——这比不校验更糟，会成为新的阻塞源。

### 2.3 jsdom 层即足，且与解析器来源无关

同样是 18/18 正确、0 误收，使用 shell 内嵌载荷或 CDN 镜像**结果一致**。因此可以选**与接收方运行时字节一致**的那份：Complete shell 内嵌的 mermaid。

载荷位置与解出方式（`scripts/postbuild-compress.mjs:94` 生成，`src/mermaid-complete.ts` 运行期消费）：

```html
<script id="taco-asset-mermaid" type="taco/deflate-b64">…base64(deflate-raw)…</script>
```

实测：`skills/taco/taco-shell.html` 中该载荷解压后 5,343,555 字节，`import()` 后 `typeof parse === 'function'`。Lite shell 没有该载荷（按设计从 CDN 加载，`src/lite-cdn-loader.ts`）。

### 2.4 render 阶段只能作参考，不能作语法结论

真机 headless Chromium（pinned CDN + Taco 配置）中，**合法的 `mindmap` 源码 render 直接失败**：

```
mindmap → parse OK · render FAIL TypeError: Cannot read properties of null (reading 're')
mindmap（非法源码） → parse OK · render FAIL TypeError: Cannot read properties of null (reading 're')
```

两种输入给出**同一条**无位置信息。jsdom 下 render 对 mindmap 同样假失败。因此 render 判定必须标注为「渲染阶段失败（无位置）」，既不得上升为语法结论，也不得用来否定 `parse` 的通过。

### 2.5 渲染失败在真实浏览器留下未清理的 DOM 残留

同一真机探针记录 `body > div[id^="d"]` 数量随失败单调增长（1 → 2 → 3 → 4），且后续**成功**渲染不会清理历史残留。mermaid 在 `render()` 失败时向 `document.body` 注入 `div#d{id}` 后抛出，Taco 侧从未清理；Taco 的 id 每次自增（`src/mermaid.ts:499`），故编辑期单调累积。

### 2.6 Mermaid 错误族与可用字段（实测）

| 错误族 | 触发示例 | 可用字段 | 注意 |
| --- | --- | --- | --- |
| jison（flowchart / sequence 等） | `flowchart TD` + 悬空箭头 | `hash.line`、`hash.loc{first_line,last_line,first_column,last_column}`、`hash.token`、`hash.expected[]`；`message` 含 `Parse error on line N:` 与指示线 | **字段互相矛盾，只有 `loc.first_line` 可靠**。实测（3 个样本，含 DOM 抛出式 `parse`）：`loc.first_line` **3/3 正确**；`hash.line` 2/3（未闭合方括号给 1，实为 2）；`message` 2/3（悬空箭头说 line 3，实为 2） |
| langium（gitGraph / architecture 等） | `gitGraph` + 非法语句；`architecture-beta` + 非法行 | `result.parserErrors[0].token.{startLine,startColumn,endLine,endColumn,startOffset,endOffset}`；`message` 为 `Parsing failed:  Parse error on line 3, column 3: …` | 实测 2/2 精确（gitGraph 3,3；architecture 3,8）。**注意 `error.name` 实测为 `Error`，不是 `MermaidParseError`**——分类必须按结构（`result.parserErrors[0].token` 是否存在）判定，不能按名字。`result` 极大且自引用，**绝不可整体序列化或写日志** |
| 未识别类型 | 空内容、纯 `%%` 注释、未知图表头 | `name === 'UnknownDiagramError'`，无位置 | 与「语法错误」不是一回事 |

`parse(text, { suppressErrors: true })` 返回 `false`（无效）或 `{ diagramType, config }`（有效），**不抛异常**，也不触碰 DOM——这是 lint 的基元。

### 2.7 人侧现状（最小集要修的部分）

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
| R4 | 校验离线可用，且与接收方运行时同版本，不产生版本漂移 | FR-007a 的离线精神 |
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
node scripts/lint-mermaid.mjs --dir <dir> [--json]
node scripts/lint-mermaid.mjs --harness <out.html>   # 零依赖模式（浏览器执行）
```

- 输入：`.mmd` 文件、含 ```` ```mermaid ```` 围栏的 `.md` 文件、`--dir` 目录（递归、忽略点目录与 `*.taco.html`）、stdin。
- 扫描范围与 Taco 的能力对齐：`.mmd` 与 `.md` 里的 Mermaid 围栏；忽略其他文件类型。
- 输出（默认人类可读；`--json` 给机器）：每条诊断含

```json
{ "file": "diagrams/flow.mmd", "line": 14, "column": 11,
  "kind": "syntax", "detail": "Parse error on line 14: Expecting 'SQE', got 'SQS'",
  "tier": "parse", "runtime": "shell-embedded@12.0.0" }
```

- 退出码：`0` 全部通过；`1` 存在诊断；`2` 校验**未运行**（解析器或 DOM 不可用、输入不可读）。三者必须可区分（R5）。

### 4.2 解析器来源：shell 内嵌载荷写临时文件

按优先级：

1. **从 shell 提取**（默认路径，离线、零下载）：读 `taco-shell.html`，取出 `#taco-asset-mermaid` 的 base64，`zlib.inflateRawSync` 解压，**写入临时 `.mjs` 文件**，`import(pathToFileURL(tmp))`。这就是「写一个临时文件再用 mermaid parser lint」的直接落地。
2. `--mermaid <path>`：显式指定一个本地 mermaid ESM 入口。
3. `--shell <path>`：明确指定 shell 文件。

不使用 CDN 抓取作为默认路径（jsdelivr 的 `dist/mermaid.esm.min.mjs` 是**分片**入口，单个文件无法离线 `import`；实测需要镜像 105 个分片、5.4 MB，不适合作为默认行为）。网络仅在用户显式要求时才参与。

选择内嵌载荷的理由是**一致性**：那份字节就是接收方浏览器将要执行的东西，`parse` 结论天然对应人看到的渲染结果，不存在版本漂移（R4）。

### 4.3 DOM 策略：jsdom 是硬约束

`jsdom` 解析顺序（**必须按调用目录解析，不能靠脚本自身位置**——脚本装在 `skills/taco/scripts/`，其 ESM 裸模块解析以脚本文件为基准，调用方项目的 `node_modules` 不会自动进入解析路径）：

1. `--jsdom <path>`：显式指定 jsdom 入口；
2. 以 `createRequire(new URL('package.json', pathToFileURL(join(process.cwd(), '/'))))` 解析 `jsdom`（即以**调用目录** `process.cwd()` 为基准）；
3. 兜底：脚本自身位置可解析到的 `jsdom`。

三者都失败时按 §4.1 的退出码 `2` 失败，并打印与**实际生效顺序**一致的确切补救命令（例如在调用目录执行 `npm i -D jsdom`），**绝不降级为「无 DOM 的 parse」**——§2.2 已证明那样会产生 12/18 误报，且非法输入的诊断也会退化成无信息的 `TypeError`（§4.5）。

必须内置的两个测量垫片（否则部分族解析不稳定）：

```js
SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 20 })
SVGElement.prototype.getComputedTextLength = function () { return (this.textContent ?? '').length * 8 }
```

实现要点：把 jsdom window 上除 `location` 外的可枚举全局注入 `globalThis`（`CSSStyleSheet`、`DOMParser`、`customElements`、`MutationObserver`、`requestAnimationFrame` 等都要在），并以 `window`/`self` 指回该 window。实测该组合下 18/18 正确。

Lite shell 场景：`taco-shell-lite.html` **没有**内嵌载荷（按设计从 CDN 加载，`src/lite-cdn-loader.ts`）。因此对 Lite 交付物，校验器必须显式说明「无离线载荷」并按需使用 `--mermaid`/`--shell` 或 `--harness --payload cdn`，不得静默回退到网络。

### 4.4 零依赖模式：`--harness`

对没有 Node 侧 `jsdom`、但**有浏览器工具**的 Agent，`--harness <out.html>` 写一个自包含临时页：内嵌同一份 mermaid 载荷（或按 `--payload cdn` 使用 pinned CDN）、内联待校验源码、把诊断 JSON 写入 `<output id="result">`。

**退出码语义必须明确区分**（审查修正）：`--harness` 的 `0` 只表示**harness 已写出**，不表示校验通过。该模式下必须打印「校验未运行 —— 请在浏览器中打开该文件并读取结果」，且**不得**输出任何「通过」字样。页面必须在完成后设置显式标记（如 `window.__lintDone = true` 并把 `{diagnostics, unavailable}` 写入 `output`）；`unavailable` 非空时同样表示「校验未运行」。

SKILL.md 必须给出完整回读步骤：打开文件 → 等待完成标记 → 读取 `output` → 有诊断则修，`unavailable` 非空则报告未运行。测试必须**真的在浏览器里执行**该页面并断言其输出，只比较生成的 HTML 文本不算通过（§7.1）。

这条路径同时是「浏览器即权威」的实现：与接收方渲染环境完全一致，且零依赖。代价是需要浏览器工具（并非所有宿主都提供），因此它不是默认路径，而是缺 jsdom 时的替代。

### 4.5 诊断提取

`src/mermaid-diagnostics.ts`（新模块，两个消费方共用：脚本侧与人侧 UI）：

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
6. `stage === 'parse'` 的**其余非白名单异常** → `runtime`（`parse` 阶段失败意味着校验环境本身不可用，例如缺 DOM 时抛的 `TypeError`），退出码 `2`；**绝不可归为 `render`**。
7. `stage === 'render'` 的异常 → `render`，无位置；文案必须表达「渲染阶段失败」，不得写成语法错误，也不参与「语法是否有效」的判定（§2.4）。

**优先使用抛出式 `parse(source)` 并捕获**，而不是 `suppressErrors: true`：只有抛出的异常对象才带 `hash`/`result` 与原始 `message`。实测同一段悬空箭头源码，`suppressErrors` 只得到布尔 `false`（无位置、无原文），而抛出式给出完整 `Parse error on line …` 与 `hash`。规则 5 仅覆盖实现差异（CDN/桩返回布尔）的兜底。

**无 DOM 还会损坏错误诊断本身**（实测，强化 §4.3）：同一段 `flowchart TD\n  A[Start] -->` 在没有 DOM 时抛的是 `TypeError` 且 `hash`/`loc` 全空，只有装了 DOM 才还原为带行列的解析错误。即没有 DOM 不只是「合法图误报」，而是「非法图的诊断也退化成无信息的 TypeError」；按规则 6，它必须表现为「校验未运行」而不是任何语法结论。

### 4.6 位置换算

Markdown fence 的行号需要换算：定位围栏起始行，源码第 1 行对应宿主文件的 `fenceStart + 1`，据此把诊断行号映射回 `.md` 的真实行号，列号不变（fence 内未做缩进改写）。

## 5. 方案：人侧最小集

只做四件事，不重排交互、不新增任何控件。

1. **诊断精确化**：`.mmd`（`src/structured-file-viewer.ts`）与 Markdown 块（`src/tiptap-code-block.ts`）都改为呈现「类别 + 行:列 + 原始 `message`」，并支持复制原文；`render` 类明确标注「无位置信息」。取代 `labels.error` 的单句（§2.7-H1）。
2. **不互相冒充**：`runtime`（载荷/CDN 不可用）、`render`、`syntax`、`unknown-type` 四种文案独立；`unavailable` 时清除 `is-loading` 假进度并给出原因（§2.7-H2）。
3. **残留清理**：`render` 失败后按 id 精确移除 `#d{id}`；并在成功路径复查一次（§2.7-H5）。
4. **两入口一致**：Markdown 路径接上同一条诊断回调链（`src/tiptap-code-block.ts` 的 split view 需要透传，当前未接，§2.7-H4）。

顺带优化（同一条因果链，非独立目标）：`parse` 作为 `render` 的前置门——无效源码不再调用 `render()`，从源头消掉大部分失败与泄漏。

### 5.1 运行时不可用的恢复触发点（审查修正：不得新增交互）

现状问题（§2.7-H3）：`src/tiptap-code-block.ts:495-507` 置 `mermaidUnavailable = true` 后，`paint()` 只在 `!isMermaid` 分支复位它（`:526-533`），而渲染门又要求 `!mermaidUnavailable`（`:485-491`），于是该块在本会话内永久退化。

恢复必须靠**已有的**事件触发，不引入重试按钮（按钮属于 §10 的交互改造）：

| 入口 | 触发事件（全部已存在） | 行为 |
| --- | --- | --- |
| Markdown 块 | 节点视图 `update()` → `paint()`；内容变更 | `paint()` 依据 `state` 派生可用性而不是读一个单向标志位；`state === 'runtime'` 时允许再次尝试加载 |
| `.mmd` | 模式切换 / 重新进入 `paintMermaid()`（每次重建 split view，已如此） | 重建即重试 |

验收相应收紧为：**在编辑或模式切换之后**、无需重载文档即可恢复出图（A6）。「一键重试按钮」「失败回落源码」「低频编译」等仍属 §10，另开 Issue。

## 6. 契约与兼容

| 项 | 变化 | 兼容性 |
| --- | --- | --- |
| `skills/taco/scripts/lint-mermaid.mjs` | 新增（调用式校验工具） | 不进入落盘链路；不下落为必需步骤 |
| `src/mermaid-diagnostics.ts` | 新增诊断模型与分型 | 新模块 |
| `src/mermaid.ts` | 增加 parse 门与 `onDiagnostic`；移除失败残留 | 内部 |
| `src/structured-file-viewer.ts` / `src/tiptap-code-block.ts` | 诊断呈现改为结构化 | 用户可见（文案更具体） |
| bundle / `.mmd` 格式 | **无变化** | `text/plain` 与 `taco/files` v1 不变 |
| 装配流程（`pack.mjs` 等） | **不涉及** | 本设计不依赖、不修改 |

`security` 边界不变：渲染产物仍必须经 `sanitizeMermaidSvg`；安全边界拒绝另归一类文案。

## 7. 验证方案

### 7.1 校验器（脚本级，可复跑）

- **正确性矩阵**（A1）：**22 个输入**的期望表（18 个合法图 + 3 个语法无效 + 1 个未知类型），逐条断言 `kind` 与是否报错；未知类型必须断言为 `unknown-type` 而非 `syntax`。任何人可重放，且须覆盖 §2.2 点名的 11 个易漏报族。
- **位置换算与 clamp**（A2）：构造围栏起始于第 N 行的 `.md`，断言诊断行号落在**围栏体范围内**（不得指向闭合围栏或越界）；已实测反例：悬空箭头会把未 clamp 的映射算到闭合围栏那一行。
- **字段优先级**：用固定样本锁定 §4.5 的取值顺序，并**分别断言行列的正确值**（不靠 clamp 掩盖偏差）：
  - 悬空箭头 `flowchart TD\n  A[Start] -->` → 第 **2** 行（`loc.first_line=2` ✓、`hash.line=2` ✓、`message` 说 3 ✗）；
  - 未闭合方括号 `flowchart TD\n  A[Start --> B[End]` → 第 **2** 行（`loc.first_line=2` ✓、`hash.line=1` ✗、`message` 说 2 ✓）；
  - sequence 缺冒号 `sequenceDiagram\n  Alice->>Bob hello` → 第 **2** 行；
  - langium 结构判定：gitGraph 非法语句 → 第 3 行第 3 列；`architecture-beta` 非法行 → 第 3 行第 8 列（同时断言 `error.name` 为 `Error` 时仍被正确判为 `syntax`）。
- **阶段分类**：构造 `parse` 阶段的非白名单异常（例如无 DOM 时的 `TypeError`）→ `kind === 'runtime'` 且退出码 `2`，断言它**不**被归为 `render`。
- **抛出式优先**：断言同一段源码在抛出式 `parse` 下产出 `detail` 与非空位置；在 `suppressErrors` 布尔路径下 `detail` 缺省但 kind 仍正确。
- **不可用路径**（A3）：屏蔽 jsdom 时退出码为 2 且不打印通过；屏蔽 shell 载荷时同样。
- **离线**（A4）：断开网络后对 Complete shell 场景断言仍全通过。
- **`--harness` 等价性**：同一输入在 `--harness` 模式下产出与默认模式同构的诊断（至少 1 个合法 + 1 个非法）。

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
| `src/mermaid-diagnostics.ts`（新增） | 诊断分型与位置提取（脚本与人侧共用） |
| `src/mermaid.ts` | parse 前置门、`onDiagnostic`、残留清理 |
| `src/structured-file-viewer.ts`、`src/tiptap-code-block.ts` | 诊断呈现与两入口一致 |
| `src/i18n.ts`、`src/styles.css` | 四类文案与诊断样式 |

## 9. 实现任务（设计阶段不实施）

1. **阶段一：诊断内核** — `src/mermaid-diagnostics.ts` + 单元测试（五类分型、jison 行号校准、langium 行列、不序列化 `error.result`）。
2. **阶段二：校验器** — `skills/taco/scripts/lint-mermaid.mjs`：shell 载荷提取 + 临时文件 + jsdom 注入与垫片 + 目录/文件/stdin 输入 + fence 行号换算 + `--json` + 退出码三态 + `--harness`。
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

## 11. 待评审确认的一点

校验器把 `jsdom` 作为硬约束（§4.3）：它是本设计中**唯一**新增外部依赖，换来的是「零误报」。替代路径 `--harness`（浏览器执行）零依赖但要求宿主提供浏览器工具（§4.4）。若要求「任何情况下都零依赖」，则必须在 §4.3 与「无 DOM 会误报 12/18」之间选择后者，本设计不建议。请评审时确认这一取舍。
