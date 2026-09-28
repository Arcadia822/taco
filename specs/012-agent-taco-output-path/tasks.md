---
title: '012-agent-taco-output-path 实施任务'
feature_id: '012-agent-taco-output-path'
created: '2026-09-28'
status: 'Draft'
---

## 阶段 1：契约定稿

- [ ] T1 评审并冻结 `contracts/output-path-rule.md` 的语法、查找链与失败语义（含 spec.md §10 的 5 个待确认项）。
- [ ] T2 确认级联优先级顺序（L0 用户指定 > L1 刷新既有 > L2 项目规则 > L3 文档目录 > L4 仓库根 `Tacos` > L5 个人归档）。

## 阶段 2：解析器

- [ ] T3 新增 `skills/taco/scripts/output-path.mjs`：`parseOutputDirRule` / `resolveOutputPath` / CLI（`--workspace --requested --existing --feature --title --home --json`）。
- [ ] T4 路径安全校验（相对性、无 `..`/反斜杠/空段/通配符、`{feature}` 替换后仍落在仓库内）与 `<Title>.taco.html` 归一化。
- [ ] T5 `git check-ignore` 告警（不失败、不改 `.gitignore`）；`git` 不可用时降级为 `git-unavailable` 告警。
- [ ] T6 新增 `tests/output-path.test.ts`，覆盖 spec.md §7.1 十项；含 `pack.mjs` 联动断言。

## 阶段 3：文档接线

- [ ] T7 新增 `skills/taco/references/output-path.md`（级联表 + 报告/告警清单 + 失败即停四种情况；语法引用契约）。
- [ ] T8 `skills/taco/SKILL.md` 新增 `## Where to write .taco.html`，并在 Workflow 步骤 1 引用（保持英文）。
- [ ] T9 `docs/agent-installation.md` 的 "Use the skill" 步骤 1 补一句 + 链接。
- [ ] T10 `extensions/taco/commands/update.md`、`extensions/taco/skills/taco-speckit/SKILL.md`、`extensions/taco/README.md` 各声明 feature 目录规则 ≡ L2。

## 阶段 4：自我应用与端到端核对

- [ ] T11 在本仓库 `AGENTS.md` 添加 `taco-output-dir: specs/{feature}`。
- [ ] T12 逐项跑 spec.md §7.2 的五类场景，记录"产物位置"与"`root`/内部引用"两组结果。

## 阶段 5：验证与交付

- [ ] T13 `npm test` 与 `npm run check` 通过（含格式检查与构建）。
- [ ] T14 真实仓库冒烟：解析 → `pack.mjs --out` → `verify` 无 warning。
- [ ] T15 如改动涉及 `skills/` 与 `packages/host/`，按 AGENTS.md 提出并执行 skill 与官网同步方案，并给出本地可访问预览 URL。
- [ ] T16 构建并交付 `.taco.html` 供人工评审，附最终报告（级别/路径/依据/告警）。
