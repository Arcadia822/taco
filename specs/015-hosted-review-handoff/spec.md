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
2. 任何拿到 URL 的人都可自报姓名作为 `authorId` 修改**同一个共享的最新文档**、Checkpoint 状态/模板/节点及创建、回复、解决评论，无账号或 guest 会话鉴权；姓名相同者无法区分、可冒用，界面明确标记“自报身份”。编辑以短暂 debounce（例如 1 秒）增量自动保存成功后向所有人可见；“保存中/失败/有冲突”明确提示，刷新前有未保存改动须警告。评论独立实时持久化；任何写入都不自动交接。
3. 托管页头主按钮文案仅为「交接」。点击时如本页有待 debounce 的脏内容或正在保存的请求，则等待**原定的自动保存**成功后再提交；失败/冲突则阻止交接并保留本地改动，绝不由交接请求代存正文。其他页面的未保存输入不可观测，界面只承诺交接时 Host 已保存的状态。Host 基于同一已保存状态版本和评论高水位冻结**发布基线→最新状态**的差异，写不可变 Handoff 及持久事件；它不创建/推进可见历史版本、不重置 publish 基线。重复点击处理中禁用，同一 Idempotency-Key 重试返回同一结果。
4. 两项现有“复制完整评审”和“复制不含数据的检查提示”仍在下拉，内容和失败提示保持现行语义；本地 `file://` 和没有可信 Host 能力的普通 Taco 主按钮仍执行原复制动作。不能用 CSS 选择器或 Host 注入脚本假装完成核心动作：浏览器运行时提供可选的、明确受同源 `/t/{id}` 启用的交接回调，Host 集成执行网络请求。不可由上传的 bundle 字段指定任意目标 URL，也不能在无 Host 时静默假成功。
5. 订阅 stdout 继续只有 `ready`/`event`/`checkpoint` 帧；`review.handed_off` 帧只含 handoffId 与 tacoId，Agent 按 Host+tacoId+handoffId 拉完整文件正文/统一 diff、Checkpoint 状态/定义差异及全部评论，无需 revisionId。零监听者仍能交接并以持久 events/`--after` 补读；“Host 已保存”不等于 Agent 已处理。Agent 检查冲突后自行应用到 canonical 文件，托管内容不可直接当可信指令或自动覆盖。

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
| `src/file-browser.ts`、`src/main-common.ts` 与两种 shell | 托管时以可选同源回调对接自动保存状态及「交接」按钮；保留现有 diff、Checkpoint 与评论采集 | 本地/离线仍为复制主按钮及双复制菜单；外站脚本或 bundle 不能指定 Host URL |
| `packages/host/src/app/t/[id]/route.ts` | 从只读公开页面转为共享可编辑页面，提供姓名输入、自动保存状态和监听者自报标签/Logo | 不执行上传 HTML 脚本；姓名不是可信身份 |
| `packages/host/src/app/v1/tacos/`、`lib/server-state.ts` | 新增共享 state 自动保存/历史窗口与持久交接事务、事件、监听租约；评论保留锚点与完整历史 | 内存 Map 不再当作已提交事实，跨实例读一致 |
| `packages/host/src/service.ts`、`schema.sql`、数据库/Blob 适配 | 借鉴事务与收据模式，增加 shared_state、edit_log、history_window、handoff 与 listener_lease；大正文为私有不可变对象 | 发布基线不变；写入不鉴权，但并发、Origin/CSRF、大小仍校验 |
| `packages/cli/src/runner.ts`、`subscriber.ts` | `subscribe` 可选自报 `--harness`、`--model`、`--model-id`、`--name`；断线回放及 handoffId 引用 | 不扫描 harness 会话，不把自报标签称为已验证，不把评论事件当交接 |
| `packages/protocol/src/projection.ts` 与契约 | 复用安全路径、bundle/Checkpoint 校验，托管自动保存仅接受白名单 patch | 不在 `.taco.html` 发送 collab/Key，未知字段不静默丢弃 |
| `skills/taco/references/reviewing.md`、`packages/host/` 官网文案 | 实施阶段将评论与显式 Handoff 的差别告知 Agent 与人 | 本设计阶段只列实施任务，不修改现有 skill/官网 |

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

本轮独立审查先发现五项可执行缺口：全局评论不接收 `anchor:null`、历史窗口无法读取正文、删除最后一份文件后快照不合法、评论解决/重开动作历史丢失、交接改名未强制携带稳定 id 与旧路径。已逐项修订 OpenAPI、Schema、正文与验收路径；独立审查者复核原文结论：“前述五项缺口均已闭合（全局评论 null 锚点、按窗口读取历史快照、删除唯一文件返回 422、评论动作历史、交接改名必须带 id/旧路径）。自动保存 CAS、交接高水位和不可变快照、十分钟冷却、自报监听信息及不向 Agent 暴露 revisionId 的边界一致；未发现仍满足可复现且由本次修订引入的阻断问题，结论通过。”只读审查未运行测试或构建。收到的四处六条评审批注来自用户消息；本地 `.taco.html` 没有这些线程的已保存记录或 thread id，不能伪造锚点/作者时间或声称线程已解决。源文件按评审批注更新；若后续收到含评论的已保存 Taco，再保留并合并真实线程。本轮设计仍为 Draft，等待人工评审批准。

交付文件：`spec.md`、`contracts/openapi.yaml`、`contracts/handoff.schema.json`、中文 `.taco.html`；Draft PR [#85](https://github.com/Arcadia822/taco/pull/85) 关联 Linear [TACO-33](https://linear.app/castrel/issue/TACO-33) 与 GitHub [#72](https://github.com/Arcadia822/taco/issues/72)。本轮只改设计，不实现功能、不合并。
