---
title: 'TACO-33：托管评审人工交接'
feature_id: '015-hosted-review-handoff'
created: '2026-09-29'
status: 'Draft'
linear: 'https://linear.app/castrel/issue/TACO-33'
issue: 'https://github.com/Arcadia822/taco/issues/72'
---

## 1. 需求定位与证据

TACO-33 原提案希望 review 文件自动向原 agent session 注入 user message，以本地标识词扫描解决寻址问题。本次用户将方向明确改为 Tacobin 托管回路：Agent 在 publish 后通过 `taco-cli subscribe <tacoId>` 保持监听；人的评论和修改本身不唤醒 Agent，人在页头点击 **Handoff** 才明确表示自己的评审完成，并把完整评审交给监听中的 Agent。本设计只定义这一路径，不把原提案的本地扫描当作已确认实现方向。

已直接读取 Linear TACO-33：状态 Backlog、优先级 High、无所属 project/子项/关联其他 Linear Issue；关联 GitHub #72，评论仅为 GitHub 同步说明。该工单是提案，没有正式逐条验收清单；下表将工单目标与用户本轮的明确要求拆成可测试场景，**不是宣称 Linear 已改写或批准此方案**。关联仓库通过 GitHub #72 确认为 `Arcadia822/taco`。

| 来源 | 需求或目标 | 本设计验收场景 |
| --- | --- | --- |
| TACO-33 原提案 | 人不再手工复制、切回终端并粘贴 user message | A1：托管评审点击 Handoff 后订阅流产生可定位完整评审的事件；不要求人为复制。是否进一步向 idle harness 注入 user message 见「待决策点」。 |
| TACO-33 原提案 | 评审正确关联原 Agent，避免错误会话接收 | A2：事件按 Host 和 `tacoId`、revision 归属；跨 Taco 或旧版不得混入；不将机器本地 session 信息嵌入公开 Taco。 |
| 用户本轮 | 评论不触发交接；人明确控制完成时机 | A3：发布后评论或修改产生持久评审数据而**不产生 Handoff 事件**；只有人点击页头 Handoff 才产生一次可补读的交接。 |
| 用户本轮缺口 1 | 人能看到谁在监听当前 Taco | A4：同一 Taco 的一个或多个活跃 CLI 监听者可见；断开/超时后消失；无监听者时不谎称已送达。 |
| 用户本轮缺口 2 | 文件 CP 状态改动进入 diff | A5：从 `todo` 到 `complete` 或回退等状态变化包含 path/from/to，并与文件修改、评论一起返回。 |
| 用户本轮缺口 3 | Handoff 默认按钮新增动作，既有两种复制行为不变 | A6：托管页主按钮提交交接，两项下拉复制维持现有语义；离线/本地 Taco 主按钮仍是复制。 |
| 用户本轮 | Agent 收到人的所有修改、审阅、评论 | A7：未保存文件编辑、Checkpoint 状态/定义与评论完整历史同属一个可追溯快照；失败或冲突不能提示已交接。 |

## 2. 设计阶段体积与依赖预算（prepare 估算）

以下为实现规模的**预算而非实测结果**；本轮只产出设计。以 `AGENTS.md` 2026-09-28 构建基线为比较口径：Complete 产物 2,835,255 B、Lite 产物 286,281 B、skill Complete shell 2,730,006 B、skill Lite shell 181,032 B。

| 产物 | 预计增量 | 说明 |
| --- | ---: | --- |
| `skills/taco/taco-shell.html` 与 Complete `.taco.html` | 各约 +3–6 KiB（shell 约 +0.11–0.23%，单文件产物约 +0.11–0.22%） | 仅承载宿主可选择的 Handoff 扩展接口；完整托管逻辑留在 Host。 |
| `skills/taco/taco-shell-lite.html` 与 Lite `.taco.html` | 各约 +3–6 KiB（shell 约 +1.7–3.4%，产物约 +1.1–2.1%） | 达到仓库“≥1%”的主动告知阈值；实施时必须按两种 shell 分别实测。 |
| `skills/taco/` 非 shell 文档 | 约 +1–3 KiB | 说明托管交接与离线复制的分支及凭据边界。 |
| `@tacobin/cli` 打包产物 | 约 +2–5 KiB | 订阅身份与交接事件提示；数值须由实现后的实际打包对比。 |
| `packages/host` 服务源码 | 约 +20–40 KiB | 持久评审/事件、在线编辑、presence 与交接 API；不是下载体积承诺。 |
| 本轮中文设计与契约源文件 | 约 +10–25 KiB；生成 `.taco.html` 另约 +10–25 KiB 内容数据 | 设计文档是唯一新增的当前产物；shell 基数按上表计算。 |

当前托管路由靠进程内 `Map` 记录评论和订阅，不能保证跨 Vercel 实例和重启后的交接可重放。设计建议复用已有 `packages/host/src/schema.sql` 的数据库方向，但现有 Next 路由未接入它；因此实施预计新增真正的持久数据库驱动/连接配置与 Host↔数据库联网。CLI 与本地 Taco 无新增常驻 daemon；离线打开仍不联网。身份机制的额外依赖与迁移取舍将在「待决策点」说明。develop 阶段必须构建并将对应产物**估算值 / 实测值 / 偏差原因**并列记录；本轮不得填写虚构实测。
