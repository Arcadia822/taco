---
title: '012-agent-taco-output-path 实施任务'
feature_id: '012-agent-taco-output-path'
created: '2026-09-28'
status: 'Draft'
---

## 阶段 1：契约定稿

- [ ] T1 评审并冻结 `contracts/output-path-rule.md`（`.taco/config.yaml` 语法与失败语义、S1/S2、级联与仓库根例外、L0 规范文件名、保留字段与 `blocks` 规则、占用规则、落盘七步、校验阶梯、告警集合）。

## 阶段 2：契约落位

- [ ] T2 把契约**语义等价地译为英文**写入 `skills/taco/references/output-path.md`，逐条核对语义一致。
- [ ] T3 把 `specs/012-agent-taco-output-path/contracts/output-path-rule.md` 替换为指针文件（标题 + 迁移说明 + 链接）。
- [ ] T4 校验只有一份权威：全仓库不存在第二份完整语法表或失败语义表。

## 阶段 3：主流程收敛为零依赖

- [ ] T5 `skills/taco/SKILL.md` 新增 `## Where to write .taco.html`：级联摘要（含小写 `tacos`、个人归档、仓库根例外）、`.taco/config.yaml`、L0 文件名↔标题规则、落盘七步、校验阶梯、报告与告警清单；`## Workflow` 步骤 1 引用。
- [ ] T6 `skills/taco/SKILL.md` 主流程收敛：开篇、bundle 写入规则、`## Workflow` 步骤 1、`### 2. Check what the reviewer will see`、`## Report format` 中依赖脚本命令/退出码/输出结构的表述，全部改为"直接写数据块 + 校验阶梯"；`pack.mjs` 只保留为完全可选的辅助说明，绝不作为创建、刷新或校验的必经路径。
- [ ] T7 `docs/agent-installation.md`：Assemble 步骤改为直接写数据块（含落盘七步与校验阶梯）；reference 清单补 `output-path.md`；补"产物目录由级联决定、不再默认写 cwd"的行为变更说明。

## 阶段 4：自我应用与扩展接线

- [ ] T8 新增 `.taco/config.yaml`（`version: 1`、`outputDir: specs/{feature}`）；确认 `tests/agent-instructions.test.ts` 与 `tests/templates.test.ts` 仍通过。
- [ ] T9 `extensions/taco/commands/update.md`、`extensions/taco/skills/taco-speckit/SKILL.md`、`extensions/taco/README.md` 各加一句"扩展项目 ⇒ S2（feature 目录）"+ 可选链接；确认只装扩展的项目不依赖 skill 的 reference。

## 阶段 5：验证

- [ ] T10 文档一致性检查（级联顺序与级别命名、仓库根例外、失败类型集合、小写 `tacos`、校验阶梯、落盘顺序，四处文本一致；无第二份权威；落盘步骤不把脚本/CLI 当必经路径）。
- [ ] T11 五类验收场景走查（spec.md §8.2），每类记录"产物位置"与"bundle `root`/内部引用"两组结果。
- [ ] T12 逐分支走查（spec.md §8.3）并留下记录：配置缺键 / `version: 2` / 顶层非 mapping / 重复键；S1–S2 冲突；仓库根打包（叠加 S1 存在）；非规范 L0 文件名（拒绝并给规范名）；L3 顺序；L4；L5 无 `HOME` 停止；无 `git` 命令仍能识别仓库；禁区目标；`output-in-input`；迁移到不存在的父目录；迁移目标已存在（默认停止、授权后覆盖并报告状态差异）；内容变化后 `blocks` 被丢弃。
- [ ] T13 校验阶梯实测：至少一次 V1（打开标签页 `window.taco.validate()` 得 `ok: true`，且报告中写明级别）；至少一次 V2（仅解析核对并声明"未做运行校验"）。
- [ ] T14 `npm test` 与 `npm run check` 通过，并在报告里明确这两项只作回归防护。
- [ ] T15 若改动涉及 `skills/` 与 `packages/host/`，按 AGENTS.md 提出并执行 skill 与官网同步方案；官网如无相关内容则明确说明不涉及。

## 阶段 6：交付

- [ ] T16 交付 `.taco.html` 供人工核对，附报告（级别 / 依据 / 绝对路径 / 文件名 / 标题 / 校验阶梯级别与结果 / 告警 / 未决项）。
- [ ] T17 就 `pack.mjs` 是否删除（含 `tests/skill-pack.test.ts`）取得用户决定后收尾；不删不影响本设计验收。
