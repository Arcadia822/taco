---
title: '012-agent-taco-output-path 实施任务'
feature_id: '012-agent-taco-output-path'
created: '2026-09-28'
status: 'Draft'
---

## 阶段 1：契约与前置决策

- [ ] T1 评审并冻结 `contracts/output-path-rule.md`（`.taco/config.yaml` 语法、S1/S2、级联、L0 文件名↔标题、刷新/迁移/占用、失败语义、零外部依赖的落盘）。
- [ ] T2 确认 `pack.mjs` 的处置方向（移除 / 降级为可选校验工具 / 改旁挂形态）：它决定 `SKILL.md` 与 `docs/agent-installation.md` 的落盘章节是否还与其他内容协调。

## 阶段 2：契约落位

- [ ] T3 把契约**语义等价地译为英文**写入 `skills/taco/references/output-path.md`，逐条核对语义一致（级联、失败类型、小写 `tacos`、文件名↔标题、占用规则、落盘步骤无脚本调用）。
- [ ] T4 把 `specs/012-agent-taco-output-path/contracts/output-path-rule.md` 替换为指针文件（标题 + 迁移说明 + 链接）。
- [ ] T5 校验只有一份权威：全仓库不存在第二份完整语法表或失败语义表；`docs/agent-installation.md` 的 reference 清单补 `output-path.md`。

## 阶段 3：引导与自我应用

- [ ] T6 `skills/taco/SKILL.md` 新增 `## Where to write .taco.html`：级联摘要、`.taco/config.yaml` 的位置与键、L0 文件名↔标题规则、落盘七步序列、报告与告警清单；Workflow 步骤 1 引用。保持英文，且不出现任何脚本/CLI 调用。
- [ ] T7 `docs/agent-installation.md`：reference 清单 + "Use the skill" 一句（产物目录由级联决定、不再默认写 cwd，并说明这是相对旧版的有意行为变更）。
- [ ] T8 新增 `.taco/config.yaml`（`version: 1`、`outputDir: specs/{feature}`）；确认 `tests/agent-instructions.test.ts` 仍通过。
- [ ] T9 `extensions/taco/commands/update.md`、`extensions/taco/skills/taco-speckit/SKILL.md`、`extensions/taco/README.md` 各加一句"扩展项目 ⇒ S2（feature 目录）"+ 可选链接；确认只装扩展的项目不依赖 skill 的 reference。

## 阶段 4：验证与交付

- [ ] T10 文档一致性检查：级联顺序、级别命名（L0–L5）、失败类型（`malformed`/`conflict`/`needs_feature`/`needs_home`/`forbidden`）、小写目录与个人归档路径、落盘步骤无脚本，四处文本一致。
- [ ] T11 五类场景走查（spec.md §8.2），每类同时记录"产物位置"与"bundle `root`/内部引用"两组结果。
- [ ] T12 迁移与占用实测：迁移到不存在的父目录（建目录 → 复制 → 落盘 → 校验 `docId` 与 `comments`/`checkpoints`/`navigation` 逐字段一致，旧文件仍在）；目标被他人占用时预检即停、目标字节未变。
- [ ] T13 `npm test` 与 `npm run check` 通过（回归确认未牵动仓库既有测试与构建）。
- [ ] T14 若改动涉及 `skills/` 与 `packages/host/`，按 AGENTS.md 提出并执行 skill 与官网同步方案；官网如无相关内容则明确说明不涉及，并给出可访问的本地预览（若需要）。
- [ ] T15 交付 `.taco.html` 供人工核对，附报告（级别 / 依据 / 绝对路径 / 文件名 / 标题 / 告警 / 未决项）。
