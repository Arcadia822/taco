---
title: '012-agent-taco-output-path 实施任务'
feature_id: '012-agent-taco-output-path'
created: '2026-09-28'
status: 'Draft'
---

## 阶段 1：契约定稿

- [ ] T1 评审并冻结 `contracts/output-path-rule.md`（语法、S1/S2、级联含 LP、`root` 推导、L0 形态、刷新/迁移/预检、失败语义），确认 spec.md §10 的 8 个待确认项。

## 阶段 2：契约落位

- [ ] T2 把契约**语义等价地译为英文**写入 `skills/taco/references/output-path.md`（skill 侧沿用既有英文），逐条核对语义一致（含 LP、S2 操作差异、`root` 三种情形、失败类型表）；并把 `specs/012-agent-taco-output-path/contracts/output-path-rule.md` 替换为指针文件（标题 + 迁移说明 + 链接）。
- [ ] T3 校验只有一份权威：全仓库不存在第二份完整语法表或失败语义列表；`docs/agent-installation.md` 的 reference 清单补 `output-path.md`。

## 阶段 3：解析器与测试

- [ ] T4 新增 `skills/taco/scripts/output-path.mjs`：`parseFile` / `resolveRule(workspaceRoot, docDirRel, operation)` / `resolveOutputPath(options)` + CLI（`--doc-dir` 与 `--operation` 必填，`--requested` / `--existing` / `--title` / `--personal` / `--workspace` / `--home` / `--json`）；返回值含 `{ level, dir, file, root, sources, warnings }`。
- [ ] T5 单文件解析：剥离 fenced code block 与 HTML 注释；每文件至多一条（含同值）→ `malformed`；围栏/注释未闭合 → `malformed`；规则文件为符号链接 → `malformed`。
- [ ] T6 规则链：`RULE_FILES` 查找链、同值取首个、不同值 `conflict`；`{feature}` 在同一值中至多出现一次，重复即 `malformed`；S2 按 `operation` 判定（`create` 需 Complete shell；`refresh` 需与既有 shell 变体一致的 assets）；S1 与 S2 不同 → `conflict`；仅 `.specify/` 不产生规则。
- [ ] T7 `{feature}` 由 `docDir` 的 basename 推导；`docDir` 缺失 / 等于仓库根 / 段不安全 → `needs_feature` 或 `root_unresolvable`，不降级；不提供 `--feature` 覆盖。
- [ ] T8 `root` 推导：刷新取既有 bundle 的 `root`；新建取项目约定值，无约定取 `basename(docDir)`；`docDir` 等于仓库根 → `root_unresolvable` 停止。
- [ ] T9 `title` 缺省回退与 `pack.mjs` 对齐（`--title ?? 既有 bundle title ?? portableTitleBase(root)`）；`portableTitleBase` 与 `pack.mjs:64-69` 同算法并有断言。
- [ ] T10 路径安全：`realpath` 已存在前缀的包含性判定、禁区拒绝（skill/extension/templates/`node_modules`/`.git`）、L0 绝对路径同样受禁区约束；目标文件为符号链接 → 拒绝；目标 `docId` 冲突预检。
- [ ] T11 上下文与家目录：`git rev-parse --show-toplevel` 推导 `workspaceRoot`（`docDir` 为子目录时用顶层并校验包含）；`--personal` → LP（高于 L2）；非 git → L5 + `workspaceRoot-not-git` 告警；`HOME ?? USERPROFILE` 皆缺 → `needs_home`。
- [ ] T12 告警：`git check-ignore` 命中 → `gitignored`（仍返回路径，不改 `.gitignore`）；`git` 不可用 → `git-unavailable`；`root_unresolvable` 终止。
- [ ] T13 新增 `tests/output-path.test.ts`：覆盖 spec.md 7.1 的 20 项，其中 13–20 为行为级（真实 `pack.mjs` + 读回 bundle）：首建（父目录不存在）、L0 目录与文件形态、个人意图、无 CP、刷新（路径/`root`/状态保留）、迁移（父目录不存在 + `docId` 与状态逐字段一致）、目标占用（拒绝且文件字节未变）、模板来源独立。

## 阶段 4：文档接线

- [ ] T14 `skills/taco/SKILL.md` 新增 `## Where to write .taco.html`（级联摘要 + 解析器调用 + 写盘序列：`mkdir -p`、`--operation`、显式 `--root`、占用预检），Workflow 步骤 1 引用；保持英文。
- [ ] T15 `docs/agent-installation.md` 的 "Use the skill" 步骤 1 补一句（产物目录由级联决定、不再默认写 cwd，并说明这是相对旧版的有意行为变更）。
- [ ] T16 `extensions/taco/commands/update.md`、`extensions/taco/skills/taco-speckit/SKILL.md`、`extensions/taco/README.md` 各写一句"扩展项目 ⇒ S2（feature 目录）"并附可选链接；确认只装扩展的项目不依赖 skill reference 或解析器。

## 阶段 5：自我应用与端到端核对

- [ ] T17 在本仓库 `AGENTS.md` 添加 `taco-output-dir: specs/{feature}`；确认 `tests/agent-instructions.test.ts` 仍通过。
- [ ] T18 逐项跑 spec.md 7.2 的五类场景，记录"产物位置"与"`root`/内部引用"两组结果；场景 1 的文件名必须与标题 stem 一致。

## 阶段 6：验证与交付

- [ ] T19 `npm test` 与 `npm run check` 通过（含格式检查与构建）；确认 `pack.mjs` 的 `--out`/`--root` 默认行为回归无变化。
- [ ] T20 真实仓库冒烟：`output-path.mjs --doc-dir specs/012-agent-taco-output-path --operation create ...` → `mkdir -p` → `pack.mjs --root <解析器 root> --out <解析结果>` → `verify` 无 warning。
- [ ] T21 若改动涉及 `skills/` 与 `packages/host/`，按 AGENTS.md 提出并执行 skill 与官网同步方案，并给出本地可访问预览 URL。
- [ ] T22 构建并交付 `.taco.html` 供人工评审，附最终报告（级别/来源/路径/文件名/`root`/告警）。
