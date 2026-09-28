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

## 1. 背景与目标

TACO-19（GitHub #51）指出：Taco 里 Mermaid 的「源码 / 预览」交互存在可用性问题，编写无效 Mermaid 时只得到一句通用错误，缺少**指向源码**的可操作诊断；同时需要把「源码错误」与「Mermaid 运行时加载失败」区分开，并梳理实时/手动预览、源码面板、缩放之间的交互。

本特性覆盖两个入口，并要求两者表现一致：

- Markdown 文档内的 ```` ```mermaid ```` 代码块（`src/tiptap-code-block.ts`）；
- 独立的 `.mmd` 文件（`src/structured-file-viewer.ts`）。

目标是让 Mermaid 的编辑过程变成「可定位、可修正、不闪烁、不误导」：

1. 编辑期给出带**错误类别**与**行列（可得时）**的诊断，并保留底层原始信息；
2. 预览不再因每次按键而清空，仍有图可参照；
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

结论：输入过程中预览长期空白；「一边看图一边改」在语法正确时也无法做到。这是本 Issue 最主要的体验痛点。

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
| 渲染期非解析错误 | `classDiagram` 非法成员 | `parse()` **通过**，`render()` 抛 `TypeError` | 证明**只做 parse 前置不足以判定可渲染** |

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
- **A3** 编辑过程中预览不再清空：连续输入时上一张有效图保持可见，并带明确的「对应的是修改前源码」标记。
- **A4** 连续 N（≥5）次渲染失败后，`document.body` 中 `div[id^="d"]` 数量不增长。
- **A5** 出现语法错误时，Markdown 块的源码区与 `.mmd` 的代码面板都**自动可用**，用户可在同一视图内修正。
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
- 时机：输入后 **debounce ~250ms**；进行中只保留最新一次待执行（单飞），避免连击时刷队列。实测解析成本：常规图 3–13ms、120 节点流程图 69ms（jsdom 环境），debounce 后可接受。
- lint 与渲染共用同一个 `MermaidRuntime`，并在首次 `initialize` 之后执行，保证 `layout: 'elk'`、`securityLevel: 'strict'` 等配置对两者一致。
- 空内容 / 纯空白：**不 lint、不报语法错误**，UI 表达为「尚未识别图表类型」的中性态。
- 已知局限（必须承认，不得掩盖）：`parse` 通过不等于可渲染（§2.3 的 `classDiagram` `TypeError`）。因此 `render` 阶段的失败仍归为 `render` 类，且**不得**被说成语法错误。

### 4.3 预览状态机

`MermaidPreviewElement` 增加显式状态，并以 `data-*` 暴露给上层与 CSS：

```
empty → linting → rendering → valid
                        ↘ invalid        （syntax / unknown-type / render / sanitizer）
     ↘ unavailable                       （runtime）
```

- `host.dataset.mermaidState`：上列状态之一。
- `host.dataset.mermaidStale`：`'true'` 表示「面内显示的是上一次成功渲染的图，与当前源码不一致」。
- `rendering` 期间**保留**上一张 SVG，仅在角落显示轻量更新指示（不再清空 `surface`）→ 解 §2.1。
- 失败时：`invalid` + `mermaidStale='false'`（不显示旧图），面内呈现诊断摘要（类别 + 消息 + 可得的位置）；`unavailable` 时面内呈现原因而非「正在渲染」→ 解 §2.4。
- `applyPreview` 参数当前无任何调用方（`src/mermaid.ts:491,555,564,588` 全链路无实参），按「删除死代码」处理，不保留。

### 4.4 源码可达性

- Markdown 块的可见性判据从「运行时是否可用」改为「**当前是否处于有效渲染**」：

```ts
source.hidden  = isMermaid && !mermaidUnavailable && state === 'valid'
preview.hidden = !isMermaid
```

- 恢复块内的「代码面板」按钮（`panelButton.hidden` 不再恒真），并传 `allowCodePanel: true`，使「源码 / 预览」切换在块内可达，与 `.mmd` 的 `standalone-mermaid-source` 一致；这也是「实时/手动更新」开关可达的前提（解 §2.7-3）。
- `onRenderError` 必须在 Markdown 路径接线，使其具备与 `.mmd` 相同的回调能力（解 §2.6）。
- 死钩子 `is-source-visible` 直接删除（样式表中不存在），可见性只由 `hidden` 与 `data-mermaid-state` 驱动。

### 4.5 失败残留清理

- 渲染失败后按 id 精确移除 mermaid 注入的容器（`#d{id}`），并在成功后做一次复查；
- 因 lint 前置已消除大部分失败路径，仍必须覆盖 `render` 阶段失败（`TypeError` 类）；
- 以 A4 作为回归断言。

### 4.6 运行时不可用与恢复

- 「不可用」不再永久锁死块：`mermaidUnavailable` 改为可派生、可复位的状态，`paint()` 时按 `state` 计算；
- 提供显式「重试加载」入口，并在下一次编辑时自动重试一次（`MermaidRuntime.load()` 已支持失败后重试）；
- 面内文案区分「Mermaid 运行时不可用（原因）」与「源码仍可编辑」，不再停留在加载态。

### 4.7 交互梳理（先复核后改）

1. **单一视口状态源**：把内联 `scale/translate` 与全屏 zoom 收敛到 split view 的 `getViewport()/setViewport()`，删除 `tiptap-code-block.ts` 中的状态副本。
2. **`restoreView()` 幂等化**：消除 `closeDialog()` 与 `close` 事件的双重调用。
3. **选择联动**：`syncSelection`/`onNodeHover` 目前用 `code === renderedCode` 判断是否可映射到行（`src/mermaid-split-view.ts:283-291,353`），在「保留旧图」语义下须改为与 `renderedSource` 显式比对，避免高亮错行。
4. **缩放与预览共存**：明确「保留旧图 + 内联缩放」时的交互优先级（缩放不因状态切换被重置）。

### 4.8 文案与国际化

新增键（`zh-Hans` / `en` 双语，`src/i18n.ts`）：`mermaidDiagnosticSyntax`、`mermaidDiagnosticUnknownType`、`mermaidDiagnosticRuntime`、`mermaidDiagnosticRender`、`mermaidDiagnosticSanitizer`、`mermaidDiagnosticPosition(line, column)`、`mermaidRetry`、`mermaidStaleNotice`、`mermaidEmptyDiagram`、`mermaidCopyDetail`。
现有 `mermaidError`（`src/i18n.ts:64,128`）保留为兜底，不再作为唯一信息。

## 5. 契约与兼容

| 项 | 变化 | 兼容性 |
| --- | --- | --- |
| `MermaidApi` | 新增可选 `parse` | 可选；CDN 与测试桩缺省时不启用 lint 前置，退化为现有 `render` 失败路径 |
| `MermaidPreviewElement` | 新增状态读取（`data-mermaid-state` / `data-mermaid-stale`），`updateCode` 语义收紧为「不清空旧图」 | DOM 契约新增，旧读取方不受影响 |
| `createMermaidSplitView` | 新增 `onDiagnostic`；`onRenderError` 保持 | 增量 |
| `createTacoCodeBlock` | `allowCodePanel` 在 Mermaid 块内改为可用 | 用户可见行为变化（正是本 Issue 目标） |
| Bundle / 文件格式 | **无变化** | 不涉及 `taco/files` v1 |

`security` 边界不变：渲染产物仍必须经 `sanitizeMermaidSvg`；`sanitizer` 类失败必须有独立文案，不得冒充语法错误。

## 6. 验证方案

### 6.1 自动化

- `src/mermaid-diagnostics.ts` 单元测试：五类错误对象的分类、jison 行号校准与 clamp、langium 行列、`error.result` 不被序列化、`detail` 保留原文。
- `createMermaidPreview` 状态机测试：`empty/linting/rendering/valid/invalid/unavailable` 迁移；渲染中保留旧图（A3）；失败时 `stale=false`。
- 残留测试：连续 5 次 `render` 失败后 `document.body` 中 `div[id^="d"]` 计数不变（A4）。
- lint 前置测试：`parse` 返回 `false` 时 `render` 未被调用。
- 双入口一致性测试：同一段无效源码在 Markdown 块与 `.mmd` 中产出同类诊断与等价的源码可达性（A1、A8）。
- 回归：`tests/mermaid-docs.test.ts`、`tests/structured-file-viewer.test.ts`、`tests/tiptap-editor.test.ts`、`tests/markdown-reconstruction.test.ts` 全绿。

### 6.2 手工复现清单（A8 必须逐条记录）

| # | 路径 | 期望 |
| --- | --- | --- |
| M1 | Markdown 内新建 ```` ```mermaid ```` 块并逐字输入 | 可输入；不报假语法错误；预览在有效后出现 |
| M2 | 有效 → 删成无效（如删掉箭头右侧） | 诊断出现并给出行/列；源码自动可用；旧图不被当成本结果 |
| M3 | 无效 → 补回有效 | 诊断消失、预览恢复、`stale` 归位 |
| M4 | DevTools 离线后加载含 Mermaid 的文档 | 提示运行时不可用原因；源码可编辑；恢复网络后重试可出图 |
| M5 | 连续快速输入 20 次 | 预览不闪空；无 `div[id^="d"]` 累积 |
| M6 | 主题/方向切换、复制、行评论、节点评论、双击全屏、全屏内缩放与退出 | 与改动前一致；退出全屏后内联缩放状态合理 |
| M7 | 同一段无效源码分别在 Markdown 与 `.mmd` | 诊断类别与源码可达性一致 |

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

## 8. 待裁决项

以下两点会实质改变体验与契约，无法仅由 Issue 与仓库证据推定，需人工确认（推荐项已标注）。

### D1 编辑/失败期间是否保留上一张成功预览

Issue 要求「不让旧预览或通用错误掩盖当前状态」，但 §2.1 的闪空同样是主要痛点；两者张力需要定夺。

| 选项 | 行为 | 取舍 |
| --- | --- | --- |
| A1（不保留） | 失败或重新渲染时清空为诊断 | 最不误导；代价是编辑期间几乎看不到图，闪空痛点不解决 |
| A2（保留 + 显式标记，推荐） | 保留旧图并显示「预览对应修改前的源码」标记（`data-mermaid-stale`） | 兼顾「边看边改」与不掩盖；需保证标记醒目、可关闭 |
| A3（保留 + 淡化） | 旧图淡化 40% 并一键「回到上次有效渲染」 | 信息最全；实现与交互最复杂，可能造成视觉噪音 |

### D2 Markdown 块内源码的常驻入口

| 选项 | 行为 | 取舍 |
| --- | --- | --- |
| B1（恢复代码面板按钮 + 错误时自动展开，推荐） | 块内提供「源码 / 预览」切换，与 `.mmd` 一致 | 直接满足 R8/R6；改动面较大 |
| B2（仅错误时自动展开） | 有效时保持现状，失败时自动展开源码 | 改动最小；「实时/手动更新」开关仍只能全屏内使用 |
| B3（维持全屏唯一入口） | 只改文案与诊断 | 被验收 3 明确禁止（「避免只改变错误文案」），不推荐 |

## 9. 实现任务（设计阶段不实施）

1. **阶段一：诊断内核** — `src/mermaid-diagnostics.ts` + 单元测试（五类分型、位置提取、不序列化 error）。
2. **阶段二：渲染管线与状态机** — `MermaidApi.parse` 接入、lint 前置 + debounce、状态机与 `data-*`、残留清理（A3/A4）。
3. **阶段三：入口一致性** — Markdown 块可见性、`onRenderError` 接线、块内代码面板、`.mmd` 诊断对齐（A1/A5）。
4. **阶段四：运行时可用性** — 不可用提示、重试与自动恢复（A2）。
5. **阶段五：交互收敛** — 视口状态源、`restoreView` 幂等、选择联动（R6），先真机复核 §2.7。
6. **阶段六：文案与回归** — i18n 双语、全量测试与手工清单 M1–M7。
