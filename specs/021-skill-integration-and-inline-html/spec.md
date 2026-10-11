---
title: 'TACO-70 taco skill 统一优化：集成模块、内嵌单页 HTML 与触发/写作指引'
issue: 'https://linear.app/castrel/issue/TACO-70'
status: 'Implemented'
---

## 范围

本设计覆盖 TACO-70 的 WP1–WP4（WP5 模板库 `prd/`、`interaction/` 为后续批次，见「后续批次」）。承接 TACO-36、TACO-49、TACO-57、TACO-58 的验收点；输入为两份 TACO-49 调研（用户旅程 J01–J09/用户故事 US01–US09；pstack/gstack/superpowers/spec-kit 兼容调研）与 2026-10-11 人类提供的 pstack × Taco 集成建议。

## 行为

### WP1 · Skill 集成模块（`skills/taco/references/integrations.md` 新增）

1. **SDD 流程 skill set（pstack/poteto-mode、gstack、superpowers、spec-kit）**
   - 分层：容器层 = Taco checkpoint 节点文件（人审、批注、状态的唯一载体）；方法层 = 引擎 playbook/流程，按路径 + 版本引用，不复制正文；引擎产物写回 Taco 节点文件，不维护第二份展示稿。
   - 探测：纯文件信号（`poteto-mode/SKILL.md` + `playbooks/*.md`；gstack 的 `design-consultation`/`design-review`/`plan-*-review`/`autoplan` 等 SKILL；superpowers 的 `brainstorming`/`writing-plans`/`executing-plans` 等；spec-kit 的 `.specify/` 与 `/speckit.*`），只在进入设计阶段时探测一次，命中路径记入回复/子任务。
   - 优先级 P0–P3：用户指令 > 项目指引（`AGENTS.md`、项目 skills、`.sdlc`/`.specify`）> 已安装引擎（项目 `design_engine` 未配置时按 pstack → gstack → superpowers → speckit）> 内置默认。**缺失从不阻断**：未安装任何 SDD 引擎即跳过流程集成，按 Taco 常规工作流继续，不报缺失、不中断；用户明确点名的引擎/模板不可用时一句话说明后继续（绝不假装遵循），Taco 不以安装任何流程类 skill 为前提。
   - 接入点：`/architect with checkpoint`（设计包交 Taco 人审，首选验证组合）、multi-phase-plan（实施前审范围/依赖/验收）、show-me-your-work（交付证据索引）、prototype（探索快跑，定稿才进 Taco）。
   - 语义对齐：Handoff = 反馈交回 ≠ 放行实施；`freeze`/`frontier`/`complete` 是进度表达，不是批准或验证；评论线程由人解决；子 Agent 出候选，主 Agent 统一改文档、打包、收反馈、先查冲突再刷新（保 `docId`/`comments`/`navigation`/`checkpoints`）。
   - 首个 recipe：architect-with-checkpoint 闭环（设计 → 人改 + 评论 → 导入修订 → 复审 → 明确放行 → 运行证据回填）。
2. **产物生成类 skill 通用范式（answer-me-with-html、画 mermaid/图示/信息图类）**
   - 载体矩阵扩展「单页 HTML」：Markdown 承载叙述与决策，Mermaid 承载纯文本图表，单页 HTML 承载高密度一页纸，PNG 承载位图。
   - 生成时优先调用本地已安装的对应 skill；产物落 canonical 文档目录、正文相对路径链接、随 bundle 内嵌；产物是派生件，Markdown 仍 canonical，源变更后重新生成并刷新同一 Taco。
   - 自包含要求：内嵌 HTML 在网络封锁沙箱中渲染，页面内外部资源不加载；生成 skill 应产出自包含单页。

### WP2 · 内嵌单页 HTML 渲染（运行时）

- `files[]` 接受 `mediaType: "text/html"`（`.html`/`.htm`），`.taco.html` 容器路径仍被 shape 校验拒绝。
- `fileKind` 新增 `html`；文本类（可搜索、可 diff），不属二进制媒体。
- 渲染：`<iframe srcdoc>` + `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`（不给 `allow-same-origin`/`allow-top-navigation`）+ `referrerpolicy="no-referrer"`；srcdoc 文档注入 CSP：`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'`。
- 只读展示：不参与编辑、划词评论、Handoff diff；Markdown 相对链接指向 bundle 内 `.html` 时在 Taco 内打开该页（取消本地跳转）。
- `scripts/pack.mjs` 同步接受 `.html`/`.htm` → `text/html` 并拒绝 `*.taco.html`；安全基线（`validateTacoSecurity`、凭据投影、锚点校验、`window.taco.validate()`）不退化。

### WP3 · 触发与评审边界（TACO-36 / TACO-58）

- 重写 `SKILL.md` frontmatter `description` 与 `When to use`：**唯一触发判据是「需要人来看」**（人要审阅、拍板或签字）；需要人看的典型信号（规划/设计/方案/RFC/选型 + 决策点/契约/迁移、项目评审约定、用户要求评审）主动触发；不需要人看的（一句话问答、单点修复、纯探索头脑风暴、**一体成型且无需人看的小功能**——即使跨多文件或能写很长）不产出 Taco，长度与体量不是理由。
- 成功回合报告：真实改动、未决问题、继续审阅入口优先；冲突/安全风险不隐藏；完整诊断按需。

### WP4 · 写作/模板/决策指引（TACO-49 指引部分）

- P0–P3 决策矩阵入 skill，按「先设计什么 / 写哪些文档 / 用什么模板与是否提问」三问分别判断。
- 轻/中/重文档梯次：单篇 `spec.md`；`spec.md` + `interaction.md`/`diagrams/flow.mmd`；PRD + IxD + Architecture + Contracts。
- 决策题规范：`## Pending Decisions`（`## 待决决策项 (Pending Decisions)`），每题 = 背景 + 2–3 选项 + 同维度 Trade-off + 推荐 + 影响面；推荐 ≠ 授权。
- 排版与可视化最小指引：Callout/对比矩阵/Checklist 的适用与反例；Mermaid 按问题类型选图（流程/时序/状态机/分层），交付前跑 `scripts/lint-mermaid.mjs`。

## 验收

1. 重放 TACO-58 badcase（复杂规划请求）：Agent 主动产出 canonical Markdown + `.taco.html`，聊天只留摘要、待决点、文件入口；探索性问答不默认打包（TACO-36）；一体成型、无需人看的小功能不产出 Taco（2026-10-11 人类补充口径）。
2. 含 `.html` 的 `.taco.html` 在浏览器内嵌沙箱渲染该单页，Markdown/Mermaid/评论/导出不受影响（TACO-57）；打包不再报 shape 错误。
3. 装有 pstack 等引擎时按 P0–P3 探测与让位产出设计并写入 Taco 节点文件；未安装时跳过流程集成、Taco 照常工作，不阻断（TACO-49 调研 §3 的兼容口径按 2026-10-11 人类决定修正）。
4. 产物生成类 skill 的产出按通用范式落目录、进 bundle、正文可跳转。
5. skill 与 extension 镜像一致（J09）；`npm run check` 通过；体积与依赖预算给出实测。

## 后续批次（本 Issue WP5，非本次交付）

- `prd/`、`interaction/` 模板包（extensions 正本 + skills 生成镜像）与轻/中/重选用示例，按 TACO-49 J05/AC05 验收。

## 体积与依赖预算

prepare 估算基于 AGENTS.md 基线节（2026-10-09）；实测与估算同工作树、同构建口径（`npm run build` 后 `wc -c` / `find -exec stat`）：

| 产物 | 基线字节 | 预计增量字节 | 实测字节 | 实测增量字节 | 偏差及原因 |
| --- | ---: | ---: | ---: | ---: | --- |
| Complete shell `skills/taco/taco-shell.html` | 2737618 | +2048–6144 | 2738638 | +1020 | 低于预估：新增运行时（`src/embedded-html.ts` 与 iframe 分支）经 deflate 压缩后增量很小 |
| Lite shell `skills/taco/taco-shell-lite.html` | 188325 | +2048–6144 | 189406 | +1081 | 低于预估，同上 |
| Complete `.taco.html` 产物 | 2846082 | +2048–6144 | 2847102 | +1020 | 与 shell 同源，同因 |
| Lite `.taco.html` 产物 | 296789 | +2048–6144 | 297870 | +1081 | 与 shell 同源，同因 |
| `skills/taco/`（含 shells、模板镜像与文档） | 14094920 | +10240–24576 | 14117033 | +22113 | 落在区间内：`references/integrations.md` 约 11.8 KB + `SKILL.md` 约 +5 KB + shells 约 +2.1 KB + 模板 `empty.taco.html` 同步重建约 +4 KB + 2026-10-11 口径修订约 +0.8 KB，减去 `pack.mjs` 删除的旧校验 |

- 新增依赖：无。联网行为：无新增；内嵌 HTML 渲染为离线沙箱（CSP 禁外联），`check-update.mjs` 与 Lite CDN 行为不变。
- 阈值判断：最大相对增长为 Lite skill shell +0.57%（其余 ≤0.04%），绝对增量 ≤1081 B，均远低于「较大增大」阈值（≥1% 或 ≥32 KB），不触发告知义务；数字仍按规范在此列出。`extensions/taco/assets/`、`extensions/taco/templates/`、`packages/host/assets/` 为同源镜像/重建产物，增量同量级。

## 实现验证

- `npm run check` 通过：`format:check`、`check:lessons`、vitest 57 个测试文件 / 663 项测试全通过、`tsc -b` + `build-shells` + `refresh-host-demo` 构建通过。
- 新增/修改回归测试：`tests/embedded-html.test.ts`（doctype/片段/BOM、CSP 注入位置、sandbox 常量无 `allow-same-origin`）、`tests/model.test.ts`（`text/html` 接受与分类、参数化 media type、扩展名回退、`*.taco.html` 拒绝）、`tests/skill-pack.test.ts`（pack 接受 `.html`→`text/html`、拒绝容器路径）、`tests/validation.test.ts`（html 文件跳过锚点校验、Markdown→`.html` 跨文档链接通过）、`tests/file-browser.test.ts`（iframe srcdoc/sandbox 渲染）。
- 浏览器实测（Playwright/Chromium，对构建产物 `tmp/TACO-70_Inline_HTML.taco.html`）10/10 通过：Markdown 链接内嵌打开且不发生本地跳转；`sandbox` 含 `allow-scripts` 且无 `allow-same-origin`；srcdoc 注入 CSP 且禁外联；内联脚本执行；`parent.document` 访问被拦（opaque origin）；外链图片被 CSP 拦截；html 文件不挂载编辑器；`window.taco.validate()` 返回 `ok: true`、0 error / 0 warning。
- `node skills/taco/scripts/pack.mjs verify` 结构干净；`node scripts/smoke-built-shell.mjs tmp/TACO-70_Inline_HTML.taco.html` 通过（2 files, 0 warnings）。
- 官网 copy 同步（`packages/host/src/app/page.tsx`），taco-guide 双语文档同步（架构/功能/FAQ/路线图），AGENTS.md 打包规则同步，LESSONS-009 记录「vitest 绿 ≠ 类型完整」。

## 变更记录

TACO-70 在 skill 内落地集成模块（SDD 引擎分层/探测/优先级/语义对齐 + 产物生成类 skill 通用范式），将 `.html` 变为受管文件类型并以沙箱 iframe 内嵌渲染单页 HTML（取代本地跳转），重写 skill 触发与评审边界、补 P0–P3/轻中重/决策题指引。WP5（`prd/`、`interaction/` 模板包）保留为后续批次。

2026-10-11 人类修正两条口径：① SDD 引擎缺失从不阻断——未安装即跳过流程集成、Taco 照常工作（原「报缺失并停」作废）；② Taco 只在需要人审阅/拍板时使用，一体成型无需人看的小功能不产出 Taco。
