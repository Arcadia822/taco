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
- [ ] `MermaidRuntime` 增加 lint 入口：与 `enqueue` 共用队列；输入后 debounce ~800ms（可调 500–1000ms），单飞保留最新待执行。
- [ ] `renderDiagram`：状态显式迁移——`rendering` 态清空旧图（D1：不保留），`host.dataset.mermaidState` 驱动展示。
- [ ] 失败路径：`onRenderError` 升级为 `onDiagnostic(diagnostic)`；`unavailable` 时清除 `is-loading` 假进度并写 `mermaidState='unavailable'`；错误状态下诊断「静默重试」，仅结果变化才更新显示。
- [ ] 渲染失败后移除 `#d{id}` 残留容器；成功路径复查一次。
- [ ] 删除无调用方的 `applyPreview` 参数链。
- [ ] 测试：状态迁移、渲染中不残留旧图（A3）、5 次失败后无 `div[id^="d"]` 增长（A4）、`parse=false` 时 `render` 未被调用、debounce 单飞（连续输入编译次数有上限）。

## Phase 3: 入口一致性（对应 spec §4.4）
- [ ] `src/tiptap-code-block.ts`：`source.hidden` 判据改为 `isMermaid && !mermaidUnavailable && state === 'valid'`；`preview.hidden = !isMermaid || state !== 'valid'`（失败整体回落源码，D2）。
- [ ] 接上 `onRenderError`（经 split view 透传 `onDiagnostic`）；源码区顶部渲染诊断摘要（类别 + 位置 + `detail` 折叠/复制）。
- [ ] `src/structured-file-viewer.ts`：`.mmd` 采用同一语义——失败时回落源码编辑器 + 顶部诊断摘要，不再强制展开浮动代码面板。
- [ ] 删除死类 `is-source-visible`。
- [ ] 测试：同一段无效源码在两入口产出同类诊断与一致的回落行为（A1/A5）；有效图表 A7 行为不回归。

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
- [ ] `src/styles.css`：为 `data-mermaid-state` 提供状态样式（`rendering` 指示、诊断摘要、回落源码态、重试按钮）。
- [ ] 全量 `npm test`；手工清单 M1–M7 逐条记录。
- [ ] 更新 `docs/` 与 README 中 Mermaid 交互描述（若有出入）。

## 验证
- 每阶段 `npx vitest run tests/…` 覆盖对应验收条件；
- 最终 `npm run check`（format + test + build）；
- 构建 `dist-single/Taco_Spec.taco.html` 并用 spec 012 的 `.taco.html` 复核诊断 UI 描述与实际一致。
