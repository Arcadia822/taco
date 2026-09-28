---
title: '014-agent-taco-output-path 实施任务'
feature_id: '014-agent-taco-output-path'
created: '2026-09-28'
status: 'Draft'
---

## 阶段 1：契约定稿

- [ ] T1 评审并冻结 `contracts/output-path-rule.md`（级联 L0/L1/L2/L3/L4/L5、L2 跳过 L3、L0 规范文件名、保留字段与 `blocks` 规则、占用规则、落盘八步、校验阶梯 V1/V2、失败类型与告警、与扩展的关系）。

## 阶段 2：契约落位

- [ ] T2 把契约**语义等价地译为英文**写入 `skills/taco/references/output-path.md`，逐条核对语义一致。
- [ ] T3 把 `specs/014-agent-taco-output-path/contracts/output-path-rule.md` 替换为指针文件（标题 + 迁移说明 + 链接）。
- [ ] T4 校验只有一份权威：`contracts/output-path-rule.md`（实现后为 `references/output-path.md`）是**唯一**给出完整级联与失败语义的位置；其它文本只允许级别名摘要与链接（`spec.md` §4.1 已改为摘要）。

## 阶段 3：主流程收敛为零依赖

- [ ] T5 `skills/taco/SKILL.md` 新增 `## Where to write .taco.html`：级联摘要（小写 `tacos`、个人归档、L2 跳过目录探测、扩展项目由扩展决定）、L0 文件名↔标题规则、落盘八步、校验阶梯、报告与告警清单；`## Workflow` 步骤 1 引用。
- [ ] T6 `skills/taco/SKILL.md` 主流程收敛：开篇、bundle 写入规则、`## Workflow` 步骤 1、`### 2. Check what the reviewer will see`、`## Report format` 中依赖脚本命令/退出码/输出结构的表述，全部改为"直接写数据块 + 校验阶梯"；`pack.mjs` 只保留为完全可选的辅助说明。
- [ ] T6b `skills/taco/references/bundle-format.md` 收敛：删除"assembler 拥有载体 / 写块是工具工作 / 无浏览器时必须跑脚本"的表述，改为同等的安全写入规则 + 写前自校验 + V1/V2 阶梯；保留序列化、转义、原子替换与形态规则；明确与 `output-path.md` 的职责边界。
- [ ] T7 `docs/agent-installation.md`：Assemble 步骤改为直接写数据块；reference 清单补 `output-path.md`；补"产物目录由级联决定、不再默认写 cwd"的行为变更说明。
- [ ] T8 全局检查：规则、组件与操作步骤中不残留项目级输出配置（`.taco/config.yaml`、`outputDir`）或规则冲突判定；否定性说明允许保留。

## 阶段 4：扩展接线

- [ ] T9 `extensions/taco/commands/update.md`、`extensions/taco/skills/taco-speckit/SKILL.md`、`extensions/taco/README.md` 各加一句"扩展项目的落点由扩展自身约定决定，与通用级联无关"+ 可选链接；确认只装扩展的项目不依赖 skill 的 reference。

## 阶段 5：验证

- [ ] T10 文档一致性检查（级联顺序与级别命名、失败类型集合、小写 `tacos`、校验阶梯、落盘顺序，四处文本一致；无第二份权威；无配置机制残留；落盘步骤不把脚本/CLI 当必经路径）。
- [ ] T11 五类验收场景走查（spec.md §8.2），每类记录"产物位置"与"bundle 内部引用"两组结果。
- [ ] T12 逐分支走查（spec.md §8.3）并留下记录：隐藏路径与 `*.taco.html` 均被排除、刷新沿用既有 `packOptions.ignore`；非规范 L0 文件名（拒绝并给规范名）；非 `.taco.html` 文件（拒绝）；L2（仓库内有 `docs/` 时仍落 `<repo>/tacos/`）；L3 的 `docs` 优先于 `specs`；L4；L5 无 `HOME` 停止；无 `git` 命令仍能识别仓库；禁区目标；`unverifiable`（无解析能力时不落盘）；既有数据块损坏（`malformed`）；`output-in-input`；迁移到不存在的父目录；迁移目标已存在（默认停止、授权后覆盖并报告状态差异）；内容变化后 `blocks` 被丢弃。
- [ ] T13 校验阶梯实测：至少一次 V1（打开标签页 `window.taco.validate()` 得 `ok: true`，报告中写明级别）；至少一次 V2（仅解析核对并声明"未做运行校验"）。
- [ ] T14 `npm test` 与 `npm run check` 通过，并在报告里明确这三项既有测试只作回归防护。
- [ ] T15 若改动涉及 `skills/` 与 `packages/host/`，按 AGENTS.md 提出并执行 skill 与官网同步方案；官网如无相关内容则明确说明不涉及。

## 阶段 6：交付

- [ ] T16 交付 `.taco.html` 供人工核对，附报告（级别 / 依据 / 绝对路径 / 文件名 / 标题 / 校验阶梯级别与结果 / 告警）。
- [ ] T17 确认 `pack.mjs` 已按用户决定降为完全可选的辅助：文档不再把它写成必经路径，文件与 `tests/skill-pack.test.ts` 均保留。
