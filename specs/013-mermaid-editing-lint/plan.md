---
title: '013-mermaid-editing-lint-plan'
feature_id: '013-mermaid-editing-lint'
created: '2026-09-28'
status: 'Frozen'
issue: 'https://github.com/Arcadia822/taco/issues/51'
linear: 'https://linear.app/castrel/issue/TACO-19'
---

## 实现计划 - Mermaid 校验

对应 `specs/013-mermaid-editing-lint/spec.md`；Linear TACO-19 / GitHub #51。
状态：Frozen（2026-09-28 经用户确认冻结，作为实施与验收基线）。依赖取舍已由实测收敛为零依赖，见 spec §11。

主线是 **Agent 侧 `.mmd` 校验**；人侧只做最小集（精确诊断、不互相冒充、残留清理、两入口一致）。

## Phase 1: 诊断内核（对应 spec §4.5）
- [ ] 新增诊断内核，**按其装配契约**（spec §4.4.1）：
  - canonical：`extensions/taco/bin/mermaid-diagnostics.mjs`（纯 JS、零 import）+ `extensions/taco/bin/mermaid-diagnostics.d.mts`；
  - skill 镜像：`skills/taco/scripts/mermaid-diagnostics.mjs`（字节一致）；
  - 应用侧引用改为 `../extensions/taco/bin/mermaid-diagnostics.mjs`（同 `png.mjs` 先例）；
  - 扩展 `tests/skill-pack.test.ts` 的镜像字节一致断言。
- [ ] 内核导出 `classifyMermaidFailure({ stage, error, returnedFalse, source })`——**阶段是显式输入**，规则见 spec §4.5。
- [ ] 分型实现：`load` → `runtime`；`parse` + `result.parserErrors[0].token`（**按结构判定，不按 `error.name`**，实测 langium 族 `name` 为 `Error`）→ `syntax` 取 token 行列；`parse` + `error.hash` → `syntax`，位置优先 `hash.loc.first_line`/`first_column`，缺失退回 message 的 `Parse error on line N`，再 clamp 到单元行范围；`parse` + `UnknownDiagramError` → `unknown-type`；`parse` + `returnedFalse` → 廉价预判（空/纯注释/无图表头 → `unknown-type`，否则 `syntax`）且 `detail` 缺省；`parse` + 其余异常 → `runtime`（退出码 2，**不得**归 `render`）；`render` 阶段异常 → `render`（无位置）。
- [ ] 断言**不靠 clamp 掩盖偏差**：悬空箭头→第2行、未闭合方括号→第2行、sequence 缺冒号→第2行；langium gitGraph→3行3列、architecture→3行8列。
- [ ] 约束落实：白名单取值；`detail` 保留原始 message；`error.result` 不序列化、不进日志。
- [ ] 单元测试：五类分型、矛盾行号场景、`expected[]` 截断、空/空白源码。

## Phase 2: 校验器（对应 spec §4.1–4.4、§4.6）
- [ ] 新增 `skills/taco/scripts/lint-mermaid.mjs`（Node ≥ 22，与 `checkpoints.mjs`/`png.mjs` 同风格，**零外部依赖**）。
- [ ] 解析器来源：默认取 skill 自带的 `skills/taco/taco-shell.html` 的 `#taco-asset-mermaid` → `inflateRawSync` → **写临时 `.mjs`** → `import(pathToFileURL(...))`；`--shell <path>`、`--mermaid <path>` 覆盖。
- [ ] **旁路 DOMPurify（spec §4.2.1）**：精确替换 `sanitizeText` 内那段 `My.sanitize` 调用为 `String(Qdr(e, r))`；替换前断言锚点存在且命中恰好 1 次，否则退出码 2（「payload 结构已变化」），**绝不**在未旁路状态下继续。
- [ ] 初始化：`initialize({ htmlLabels: false, securityLevel: 'strict', layout: 'elk', look, theme, flowchart: { curve: 'basis' } })`（与接收方渲染配置一致）。
- [ ] **不使用 jsdom、不使用浏览器、不新增依赖**（spec §4.3）；纯 Node 无 DOM 必须 18/18。
- [ ] 输入：`.mmd`、含 Mermaid 围栏的 `.md`、`--dir`（递归、忽略点目录与 `*.taco.html`）、stdin。
- [ ] 位置换算：fence 起始行 → 宿主 `.md` 真实行号（并 clamp 到围栏体范围）。
- [ ] 输出：默认人类可读；`--json` 结构化（`file/line/column/kind/detail/tier/runtime`）。
- [ ] 退出码三态：`0` 通过 / `1` 有诊断 / `2` 未运行（载荷缺失、锚点不匹配、输入不可读）；退出码 2 必须打印原因且**不**打印通过。
- [ ] 退出码特例：无 Mermaid 单元时 `0` + 显式打印 `0 Mermaid unit(s) (nothing to validate)`；`--dir` 收到文件时报错并提示改用位置参数。
- [ ] 测试：不可用路径（破坏载荷 / 破坏锚点）退出码为 2；**纯 Node 无 DOM 回归 18/18**；离线（无网络请求）全通过；实测耗时记录。
- [ ] 测试：**21 例对抗性差分**（旁路+无 DOM vs 原样+jsdom，逐例比对结果含行列与错误名；含 `#br#`/`<br>`/实体/`<style>`/HTML 内含 Mermaid 语法等直接针对被旁路消毒语义的样本）作为可复跑用例，并在每次载荷升级后重跑。
- [ ] 测试：**混合退出码**（同目录含 syntax 无效单元 + runtime 异常单元）→ 退出码 2 优先，`--json` 保留两类记录且标记结果不完整。
- [ ] 测试：`tsc -b` 通过（`.mjs` + `.d.mts` 装配）且内核确实进入 shell bundle（可用产物内检索 `parserErrors` 之类标记断言）。

## Phase 3: 正确性基线（对应 spec §2.2、A1）
- [ ] 固化 22 个输入的期望矩阵为脚本级回归：18 合法 + 3 语法无效 + 1 未知类型（覆盖 §2.2 点名的 11 个易漏报族），逐条列出输入与期望 `kind`/退出码。
- [ ] 断言零误报（合法图全部通过）与零误收（非法输入全部报错）。

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
