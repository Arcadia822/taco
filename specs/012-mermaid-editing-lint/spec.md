---
title: '012-mermaid-editing-lint'
feature_id: '012-mermaid-editing-lint'
created: '2026-09-28'
status: 'Draft'
issue: 'https://github.com/Arcadia822/taco/issues/51'
linear: 'https://linear.app/castrel/issue/TACO-19'
input: |-
  TACO-19: 优化 Mermaid 编辑交互并提供编写时语法诊断（lint）
---

## 0. 靶心修正（2026-09-28，重要）

**本设计的靶心从「给人看的编辑器交互」改为「Agent 创建/编辑 Taco 时的 Mermaid 校验」。界面是服务人的，因此人侧只需可读的诊断，不需要按 Agent 的便利重做交互。**

同时**撤回**初稿中的一条错误断言：初稿 §2.3 写「`classDiagram` 非法成员：`parse()` 通过、`render()` 抛 `TypeError`，证明只做 parse 前置不足以判定可渲染」。经真机浏览器复核（pinned mermaid 12.0.0 + Taco 自身配置），该用例 **parse 与 render 均通过**；当时的 `TypeError` 来自测试环境缺少 `SVGElement.getBBox` 垫片，不是 mermaid 的行为。以该错误断言推导出的「parse 不足」结论一并作废。

修正后的证据（受控矩阵，21 个用例含 18 个合法图，同一份 pinned mermaid）：

| payload | DOM | 合法图正确通过 | 漏报 | 把非法当合法 |
| --- | --- | --- | --- | --- |
| shell 内嵌 | 无 | 6/18 | **12** | 0 |
| shell 内嵌 | jsdom | **18/18** | 0 | 0 |
| CDN 镜像 | 无 | 6/18 | **12** | 0 |
| CDN 镜像 | jsdom | **18/18** | 0 | 0 |

- **纯 Node（无 DOM）的 Mermaid 校验不可用**：`stateDiagram-v2`、`classDiagram`、`gantt`、`journey`、`mindmap`、`timeline`、`quadrantChart`、`sankey`、`kanban`、`c4`、`pie title` 等 **12 个合法图被判为无效**。根因：`setupDompurifyHooks` 抛 `TypeError: My.addHook is not a function` —— 这些图族要经 DOMPurify，而 DOMPurify 无法在无 DOM 环境初始化。若把这种实现做成门禁，会**拦下正确文档**。
- **jsdom 层即足**：18/18 正确、零误收，且与 payload 无关 → 可直接复用 **Complete shell 内嵌的 mermaid 载荷**（`<script id="taco-asset-mermaid" type="taco/deflate-b64">`，deflate-raw + base64，`zlib.inflateRawSync` 即可解出），与接收方运行时**字节一致**、离线、无需 `npm i mermaid`。
- **render 阶段只能作参考**：真机 headless Chromium 中合法 `mindmap` 源码 render 直接 `TypeError`（`Cannot read properties of null (reading 're')`），jsdom 下 render 对 mindmap 亦假失败；因此 render 判定**不得**作为语法结论，只能标注为「渲染阶段失败（无位置）」。
- **泄漏在真机成立**：真实浏览器连续渲染失败时 `body > div[id^="d"]` 数量 1→2→3→4 单调增长，且成功渲染不会清理历史残留。

据此，§3 之后的需求/方案面向 Agent 侧校验重写；原 D1/D2 交互裁决仍然有效，但降级为可选范围（见 §8）。

## 1. 背景与目标

TACO-19（GitHub #51）指出：Taco 里 Mermaid 的「源码 / 预览」交互存在可用性问题，编写无效 Mermaid 时只得到一句通用错误，缺少**指向源码**的可操作诊断。

**真实痛点（经用户澄清）**：Taco 的 Agent 工作流**要求 Agent 编写 Mermaid**（`skills/taco/SKILL.md:39` 与 `extensions/taco/policies/taco-agent-policy.md:21` 都指示把流程/时序/状态设计写成 `diagrams/*.mmd`），但 Agent 侧**没有任何 Mermaid 校验**：

- `skills/taco/scripts/pack.mjs:59` 把 `.mmd` 映射为 `text/plain` 后即视为不透明文本；
- `validateBundle`（`pack.mjs:387`）只校验 bundle 信封结构；
- `verify`（`pack.mjs:900` 附近）只打印结构与导航警告。

结果是：**Agent 写坏图没人告诉它**，第一发现者是打开浏览器的人，而人只看到一句通用错误。这既是 Agent 侧的检测缺失，也让人无法据此修正，更无法把问题回传给 Agent。

本特性覆盖两个入口，并要求两者表现一致：

- Markdown 文档内的 ```` ```mermaid ```` 代码块（`src/tiptap-code-block.ts`）；
- 独立的 `.mmd` 文件（`src/structured-file-viewer.ts`）。

目标是让 Mermaid 的编辑过程变成「可定位、可修正、不误导、可恢复」：

1. 编辑期给出带**错误类别**与**行列（可得时）**的诊断，并保留底层原始信息；
2. 预览不再因每次按键而被高频清空（debounce + 单飞），清空窗口可控；
3. 源码错误、运行时不可用、渲染期失败三类状态互不冒充；
4. 出现错误时源码始终可编辑，且 Markdown 与 `.mmd` 入口趋于一致。

本文件是设计源文件（权威），`.taco.html` 只是评审载体。当前状态为 **Draft**，未冻结。

## 2. 现状诊断（证据）

下列结论全部来自当前工作区代码与一次性探针实测（探针脚本位于临时目录，未纳入版本库）。

### 2.1 预览在每次按键时被同步清空

`src/mermaid.ts:499-502` 在**同步**阶段就把预览面重置为加载态：

```ts
const id = `taco-mermaid-${++diagramSerial}`
surface.className = 'surface is-loading'
surface.textContent = labels.loading
surface.dataset.renderId = id
```

随后才把真正的渲染 `enqueue` 进 `MermaidRuntime` 的串行队列（`src/mermaid.ts:197-199`、`:558`）。因此**每一次** `updateCode` 都会先销毁已渲染的 SVG。

实测（真实 `createMermaidPreview` + 受控 runtime）：

| 阶段 | `.surface` class | 文本 | 是否有 SVG |
| --- | --- | --- | --- |
| 首次渲染完成 | `surface` | `First` | 是 |
| 第 1 次按键后 | `surface is-loading` | `Loading` | **否** |
| 连续按键后 | `surface is-loading` | `Loading` | **否** |
| 队列中渲染完成后 | `surface` | `Render-2` | 是 |

结论：输入过程中预览长期空白；「一边看图一边改」在语法正确时也无法做到。这是本 Issue 最主要的体验痛点（按 D1 裁决，以 debounce + 单飞缓解，而非保留旧图，见 §4.2/§8）。

### 2.2 语法错误时源码不可达，且与错误文案自相矛盾

`src/tiptap-code-block.ts:479-480`：

```ts
preview.hidden = !isMermaid || mermaidUnavailable
source.hidden = isMermaid && !mermaidUnavailable
```

只要 Mermaid 运行时**已加载**，源码 `<pre>` 就恒为 `hidden`，而该 `<pre>` 内的 `<code>` 正是 Tiptap 的可编辑内容区（`src/tiptap-code-block.ts:583-585` 返回 `contentDOM: content`）。同时：

- `src/tiptap-code-block.ts:466`：`panelButton.hidden = true`，代码面板按钮永不出现；
- `src/tiptap-code-block.ts:493`：`allowCodePanel: false`，块内无法打开代码面板；
- `src/i18n.ts:128`：错误文案是「Mermaid 语法有误；请展开源码修正。」，但**没有可展开的入口**；
- 唯一入口是双击预览进入全屏弹窗（`src/tiptap-code-block.ts:540` → `:281-318` 复用同一 split view 并 `setAllowCodePanel(true)`）。

实测（Markdown 中语法错误的块）：`sourceHidden: true`、`previewHidden: false`、`surfaceClass: 'surface is-error'`——源码被隐藏、预览只剩通用错误。

另外 `is-source-visible` 类（`src/tiptap-code-block.ts:460,501`）在样式表中**没有任何规则**（`grep -c "is-mermaid" src/styles.css` 返回 0），是死钩子。

### 2.3 诊断退化为一个字符串

`src/mermaid.ts:551-553` 与 `src/structured-file-viewer.ts:706-708` 都把底层错误压缩成同一个 `labels.error`：

```ts
surface.className = 'surface is-error'
surface.textContent = labels.error
onRenderError?.(error)
```

`error.message`、类别（`error.name`）、位置信息全部被丢弃。`.mmd` 入口的实测诊断区内容就是 `["Invalid Mermaid"]`。

但 Mermaid 12 实际提供了可用的结构化数据（探针实测）：

| 错误族 | 触发示例 | 可用字段 | 备注 |
| --- | --- | --- | --- |
| jison（flowchart / sequence 等） | `flowchart TD` + 悬空箭头 | `error.hash.line`、`error.hash.loc{first_line,last_line,first_column,last_column}`、`hash.token`、`hash.expected[]`，`message` 含 `Parse error on line N` 与指示线 | **字段互相矛盾**：同一输入 `hash.line=3`、`loc.first_line=2`、`message` 说 "line 4"，不能盲信 |
| langium（gitGraph 等） | `gitGraph` + 非法语句 | `error.name === 'MermaidParseError'`，`error.result.parserErrors[0].token.{startLine,startColumn,endLine,endColumn,startOffset,endOffset}`；`message` 为 `Parse error on line 3, column 3: …` | 精确可用；但 `error.result` 极大且自引用，**绝不可整体序列化或写日志** |
| 未识别类型 | 空内容、纯 `%%` 注释、未知图表头 | `error.name === 'UnknownDiagramError'`，无位置 | 与「语法错误」不是一回事 |
| 渲染期非解析错误 | 需在真实浏览器复核 | 见 §0：初稿把 `classDiagram` 用例判为「parse 通过、render 抛 TypeError」，已撤回；真机下该用例 parse/render 均通过，当时的 `TypeError` 是测试环境缺 `getBBox` 垫片所致 |

### 2.4 运行时不可用与语法错误混同，且不可恢复

- `MermaidRuntime.load()` 失败时会清空缓存的 promise 以允许重试（`src/mermaid.ts:190-192`），`createMermaidPreview` 层面可以恢复（探针中恢复后成功出图）。
- 但 Markdown 块把不可用**锁死**：`src/tiptap-code-block.ts:495-507` 的 `onUnavailable` 置 `mermaidUnavailable = true`，而 `paint()` 只在 `!isMermaid` 分支复位它（`:526-533`），**加载成功后也没有任何复位路径**。结果是网络恢复后该块在本次会话内永久退化为只读源码。
- 该分支**没有任何提示**说明原因（与 `specs/001-taco-bento-product/spec.md:43,132` 的 FR-007a「不可用时降级为可编辑源码」一致，但缺少原因告知）。
- 预览面同时停在假进度：`src/mermaid.ts:511-512` 只写 `host.dataset.mermaidUnavailable = 'true'` 后 `return`，**不清除 `surface is-loading`**。实测：`{className: 'surface is-loading', text: 'Loading'}`——用户同时看到「正在渲染图表…」和后续的「预览不可用」。

### 2.5 每次渲染失败都在 `document.body` 残留一个错误 SVG

Mermaid 在 `render()` 失败时会向 `document.body` 注入临时容器 `div#d{id}` 并**不清理**。实测（真实 mermaid 12）：

- 连续 3 次失败 → `body > div[id^="d"]` = `['dtaco-mermaid-1', 'dtaco-mermaid-2', 'dtaco-mermaid-3']`；
- 只有**同一 id** 后续渲染成功才会把它清掉；
- Taco 的 id 每次自增（`src/mermaid.ts:499`），因此实时编辑下**单调增长**，长会话中 DOM 与样式表持续膨胀；
- 该残留 SVG 带 `aria-roledescription="error"`、内含文档级选择器的 `<style>`，且**不经过** `sanitizeMermaidSvg`（`src/security.ts:121-150`）的安全边界；
- 对照实验：只调用 `mermaid.parse(..., { suppressErrors: true })` **不产生任何残留**。

### 2.6 两个入口表现不一致（与验收第 1 条冲突）

| 关注点 | Markdown 代码块 | `.mmd` 独立文件 |
| --- | --- | --- |
| 错误归属 | 无 `onRenderError` 接线（`src/tiptap-code-block.ts:490-513` 未传该回调） | 有独立回调（`src/structured-file-viewer.ts:706-708`） |
| 诊断呈现位置 | 预览面内部 | 内容区上方的 `structured-file-diagnostics` |
| 源码是否自动展开 | 否（恒隐藏） | 是（`toggleCodePanel(true)`，`:701-708`） |
| 文案 | `labels.error` | `labels.error` / `labels.mermaidUnavailable` |

### 2.7 交互状态分散（需真机复核）

以下三点从代码阅读得出，**尚未在真机浏览器验证**，列为实现前必须复核的项：

1. **全屏与内联缩放各自维护状态**：内联缩放直接改 `previewHost.style.scale/translate`（`src/mermaid-split-view.ts:228-238`），全屏进出时又保存/恢复 `inlineScale/inlineTranslation`（`src/tiptap-code-block.ts:337-341`、`:410-413`），`--mermaid-zoom-width/min-width` 变量由 dialog 单独设置；同一份「视口状态」有三个副本。
2. **退出全屏时 `restoreView()` 可能执行两次**：`closeDialog()` 里调用一次（`src/tiptap-code-block.ts:417-419`），`dialog` 的 `close` 事件里又调用一次（`:427`）；其中包含 `setAllowCodePanel(false)` 与元素搬移。
3. **「实时更新 / 手动更新」开关在 Markdown 块内不可达**：该开关位于浮动代码面板头部（`src/mermaid-split-view.ts:190-212`），而 Markdown 块的面板被硬编码禁用（`allowCodePanel: false`、`panelButton.hidden = true`），因此只能在全屏弹窗里操作。

## 3. 需求与验收

### 3.1 需求

| 编号 | 需求 | 来源 |
| --- | --- | --- |
| R1 | 编辑期对 Mermaid 语法/解析错误给出清晰 lint 提示；有位置数据时标出行列 | Issue 期望 1 |
| R2 | 诊断必须保留底层错误原始信息（便于复制排查） | Issue 期望 1、验收 3 |
| R3 | 源码被修正后，诊断及时消失并恢复预览 | Issue 期望 1 |
| R4 | 源码错误与 Mermaid 运行时加载失败分开呈现，互不冒充 | Issue 期望 2、验收 2 |
| R5 | 任何失败状态下源码仍可编辑，且不被旧预览或通用错误掩盖 | Issue 期望 2 |
| R6 | 梳理实时/手动预览切换，以及源码、预览、选择、缩放交互，修复可复现问题 | Issue 期望 3 |
| R7 | 有效图表的既有操作（主题/方向/复制/评论/全屏）不回归 | Issue 期望 3 |
| R8 | Markdown 代码块与 `.mmd` 两个入口表现一致 | 验收 1 |
| R9 | 记录并验证具体交互故障的复现路径，不得只改文案 | 验收 3 |

### 3.2 验收条件

- **A1** 在 Markdown 代码块与 `.mmd` 两处，把无效源码改成有效源码：诊断出现、消失、预览恢复三者均与**当前**源码一致；两个入口的类别文案与源码可达性一致。
- **A2** 模拟 Mermaid 运行时不可用（阻断 CDN）：提示原因（不是语法错误），编辑器仍可用；**恢复网络后无需重载文档即可重新出图**。
- **A3** 编辑过程中预览不被高频清空：输入触发编译的频率由 debounce 控制（默认 ~800ms + 单飞），渲染期间预览呈现明确的 `rendering` 态而非旧图冒充当前结果（D1：不保留旧图）。
- **A4** 连续 N（≥5）次渲染失败后，`document.body` 中 `div[id^="d"]` 数量不增长。
- **A5** 出现语法错误时，Markdown 块与 `.mmd` 都**整体回落为可编辑的原始源码**并附顶部诊断摘要，用户可在同一视图内修正（D2）。
- **A6** 每一类失败都能取得：类别、面向用户的消息、底层原始信息；可定位时附行列。
- **A7** 有效图表的主题切换、方向切换、复制、行/节点评论、全屏缩放行为与改动前一致。
- **A8** 复现清单（见 §6.2）逐条验证并记录结果。

## 4. 方案设计

### 4.1 统一诊断模型

新模块 `src/mermaid-diagnostics.ts`，把「原始异常 → 可呈现诊断」收敛到一处：

```ts
export type MermaidDiagnosticKind =
  | 'syntax'        // 解析/语法错误，可能带位置
  | 'unknown-type'  // 未识别图表类型（含空内容、纯注释）
  | 'runtime'       // Mermaid 运行时不可用（加载失败/离线）
  | 'render'        // 通过 parse 但渲染阶段失败
  | 'sanitizer'     // 未通过 SVG 安全边界（security:*）

export interface MermaidDiagnostic {
  kind: MermaidDiagnosticKind
  message: string          // 本地化后的用户消息
  detail?: string          // 底层原始文本，原样保留、不翻译
  line?: number            // 1 基
  column?: number          // 1 基
  endLine?: number
  endColumn?: number
  token?: string
  expected?: string[]
}
```

分型与位置提取规则（**白名单取值，绝不整体序列化 error**）：

1. `error.name === 'UnknownDiagramError'` → `unknown-type`，无位置；空/纯空白源码由调用方先行判定，不进入异常路径。
2. `error.name === 'MermaidParseError'` → `syntax`；从 `result.parserErrors[0].token` 取 `startLine/startColumn/endLine/endColumn`（langium 1 基，直接可用）。
3. 存在 `error.hash`（jison）→ `syntax`；行号以 `message` 中 `Parse error on line (\d+)` 为准并 clamp 到 `[1, 源码行数]`；`hash.loc` 仅在它与 message 行号自洽时才用于列；`hash.token`/`hash.expected` 作为可选细节。
4. `message.startsWith('security:')` → `sanitizer`（`security:mermaid-too-large` / `security:mermaid-invalid-svg`）。
5. 其余（含 `TypeError`）→ `render`。

> 设计约束：jison 族的 `hash.line`/`hash.loc` 与 `message` 互相矛盾（§2.3 实测），因此**不得**把 `hash.loc` 直接当作「行列」对外承诺；`detail` 永远保留原始 message 作为兜底。

### 4.2 用 `parse` 前置做 lint

- 在 `MermaidApi` 接口上补可选方法（CDN 与测试桩兼容）：

```ts
parse?: (
  text: string,
  options?: { suppressErrors?: boolean },
) => Promise<false | { diagramType: string; config?: Record<string, unknown> }>
```

- lint 流程：`parse(source, { suppressErrors: true })` 返回 `false` → 出诊断、**不调用 `render()`**（也就不会产生 §2.5 的残留）；返回结果对象 → 进入渲染。
- 时机（按 D1 裁决：**不保留旧预览，因此必须降低实时编译频率**）：输入后 **debounce ~800ms** 起步（默认值，允许后续按手感调整到 500–1000ms 区间）；进行中只保留最新一次待执行（单飞），连击不排队；诊断面板若已显示错误，则改为「静默重试」——仅当结果变化（错误消失或位置改变）才更新显示，避免闪烁。实测解析成本：常规图 3–13ms、120 节点流程图 69ms（jsdom 环境），800ms debounce 后开销可接受。
- lint 与渲染共用同一个 `MermaidRuntime`，并在首次 `initialize` 之后执行，保证 `layout: 'elk'`、`securityLevel: 'strict'` 等配置对两者一致。
- **分支矩阵**（审查修正）：lint 与诊断必须覆盖三条输入分支——
  1. `parse` 可用且返回 `false`（`suppressErrors` 生效，**没有异常对象**）：类别只能按「未识别图表类型 vs 语法错误」两步细化——先对源码做廉价的预判（空/纯注释/无图表头 → `unknown-type`），其余一律 `syntax`；此分支 `detail` **缺省**（如实不展示底层信息，只给通用语法错误文案），不得声称保留了不存在的原始异常；
  2. `parse` 可用但抛异常（`suppressErrors` 未生效或桩实现）：按异常对象分类，`detail` 保留原始 message；
  3. `parse` 缺省（CDN/桩不提供）：退化为 `render` 失败路径，但渲染抛出的解析异常仍按 `syntax`/`unknown-type` 分类，不得误报为 `render`。
- **lint 输入与渲染输入一致**（审查修正）：`renderDiagram` 在显式主题与当前主题不同时会改写源码（`renderSource = updateMermaidCodeTheme(source, …)`，`src/mermaid.ts:542-543`）。**实现必须二选一并落地**（测试只是验证手段，不能替代）：要么让 lint 与 render 使用同一份**不改写**的输入，要么建立渲染输入到可编辑源码的**确定性行列映射**（记录改写引入/删除的行数并平移）。不得只加测试而保留漂移。
- 已知局限（必须承认，不得掩盖）：`parse` 通过不等于人能看见图——真机 headless 环境中合法 `mindmap` 的 render 仍会失败（§0）。因此 `render` 阶段的失败必须归为 `render` 类并标注「无位置信息」，**不得**被说成语法错误，也不得用来否定 parse 的通过结论。

### 4.3 预览状态机

`MermaidPreviewElement` 增加显式状态，并以 `data-*` 暴露给上层与 CSS：

```
empty → linting → rendering → valid
                        ↘ invalid        （syntax / unknown-type / render / sanitizer）
     ↘ unavailable                       （runtime）
```

- `host.dataset.mermaidState`：上列状态之一。
- **渲染期间（按 D1 裁决）清空旧图并显示 `rendering` 态**：不保留旧 SVG；配合 §4.2 的低频编译（debounce ~800ms + 单飞），让「清空到出图」的时间窗可控。
- 失败时进入 `invalid`（不显示旧图）；`unavailable` 时不得停留在「正在渲染」→ 解 §2.4。
- **诊断摘要容器独立于预览面**（审查修正）：`invalid/unavailable` 下预览面整体回落为源码（§4.4），因此诊断、失败原因与「重试加载」按钮必须渲染在**独立于 `preview.hidden` 切换的摘要节点**（Markdown 块置于源码区顶部；`.mmd` 置于内容区顶部），由统一的 `onDiagnostic` 更新。预览面内部的错误呈现只是 `valid` 路径的兜底，不承担 A2/A5/A6。
- 状态转换必须显式：`rendering` 不得回退到 `valid`（除非真正渲染成功）；`invalid` 与 `valid` 之间只经 `linting/rendering` 迁移，保证「诊断出现、消失与预览恢复」都来自当前源码（A1）。
- **初始化失败归属**（审查修正）：`mermaid.initialize` 抛出的异常（当前在 `renderDiagram` 的 try 之外，`src/mermaid.ts:516-531`）也必须进入受控失败边界——归入 `runtime` 类、状态转 `unavailable`、经 `onDiagnostic` 呈现并可重试，不得让 UI 卡在加载/处理中。
- `applyPreview` 参数当前无任何调用方（`src/mermaid.ts:491,555,564,588` 全链路无实参），按「删除死代码」处理，不保留。

### 4.4 源码可达性

按 D2 裁决：**错误时整个预览窗体展示原始代码**（不保留旧图、不叠加面板），有效时维持「预览优先」。

- Markdown 块的可见性判据改为「**当前是否处于有效渲染**」：

```ts
// state === 'valid' → 预览；其余（invalid/unavailable/rendering/empty）→ 原始源码
source.hidden  = isMermaid && !mermaidUnavailable && state === 'valid'
preview.hidden = !isMermaid || state !== 'valid'
```

- 也就是说：语法错误、渲染期失败、运行时不可用三种情况下，**代码块整体回落为可编辑的原始源码**（FR-007a 的语义扩展到所有失败形态），诊断以**源码区域顶部的一行摘要**呈现（类别 + 位置 + 可展开的 `detail`），而不是替换源码。
- `.mmd` 入口采用同一语义：失败时内容区回落到源码编辑器 + 顶部诊断摘要（与 Markdown 一致），不再强制展开浮动代码面板。
- `onDiagnostic` 必须在 Markdown 路径接线（`onRenderError`/`onUnavailable` 被其替换，见 §5），使其具备与 `.mmd` 相同的回调能力（解 §2.6）。
- 死钩子 `is-source-visible` 直接删除（样式表中不存在），可见性只由 `hidden` 与 `data-mermaid-state` 驱动。
- 不新增块内「源码/预览」切换按钮：有效图表保持预览优先，双击/按钮进全屏的既有操作不变（R7）。

### 4.5 失败残留清理

- 渲染失败后按 id 精确移除 mermaid 注入的容器（`#d{id}`），并在成功后做一次复查；
- 因 lint 前置已消除大部分失败路径，仍必须覆盖 `render` 阶段失败（`TypeError` 类）；
- 以 A4 作为回归断言。

### 4.6 运行时不可用与恢复

- 「不可用」不再永久锁死块：`mermaidUnavailable` 改为可派生、可复位的状态，`paint()` 时按 `state` 计算；
- 提供显式「重试加载」入口，并在下一次编辑时自动重试一次（`MermaidRuntime.load()` 已支持失败后重试）；
- **强制重试 API**（审查修正）：现有 `updateCode` 对相同源码立即返回（`src/mermaid.ts:580-582`）、Markdown 块也以 `renderedMermaid` 跳过同源码更新（`src/tiptap-code-block.ts:484`），因此「源码未变 + 点击重试」不会触发第二次 `load()`。方案要求 preview/split controller 提供显式 `retry()`：即使源码与主题未变也强制重新调度 `load()+render`，成功后向两个入口广播 `valid` 并清除不可用状态。必须覆盖「不编辑源码、仅点击重试」的用例。
- 面内文案区分「Mermaid 运行时不可用（原因）」与「源码仍可编辑」，不再停留在加载态。

### 4.7 交互梳理（先复核后改）

1. **单一视口状态源**：把内联 `scale/translate` 与全屏 zoom 收敛到 split view 的 `getViewport()/setViewport()`，删除 `tiptap-code-block.ts` 中的状态副本。
2. **`restoreView()` 幂等化**：消除 `closeDialog()` 与 `close` 事件的双重调用。
3. **渲染来源三态**（审查修正，替代原先的 `renderedSource` 单变量方案）：split view 与块节点必须区分
   - `currentSource`：编辑器当前内容；
   - `requestedSource`：最近一次提交给 lint/render 的内容；
   - `renderedSource`：**最近一次实际渲染成功的原始源码**（由 preview 在成功回调中回传，如 `onRendered(renderedSource)` 携带版本号）。
   现有 `renderedCode` 是「已请求」而非「已成功」，直接改名不能修复映射错误。节点/行映射（`syncSelection`、`onNodeHover`、行评论）只允许在 `currentSource === renderedSource` 时启用。
4. **手动预览模式的当前性**（审查修正）：手动模式下编辑源码必须立即把状态标记为 dirty——按 D1 统一语义，**移除/隐藏旧 SVG**（不保留任何旧图），提示「源码已修改，点击『更新图表』重新渲染」放入独立诊断摘要区域，源码保持可编辑；点击「更新图表」后才执行 lint/render。不得沿用 `state === 'valid'` 让旧图继续隐藏源码。
5. **缩放与状态共存**：明确「渲染中/失败回落源码 + 内联缩放」时的交互优先级（缩放状态不因状态切换被悄悄重置）。

### 4.8 文案与国际化

新增键（`zh-Hans` / `en` 双语，`src/i18n.ts`）：`mermaidDiagnosticSyntax`、`mermaidDiagnosticUnknownType`、`mermaidDiagnosticRuntime`、`mermaidDiagnosticRender`、`mermaidDiagnosticSanitizer`、`mermaidDiagnosticPosition(line, column)`、`mermaidRetry`、`mermaidEmptyDiagram`、`mermaidCopyDetail`。
现有 `mermaidError`（`src/i18n.ts:64,128`）保留为兜底，不再作为唯一信息。

## 5. 契约与兼容

| 项 | 变化 | 兼容性 |
| --- | --- | --- |
| `MermaidApi` | 新增可选 `parse` | 可选；CDN 与测试桩缺省时不启用 lint 前置，退化为现有 `render` 失败路径 |
| `MermaidPreviewElement` | 新增状态读取（`data-mermaid-state`）；`updateCode` 语义收紧为「状态显式迁移」 | DOM 契约新增，旧读取方不受影响 |
| `createMermaidSplitView` | `onRenderError`/`onUnavailable` 被替换为 `onDiagnostic(diagnostic)`（唯一回调链：preview → split view → 两入口各自摘要节点）；旧回调**移除**，不留兼容别名 | 内部 API，两入口同步接线 |
| `createTacoCodeBlock` | 失败形态下整体回落为源码（用户可见行为变化，正是本 Issue 目标） | 用户可见行为变化 |
| Bundle / 文件格式 | **无变化** | 不涉及 `taco/files` v1 |

`security` 边界不变：渲染产物仍必须经 `sanitizeMermaidSvg`；`sanitizer` 类失败必须有独立文案，不得冒充语法错误。

与既有产品契约的关系（审查确认项）：FR-007a / FR-012 / SC-004（`specs/001-taco-bento-product/spec.md:132,137,167`）关于「离线降级为可编辑源码」「无 Mermaid 文档不发起请求」的约束**全部保留**，本方案只是把「不可用降级」的语义扩展到所有失败形态，并要求实现阶段不引入任何额外的 CDN 请求时机。

## 6. 验证方案

### 6.1 自动化

- `src/mermaid-diagnostics.ts` 单元测试：五类错误对象的分类、jison 行号校准与 clamp、langium 行列、`error.result` 不被序列化、`detail` 保留原文、三条输入分支（`parse=false` / `parse` 抛异常 / `parse` 缺省）。
- `createMermaidPreview` 状态机测试：`empty/linting/rendering/valid/invalid/unavailable` 迁移；渲染中不残留旧图、明确 `rendering` 态（A3，D1）；失败后进入 `invalid` 且不显示旧图；`initialize` 抛错进入 `unavailable` 且可重试。
- lint 频率测试：连续输入时编译次数受 debounce + 单飞约束（A3，D1）。
- 强制重试测试：源码不变、仅调用 `retry()` 时重新 `load()+render` 并恢复 `valid`（A2）。
- 手动预览模式测试：编辑源码即 dirty——移除/隐藏旧 SVG、摘要区提示、源码可编辑（D1 一致）；点击更新后才 lint/render、失败后恢复（A1/A5）。
- 主题改写测试：源码含显式主题配置时 lint 输入与渲染输入一致、行列映射正确。
- 残留测试：连续 5 次 `render` 失败后 `document.body` 中 `div[id^="d"]` 计数不变（A4）。
- lint 前置测试：`parse` 返回 `false` 时 `render` 未被调用。
- 渲染成功回调测试：`onRendered(renderedSource)` 携带成功渲染的源码；节点/行映射仅在该版本与当前源码一致时启用（§4.7-3）。
- 双入口一致性测试：同一段无效源码在 Markdown 块与 `.mmd` 中产出同类诊断与等价的源码回落行为（A1、A8）。
- 回归：`tests/mermaid-docs.test.ts`、`tests/structured-file-viewer.test.ts`、`tests/tiptap-editor.test.ts`、`tests/markdown-reconstruction.test.ts` 全绿。

### 6.2 手工复现清单（A8 必须逐条记录）

| # | 路径 | 期望 |
| --- | --- | --- |
| M1 | Markdown 内新建 ```` ```mermaid ```` 块并逐字输入 | 可输入；空块不报语法错误；预览在有效后出现；连续输入时编译频率受 debounce 约束 |
| M2 | 有效 → 删成无效（如删掉箭头右侧） | 诊断出现并给出行/列；块整体回落为可编辑源码 + 顶部诊断摘要（D2）；不显示旧图 |
| M3 | 无效 → 补回有效 | 诊断消失、预览恢复，且恢复只来自当前源码（A1） |
| M4 | DevTools 离线后加载含 Mermaid 的文档 | 提示运行时不可用原因；源码可编辑；恢复网络后重试可出图 |
| M5 | 连续快速输入 20 次 | 预览不闪频（编译次数 ≈ 输入时长 / debounce）；无 `div[id^="d"]` 累积 |
| M6 | 主题/方向切换、复制、行评论、节点评论、双击全屏、全屏内缩放与退出 | 与改动前一致；退出全屏后内联缩放状态合理 |
| M7 | 同一段无效源码分别在 Markdown 与 `.mmd` | 诊断类别、位置信息与「回落为源码」行为一致 |
| M8 | `parse` 通过但渲染失败（`classDiagram` 非法成员） | 归为 `render` 类而非语法错误；可重试 |
| M9 | `sanitizeMermaidSvg` 拒绝（构造超大/非法 SVG） | 归为 `sanitizer` 类，独立文案 |
| M10 | 纯注释 / 未识别图表头 | `unknown-type` 中性态，不算语法错误 |
| M11 | 手动预览模式下把有效源码改成无效 | 旧 SVG 被移除/隐藏；摘要区提示源码已修改；源码可编辑；点击更新后才 lint/render |
| M12 | 离线失败后不编辑源码、仅点击「重试加载」 | 重新加载并恢复 `valid`（A2） |

### 6.3 证据留存

探针 JSON（`tmp/probe-*.json`）在实现阶段转化为上述测试用例后删除，不进入版本库。

## 7. 影响范围

| 文件 | 角色 |
| --- | --- |
| `src/mermaid.ts` | 渲染流程、状态机、`MermaidApi`、残留清理 |
| `src/mermaid-diagnostics.ts`（新增） | 诊断分类与位置提取 |
| `src/mermaid-split-view.ts` | 实时/手动更新、面板、视口、选择联动 |
| `src/tiptap-code-block.ts` | Markdown 块的可见性、回调接线、块内面板 |
| `src/structured-file-viewer.ts` | `.mmd` 诊断呈现对齐 |
| `src/i18n.ts`、`src/styles.css` | 文案与状态样式 |
| `src/security.ts` | 只读依赖（`security:*` 归类） |

## 8. 已裁决项

### D1 编辑/失败期间是否保留上一张成功预览

**裁决：A1 —— 不保留旧预览；同时降低实时编译频率以缓解闪空。**

- 渲染期间不显示旧 SVG（`rendering` 态明确表达「正在按当前源码重画」，旧图不冒充当前结果，满足「不让旧预览掩盖当前状态」）。
- 以 debounce（默认 ~800ms，可在 500–1000ms 调整）+ 单飞约束编译频率，使清空窗口可控（§4.2）。
- 已在错误状态下改为「静默重试」：仅当诊断结果变化才更新显示，避免反复闪烁。

### D2 Markdown 块内源码的常驻入口

**裁决：错误时整个窗体展示原始代码。**

- 有效时维持预览优先（既有全屏入口不变，R7）。
- 任何失败形态（syntax / render / sanitizer / runtime）下，代码块整体回落为可编辑原始源码，诊断以源码区顶部摘要呈现；`.mmd` 同语义（R8）。
- 不新增块内「源码/预览」切换按钮（与 B1 方案不同，明确记录为**未采纳**）。

## 9. 实现任务（设计阶段不实施）

1. **阶段一：诊断内核** — `src/mermaid-diagnostics.ts` + 单元测试（五类分型、位置提取、不序列化 error）。
2. **阶段二：渲染管线与状态机** — `MermaidApi.parse` 接入、lint 前置 + debounce ~800ms + 单飞、状态机与 `data-*`、渲染期清空旧图、残留清理（A3/A4）。
3. **阶段三：入口一致性** — Markdown 块与 `.mmd` 的「失败回落为源码 + 顶部诊断摘要」（A1/A5）、`onDiagnostic` 接线（替换 `onRenderError`）。
4. **阶段四：运行时可用性** — 不可用提示、重试与自动恢复（A2）。
5. **阶段五：交互收敛** — 视口状态源、`restoreView` 幂等、选择联动（R6），先真机复核 §2.7。
6. **阶段六：文案与回归** — i18n 双语、全量测试与手工清单 M1–M12。
