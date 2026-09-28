---
title: '013-mermaid-editing-lint-plan'
feature_id: '013-mermaid-editing-lint'
created: '2026-09-28'
status: 'Draft'
issue: 'https://github.com/Arcadia822/taco/issues/51'
linear: 'https://linear.app/castrel/issue/TACO-19'
---

## 实现计划 - Mermaid 校验

对应 `specs/013-mermaid-editing-lint/spec.md`；Linear TACO-19 / GitHub #51。
状态：Draft（等人工评审；§11 的 jsdom 取舍需确认后开工）。

主线是 **Agent 侧 `.mmd` 校验**；人侧只做最小集（精确诊断、不互相冒充、残留清理、两入口一致）。

## Phase 1: 诊断内核（对应 spec §4.5）
- [ ] 新增 `src/mermaid-diagnostics.ts`：`MermaidDiagnosticKind`、`MermaidDiagnostic`、`classifyMermaidFailure(errorOrFalse, source)`。
- [ ] 分型实现：`UnknownDiagramError` → `unknown-type`；`MermaidParseError` → langium `result.parserErrors[0].token` 行列；`error.hash` → jison，行号以 message 的 `Parse error on line N` 为准并 clamp；`parse` 返回 `false` → 廉价预判（空/纯注释/无图表头 → `unknown-type`，否则 `syntax`）且 `detail` 缺省；其余 → `render`（无位置）。
- [ ] 约束落实：白名单取值；`detail` 保留原始 message；`error.result` 不序列化、不进日志。
- [ ] 单元测试：五类分型、矛盾行号场景、`expected[]` 截断、空/空白源码。

## Phase 2: 校验器（对应 spec §4.1–4.4、§4.6）
- [ ] 新增 `skills/taco/scripts/lint-mermaid.mjs`（Node ≥ 22，与 `checkpoints.mjs`/`png.mjs` 同风格）。
- [ ] 解析器来源：默认从 `taco-shell.html` 取 `#taco-asset-mermaid` → `inflateRawSync` → **写临时 `.mjs`** → `import(pathToFileURL(...))`；`--mermaid <path>`、`--shell <path>` 覆盖。
- [ ] DOM：jsdom 注入（window 上除 `location` 外的全局 + `window`/`self` 指回 + `getBBox`/`getComputedTextLength` 垫片）；解析顺序 `--jsdom <path>` → 调用目录 `import('jsdom')`。
- [ ] 输入：`.mmd`、含 Mermaid 围栏的 `.md`、`--dir`（递归、忽略点目录与 `*.taco.html`）、stdin。
- [ ] 位置换算：fence 起始行 → 宿主 `.md` 真实行号。
- [ ] 输出：默认人类可读；`--json` 结构化（`file/line/column/kind/detail/tier/runtime`）。
- [ ] 退出码三态：`0` 通过 / `1` 有诊断 / `2` 未运行（jsdom 或载荷不可用）；退出码 2 必须打印补救命令且**不**打印通过。
- [ ] `--harness <out.html>`：自包含临时页（内嵌同一载荷，`--payload cdn` 可选），诊断 JSON 写入 `<output id="result">`。
- [ ] 测试：不可用路径（屏蔽 jsdom / 屏蔽载荷）退出码为 2；离线场景全通过。

## Phase 3: 正确性基线（对应 spec §2.2、A1）
- [ ] 固化 18 合法 + 4 非法输入的期望矩阵为脚本级回归（覆盖 §2.2 点名的 11 个易漏报族）。
- [ ] 断言零误报（合法图全部通过）与零误收（非法输入全部报错）。
- [ ] 断言 `--harness` 模式产出与默认模式同构的诊断（至少覆盖 1 个合法 + 1 个非法）。

## Phase 4: 人侧最小集（对应 spec §5、A5–A7）
- [ ] `src/mermaid.ts`：`parse` 作为 `render` 前置门（无效源码不调 `render`）；`onRenderError`/`onUnavailable` 替换为唯一 `onDiagnostic`；`unavailable` 清 `is-loading` 假进度并给原因与重试；失败后按 id 移除 `#d{id}` 并在成功路径复查。
- [ ] `src/structured-file-viewer.ts`：`.mmd` 诊断区改为结构化呈现（类别 + 行:列 + 可复制原文）；`render` 类标注「无位置信息」。
- [ ] `src/tiptap-code-block.ts`：Markdown 路径接上同一条诊断链，呈现与 `.mmd` 一致（不新增交互按钮，不动可见性策略）。
- [ ] `src/i18n.ts`：四类文案（`syntax`/`unknown-type`/`render`/`runtime`）+ 位置格式 + 重试 + 复制原文，`zh-Hans` / `en` 双语。
- [ ] `src/styles.css`：诊断行与位置/原文折叠的样式。
- [ ] 测试：四类失败在两入口的文案与位置断言；`#d{id}` 计数不增长；`runtime` 恢复后可重新出图。

## Phase 5: 最小文档指引（对应 spec §8）
- [ ] `skills/taco/SKILL.md`：加一段「写完 `.mmd`/Mermaid 围栏后自查」——给出调用方式与退出码含义；**不**改变任何落盘步骤。
- [ ] `skills/taco/references/bundle-format.md`：在 `.mmd` 行附近补一句「内容层不由 bundle 校验覆盖，需用校验器自查」。
- [ ] 不修改装配流程，不新增必需步骤（`pack.mjs` 已由用户移除，本设计不依赖）。

## Phase 6: 回归
- [ ] `npx vitest run tests/…` 覆盖对应验收条件。
- [ ] 全量 `npm test`；`npm run check`。
- [ ] 手工：真实浏览器打开含三类问题的 `.taco.html`，核对人侧文案与位置（spec §7.3）。
- [ ] 构建 `dist-single/Taco_Spec.taco.html` 与 013 的 `.taco.html`，核对诊断描述与实际一致。

## 明确不做（spec §10，另开 Issue）
- [ ] 预览刷新频率/闪烁、失败回落源码、缩放状态源、实时/手动开关可达性——已取证，另开 Issue；D1/D2 结论保留待用。
