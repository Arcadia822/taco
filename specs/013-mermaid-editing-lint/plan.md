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
- [ ] 新增 `src/mermaid-diagnostics.ts`：`MermaidDiagnosticKind`、`MermaidDiagnostic`、`classifyMermaidFailure({ stage, error, returnedFalse, source })`——**阶段是显式输入**，规则见 spec §4.5。
- [ ] 分型实现：`load` → `runtime`；`parse` + `result.parserErrors[0].token`（**按结构判定，不按 `error.name`**，实测 langium 族 `name` 为 `Error`）→ `syntax` 取 token 行列；`parse` + `error.hash` → `syntax`，位置优先 `hash.loc.first_line`/`first_column`，缺失退回 message 的 `Parse error on line N`，再 clamp 到单元行范围；`parse` + `UnknownDiagramError` → `unknown-type`；`parse` + `returnedFalse` → 廉价预判（空/纯注释/无图表头 → `unknown-type`，否则 `syntax`）且 `detail` 缺省；`parse` + 其余异常 → `runtime`（退出码 2，**不得**归 `render`）；`render` 阶段异常 → `render`（无位置）。
- [ ] 断言**不靠 clamp 掩盖偏差**：悬空箭头→第2行、未闭合方括号→第2行、sequence 缺冒号→第2行；langium gitGraph→3行3列、architecture→3行8列。
- [ ] 约束落实：白名单取值；`detail` 保留原始 message；`error.result` 不序列化、不进日志。
- [ ] 单元测试：五类分型、矛盾行号场景、`expected[]` 截断、空/空白源码。

## Phase 2: 校验器（对应 spec §4.1–4.4、§4.6）
- [ ] 新增 `skills/taco/scripts/lint-mermaid.mjs`（Node ≥ 22，与 `checkpoints.mjs`/`png.mjs` 同风格）。
- [ ] 解析器来源：默认从 `taco-shell.html` 取 `#taco-asset-mermaid` → `inflateRawSync` → **写临时 `.mjs`** → `import(pathToFileURL(...))`；`--mermaid <path>`、`--shell <path>` 覆盖。
- [ ] DOM 解析顺序：`--jsdom <path>` → **以 `process.cwd()` 为基准**的 `createRequire` 解析 `jsdom` → 脚本自身位置兜底；三者皆失败时退出码 2 并打印与生效顺序一致的补救命令（脚本位于 `skills/taco/scripts/`，裸 `import('jsdom')` 不会看到调用方项目的 `node_modules`，必须显式按 cwd 解析）。
- [ ] jsdom 注入：window 上除 `location` 外的可枚举全局 + `window`/`self` 指回 + `getBBox`/`getComputedTextLength` 垫片。
- [ ] Lite shell（无内嵌载荷）场景：显式提示无离线载荷，需要 `--mermaid`/`--shell`/`--harness --payload cdn`，不得静默走网络。
- [ ] 输入：`.mmd`、含 Mermaid 围栏的 `.md`、`--dir`（递归、忽略点目录与 `*.taco.html`）、stdin。
- [ ] 位置换算：fence 起始行 → 宿主 `.md` 真实行号。
- [ ] 输出：默认人类可读；`--json` 结构化（`file/line/column/kind/detail/tier/runtime`）。
- [ ] 退出码三态：`0` 通过 / `1` 有诊断 / `2` 未运行（jsdom 或载荷不可用）；退出码 2 必须打印补救命令且**不**打印通过。
- [ ] `--harness <out.html>`：自包含临时页（内嵌同一载荷，`--payload cdn` 可选），诊断 JSON 写入 `<output id="result">` 并置 `window.__lintDone = true`。
- [ ] harness 退出码语义：`0` 仅表示**已写出**，必须打印「校验未运行 —— 请在浏览器中打开并读取结果」，不得出现「通过」字样；`unavailable` 非空同样表示未运行。
- [ ] harness 载荷：默认 `--payload embedded` 把 shell 载荷以 base64 内联 + Blob URL 导入（同 `src/mermaid-complete.ts`），页面自身离线可用；给出载荷导入超时（~8s），超时写 `unavailable` 并置完成标记，不得悬挂。
- [ ] 退出码特例：无 Mermaid 单元时 `0` + 显式打印 `0 Mermaid unit(s) (nothing to validate)`；`--dir` 收到文件时报错并提示改用位置参数。
- [ ] 测试：不可用路径（屏蔽 jsdom / 屏蔽载荷）退出码为 2；**从独立项目 cwd 调用 skill 脚本**时 jsdom 仍能被解析到（跨目录解析回归）；harness 写出后退出码为 0 且不打印通过。
- [ ] 测试：离线场景全通过。

## Phase 3: 正确性基线（对应 spec §2.2、A1）
- [ ] 固化 22 个输入的期望矩阵为脚本级回归：18 合法 + 3 语法无效 + 1 未知类型（覆盖 §2.2 点名的 11 个易漏报族），逐条列出输入与期望 `kind`/退出码。
- [ ] 断言零误报（合法图全部通过）与零误收（非法输入全部报错）。
- [ ] **真的在浏览器中执行** `--harness` 页面并断言 `output` 内容与默认模式同构（至少 1 个合法 + 1 个非法 + 1 个 unavailable）；只比较生成的 HTML 文本不算通过。作者原型阶段已实测：生成的页面曾因 `??` 与 `||` 混用抛 `SyntaxError` 并永久停在 running——只做文本比较会漏掉该缺陷。

## Phase 4: 人侧最小集（对应 spec §5、A5–A7）
- [ ] `src/mermaid.ts`：`parse` 作为 `render` 前置门（无效源码不调 `render`）；`onRenderError`/`onUnavailable` 替换为唯一 `onDiagnostic`；`unavailable` 清 `is-loading` 假进度并给原因与重试；失败后按 id 移除 `#d{id}` 并在成功路径复查。
- [ ] `src/structured-file-viewer.ts`：`.mmd` 诊断区改为结构化呈现（类别 + 行:列 + 可复制原文）；`render` 类标注「无位置信息」。
- [ ] `src/tiptap-code-block.ts`：Markdown 路径接上同一条诊断链，呈现与 `.mmd` 一致（不新增交互按钮，不动可见性策略）。
- [ ] `src/i18n.ts`：四类文案（`syntax`/`unknown-type`/`render`/`runtime`）+ 位置格式 + 重试 + 复制原文，`zh-Hans` / `en` 双语。
- [ ] `src/styles.css`：诊断行与位置/原文折叠的样式。
- [ ] 测试：四类失败在两入口的文案与位置断言；`#d{id}` 计数不增长；**编辑或模式切换之后**无需重载即可恢复出图（不新增任何按钮，见 spec §5.1）。
- [ ] 测试/手工：A8-a~A8-f 逐项（主题、方向、复制、行评论、节点评论、全屏缩放）在新 parse 前置门之后仍工作。

## Phase 5: 最小文档指引（对应 spec §8）
- [ ] `skills/taco/SKILL.md`：加一段「写完 `.mmd`/Mermaid 围栏后自查」——给出调用方式与退出码含义；**不**改变任何落盘步骤。
- [ ] `skills/taco/references/bundle-format.md`：在 `.mmd` 行附近补一句「内容层不由 bundle 校验覆盖，需用校验器自查」。
- [ ] 不修改装配流程，不新增必需步骤（`pack.mjs` 已由用户移除，本设计不依赖）。

## Phase 6: 回归与体积实测
- [ ] `npx vitest run tests/…` 覆盖对应验收条件。
- [ ] 全量 `npm test`；`npm run check`。
- [ ] 手工：真实浏览器打开含三类问题的 `.taco.html`，核对人侧文案与位置（spec §7.3）。
- [ ] 构建 `dist-single/Taco_Spec.taco.html` 与 013 的 `.taco.html`，核对诊断描述与实际一致。
- [ ] **体积实测（AGENTS.md 强制）**：`node scripts/build-shells.mjs` 后与 spec §12.1 基线比较 Complete/Lite 字节数与 `skills/taco/` 目录增量，把**实测值**回填 spec §12.3，并写明与 §12.4 估算的偏差及原因。
- [ ] 阈值判定：Lite 若超过 +1%（2,863 字节）或任一 shell 超过 +32 KB，必须在交付说明中主动告知用户并给出数字、原因与可选方案。

## 明确不做（spec §10，另开 Issue）
- [ ] 预览刷新频率/闪烁、失败回落源码、缩放状态源、实时/手动开关可达性——已取证，另开 Issue；D1/D2 结论保留待用。
