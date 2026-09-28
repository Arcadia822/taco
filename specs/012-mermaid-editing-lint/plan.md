---
title: '012-mermaid-editing-lint-plan'
feature_id: '012-mermaid-editing-lint'
created: '2026-09-28'
status: 'Draft'
issue: 'https://github.com/Arcadia822/taco/issues/51'
linear: 'https://linear.app/castrel/issue/TACO-19'
---

## 实现计划 - Mermaid 编辑交互与编写时诊断

对应 `specs/012-mermaid-editing-lint/spec.md`；Linear TACO-19 / GitHub #51。
状态：Draft（设计已经人工裁决 D1/D2；等评审通过后启动实施）。

## Phase 1: 诊断内核（对应 spec §4.1）
- [ ] 新增 `src/mermaid-diagnostics.ts`：`MermaidDiagnosticKind`、`MermaidDiagnostic`、`classifyMermaidFailure(error, source)`。
- [ ] 分型实现：`UnknownDiagramError` → `unknown-type`；`MermaidParseError` → langium `result.parserErrors[0].token` 行列；`error.hash` → jison，行号以 `message` 的 `Parse error on line N` 为准并 clamp；`security:*` → `sanitizer`；其余 → `render`。
- [ ] 约束落实：白名单取值；`detail` 保留原始 message；`error.result` 不序列化、不进日志。
- [ ] 单元测试：五类错误对象、矛盾行号场景、`expected[]` 截断、空/空白源码。

## Phase 2: 渲染管线与状态机（对应 spec §4.2–4.3、§4.5）
- [ ] `src/mermaid.ts`：`MermaidApi` 增加可选 `parse(text, { suppressErrors })`。
- [ ] `MermaidRuntime` 增加 lint 入口：与 `enqueue` 共用队列；输入后 debounce ~800ms（可调 500–1000ms），单飞保留最新待执行。
- [ ] `renderDiagram`：状态显式迁移——`rendering` 态清空旧图（D1：不保留），`host.dataset.mermaidState` 驱动展示。
- [ ] 三条输入分支落地（spec §4.2 分支矩阵）：`parse=false` / `parse` 抛异常 / `parse` 缺省（render 失败按异常分类，不误报 `render` 类）。
- [ ] lint 输入与渲染输入对齐：`renderSource = updateMermaidCodeTheme(...)` 改写场景下的行列映射或同输入策略。
- [ ] 失败路径：`onRenderError`/`onUnavailable` 替换为 `onDiagnostic(diagnostic)`（唯一回调链，旧回调移除）；`initialize` 抛错纳入失败边界（归 `runtime`，转 `unavailable`，可重试）；`unavailable` 时清除 `is-loading` 假进度。
- [ ] **诊断摘要容器**：独立于 `preview.hidden` 的摘要节点（Markdown 块源码区顶部 / `.mmd` 内容区顶部），由 `onDiagnostic` 统一更新，含「重试加载」按钮。
- [ ] `MermaidRuntime`/preview 提供 `retry()`：源码不变也强制重新 `load()+render`，成功后广播 `valid`。
- [ ] 渲染成功回调携带成功源码：`onRendered(renderedSource)`（或版本号）供 split view 与块节点比对。
- [ ] 渲染失败后移除 `#d{id}` 残留容器；成功路径复查一次。
- [ ] 删除无调用方的 `applyPreview` 参数链。
- [ ] 测试：状态迁移（含 `initialize` 抛错）、渲染中不残留旧图（A3）、5 次失败后无 `div[id^="d"]` 增长（A4）、三条 parse 分支、`parse=false` 时 `render` 未被调用、debounce 单飞、同源码 `retry()` 生效、主题改写场景行列不漂移。

## Phase 3: 入口一致性（对应 spec §4.4）
- [ ] `src/tiptap-code-block.ts`：`source.hidden` 判据改为 `isMermaid && !mermaidUnavailable && state === 'valid'`；`preview.hidden = !isMermaid || state !== 'valid'`（失败整体回落源码，D2）。
- [ ] 接上 `onDiagnostic`（preview → split view → 摘要节点的唯一回调链，替换 `onRenderError`/`onUnavailable`）；源码区顶部渲染诊断摘要（类别 + 位置 + `detail` 折叠/复制）。
- [ ] `src/structured-file-viewer.ts`：`.mmd` 采用同一语义——失败时回落源码编辑器 + 顶部诊断摘要，不再强制展开浮动代码面板。
- [ ] 删除死类 `is-source-visible`。
- [ ] 测试：同一段无效源码在两入口产出同类诊断与一致的回落行为（A1/A5）；有效图表 A7 行为不回归。

## Phase 4: 运行时可用性（对应 spec §4.6）
- [ ] `mermaidUnavailable` 改为可复位：`paint()` 依据状态派生；提供「重试加载」；下一次编辑自动重试一次。
- [ ] `retry()` 强制路径接入两入口：源码不变也能重新 `load()+render`，成功后清除不可用状态并广播 `valid`（A2）。
- [ ] 摘要节点文案：`mermaidDiagnosticRuntime`（原因）+ `mermaidRetry`；不再停留加载态。
- [ ] 测试：rejecting loader → 摘要可见、源码可编辑（A2）；loader 恢复 → 不编辑源码仅重试即出图。

## Phase 5: 交互收敛（对应 spec §4.7）
- [ ] 先在真机浏览器复核 spec §2.7 的三条观察（视口副本、`restoreView` 双调、实时开关不可达），不成立则记录并跳过。
- [ ] split view 提供 `getViewport()/setViewport()`，`src/tiptap-code-block.ts` 全屏进出改用该 API。
- [ ] `restoreView()` 幂等化。
- [ ] 渲染来源三态：`currentSource` / `requestedSource` / `renderedSource`（成功回调回传），节点/行映射仅在 `currentSource === renderedSource` 时启用。
- [ ] 手动预览模式：编辑即 dirty——移除/隐藏旧 SVG、摘要区提示「源码已修改」，源码保持可编辑；点击「更新图表」才 lint/render；不把旧图当当前预览。
- [ ] 手工清单 M6/M11 验证。

## Phase 6: 文案与回归
- [ ] `src/i18n.ts`：新增 spec §4.8 全部键，`zh-Hans` / `en` 双语。
- [ ] `src/styles.css`：为 `data-mermaid-state` 提供状态样式（`rendering` 指示、诊断摘要、回落源码态、重试按钮）。
- [ ] 全量 `npm test`；手工清单 M1–M12 逐条记录。
- [ ] 更新 `docs/` 与 README 中 Mermaid 交互描述（若有出入）。

## 验证
- 每阶段 `npx vitest run tests/…` 覆盖对应验收条件；
- 最终 `npm run check`（format + test + build）；
- 构建 `dist-single/Taco_Spec.taco.html` 并用 spec 012 的 `.taco.html` 复核诊断 UI 描述与实际一致。
