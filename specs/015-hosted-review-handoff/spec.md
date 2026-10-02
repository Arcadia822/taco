---
title: 'TACO-33：托管评审人工交接'
feature_id: '015-hosted-review-handoff'
created: '2026-09-29'
status: 'Draft'
linear: 'https://linear.app/castrel/issue/TACO-33'
issue: 'https://github.com/Arcadia822/taco/issues/72'
---

## 1. 需求定位与证据

TACO-33 原提案希望 review 文件自动向原 agent session 注入 user message，以本地标识词扫描解决寻址。本次用户明确改为 Tacobin 托管回路：Agent publish 后订阅当前 Taco；任何访问分享链接的人均可用自报姓名编辑、评论，修改自动保存；人在页头点击「交接」时，Host 将**上次 publish 的不可变基线到当时已保存的最新状态**的完整差异及评论交给订阅者。评论和自动保存不触发交接；本轮不设计本地 harness 扫描或 idle session 唤醒插件。

已直接读取 Linear TACO-33：状态 Backlog、优先级 High、无所属 project/子项/关联其他 Linear Issue；关联 GitHub #72，评论仅为 GitHub 同步说明。该工单是提案，没有正式逐条验收清单；下表将工单目标与用户本轮的明确要求拆成可测试场景，**不是宣称 Linear 已改写或批准此方案**。关联仓库通过 GitHub #72 确认为 `Arcadia822/taco`。

| 来源 | 需求或目标 | 本设计验收场景 |
| --- | --- | --- |
| TACO-33 原提案 | 人不再手工复制、切回终端并粘贴 user message | A1：托管评审点击「交接」后订阅流产生可定位完整评审的事件；无需手工复制，本地 harness 唤醒属独立插件、不在本设计范围。 |
| TACO-33 原提案 | 评审正确关联原 Agent，避免错误会话接收 | A2：事件仅按 Host 与 `tacoId` 路由；单个 Taco 只有一次 Agent publish 基线，Agent 不必读取或提供 revisionId；自报订阅身份不保证其就是原 Agent。 |
| 用户本轮 | 评论不触发交接；人明确控制完成时机 | A3：编辑和评论实时自动保存并产生可追溯记录，但**仅点击「交接」**生成 Handoff 事件；重复操作幂等。 |
| 用户本轮缺口 1 | 人能看到谁在监听当前 Taco | A4：零/一个/多个活跃监听者可见；可选自报 Harness、Model 名称及详细 model id、Name，匹配枚举图标；未验证身份且不提供送达承诺。 |
| 用户本轮缺口 2 | 文件 CP 状态改动进入 diff | A5：`todo→complete` 或回退等状态变化含 `path/from/to`，与文件修改及评论一起返回；恢复 publish 原状时保留相对前次交接的增量。 |
| 用户本轮缺口 3 | Handoff 默认按钮新增动作，既有两种复制行为不变 | A6：托管页主按钮「交接」只读取已保存状态并发事件，两项下拉复制及本地/离线主按钮语义不变。 |
| 用户本轮 | Agent 收到人的所有修改、审阅、评论 | A7：publish 基线到最新**已自动保存**状态的文件/Checkpoint 完整差异和所有评论历史在一致快照里；有未保存/失败的编辑时不可声称已交接。 |
| Taco 审阅批注 | 任意访问者自报姓名即可写；版本不应每次保存都增加 | A8：无账号/guest 鉴权，姓名是记录中的自报 id；自动保存立即可见，历史版本按固定 10 分钟窗口合并，交接快照独立于版本合并。 |

## 2. 设计阶段体积与依赖预算（prepare 估算）

以下为实现规模的**预算而非实测结果**；本轮只产出设计。以 `AGENTS.md` 2026-09-28 构建基线为比较口径：Complete 产物 2,835,255 B、Lite 产物 286,281 B、skill Complete shell 2,730,006 B、skill Lite shell 181,032 B。

| 产物 | 预计增量 | 说明 |
| --- | ---: | --- |
| `skills/taco/taco-shell.html` 与 Complete `.taco.html` | 各约 +3–6 KiB（shell 约 +0.11–0.23%，单文件产物约 +0.11–0.22%） | 仅承载宿主可选择的 Handoff 扩展接口；完整托管逻辑留在 Host。 |
| `skills/taco/taco-shell-lite.html` 与 Lite `.taco.html` | 各约 +3–6 KiB（shell 约 +1.7–3.4%，产物约 +1.1–2.1%） | 达到仓库“≥1%”的主动告知阈值；实施时必须按两种 shell 分别实测。 |
| `skills/taco/` 非 shell 文档 | 约 +1–3 KiB | 说明托管自动保存、无鉴权自报身份与离线复制的边界。 |
| `@tacobin/cli` 打包产物 | 约 +3–7 KiB | 可选监听元数据与交接引用；数值须由实现后的实际打包对比。 |
| `packages/host` 服务源码 | 约 +25–45 KiB | 持久自动保存/历史窗口、事件、presence 与交接 API；不是下载体积承诺。 |
| 本轮中文设计与契约源文件 | 初估 +10–25 KiB；前一版实测 49,684 B；修订稿实测约 55.3 KiB（合计 56,613 B） | 初估漏计两份独立接口契约；修订增加历史快照读回与线程动作史等契约，偏差来自新增两份契约及评审修正。本轮只产出三份设计源文件，无新运行依赖或联网行为。 |
| 本轮中文评审 `.taco.html` | 初估相对当前 Complete shell +50–70 KiB；重打包后实测约 +58.4 KiB（2,795,134 B） | 本轮不修改 Complete/Lite shell 或 skill；实现后的 shell/产物预算与实测另记。 |

当前托管路由靠进程内 `Map` 记录评论和订阅，不能保证跨 Vercel 实例和重启后的交接可重放。设计建议复用 `packages/host/src/schema.sql` 的数据库方向，但 Next 路由尚未接入；实施需新增持久数据库驱动/连接配置与 Host↔数据库联网。CLI 与本地 Taco 不新增常驻 daemon，离线打开仍不联网；编辑在**托管页面**才会联网自动保存。develop 阶段必须构建对应产物，将**估算值 / 实测值 / 偏差原因**并列记录；本轮设计不填写虚构的实现体积。

## 3. 现状、约束与方案

### 3.1 当前运行代码与目标契约必须区分

当前 `packages/host/src/app/v1/tacos/route.ts` 将 publish 请求写入公开、允许覆盖的 Vercel Blob，仅返回 `tacoId` 和 URL；`packages/host/src/app/t/[id]/route.ts` 强制 `access: 'reader'`。评论按钮调用 `/reviews`，只发 body/author（quote 被路由丢弃）；`reviews/route.ts` 用内存 Map 广播 `comment.created`，没有持久评论线程或在线编辑。`subscribe/route.ts` 是内存 SSE，CLI 使用 SSE adapter。现有 `service.ts`、`schema.sql` 和 008 设计含 revision/guest-session 等**未接入**的目标契约；本轮按用户新决策只借用其中事务/事件/私有存储模式，不强加 guest 鉴权或把内部 revisionId 暴露给 Agent。

本地 `src/file-browser.ts` 的 Handoff 主按钮目前复制完整评审，下拉分别复制完整评审和“不含数据”的检查提示；`getModifiedReviewFiles()` 从当前未保存内容生成 diff，`getCheckpointChanges()` 给出 path/from/to，`src/main-common.ts` 的 `window.taco.getReviewHandoff()` 也提供模板/成员变化及所有评论。浏览器已有事实可以复用，**缺的是托管写入、持久交接和订阅者展示**。`freeze` 是 Checkpoint 标签，不是批准。

### 3.2 交互与责任边界

1. CLI publish 返回分享 URL 和 `tacoId`；一个 Taco 仅有一次 Agent publish，不设计多个 Agent 对同一 Taco 再 publish。Host 固定一份不可变发布基线；Agent `taco-cli subscribe <tacoId>` 收到 ready，页头显示此 Taco 活跃连接的自报信息。列表仅代表连接在线，不认证其为原 Agent，也不保证进程已读。
2. 任何拿到 URL 的人都可自报姓名作为 `authorId` 修改**同一个共享的最新文档**、Checkpoint 状态及创建、回复、解决评论，无账号或 guest 会话鉴权；姓名相同者无法区分、可冒用。模板名称与节点定义保留在存储协议中，Header 不提供编辑入口。编辑以短暂 debounce（例如 1 秒）增量自动保存成功后向所有人可见；“保存中/失败/有冲突”明确提示，刷新前有未保存改动须警告。评论独立实时持久化；任何写入都不自动交接。页头 Save 保存本地 Taco，独立于 Host 自动保存。
3. 托管页头主按钮文案仅为「交接」。点击时如本页有待 debounce 的脏内容或正在保存的请求，则等待**原定的自动保存**成功后再提交；失败/冲突则阻止交接并保留本地改动，绝不由交接请求代存正文。其他页面的未保存输入不可观测，界面只承诺交接时 Host 已保存的状态。Host 基于同一已保存状态版本和评论高水位冻结**发布基线→最新状态**的差异，写不可变 Handoff 及持久事件；它不创建/推进可见历史版本、不重置 publish 基线。重复点击处理中禁用，同一 Idempotency-Key 重试返回同一结果。
4. 两项现有“复制完整评审”和“复制不含数据的检查提示”仍在下拉，内容和失败提示保持现行语义；本地 `file://` 和没有可信 Host 能力的普通 Taco 主按钮仍执行原复制动作。不能用 CSS 选择器或 Host 注入脚本假装完成核心动作：浏览器运行时提供可选的、明确受同源 `/t/{id}` 启用的交接回调，Host 集成执行网络请求。不可由上传的 bundle 字段指定任意目标 URL，也不能在无 Host 时静默假成功。
5. 订阅 stdout 使用 `ready`/`event`/`checkpoint` 帧；默认只等待 `review.handed_off`，收到后输出并以退出码 0 结束，`--stream` 持续接收全部事件。交接帧含 handoffId 与 tacoId，Agent 拉完整快照再检查冲突、应用反馈。Host 页面交接前刷新监听列表；零监听者展示安装引导，不生成交接事件，查询失败阻止提交。已持久化事件可通过 events/`--after` 补读；“Host 已保存”不等于 Agent 已处理，托管内容不可直接当可信指令或自动覆盖。

### 3.3 快照一致性、评论与完成时机

- 发布快照是 Taco 内唯一 Agent publish 基线；共享文档的每次自动保存改变 `stateVersion`，不改变该基线。每个 Handoff 的主 payload 包含**发布基线→当时最新已保存状态**的累计统一 diff/完整文件内容、Checkpoint 全量状态/定义与差异、当时所有评论线程的完整历史（状态、锚点、作者、消息墓碑、时间及创建/解决/重开等线程动作）。为辨别重复交接及恢复原状，还保留**上次成功交接→本次**的文件/Checkpoint 增量和定义变化；第一次以发布基线为上次状态。即使累计差异变为空，恢复原状的增量仍携带当前内容。评论按同一事务高水位冻结，不把以后保存或新增评论回填旧记录。

自动保存只发送**被修改的文件或 Checkpoint patch**：小改动经 JSON patch，较大的单文件增量沿用私有 Blob 预留，Host 校验 blob、预期 `stateVersion` 与路径后原子更新共享最新状态；以序列化 UTF-8 字节数限制每次 JSON patch 不超过 1 MiB，过大的单文件正文先走私有上传，过大的非文件 patch 拆分为独立 CAS 保存或明确拒绝，避免 Vercel Function 的 4.5 MB 请求体限制；整个共享快照最大 32 MiB，达到上限时明确拒绝新写入。不在每次按键时重新上传完整发布包。新增/改名带稳定 id，删除明确列出路径，**删除最后一份文件返回 422**，使共享状态继续符合 008 `Snapshot.files.minItems=1`；相同 id 改名才报告重命名，否则删除+新增；路径保持 bundle root 相对形式，Checkpoint/评论锚点用完整 bundle 路径，旧锚点失效仍留历史。Host 交接读取已保存的共享快照，**没有 HandoffUpload**。`changedFiles[]` 以 publish 为基线，`incrementalFiles[]` 以上次交接为基线；删除 `content=null`，改名必须含稳定 id 和旧路径，其它变更完整正文/二进制数据可读取；重复、越界路径、遗漏正文均拒绝。
- 首次点击即使没有文本改动仍追加一次“人的评审已交接”事件；同键网络重试复用 handoffId。之后判断变化须比较上次交接完整状态与当时评论高水位，而非只比较累计 diff；没有任何新增状态/评论则提示“已交接，无新内容”且不发重复事件。**交接属于整份 Taco**，任何访问者都能触发；保存与提交是两个独立操作。
- 所有写入以共享 `stateVersion` 乐观并发校验：两标签/两人同一文件并发时先提交成功，后者 409，保留本地草稿供显式合并，不用自报姓名隔离私有草稿。交接带 `expectedStateVersion`，若别人刚保存则 409 提示刷新预览再交接；评论写入/交接快照在同一事务锁与高水位，持久记录、event sequence、幂等收据原子提交。提交成功仅称 Host 已保存，不能称 Agent 已收到。
- 不使用 `review.completed` 或 `revision.approved` 代替 `review.handed_off`：现有未接线 service 的这两个概念既无评审 payload，也不能表示 Agent 看到了完整修改。评论事件可继续存在，**Agent 工作流只以 `review.handed_off` 作为继续处理的门槛**，不能由新增评论自动继续。

### 3.4 自动保存与历史版本冷却

参照飞书官方说明：[云文档内容变动实时自动保存](https://www.feishu.cn/hc/zh-CN/articles/803525191890-%E4%BA%91%E6%96%87%E6%A1%A3%E4%BB%8B%E7%BB%8D)，[历史记录自动保留修改人、时间和细节](https://www.feishu.cn/hc/zh-CN/articles/753686977351-%E6%9F%A5%E7%9C%8B%E5%92%8C%E8%BF%98%E5%8E%9F%E6%96%87%E6%A1%A3%E5%8E%86%E5%8F%B2%E8%AE%B0%E5%BD%95)；公开资料**没有给出自动历史版本生成的分钟间隔**，不能声称“飞书就是每 10 分钟”。本设计自行选定固定 10 分钟窗口：第一笔成功自动保存打开工作版本，接下来 10 分钟内所有成功保存更新该版本的最新内容指针；到期封存该版本，下一次成功保存才创建下一版本。时间窗口从第一笔成功写入起算，不因持续编辑推迟；无编辑不新增版本。`GET /history/{windowId}` 可查看开放窗口的最新已保存状态或封存窗口的最终不可变完整快照，旧 Blob 在保留该版本时不可回收；本轮不自动恢复历史内容。底层每次保存仍有持久 `stateVersion` 与作者/时间记录、评论独立记录，因此窗口合并不丢审计，窗口内已有交接的不可变快照不被改写。发布基线永久不随历史窗口前移；一次 Handoff 不创建/封存历史版本。大文件私有 Blob 为不可变对象，提交新指针后旧内容仅在没有历史版本/交接引用且留存策略允许时回收。

`specs/008-taco-host-contract/contracts/protocol.schema.json` 的 `Event.type` 是封闭枚举，且旧 Event 必填 `revisionId` 和旧 Actor 形状；HTTP events 与 SSE ServerFrame 共用它。实施须增加 `review.handed_off` 独立分支，允许该分支不携带 revisionId、使用自报作者及 `data.handoffId`，不放宽旧事件分支的校验；旧 CLI 对未知事件的 NDJSON 透传仍须验证。不能仅添加独立 HandoffEvent 就宣称现有订阅接口已支持新类型，也不能把 008 已批准设计误称现有运行代码。

## 4. 受影响组件与存储

| 组件 | 设计动作 | 必须保留的边界 |
| --- | --- | --- |
| `src/file-browser.ts`、`src/main-common.ts`、`packages/host/src/browser/` 与专用 Host shell | 本地编辑器保留通用 diff、Checkpoint、评论和复制交接钩子；仅 Host shell 编入自动保存、监听与显式交接逻辑 | Complete/Lite 不携带托管逻辑或 UI；本地/离线主按钮及双复制菜单不变；外站脚本或 bundle 不能指定 Host URL |
| `packages/host/src/app/t/[id]/route.ts` | 从只读公开页面转为共享可编辑页面，提供姓名输入、自动保存状态和监听者自报标签/Logo | 不执行上传 HTML 脚本；姓名不是可信身份 |
| `packages/host/src/app/v1/tacos/`、`lib/server-state.ts` | 新增共享 state 自动保存/历史窗口与持久交接事务、事件、监听租约；评论保留锚点与完整历史 | 内存 Map 不再当作已提交事实，跨实例读一致 |
| `packages/host/src/service.ts`、`schema.sql`、数据库/Blob 适配 | 借鉴事务与收据模式，增加 shared_state、edit_log、history_window、handoff 与 listener_lease；大正文为私有不可变对象 | 发布基线不变；写入不鉴权，但并发、Origin/CSRF、大小仍校验 |
| `packages/cli/src/runner.ts`、`subscriber.ts` | `subscribe` 可选自报 `--harness`、`--model`、`--model-id`、`--name`；断线回放及 handoffId 引用 | 不扫描 harness 会话，不把自报标签称为已验证，不把评论事件当交接 |
| `packages/protocol/src/projection.ts` 与契约 | 复用安全路径、bundle/Checkpoint 校验，托管自动保存仅接受白名单 patch | 不在 `.taco.html` 发送 collab/Key，未知字段不静默丢弃 |
| `skills/taco/references/reviewing.md`、`packages/host/` 官网文案 | 已同步评论与显式 Handoff 的区别，以及本地 shell 与 Host 页面运行时分界 | 不将本地复制交接误写成托管事件，也不把监听在线误写成送达回执 |

存储边界：发布时固定 `publishSnapshotRef`，共享当前状态以 `{tacoId,stateVersion,snapshotRef,updatedAt}` 指向不可变 Blob；编辑日志 `{tacoId,stateVersion,authorId,changedAt,changeRef}` 逐次持久，历史版本窗口 `{tacoId,id,startedAt,closedAt,latestStateVersion,snapshotRef}` 在首次写入后固定十分钟并允许按 id 回读；Handoff `{id,tacoId,stateVersion,eventSequence,payloadRef,payloadHash,commentsThroughSequence,createdAt,authorId}` 冻结当时已保存状态，**不按窗口覆盖**。评论线程/消息/不可变动作日志按 Taco、稳定锚点及自报姓名保存；删除消息保留墓碑，解决又重开保留两次动作及作者、时间。监听短租约 `{tacoId,listenerId,name,harness,model,modelId,lastSeenAt,expiresAt}` 不存机器路径或会话 ID，所有字段均自报。同一 Taco 行锁分配十进制事件 sequence，跨实例用持久日志恢复；CLI 已完整输出的 cursor 才确认，重复按 handoffId 去重。

## 5. 接口契约与兼容边界

本功能 HTTP 路径、参数、错误由 [OpenAPI 增量契约](contracts/openapi.yaml) 维护，自动保存 patch 与交接数据由 [JSON Schema](contracts/handoff.schema.json) 维护；008 的 OpenAPI 和 service 仅是历史目标设计，当前 Next 路由并未接入。本文定义跨接口时序，不复制一份互相漂移的字段表。

- `publish` 继续只对 CLI 返回分享 URL 与 tacoId；Host 内部保留发布快照，不要求 CLI/订阅者/交接消费者传 revisionId。单一 Agent publish 的 Taco 才启用此路径；对已有无基线的旧公开 paste 保持只读/复制，不能凭空推断版本。新 Agent publish 生成新 Taco，不支持多个 Agent 对同一 Taco 再 publish。
- 公开编辑/评论/交接不做账号或 guest-session 认证，任意访问者可提交自报姓名；自报姓名经裁剪与长度限制仅用于展示/记录，不能视为权限或可靠审计。仍校验浏览器同源 Origin/公开 CSRF、路径、媒体类型、状态版本、正文体积和存储结果，恶意跨站触发写入应被拒绝；API 本身公开，可用脚本以任意姓名写入，故需速率/体积限制和清晰的公开风险提示。评论服务必须先从当前只保存 body/author 的内存路由迁至锚点、消息和状态可回读的持久结构，否则不能承诺交接全历史。
- 新托管页面对外公开读取发布基线、共享最新状态和 Handoff；正文编辑经自动保存接口独立提交，小 patch 直接 JSON、大单文件先传私有 Blob；交接 POST **不上传正文、不执行保存**。旧 CLI 的 SSE 帧语法不变，未知事件可透传。cursor 过期明确报缺口，不能把最新位置冒充历史。Host 交付/评论默认公开，编辑可能被别人覆盖或冒名，界面明示这不是权限保护的私有协作。

## 6. 验证方案与实施任务

### 6.1 必须可复现的验收路径

1. 新发布返回 tacoId，`subscribe` 无凭据可选自报 `--harness codex --model gpt --model-id gpt-5 --name 设计助手`；页面显示对应本地 Logo/模型族名称及详细 id，并标“自报”；全部可选时显示匿名监听者；非法枚举返回明确参数错误，不透明或未知值显示通用图标而非冒充支持的模型。停止/失效后消失，同一 listenerId 重连不重复计数。
2. 两个匿名浏览器分别自报姓名编辑同一共享文件；Markdown、PNG、Checkpoint `todo→complete`、template/成员更改和锚定评论自动保存成功后跨刷新/实例可见，交接之前无 `review.handed_off`。正在保存、保存失败或 409 冲突时点击「交接」不静默保存，也不误称未保存文本已交接；修复后点击只提交轻量交接请求。
3. 首次交接可无变更，仍形成一个事件；事件只含 tacoId/handoffId，Agent 拉取 publish→当前最新状态的累计差异、当前正文、完整 CP/评论及上次交接→本次增量。第二次把正文与 CP 恢复发布原状时，累计 diff 为空但增量列恢复操作；没有新状态/评论时不重复发事件。评论 POST 永不生成交接事件。
4. 10 分钟固定窗口内持续自动保存产生不同 `stateVersion` 但仅一个历史版本；到期后的下一次写入开始新版本；持续无休止编辑也不能延长窗口。开放窗口可读最新内容，封存窗口可按窗口 id 读旧版全文且后来编辑不改旧版；第 5 分钟交接的不可变 payload 在第 6 分钟写入后不变；交接不推进历史版本。飞书文档只作为自动保存/历史概念参考，不把十分钟冒称其实际规则。
5. 并发保存旧 `stateVersion` 返回 409，保留本地未提交内容；交接前别人保存导致 expectedStateVersion 不匹配则提示重新查看。连点、丢响应同键重试、跨实例重启和 `--after` 回放仍只有一次手动交接记录；没有监听者仍可交接，但不可声称 Agent 已处理。新增/删除/改名/大文件可读完整内容，删除唯一文件返回 422，无 ID 的改名表示删除+新增；超限/非法路径/存储失败无部分成功；跨 Taco id 拉取 404。全局无锚点评论可创建；解决、重开及删除消息后，交接能读出各次动作作者、时间及墓碑。
6. Host 两项菜单仍复制完整评审与不含数据的检查提示，失败提示不变；本地 Taco 主按钮仍复制且不发 Host 请求。Checkpoint 状态只写共享状态表，不改文件 frontmatter；`freeze` 不是批准。

### 6.2 依赖顺序

1. 落实共享事件协议：008 的 Event 封闭枚举增加 `review.handed_off` 分支，HTTP events 与 SSE 一致；Host 固定 publish 基线，选生产事务数据库/私有 Blob 并给共享状态、编辑日志、历史窗口、handoff 建表。不实施旧设计的 guest-session/owner listener capability。
2. 接入公开共享自动保存与持久评论：姓名自报、Origin/CSRF、CAS 并发、文件/Checkpoint 增量 patch、大文件私有预留、十分钟固定历史窗口、失败恢复；先证明跨实例读回。交接 POST 仅读已持久状态并原子冻结 payload/事件，不走上传或代保存。
3. 接入 CLI 可选 Harness/Model/ModelId/Name 元数据与 Host 监听短租约/内置 Logo，补回放与旧 CLI 兼容；升级同源托管主按钮为「交接」，保留两项复制与离线回退。Harness 进程 wait/插件注入在各自集成里实现，不属于本功能。
4. 更新 `skills/taco/` 托管评审说明和 `packages/host/` 官网使用说明；代码审查阶段同步检查 skill/官网关联，修改官网须启动本地服务提供真实预览 URL。
5. 实施阶段运行自动保存/历史窗口/并发/公开写入与 CSRF/交接/CLI 交互测试，构建 Complete/Lite、CLI 和 Host，记录上述估算/实测/偏差。Lite 若达到 ≥1% 或 ≥32 KiB 阈值，告知用户数字、原因及将 Host 专用 UI 外置的替代方案。

## 7. 评审决定与审查状态

本次 Taco 评审已替代上一轮的 D1/D2：**不引入监听凭据**，Harness/Model/Name 全部由调用方自报并明确未验证；**不设计 idle session 自动唤醒**，支持等待子进程的 harness 可自行消费 CLI 输出，其他 harness 的独立插件另议。本设计不再留下上述两项待决策点。其他评审批注决定：任意访客可用自报姓名写入、正文自动保存、十分钟固定历史窗口、页头仅写「交接」、提交只读取上次 publish 到最新已保存状态的差异且不要求 Agent 理解 revisionId。

上一轮独立设计审查发现五项可执行缺口：全局评论不接收 `anchor:null`、历史窗口无法读取正文、删除最后一份文件后快照不合法、评论解决/重开动作历史丢失、交接改名未强制携带稳定 id 与旧路径。已逐项修订 OpenAPI、Schema、正文与验收路径；独立审查者复核原文结论：“前述五项缺口均已闭合（全局评论 null 锚点、按窗口读取历史快照、删除唯一文件返回 422、评论动作历史、交接改名必须带 id/旧路径）。自动保存 CAS、交接高水位和不可变快照、十分钟冷却、自报监听信息及不向 Agent 暴露 revisionId 的边界一致；未发现仍满足可复现且由本次修订引入的阻断问题，结论通过。”该审查只针对设计，未运行实现代码。收到的四处六条评审批注来自用户消息；本地 `.taco.html` 没有这些线程的已保存记录或 thread id，不能伪造锚点/作者时间或声称线程已解决。设计源文件按评审批注更新；若后续收到含评论的已保存 Taco，再保留并合并真实线程。设计仍为 Draft，等待人工评审批准。

上一轮设计交付：`spec.md`、`contracts/openapi.yaml`、`contracts/handoff.schema.json`、中文 `.taco.html`；Draft PR [#85](https://github.com/Arcadia822/taco/pull/85) 关联 Linear [TACO-33](https://linear.app/castrel/issue/TACO-33) 与 GitHub [#72](https://github.com/Arcadia822/taco/issues/72)。本轮在同一 PR 开发并保留 Draft 状态，不合并、不将设计标记为已批准。

## 8. 实施阶段体积与依赖实测（develop）

2026-09-29 以 `npm run build` 生成的 Complete/Lite、`packages/cli` 的 `npm run build`、Host 的 `next build` 和 `wc -c` 实测。前一阶段第 2 节的预算保留，以下与之并列；构建基线为 `AGENTS.md` 2026-09-28 的四个 shell 字节数。`skills/taco/` 与 Host 源码的基线采用实施前设计提交 `ba65720` 跟踪文件大小总和，同口径测当前文件。

| 产物 | prepare 估算增量 | develop 实测增量/当前大小 | 偏差与原因 |
| --- | ---: | ---: | --- |
| Complete shell（`skills/taco/taco-shell.html`） | +3–6 KiB | +18,408 B（2,748,414 B，+0.67%） | 浏览器托管自动保存、监听状态、评论动作及并发保护需要共享运行时代码；高于仅有回调的预算。 |
| Complete `.taco.html`（`dist-single/Taco_Spec.taco.html`） | +3–6 KiB | +18,694 B（2,853,949 B，+0.66%） | 同一内嵌运行时代码，附加构建包装开销。 |
| Lite shell（`skills/taco/taco-shell-lite.html`） | +3–6 KiB | +17,208 B（198,240 B，+9.51%） | 同上，Lite 基数较小；超过 ≥1% 的主动告知阈值。 |
| Lite `.taco.html`（`dist-single/Taco_Spec_Lite.taco.html`） | +3–6 KiB | +17,494 B（303,775 B，+6.11%） | 同上，超过 ≥1% 的主动告知阈值。 |
| `skills/taco/` 全目录 | 非 shell 文档 +1–3 KiB | 跟踪文件基线 14,056,129 B → 当前 14,136,126 B（+79,997 B）；`du -sk` 当前 18,368 KiB | shell 及多个生成模板镜像同步增加，目录增量不能只按正文说明计算。 |
| `@tacobin/cli` 二进制 | +3–7 KiB | 当前 `dist/main.js` 73,733 B；该构建前未留存同环境旧 binary，增量不可核实 | 只报告可复现的当前字节数，不以不同依赖环境估算旧产物。 |
| Host `.ts/.tsx/.sql` 源码 | +25–45 KiB | `ba65720` 同口径 177,560 B → 当前 336,546 B（+158,986 B） | 持久化 PostgreSQL/本地 SQLite 双适配器、共享路由及事务/CSRF/配额校验多于规划。服务端打包体积不等于此源码增量。 |

依赖：Host 新增运行依赖 `pg`（生产 PostgreSQL 连接）和开发类型依赖 `@types/pg`；本地 SQLite 使用 Node 内置模块。托管网页自动保存、评论、监听状态与显式交接需要同源网络请求；本地 `.taco.html` 仍可离线打开。第 9 节已按用户裁决把托管协作代码从本地 shell 拆出，采用 Host 专用单文件运行时，避免额外脚本请求和独立缓存版本契约。

上一轮实测交互：本地生产 Host + SQLite、CLI publish/subscribe、浏览器文件编辑与全局/锚定评论自动保存、监听者自报展示、页头手动交接、CLI 按引用取回累计/增量 diff 与评论、Checkpoint 状态 `in_progress → complete` 的持久交接，以及 CLI `events --after/--through/--limit` 回放均成功。第二次只新增评论后交接：累计文件改动仍为 `plan.md`，增量文件/Checkpoint 差异均为空，评论历史保留两条消息。本轮拆分后根测试 52 文件、564 测试通过，Complete/Lite/Host 专用运行时、CLI、Host 构建通过；第 9 节记录了拆分后的浏览器交互。独立代码审查的 PostgreSQL 事务、跨次交接路径、上传限额/内存上限、幂等收据和浏览器编辑竞争等问题已修复并补回归测试；生产 PostgreSQL、私有 Blob 及跨 Vercel 实例场景尚未在此环境实测，不能据本地 SQLite 结果宣称已通过。

## 9. 托管运行时与本地 shell 分离（2026-09-29 修订）

用户裁决：本地 Complete/Lite 版本不得携带、展示或依赖仅托管页面需要的协作功能；确属本地评审能力的评论、Checkpoint 和复制交接保持可用。此前把 `src/host-client.ts`、`src/hosted-session.ts` 和托管按钮一起静态引入单文件 shell，导致 Lite shell 相对实施前基线增加 17,208 B（+9.51%），不符合该边界。

**prepare 估算**（相对上一轮实测，改造前 Complete shell 2,748,414 B、Lite shell 198,240 B、Complete 产物 2,853,949 B、Lite 产物 303,775 B）：将托管交互只编译进 Tacobin 专用 shell，预计本地 Complete/Lite shell 各减少约 12–20 KiB；对应 `.taco.html` 产物各减少约 12–20 KiB。Host 专用 shell 预计约 2.85–2.88 MB（承载现有完整编辑器和协作逻辑）；`skills/taco/` 全目录预计减少约 24–40 KiB，生成模板镜像同步缩减。现有 Host asset 2,853,949 B，预计专用版增量在 ±8 KiB；以构建后字节数为准。本次不引入 npm 依赖，也不增加浏览器网络请求：Tacobin 路由只提供 Host 专用、仍可单次加载的页面；本地 shell 离线不发托管请求。

实现后须并列记录上述估算与实测偏差，验证本地双 shell 的脚本/样式中没有托管 API、监听者、自动保存及托管交接行为，Host 专用产物仍在同源下完成 publish→浏览器编辑/评论/Checkpoint→显式交接→CLI 补读。不以仅移走 HTTP 客户端却留下托管 UI 和翻译字符串作为完成。

**develop 实测**（与第 9 节估算同一口径，`npm run build` 后 `wc -c`，相对拆分前产物）：

| 产物 | prepare 估算 | develop 实测 | 偏差与原因 |
| --- | ---: | ---: | --- |
| skill Complete shell | -12–20 KiB | -11,120 B（2,737,294 B，-0.40%） | 比减量下界少 1,168 B：通用浏览器钩子仍须承载本地 Handoff/评论能力。 |
| Complete `.taco.html` | -12–20 KiB | -11,120 B（2,842,829 B，-0.39%） | 与 shell 同步；本地页面的同源托管代码已由构建剪除。 |
| skill Lite shell | -12–20 KiB | -10,410 B（187,830 B，-5.25%） | 比减量下界少 1,878 B：通用钩子仍在 Lite 中；原先托管增长已大幅回收。 |
| Lite `.taco.html` | -12–20 KiB | -10,410 B（293,365 B，-3.43%） | 与 Lite shell 同步；相对 2026-09-28 基线 286,281 B 仍 +7,084 B（+2.47%），超过 ≥1% 告知阈值，属本地评论/Checkpoint/Handoff 通用功能及构建开销。 |
| Host 专用 `.taco.html` / Host asset | 相对旧 Host asset ±8 KiB | +1,628 B（2,855,577 B，+0.06%） | 多了 Host shell 变体标记与隔离编译入口；无第二个联网脚本请求。 |
| `skills/taco/` 已跟踪文件 | -24–40 KiB | -65,893 B（14,070,233 B） | Complete/Lite shell 与四份模板镜像同时减量，比原估计多；`du -sk` 当前 18,356 KiB（包含目录分配和非跟踪文件）。 |
| Host `.ts/.tsx/.sql` 源码 | 原预算已在第 8 节列示，本轮拆分预估无新增 npm 依赖 | 相对上一轮 336,546 B 增加 65,646 B（402,192 B） | 原 `src/` 托管运行时搬入 `packages/host/src/browser/`；源码字节转移不是下载体积。 |

Host 使用编译生成并随部署绑定的 `packages/host/assets/taco-shell.html`；当资产缺失或 shell variant 不是 `host` 时返回 503，不把本地 Complete/Lite 静默作为后备。Vite 为 Host 编译同一编辑器 + 托管模块，为 Complete/Lite 静态剪除托管模块、样式和文案；产物 gate 解压运行时并检查边界。选择这一方案而非同源注入第二个 JavaScript 文件：不增加页面启动请求、注入时序或额外缓存版本合同；代价是 Host 保存自己的完整编辑器单文件资产，不能用 Lite 包替代。`taco-cli publish` 仍只上传文档投影，访客从 Host 独立页面评审。

拆分后浏览器实测：通过 HTTP 打开构建后的 Complete 与 Lite，本地页面的 `meta[name=taco-shell-variant]` 分别为 `complete`/`lite`，`window.taco.hosted` 不存在，未注入 Host capability 或 Host 样式，原有 Handoff/Save 按钮仍在；通过独立 SQLite 的生产 Host 发布 009 评审样例后，`/t/<tacoId>` 的 variant 为 `host`，呈现 Host 保存状态、监听者 `SplitSmoke`，并能编辑 `plan.md` 自动保存至 `stateVersion=2`。点击主按钮（非同名下拉按钮）生成 `review.handed_off` sequence 2，CLI subscriber 实际收到该事件，`taco-cli handoff` 按 id 返回包含该编辑的不可变 `changedFiles` 与 `incrementalFiles`。本地 shell 未在这些交互中触发 Host API。验收仅代表本机 SQLite/浏览器场景，不代表生产 PostgreSQL 或跨实例已实测。

## 10. Presence 与交接按钮修订（2026-09-30）

Header 扩展控件持久保存左右位置，主交接动作持久保存图标与文案；语言切换和重建仍呈现机器人箭头与「交接」。Presence 使用 ghost 按钮，非零监听数显示角标；删除菜单底部自报信息说明。姓名使用行内编辑，Enter/失焦提交，Escape 取消，行结构复用 Sidebar。属性标签跟随页面语言；Session 标题可选，由 CLI `--session` 上报，缺失时不显示。Harness Logo 随 Host 打包，无运行时外部下载。全局评论不显示标题，保留已有线程。

**prepare 估算**：相对本轮开始实测，Complete 产物 2,834,449 B、Lite 产物 294,615 B、Host 产物 2,848,557 B、skill Complete shell 2,728,914 B、skill Lite shell 189,080 B。Host 产物预计 +4–12 KiB；本地两种 shell/产物预计各 +0–1 KiB；skill 目录生成镜像预计合计 +0–6 KiB，文档约 +0–1 KiB；CLI 打包产物预计 +0.3–1 KiB。无新增 npm 依赖或联网行为，监听元数据沿用同源 SSE 和 listeners API。

**develop 实测**：`npm run build` 与 CLI `npm run build`；同口径比较本轮开始基线。

| 产物 | prepare 估算增量 | develop 实测大小 / 增量 | 偏差 |
| --- | ---: | ---: | --- |
| Complete 产物 / skill Complete shell | 各 0–1 KiB | 2,834,537 B / 2,729,002 B；各 +88 B | 在预算内；仅通用 header 配置持久化 |
| Lite 产物 / skill Lite shell | 各 0–1 KiB | 294,660 B / 189,125 B；各 +45 B | 在预算内；不含 Host Logo |
| Host `.taco.html` | 4–12 KiB | 2,865,905 B；+17,348 B（+0.61%） | 比上限多 5,060 B，完整上游 Logo 向量尤其 Hermes 比预估大；没有新增外部请求 |
| CLI `dist/main.js` | 0.3–1 KiB | 77,155 B；+1,378 B | 比上限多 354 B，包含 Session 编码校验、Harness 枚举与 help |
| skill 目录 | 镜像 0–6 KiB、文档 0–1 KiB | 全目录 14,032,092 B → 14,032,895 B；+803 B | 生成镜像和监听指南同步，无新依赖 |

验证：CLI 37 项、HostedSession/租约 22 项测试通过；已有全局评论保留和 Header 重建用例通过。实际 Host 页面检查 spacer 右侧 ghost 控件和在线计数角标；中英文切换后主按钮与菜单首项图标/文案一致；姓名 Enter 提交、Escape 取消、失焦提交；中文 Session 经 CLI→SSE→SQLite→listeners→悬浮卡片保持原文。`connectedAt` 为初始连接时间，心跳更新 `lastSeenAt` 不改变它。新增字段采用 PostgreSQL/SQLite 加列迁移；本轮仅 SQLite 实际运行，PostgreSQL 未做服务实测。未重跑已知无关 Mermaid/Tiptap/image 失败的整仓测试，不宣称全仓测试通过。

## 11. 交接反馈与固定面包屑（历史方案，Header 已由 §14 替代）

交接刷新 Host 内容时保留 Checkpoints 页面和布局。Header 固定三级：Taco 标题 → Category → 文件 Title（无 Title 时用相对路径与文件名）；Checkpoints 页面为 Taco 标题 → 国际化 Checkpoints → 配置名称。Taco 标题保持行内编辑，普通文件 Category 保持可切换；Checkpoint 所属分组继续由配置决定。

托管 Taco 标题和普通 Category 编辑通过现有 CAS autosave 保存：`taco-state/1` patch 增加可选 `title` 与 `navigation`，`navigation: null` 清除显式清单，省略字段保留当前值。支持仅元数据的 patch；保存期间的新编辑保留为 dirty 并在下一次保存提交。两种数据库适配器使用同一快照校验，发布基线保持不可变。

交接前刷新监听者列表；没有 Agent 时显示安装引导 modal，不生成交接事件。安装命令与官网使用共享常量。成功提示只显示「已交接给名称」或「已交接给 N 个监听者」，提交前保存监听目标避免成功后订阅退出丢失名称。

prepare 估算：Complete 产物基线 2,834,537 B、Lite 294,660 B、Host 2,865,905 B、skill Complete shell 2,729,002 B、skill Lite 189,125 B。通用面包屑和页面保持预计使本地 shell/产物各 +0.5–2 KiB，Host 产物 +1–4 KiB，skill 目录镜像合计 +3–12 KiB，新增文档 +0–1 KiB。无新增 npm 依赖或外部联网行为；监听查询沿用现有同源 API。

develop 实测（同一构建口径，字节）：Complete 2,834,789（+252 B，+0.009%，估算 +0.5–2 KiB）；Lite 294,966（+306 B，+0.104%，估算 +0.5–2 KiB）；Host 2,868,737（+2,832 B，+0.099%，估算 +1–4 KiB）；skill Complete shell 2,729,254（+252 B）；skill Lite 189,431（+306 B）；skill 全目录 14,035,187（+2,292 B，估算 +3–12 KiB）。本地与 skill 增量低于估算，原因是压缩抵消新增布局与 DOM 文本；Host 落在估算区间，包含安装引导与元数据保存。无新增依赖、无新增外部请求，均未触发 1%／32 KiB 告知阈值。镜像和模板由构建生成。

验证：Host/HostedSession 26 项回归通过；导航路径修正后定向回归 23 项通过（其余跳过）。构建通过。真实浏览器验证零监听者 modal、不生成交接事件、单人名称提示、两人计数提示、默认订阅交接后退出码 0、Checkpoints 页面保持、文件标题即时更新、Taco 标题／普通 Category 保存并刷新保留、英文 Checkpoints 标签、390px 双行 Header 与安装命令无横向裁切。SQLite 实测；PostgreSQL 同步实现但未连接服务实测。编辑必须在 Host 初始加载完成后进行，加载期间编辑沿用既有冲突保护。本轮未重跑已知无关整仓失败，不宣称全仓通过。

## 12. 重叠头像入口（2026-09-30）

监听菜单入口显示当前用户的彩色首字母 avatar 与 Agent 的 Harness avatar，圆形头像横向重叠；多个 Agent 同样叠放，最多显示三名 Agent，超出的数量用叠放的 `+N` 表示，完整名单保留在原菜单。没有 Agent 时仅显示人类头像。点击、键盘操作、语言切换与姓名修改沿用现有菜单逻辑。

prepare：Host 成品基线 2,868,737 B，估计 +0.3–1 KiB；Complete 2,834,789 B、Lite 294,966 B、skill Complete 2,729,254 B、skill Lite 189,431 B 预计 +0 B；skill 全目录 14,035,187 B 预计文档 +0–300 B。无新增依赖、网络行为或发布包内容种类。

develop 实测：Host 2,868,893 B（+156 B，+0.0054%，估算 +0.3–1 KiB）；Complete 2,834,789 B（+0 B）；Lite 294,963 B（−3 B）；skill Complete 2,729,254 B（+0 B）、Lite 189,428 B（−3 B）；skill 全目录 14,035,396 B（+209 B，估算 +0–300 B 文档）。Host 低于估算，压缩与移除原图标／角标代码抵消增量；Lite 的 −3 B 为生成压缩差异。无新增依赖／请求，无阈值触发。

验证：构建与三变体 gate 通过，HostedSession 10 项通过。真实浏览器＋实际 SSE：单名 Agent 时显示人类与 omp 圆形重叠头像，点击正常展开菜单；五名 Agent 时显示三枚 Harness avatar 与 `+2`，完整五名仍在菜单，Header 未挤压或裁切 Handoff。临时四名测试监听已停止，保留 omp Review Agent。Skill presence 说明同步；官网没有需要更新的独立文字，Host 专用资产由构建同步。

## 13. 监听详情运行时标签

监听详情英文标签改为 `runtime`，中文改为「运行时」；协议字段与 CLI `--harness` 保持现有名称。prepare：Host 基线 2,868,893 B，预计增量 0–32 B；Complete／Lite／skill shell 预计 0 B，skill 文档预计 0 B，无新增依赖或联网行为。

托管页恢复现有 Save／保存按钮及下拉菜单，继续保存本地 Taco 文件；Host 自动保存与交接保持既有语义。移除 Host 专用隐藏规则，预计 Host 成品相对 2,868,893 B 总增量 −256 至 +32 B，本地 Complete／Lite 及 skill shell 预计 0 B。无新增依赖、联网行为。最终 Header 与文档同步见 §14。

## 14. Header 简化（替代三级面包屑方案）

Taco Complete／Lite 与 Tacobin Host 共用 Header：文件页只显示文件名（包括扩展名，不用 frontmatter Title 或相对路径），Checkpoints 页只显示国际化 Checkpoints／检查点。彻底删除面包屑 DOM、分隔符、Taco title 输入、CP 模板名称输入、Header Category 切换及对应事件／样式。存储中的标题、模板名称、导航仍保留；文件正文标题编辑与创建文件时分类不受影响。保存按钮恢复，运行时标签用英文 `runtime`、中文「运行时」。

prepare：以前一轮重叠头像产物为基线，Complete 2,834,789 B、Lite 294,963 B、Host 2,868,893 B、skill Complete 2,729,254 B、skill Lite 189,428 B、skill 全目录 14,035,396 B；各 shell／成品预计 −0.5 至 −2 KiB，skill 目录镜像预计 −3 至 −12 KiB、文档 −0.5 至 +0.5 KiB。无新增依赖／外部联网行为。本节替代未交付的 chevron 方案和此前三级 Header 编辑交互。

窄屏 ≤560px 保持单行 Header：Handoff／Save 主按钮显示图标并保留可访问名称与下拉菜单，页面名溢出省略，移除折叠状态的重复品牌图标。所有控件保留；头像栈、主题和语言按钮可见。

develop 实测（字节，§14 基线）：Complete 2,832,705（−2,084 B，−0.0735%，估算 −0.5 至 −2 KiB）；Lite 292,937（−2,026 B，−0.687%，同估算）；Host 2,866,481（−2,412 B，−0.0841%，同估算）；skill Complete 2,727,170（−2,084 B）；skill Lite 187,402（−2,026 B）；skill 全目录 14,023,072（−12,324 B，估算镜像 −3 至 −12 KiB、文档 −0.5 至 +0.5 KiB）。Complete 比估算下界多减 36 B，Host 多减 364 B，来自删除编辑事件／Category popover 入口与压缩；目录落在镜像加文档估算内。无新增依赖或联网行为。本轮所有 shell 均减小，无增大阈值触发。累计相对仓库 2026-09-28 基线，Lite shell 仍 +6,370 B（3.52%）、Lite 成品 +6,656 B（2.33%）；原因是此前共享交接／评论／Checkpoint 能力，若继续缩减需单独精简通用本地交互。

验证：最终构建、Complete／Lite／Host gate 与生成镜像通过；定向 file-browser／HostedSession 30 项通过，类型断言修正后 Checkpoints 页面保持回归单独通过。真实浏览器验证三变体文件 Header 显示 `spec.md`（正文 Title 为 New Feature Specification），中英文 Checkpoints／检查点，删除控件零残留。Host 详情可见英文 `runtime`、中文「运行时」；保存下拉含 Save／Save a copy／Save & unpack。禁用浏览器 File System Access 后走真实下载路径，点击确认后保存并解析 Feature_Specification.taco.html，包含原 docId、三文件与 template。未操作系统保存选择器。窄屏 390px 设备配置（实测 CSS 视口 354px）Header 控件边界均在视口内，语言按钮 right=347px。刷新原 Taco 保留 docId、导航与零评论，浏览器 validate 为 ok:true、零 error／warning／info。官网演示由构建同步，本地官网与评审 URL 保持可用；实际 omp 订阅从 sequence 2 恢复。未宣称全仓测试通过。

## 15. 交接下拉箭头 hover 修正

箭头错误传入组件 `primary=true`，常态灰色被自定义 `.copy-review-more` 覆盖，但 hover 命中绿色 `.control-button-primary:hover`。移除错误参数，沿用组件默认按钮 hover，不新增 hover 特例。prepare：以 §14 最终字节为基线，Complete／Lite／Host 成品与 skill 双 shell 各预计 −32 至 +32 B，skill 全目录含镜像预计 −256 至 +256 B。无新增依赖或联网行为；技能无需新增操作说明，官网演示随构建更新。

develop：Complete 成品 2,832,705 B（0 B）、Lite 292,934 B（−3 B）、Host 2,866,481 B（0 B）、skill Complete 2,727,170 B（0 B）、skill Lite 187,399 B（−3 B）、skill 目录 14,023,069 B（−3 B），均在估算内，压缩使删除参数几乎无字节变化。无依赖／请求变化，无增大阈值触发。构建与三变体 gate 通过；真实浏览器 Complete／Lite／Host 箭头 hover=true，背景均保持 rgb(238,238,238)，与主交接按钮相同，primary 标记消失，下拉菜单可打开。Host 截图显示交接灰色、保存绿色；官网演示镜像已生成，实际监听从 sequence 2 恢复。

## 16. 交付文档一致性检查

prepare：同步中英文 README、默认产品规格、Checkpoint 规格、安装指南、skill 与官网的最终 Header／分类入口／保存／监听交接语义。shell runtime 预计 0 B；内嵌默认文档的 Complete／Lite／Host 成品预计各 −4 至 +8 KiB，skill 目录文档预计 +0 至 +2 KiB，CLI 内嵌指南预计 +0.5 至 +2 KiB，官网单页文案预计 +0.5 至 +2 KiB。无依赖／联网行为变化。历史 changelog 保持原记录，§11 标为被 §14 取代。

develop 实测（以 §15 最终产物为基线）：Complete 2,835,634 B、Lite 295,863 B、Host 2,869,410 B，各 +2,929 B，均在 −4 至 +8 KiB 估算内，增量来自内嵌默认规格文档；skill Complete 2,727,170 B、Lite 187,399 B，runtime shell 均 0 B，符合估算；skill 全目录 14,023,367 B（+298 B，估算 +0 至 +2 KiB）；CLI dist/main.js 78,302 B（+1,147 B，估算 +0.5 至 +2 KiB），内嵌指南源码同为 +1,147 B。官网 page.tsx 61,551 B（+290 B，估算 +0.5 至 +2 KiB），比估算下界少 222 B，因为替换既有说明而非追加；页面资源压缩体积未单独测量。没有新增依赖或联网行为。本轮单个 shell／成品均未达到 1% 或 32 KiB 增长阈值。

累计相对仓库 2026-09-28 基线，Lite skill shell +6,367 B（3.52%）、Lite 成品 +9,582 B（3.35%），超过 1% 告知阈值；前者来自此前共享交接／评论／Checkpoint 能力，后者还包含本轮内嵌规范文档增长。可选缩减方案是单独精简通用本地交互或默认内嵌文档，本轮保持功能与文档完整。

验证：根构建、Complete／Lite／Host gate、CLI 构建、文档格式检查通过；实际运行 CLI skills read 返回更新的 reviewing 指南。skill 结构校验 valid:true、errors:[]，保留既有 SKILL.md 33,313 字符超过建议 20,000 的 advisory warning。真实官网中英文正文完整显示，既有指令栏横向滚动可读取完整内容，复制按钮返回 Copied；未改变指令栏布局。README 镜像字节一致，默认产品／Checkpoint 规格同步最终 Header；历史记录保留，旧 Header 设计明确由 §14 取代。无额外测试或全仓通过声明。

## 17. PR #85 审查问题修复

prepare：以 §16 最终构建为基线：Complete 2,835,634 B、Lite 295,863 B、Host 2,869,410 B、skill Complete 2,727,170 B、skill Lite 187,399 B、skill 全目录 14,023,367 B、CLI dist/main.js 78,302 B。预计 Complete／Lite 成品与 skill 双 shell 各 +0.5 至 +2 KiB；Host 成品 +2 至 +8 KiB；skill 全目录 +2 至 +10 KiB（生成镜像、Mermaid lint 与指南）；CLI +0.2 至 +1 KiB。修复数据库事务、事件解析、快照重建、配额与锚点，订阅元数据／游标／取消，浏览器请求幂等恢复、导航、代码块身份和本地保存基线；冲突提供明确放弃草稿入口，失败提供重试。无新增依赖或联网目的地；沿用现有 Host API，丢响应时以原 payload 和 key 确认请求。

develop 实测（相对本节 prepare 基线，字节）：

| 产物 | 估算增量 | 实测大小 | 实测增量 | 偏差原因 |
| --- | --- | --- | --- | --- |
| Complete 成品 | +512 至 +2,048 | 2,835,738 | +104（0.0037%） | 复用导航 helper，删除旧循环抵消修复增量 |
| Lite 成品 | +512 至 +2,048 | 295,980 | +117（0.0395%） | 同上，压缩结果略有差异 |
| Host 成品 | +2,048 至 +8,192 | 2,870,630 | +1,220（0.0425%） | 幂等恢复与恢复入口经压缩后低于估算 |
| skill Complete shell | +512 至 +2,048 | 2,727,274 | +104（0.0038%） | 与 Complete runtime 同步 |
| skill Lite shell | +512 至 +2,048 | 187,516 | +117（0.0624%） | 与 Lite runtime 同步 |
| skill 全目录 | +2,048 至 +10,240 | 14,025,349 | +1,982（0.0141%） | 镜像与指南增量，比估算下界少 66 B |
| CLI dist/main.js | +205 至 +1,024 | 80,068 | +1,766（2.2554%） | 内嵌恢复指南、Unicode 元数据与订阅关闭逻辑比估算多 |

本轮单个 shell／成品均未达到 1% 或 32 KiB 增长阈值；无新增依赖或联网目的地，复用现有 Host 请求确认未知提交结果。累计相对仓库 2026-09-28 基线，Lite skill shell +6,484 B（3.58%）、Lite 成品 +9,699 B（3.39%），超过 1% 告知阈值；来自此前共享交接／评论／Checkpoint 与内嵌规范，本轮分别增加 117 B。可选缩减方案仍为单独精简通用本地交互或默认内嵌文档。

验证：最终根构建、Complete／Lite／Host gate、生成镜像与 CLI 构建通过，格式检查通过。全仓 54 个测试文件中 53 通过，584 项中 583 通过；唯一失败为未修改的 update-check 测试，CLI shim 预期 installed=0.1.4，实际 null，未宣称全仓全绿。相关数据库、PostgreSQL 驱动 fixture、订阅、浏览器状态、导航与 Mermaid 回归通过；取消回放在 replay 等待期间关闭，断言无 timer／subscriber 残留。PostgreSQL 未连接真实服务，事务与 JSONB 行为由驱动 fixture 验证。

真实浏览器／HTTP／SQLite 烟测：冲突取消保留本地草稿，确认放弃后加载远端版本且本地 Save／manual Handoff 差异基线仍保留；改名与删除同步 full-path navigation。交接提交后连续丢失两次响应，重试先确认旧 payload／key，再提交新版本；评论同样丢响应后点击 Retry，数据库仍仅一个 thread、message、create action。实际 CLI 使用中文名称与模型 ID，Host 详情正确显示，首个交接后退出 0。官网同步中英文恢复说明，本地预览 http://localhost:32171；最终 Taco 保留原 docId、导航与评审状态，以新构建 runtime 提供独立可打开产物。

收尾更正（2026-10-02）：CI 的测试／构建已通过，但 committed-artifacts gate 发现本机 pnpm 依赖树生成的镜像与 npm lockfile 不一致。执行 npm ci 后重建，最终以 package-lock.json 为准：Complete 2,844,334 B（相对 prepare +8,700 B，0.3068%）、Lite 295,038 B（−825 B，−0.2788%）、Host 2,878,646 B（+9,236 B，0.3219%）；skill Complete 2,735,870 B（+8,700 B，0.3190%）、Lite 186,574 B（−825 B，−0.4402%）、目录 14,067,387 B（+44,020 B，0.3139%）。之前表格保留为 pnpm 环境历史测量；以上数字为交付口径，估算偏差额外来自依赖树变化，无依赖 manifest／lockfile 变更。本轮任一 shell 仍未达 1% 或 32 KiB；累计相对 2026-09-28 基线，Lite skill +5,542 B（3.06%）、Lite 成品 +8,757 B（3.06%），继续超过累计告知阈值。缩减选项与上文相同。

收尾验证：npm ci 后全仓 54/54 个文件、584/584 项测试全部通过；此前 update-check 的本地失败不再出现。完整构建和三变体 gate 通过，最终以远端最新提交的 CI 与 committed-artifacts 检查确认可合并状态。
