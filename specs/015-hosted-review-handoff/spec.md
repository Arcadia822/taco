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
| 本轮中文设计与契约源文件 | 初估 +10–25 KiB；定稿后实测 49,684 B（spec 26,164 B、OpenAPI 13,266 B、schema 10,254 B） | 初估漏计两份独立接口契约，超出原上界 24,084 B；本轮新建三份而非一份文件，无新依赖或联网行为。 |
| 本轮中文评审 `.taco.html` | 预计相对当前 Complete shell +50–70 KiB；实测 2,787,903 B，相对当前 shell 2,735,358 B 增 52,545 B | 本轮设计正文与两份契约均打包；相对 2026-09-28 Complete 构建产物基线 2,835,255 B 反而少 47,352 B。此设计不修改 Complete/Lite shell 或 skill；实施后的 shell/产物预算与实测另记。 |

当前托管路由靠进程内 `Map` 记录评论和订阅，不能保证跨 Vercel 实例和重启后的交接可重放。设计建议复用已有 `packages/host/src/schema.sql` 的数据库方向，但现有 Next 路由未接入它；因此实施预计新增真正的持久数据库驱动/连接配置与 Host↔数据库联网。CLI 与本地 Taco 无新增常驻 daemon；离线打开仍不联网。身份机制的额外依赖与迁移取舍将在「待决策点」说明。develop 阶段必须构建并将对应产物**估算值 / 实测值 / 偏差原因**并列记录；本轮不得填写虚构实测。

## 3. 现状、约束与方案

### 3.1 当前运行代码与目标契约必须区分

当前 `packages/host/src/app/v1/tacos/route.ts` 将 publish 请求写入公开、允许覆盖的 Vercel Blob，仅返回 `tacoId` 和 URL，**不返回 revisionId**；`packages/host/src/app/t/[id]/route.ts` 加载快照后强制 `access: 'reader'`。其注入的划词评论按钮调用 `/reviews`，只发 body/author（quote 被路由丢弃）；`reviews/route.ts` 将评论记在 `server-state.ts` 的内存 Map 中并广播 `comment.created`，没有持久评论线程或在线文件编辑。`subscribe/route.ts` 是内存 SSE；`packages/cli/src/runner.ts` 使用 SSE adapter，虽然 `subscriber.ts` 的抽象命名为 WebSocket。重新部署或跨实例时既不能可靠列出监听者，也不能补读事件。`packages/host/src/service.ts`、`schema.sql` 和 `specs/008-taco-host-contract/` 给出了事务日志及 guest-session 的可复用方向，但当前 Next 路由**没有接入**，且 service 内部的 driver 是内存实现。设计必须把这些前提的接线列为实施任务，而非当成已具备的服务。

本地 `src/file-browser.ts` 的 Handoff 主按钮目前复制完整评审，下拉分别复制完整评审和“不含数据”的检查提示；`getModifiedReviewFiles()` 从当前未保存内容生成 diff，`getCheckpointChanges()` 给出 path/from/to，`src/main-common.ts` 的 `window.taco.getReviewHandoff()` 也提供模板/成员变化及所有评论。浏览器已有事实可以复用，**缺的是托管写入、持久交接和订阅者展示**。`freeze` 是 Checkpoint 标签，不是批准。

### 3.2 交互与责任边界

1. CLI publish 继续返回分享 URL 和 tacoId；新托管评审须有明确的 revisionId（新发布生成，当前旧粘贴不假设已有）。Agent 启动 `taco-cli subscribe <tacoId>`，得到 ready；网页页头显示该 Taco 的活跃监听者列表。列表报告连接在线，不保证 Agent 进程已读或已处理消息。
2. 人进入 `/t/{id}` 后可以编辑**该评审者的草稿副本**，修改文件和 Checkpoint 状态、模板名及节点成员，创建/回复/解决评论；发布快照不可变。不同评审者的草稿以服务端 guest 身份和 revision 隔离。在线评论实时保存并可供其他人查看，但不产生 Handoff；未提交的文件/CP 修改仍留在浏览器内存，刷新前警告可能丢失。若服务端保存失败，评论不得显示“已提交”。
3. 页头托管主按钮标作「完成评审并交接」（英文 UI 对应译文）；点击后从**当前内存**构造完整快照（包括未保存修改），先在 Host 验证 revision/草稿版本并持久提交，再追加 `review.handed_off`。小正文也统一走上传预留与私有 Blob 提交，避免 Vercel Function 4.5 MB 入站限制；现有发布上限 32 MiB，交接包因完整文件集合和包装会更大，因此单次交接上传独立上限 64 MiB，不能沿用 008 的 32 MiB `maxBytes`。该预留目前只在 008 的目标契约中，实施需接入真实 Next 路由。超限报错并保留未保存修改，不截断；允许用**同一个**幂等键重试；重复点击提交中禁用按钮。提交后仅重置该评审者的交接 diff 基线，不把内容写回 Agent 的 canonical 目录。
4. 两项现有“复制完整评审”和“复制不含数据的检查提示”仍在下拉，内容和失败提示保持现行语义；本地 `file://` 和没有可信 Host 能力的普通 Taco 主按钮仍执行原复制动作。不能用 CSS 选择器或 Host 注入脚本假装完成核心动作：浏览器运行时提供可选的、明确受同源 `/t/{id}` 启用的交接回调，Host 集成执行网络请求。不可由上传的 bundle 字段指定任意目标 URL，也不能在无 Host 时静默假成功。
5. Host 提交事务同时保存不可变 handoff 记录和事件指针。订阅 stdout 只输 `ready`/`event`/`checkpoint` 帧；`review.handed_off` 帧中提供 handoffId，Agent 按 Host+tacoId+revisionId+id 获取文件正文与 diff、CP 变化及所有评论/审阅历史。**事件已写入**不是“Agent 已接收/已处理”；零监听者仍可交接并通过持久 events/`--after` 补读，UI 此时显示「已保存，等待 Agent 读取」。Agent 审核冲突后自行将修改应用到 canonical 文件，不能把托管内容直接当可信指令或自动覆盖。

### 3.3 快照一致性、评论与完成时机

- 每个 Handoff 带当前 revisionId、reviewerId、baseReviewVersion、reviewVersion 和本次交接的不可变 payload。服务端同时计算**相对发布 revision 的累计差异**（供完整应用）与**相对该评审者上一次成功交接状态的增量差异**（决定是否需要新事件）；两份文件 diff/Checkpoint 状态 diff 都独立保留。恢复发布原状时累计差异为空，增量差异仍须列出从上次状态恢复的文件正文与 `{path,from,to}`，Agent 据此回退自己的未落盘评审输入。完整 payload 含全部当前文件内容、CP 的完整 `documents`、template/节点成员当前定义以及所有评论线程的完整消息历史（状态、锚点、作者、删除墓碑、时间）。`todo` 回退也要记录；二进制/新增文件不能只传通知，必须可取字节。其他评审者在交接前已持久化的评论在同一事务高水位冻结并标作者；旧记录不拼接新评论。

完整上传包的 `files[]` 是当前**全部文件集合**而非只含有改动的列表，`deletedPaths[]` 显式列出真正删除的原路径；服务端以发布快照比较新增、修改、删除，若同一稳定 file id 变了路径则报告重命名（无 id 时按显式删除+新增）。每个原文件必须仍在 `files[]`、被 `deletedPaths[]` 声明删除，或凭相同 id 被重命名；不能把意外省略误认为删除。交接 `changedFiles[]` 中，删除的 `content=null`，其它文件必须携带完整正文或二进制数据，不能仅留“文件已变更”的提示；被删文件的旧评论留作历史并标记锚点失效。文件路径相对 `root`，Checkpoint/评论路径保留 bundle 完整路径，Agent 只拼接一次 `root`；重复/越界路径和重复 id 必须拒绝。
- 点击时即使没有文本改动，也可表达“我的评审已完成”：首次交接追加**一次显式**事件；同一请求网络重试复用 Idempotency-Key、返回同一 handoffId。再次点击是否有新增变化，必须比较上次交接的**完整文件集合、Checkpoint 全量定义及状态、评论高水位**，不能只比较发布快照或当前累计 diff；若三者均不变则显示“已交接，无新内容”且不产生新事件。新增评论/修改/恢复原状态都形成新交接；另一人或另一版本不能替本评审者完成。
- 基于 revision 和 per-reviewer 草稿版本做乐观并发校验：同一评审者两标签分别修改时，先提交的胜出，另一标签收到 409、展示冲突并保留本地草稿供人工比较；不自动改 base 或覆盖。新版发布不改写正在看的旧版，旧版交接保持原 revisionId。评论提交与 Handoff 快照取同一事务高水位；持久记录、递增 sequence、幂等收据同一事务，不能先广播后失败。网页提交成功只意味着 Host 持久化成功；没有从 Agent 回执时不能写“Agent 已收到”。
- 不使用 `review.completed` 或 `revision.approved` 代替 `review.handed_off`：现有未接线 service 的这两个概念既无评审 payload，也不能表示 Agent 看到了完整修改。评论事件可继续存在，**Agent 工作流只以 `review.handed_off` 作为继续处理的门槛**，不能由新增评论自动继续。

`specs/008-taco-host-contract/contracts/protocol.schema.json` 的现有 `Event.type` 是封闭枚举；当前 HTTP events 与 ServerFrame 都引用该 Event，不能只添加本目录 `HandoffEvent` 就声称可校验。实施任务必须在共享 Event 枚举中加入 `review.handed_off`，以本目录 schema 的 data.handoffId 为新分支，更新 HTTP 历史与 SSE 同一事件定义并验证旧 CLI 透传，不能生成一种只有新接口承认的孤立事件。该迁移属于实施，不把当前 008 已批准契约改写成“现已上线”。

## 4. 受影响组件与存储

| 组件 | 设计动作 | 必须保留的边界 |
| --- | --- | --- |
| `src/file-browser.ts`、`src/main-common.ts` 与两种 shell | 复用现有 diff/Checkpoint/评论采集；加入可选同源托管交接回调与页头监听状态展示接口 | 无 Host 时原主按钮与双复制菜单；不让 bundle 或外站 JS 指定 Host 凭据 |
| `packages/host/src/app/t/[id]/route.ts` | 从只读展示变成受控的托管评审页、接入可选回调与读者/草稿身份、展示 presence | 不执行上传 HTML 脚本；不把公开 snapshot 改成私有 canonical 文件 |
| `packages/host/src/app/v1/tacos/`、`lib/server-state.ts` | 接入持久评审/交接事务、事件历史、presence 租约；评论接口保存锚点及线程历史 | 内存 Map 不再作为已提交事实来源，跨实例读一致 |
| `packages/host/src/service.ts`、`schema.sql`、数据库/Blob 适配 | 借鉴现有事务/事件/收据模型，增加 review_draft、handoff、listener_lease 的持久或 TTL 状态，完整正文存私有不可变对象 | 不能拿内存 driver 冒充生产数据库；大内容不走 Function 请求体 |
| `packages/cli/src/runner.ts`、`subscriber.ts` | 订阅登记/续租与断线恢复；输出 Handoff 帧的稳定引用；在指南里说明用 id 拉全量内容 | CLI 不拉起 daemon，不持久隐藏游标，stdout 不掺评论即交接的提示 |
| `packages/protocol/src/projection.ts` 与契约 | 复用安全路径、bundle 与 Checkpoint 校验，给托管上传定义白名单 | 不从 `.taco.html` 发布 collab/Key，未知字段不得静默丢弃 |
| `skills/taco/references/reviewing.md`、`packages/host/` 官网文案 | 实施阶段将评论与显式 Handoff 的差别告知 Agent 与人 | 本设计阶段只列实施任务，不修改现有 skill/官网 |

存储边界：Taco 与不可变发布 revision 共用已有实体；per-reviewer 草稿记录 `{tacoId,revisionId,reviewerId,version,updatedAt}`，完整大正文落受保护 Blob，数据库保存不可变 payload 引用和摘要；handoff 记录 `{id,tacoId,revisionId,reviewerId,reviewVersion,eventSequence,payloadRef,payloadHash,createdAt}`；事件表用同一 Taco 行锁分配十进制字符串 sequence。在线监听者是短租约 `{tacoId,clientId,displayAlias,verified,lastSeenAt,expiresAt}`，不存机器路径、会话 ID 或浏览历史。评论线程/消息引用 revision 和稳定锚点，删除消息仅墓碑；快照使用事务高水位生成，旧记录不随新评论/新修订变化。CLI 初次 ready 与回放 cursor 的现有语义保留，切换服务器实例依赖持久日志而非进程内广播；轮换/网络断线以已完整输出的 sequence 重连，保留重复事件由 Agent 按 id 去重的约束。

## 5. 接口契约与兼容边界

本功能 HTTP 的路径、参数和错误由 [OpenAPI 增量契约](contracts/openapi.yaml) 唯一维护，上传与事件消息体由 [交接 JSON Schema](contracts/handoff.schema.json) 维护；本文只写生命周期与事务语义，避免第二份互相漂移的字段表。008 的 OpenAPI、CLI 与事件契约是历史目标设计；实现时先确认哪些路由真实接线，**不能**直接改写旧文档当成服务已具备功能。

- 新 publish 响应明确 revisionId；**若采用 D1 推荐方案**，CLI 在 publish 前本地生成 256-bit 随机 listener capability，以 `X-Taco-Listener-Token` 请求标头随已认证发布提交发送；Host 只存 token 摘要并绑定 origin+tacoId，CLI 成功后按该绑定存于系统凭据库或 0600 本地文件。响应丢失时同一幂等键携带同一 token 重试；不同 token 被拒绝而非颁发无法恢复的新秘密。publish stdout JSON、stderr、错误/日志均不得含此标头/凭据；跨机订阅仅通过用户自行安全传递的 `TACO_HOST_LISTENER_TOKEN` 使用，并校验 Host+tacoId。无凭据公开 subscribe 可读事件但不列为已验证 Agent，无效凭据立即 401、不降级匿名。旧公开 paste 无 revisionId 时“旧版只读，仅可复制 Handoff”，新功能须新 Taco 重新 publish；历史分享 URL/导出仍可读，旧 CLI 未知事件可透传。
- 当前 `POST /v1/tacos/{id}/reviews` 只有 body/author；切到带同源 guest-session、Origin 与 CSRF 校验且锚点/线程 ID 可持久回读的评论协议之前，**不能开启托管主按钮**，否则会说“所有评论”却只送到内存。guest 名称只作显示，不作为可信身份。跨来源请求、无效 token、已关闭空间、非法路径/媒介、过期 revision、超限 payload 都必须拒绝并保证没有半份“成功交接”事件；限制公开正文与评论的读写量，不在错误/日志泄露 Key/正文。
- 支持对外公开读取已发布内容与交接 payload（本产品默认公开），但只有当前评审者的有效同源会话可以提交其草稿/交接；CLI 的列表身份采用待决策的验证策略。监听连接在线与评论是否已读无关；成功交接后可供离线 CLI 用 events 历史补读。若 cursor 过期必须明确报缺口，不能从“现在”假装已完整阅读。

## 6. 验证方案与实施任务

### 6.1 必须可复现的验收路径

1. 新发布得 `tacoId` 和 revisionId，CLI 通过私存监听 capability 发起订阅得到 ready，stdout 不含 capability；网页显示一位**已验证**监听者，停止/失效后显示离线，两个监听者显示两条，同一 client 重连不复制。无凭据公开订阅可收事件但不冒充已验证 Agent；假 token 返回 401。
2. 同一 guest 会话以 `X-Taco-CSRF` 完成锚定评论及 Handoff；网页修改未保存 Markdown、CP 从 `todo→complete`、更改模板名并留下评论及回复；订阅看到评论事件，但**Handoff 前没有 `review.handed_off`**。点击主按钮后恰有一个该事件，按 handoffId 取回正文、累计及增量 diff、CP 状态及两种差异、定义与评论全历史；第二次把 Markdown 与 CP 恢复发布原状时累计差异为空而增量列出恢复操作，不把 `freeze` 认作批准。
3. 连点、响应丢失后用同键重试、跨实例提交/订阅、进程重启、CLI `--after` 回放：同一逻辑提交只有一个 id/sequence、完整正文可取；没有监听者时仍可提交，列表/成功提示不得声称 Agent 已处理。另一次无新增改动点击不重复生成事件，有新增改动才形成下一次。
4. 双标签同 reviewer 的版本竞争只有一个成功，失败端保留草稿且明确 409。新增、删除、重命名文件含有效完整内容/删除标志；故意漏报原路径被拒绝。旧版与新版并存时交接归属旧 revision，跨 Taco id 拉取 404；无 guest/CSRF、非法路径、超限上传、存储失败等失败路径不输出成功消息或事件。接近 32 MiB 的合法发布快照加文件修改仍在 64 MiB 交接上传上限内；超过 64 MiB 明确报 413，评论历史通过流式读取不截断。
5. 在 Host 页面两项菜单仍分别复制完整评审与不含数据的检查提示，复制失败有错误提示；离线/本地 Taco 主按钮继续复制且没有任何 Host 请求。修改 CP 状态仅写 bundle 的状态表，不改正文 frontmatter。

### 6.2 依赖顺序

1. 落实共享协议：在 008 的 Event 闭合枚举增加 `review.handed_off` 分支，使事件日志/SSE/CLI 历史一致；为 handoff 新增单独的 64 MiB 上传限制和 owner listener capability（D1 推荐），接入 008 的上传预留/私有对象路径、guest 身份及具事务能力的生产数据库驱动。
2. 接入持久评论与 per-reviewer 草稿/原子 Handoff 快照；让 Host 页面可编辑、提交前保留未保存修改，冲突不覆盖。先证明跨实例读回，再发事件。
3. 接入 CLI presence 短租约/列表与断线回放，不将“评论已发”当“评审完成”；升级同源 Host 集成与页头主按钮，保留双复制及离线回退。
4. 更新 `skills/taco/` 的托管评审说明和 `packages/host/` 官网使用说明，核对新旧 CLI 帮助；代码审查阶段同步检查 skill/官网关联，并在修改官网时启动本地预览服务给出真实 URL。
5. 实施阶段运行交互与断线/并发/权限测试，重新构建 Complete/Lite 与 CLI/Host 产物，将上述**预测/实测/偏差原因**记入设计源与 PR；Lite 达到仓库阈值时主动告知用户体积、原因和可选将 Host 特定 UI 完全外置的替代方案。

## 7. 待决策点

### D1. 监听者能否被称为 Agent

- **问题与背景**：当前 `subscribe` 是匿名公开 SSE；光有 TCP/SSE 连接无法证明连接者确为发布者的 Agent，却又要让人看见“谁在监听”。
- **选项 A（推荐）**：publish 时 CLI 生成并私存 owner 监听凭据，Host 只存摘要；带凭据订阅才能列为“已验证 Agent”，无凭据的公开订阅不出现在已验证列表。优点是列表可信且不泄露 session；代价是新增凭据保管、迁移及跨机使用步骤。
- **选项 B**：匿名订阅也列出，但只称“未验证的 CLI 监听者”。优点是不引入凭据；代价是任何人可伪造或大量创建连接，不能对人承诺是原 Agent。
- **推荐理由、影响与默认**：诚信显示优先于便利，按 A 完成可评审方案；影响 publish/CLI/Host 认证和既有无凭据发布的兼容。未决时仅按 A 设计，旧发布依旧只读/复制，不伪称已验证；用户选择前不称获批。

### D2. 是否必须自动唤醒 idle agent session

- **问题与背景**：Linear TACO-33 原提案明确要求向本地 harness session 注入 user message，本次用户指定的是 publish 后的前台 `taco-cli subscribe`，两者不等价。没有运行中的消费者，事件可持久保存但不能自动唤醒已退出的 Agent。
- **选项 A（推荐）**：订阅 stdout 提供显式交接事件，由正在运行的 Agent/宿主接收；退出后用 `events`/`--after` 补读。优点是符合现有无 daemon 的 CLI 边界，不扫描本地隐私文件；代价是 idle session 不会自行恢复。
- **选项 B**：保留原提案的本地标识词扫描与跨 harness 注入，联动托管 Handoff。优点是可自动推进 idle session；代价是隐私、误投递和各 harness 适配/授权的显著成本，不能把云端页面直接授权为本地 user message。
- **推荐理由、影响与默认**：先把用户本次确认的“人控制、订阅收取”做成完整闭环，按 A 形成设计；B 必须另行明确可信边界。未决时不创建本地 scanner、sidecar 或 bundle 内 session 字段，不声称能唤醒已退出进程。

## 8. 审查结论

独立审查者（非原作者）的最终结论原文：

> 最终复核：设计阶段通过，未发现剩余可执行阻塞。CSRF 已统一为 `X-Taco-CSRF`（contracts/openapi.yaml:259-264），同 guest 会话的评论→交接被列入验收（spec.md:95）；体积表已记录三份源文件阶段性实测 47,547 B、原估算漏计两份契约的偏差原因及定稿复测要求（spec.md:37）。此前的回退增量、监听身份与凭据隔离、上传容量和响应、锚点失效均已进入设计与契约；共享 Event 枚举的迁移明确列为实施前置条件（spec.md:66,102），不能误称当前已上线。A1–A7、零/重复监听、CP 回退、双复制、离线/并发/权限与近上限上传均有明确验收路径（spec.md:14-24,93-99）。D1/D2 仍是明示待决策项，并已说明推荐默认和能力边界；本次只读复核，未运行测试。

首轮审查发现六类可执行缺口：回退时累计 diff 为空、008 Event 封闭枚举、监听凭据可能泄露、32 MiB 交接上限和预留响应不一致、锚点失效字段缺失、设计源预算漏算。修正后复核还指出 guest CSRF 标头不一致，已统一并补同会话验收；上述问题均在本轮设计与契约中修正或明确列为实施前置条件，没有改写既有已批准设计来冒充现状。D1/D2 仍由人类评审裁决，方案状态保持 Draft。

交付文件：`spec.md`（本文件）、`contracts/openapi.yaml`、`contracts/handoff.schema.json`、可直接打开的中文 `.taco.html`；Draft PR [#85](https://github.com/Arcadia822/taco/pull/85) 关联 Linear [TACO-33](https://linear.app/castrel/issue/TACO-33) 与 GitHub [#72](https://github.com/Arcadia822/taco/issues/72)。本轮仅设计，不实现功能或合并。
