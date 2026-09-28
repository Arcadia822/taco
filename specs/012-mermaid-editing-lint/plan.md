# 实现计划 - Mermaid 编辑交互与编写时诊断

对应 `specs/012-mermaid-editing-lint/spec.md`；Linear TACO-19 / GitHub #51。
状态：Draft（等人工评审与 D1/D2 裁决后启动实施）。

## Phase 1: 诊断内核（对应 spec §4.1）
- [ ] 新增 `src/mermaid-diagnostics.ts`：`MermaidDiagnosticKind`、`MermaidDiagnostic`、`classifyMermaidFailure(error, source)`。
- [ ] 分型实现：`UnknownDiagramError` → `unknown-type`；`MermaidParseError` → langium `result.parserErrors[0].token` 行列；`error.hash` → jison，行号以 `message` 的 `Parse error on line N` 为准并 clamp；`security:*` → `sanitizer`；其余 → `render`。
- [ ] 约束落实：白名单取值；`detail` 保留原始 message；`error.result` 不序列化、不进日志。
- [ ] 单元测试：五类错误对象、矛盾行号场景、`expected[]` 截断、空/空白源码。

## Phase 2: 渲染管线与状态机（对应 spec §4.2–4.3、§4.5）
- [ ] `src/mermaid.ts`：`MermaidApi` 增加可选 `parse(text, { suppressErrors })`。
- [ ] `MermaidRuntime` 增加 lint 入口：与 `enqueue` 共用队列；输入后 debounce ~250ms，单飞保留最新待执行。
- [ ] `renderDiagram`：移除同步 `surface is-loading` 清空；渲染中保留上一张 SVG，`host.dataset.mermaidState` / `mermaidStale` 驱动轻量指示。
- [ ] 失败路径：`onRenderError` 升级为 `onDiagnostic(diagnostic)`；`unavailable` 时清除 `is-loading` 假进度并写 `mermaidState='unavailable'`。
- [ ] 渲染失败后移除 `#d{id}` 残留容器；成功路径复查一次。
- [ ] 删除无调用方的 `applyPreview` 参数链。
- [ ] 测试：状态迁移、渲染中保留旧图（A3）、5 次失败后无 `div[id^="d"]` 增长（A4）、`parse=false` 时 `render` 未被调用。

## Phase 3: 入口一致性（对应 spec §4.4）
- [ ] `src/tiptap-code-block.ts`：`source.hidden` 判据改为 `isMermaid && !mermaidUnavailable && state === 'valid'`；`preview.hidden = !isMermaid`。
- [ ] 传 `allowCodePanel: true`，恢复 `panelButton` 显示；接上 `onRenderError`（经 split view 透传 `onDiagnostic`）。
- [ ] `src/structured-file-viewer.ts`：`.mmd` 的诊断节点改用 `MermaidDiagnostic`（类别 + 位置 + `detail` 折叠/复制）。
- [ ] 删除死类 `is-source-visible`。
- [ ] 测试：同一段无效源码在两入口产出同类诊断（A1/A5）；有效图表 A7 行为不回归。

## Phase 4: 运行时可用性（对应 spec §4.6）
- [ ] `mermaidUnavailable` 改为可复位：`paint()` 依据状态派生；提供「重试加载」；下一次编辑自动重试一次。
- [ ] 面内文案：`mermaidDiagnosticRuntime`（原因）+ `mermaidRetry`；不再停留加载态。
- [ ] 测试：rejecting loader → 提示与源码可编辑（A2）；loader 恢复 → 无需重载即可出图。

## Phase 5: 交互收敛（对应 spec §4.7）
- [ ] 先在真机浏览器复核 spec §2.7 的三条观察（视口副本、`restoreView` 双调、实时开关不可达），不成立则记录并跳过。
- [ ] split view 提供 `getViewport()/setViewport()`，`src/tiptap-code-block.ts` 全屏进出改用该 API。
- [ ] `restoreView()` 幂等化。
- [ ] `syncSelection` / `onNodeHover` 改为与 `renderedSource` 显式比对。
- [ ] 手工清单 M6 验证。

## Phase 6: 文案与回归
- [ ] `src/i18n.ts`：新增 spec §4.8 全部键，`zh-Hans` / `en` 双语。
- [ ] `src/styles.css`：为 `data-mermaid-state` / `data-mermaid-stale` 提供状态样式（诊断摘要、过期标记、重试按钮）。
- [ ] 全量 `npm test`；手工清单 M1–M7 逐条记录。
- [ ] 更新 `docs/` 与 README 中 Mermaid 交互描述（若有出入）。

## 验证
- 每阶段 `npx vitest run tests/…` 覆盖对应验收条件；
- 最终 `npm run check`（format + test + build）；
- 构建 `dist-single/Taco_Spec.taco.html` 并用 spec 012 的 `.taco.html` 复核诊断 UI 描述与实际一致。
