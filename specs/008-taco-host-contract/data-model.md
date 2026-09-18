---
title: 'Taco Host 数据模型与提交边界'
taco_scope: plan
status: 'Approved'
---

## 定位与权威来源

部署采用 Vercel，这是用户已确认的方向。具体组合建议为 **Vercel Functions（Node.js）+ Vercel Marketplace 的 Neon Postgres + 私有 Vercel Blob**；数据库供应商、物理表和参数仍待评审，本文不代表服务已部署。

业务仍只有 User、ApiKey、Taco、Revision、评审数据五类。[产品契约](spec.md) 定义目标；[OpenAPI](contracts/openapi.yaml) 定义 HTTP；[JSON Schema](contracts/protocol.schema.json) 定义发布内容与实时帧；[CLI 契约](contracts/cli.md) 定义命令行为。本文只定义存储关系、事务与恢复，不复制 DTO。

## 平台约束与选择

- [Vercel Functions 限制](https://vercel.com/docs/functions/limitations)：入站与普通响应有 4.5 MB 上限。32 MiB 发布内容不能直接 POST 到 Function；统一直传 Blob，再用小请求提交。
- [Blob Signed URLs](https://vercel.com/docs/vercel-blob/vercel-signed-urls)：CLI 可用限定路径/PUT/类型/大小/有效期的预签名 URL。服务端签发，不把 store 级凭据交给 CLI。
- [流式响应](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)：流式输出不受普通 4.5 MB 响应限制，但仍受 Function 最大时长约束；版本读取和导出使用流式 application/json。
- [原生 WebSocket](https://vercel.com/docs/functions/websockets)：单连接固定到一个 Function，重连不保证同实例；达到 maxDuration 会断开。首版使用 Node HTTP/WebSocket 服务，不依赖 Next.js 实验升级接口。建议 maxDuration=300 秒、240 秒主动轮换。
- [Marketplace 数据库](https://vercel.com/docs/storage)：Neon Postgres 是集成供应商，不是 Vercel 自营关系数据库。数据库与 Functions 部署在相近区域，Preview 与 Production 使用隔离库/Blob，预览不能访问生产凭据。

以上为 2026-09-17 官方文档核查结果，不代替部署时的账号能力与容量验证。

## 数据归属与不变量

| 数据     | 存储                           | 必须保持的关系                                                                                         |
| -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| User     | Postgres users                 | anonymous/registered；显示名不是身份；首版无 OAuth                                                     |
| ApiKey   | Postgres api_keys              | 引用 User；高熵 secret 仅创建响应返回，存 SHA-256 摘要；撤销不改变 Taco 归属                           |
| Taco     | Postgres tacos                 | owner_id 引用 User；current_revision_id 必须属于本 Taco；last_sequence 是已提交事件高水位              |
| Revision | Postgres revisions + 私有 Blob | UUID；parent 属于同 Taco；不可变发布内容包含 snapshot 与 importedComments，contentHash 只计算 snapshot |
| 评审数据 | Postgres events + 投影表       | 每个评论/确认固定 revision；sequence 按 Taco 递增；actor 与时间由服务端赋值                            |

upload_reservations、mutation_receipts、guest_sessions、threads、thread_messages、reviewer_states 是内部记录，不新增业务实体。数据库关系可以使用真实外键：current_revision_id 用 `(taco_id, revision_id)` 复合关系或提交时延迟约束，不能只验证某个 UUID 存在。首次 Taco/revision 的循环引用在同一事务中通过延迟外键提交。

上传 reservation 的逻辑唯一键是 `(user_id, purpose, target_scope, idempotency_key)`。publish 的 target_scope 使用固定非空值，update 使用目标 Taco UUID；不能依赖 PostgreSQL 默认 UNIQUE 对 NULL 的去重行为。记录完整元信息摘要、uploadId、预分配 Taco/revision UUID、服务端 Blob 路径、pending/committed/abandoned、最后签发 URL 的截止时间和总截止时间。

评审幂等键包含 Taco、操作、actor kind/id、Idempotency-Key；guest 不能被排除，也不能只用裸 id 造成 User/Guest 碰撞。导入线程的本地 ID 在 revision 内命名空间隔离；原作者只显示 imported/unverified，不映射 Host 身份。投影可由不可变 importedComments 基线加 Host 事件重建，不能声称仅凭 Host 事件就能恢复离线评论。

## 身份与匿名引导

1. 公开读取无需 Key。help、skills、dry-run、读取和导出不创建身份或隐式写凭据。
2. publish 无该 Host 的 Key 时，调用 OpenAPI 的匿名凭据入口。收到 User/ApiKey 后先安全保存，再申请上传。响应丢失最多留下无内容的匿名身份；未保存 Key 不上传正文。
3. 无效/撤销/过期 Key 是认证失败，不降级成新匿名用户。已有 Taco 的 update/close/delete 没有 Key 直接失败。
4. 首版不做匿名 Key 找回、账号合并、所有权认领或 OAuth login。公开 UUID、源 docId、相同显示名不构成管理证明。
5. 网页 guest cookie 识别评审参与者，不代替发布者 Key；丢失 cookie 不能冒领旧评论/确认。首版 User/Guest 均 verified=false。

## PostgreSQL 提交边界

使用支持真实事务与行锁的 SQL 驱动；涉及多语句的事务必须绑定同一数据库会话，不能用相互独立的 HTTP SQL 请求模拟事务。连接通过池复用；WebSocket 存活期间不独占数据库连接或事务。

统一锁序：**凭据行 → 上传 reservation（涉及上传时）→ Taco 行 → 子记录/收据**。同类多行按稳定 ID 排序。凭据鉴权同时检查 owner、revoked_at、expires_at；不能只检查存在。

- ApiKey 业务提交持有共享行锁并重验有效性；撤销持有目标 Key 排他锁。若操作涉及当前与目标两个 Key，按 ID 排序获取所需最强锁，禁止先锁 A 再锁 B 导致互相撤销死锁。
- 撤销先提交，则后续最终事务失败；业务事务先取得共享锁，则撤销等待其提交。入口验证之后的 Blob 等待不持锁，因此等待期间撤销会在最终事务被发现。到期按最终鉴权检查时刻判断，不宣称跨时钟的瞬时取消。
- guest 写入先验证会话/CSRF，再在短事务重验会话与 Taco 状态。不能要求 guest 提供不存在的 ApiKey。
- 每个影响事件/版本/生命周期的写入持有 Taco 行排他锁。在同一事务增加 last_sequence 并插入 events；不使用可能发生提交倒序的全局数据库 sequence。
- Blob 读取、上传、JSON/PNG 校验均在数据库事务之外。只有经验证不可变对象的元信息进入最终事务。

这些规则缩小竞争窗口，但不声称消除所有数据库死锁；实现仍需识别数据库事务中止并用原幂等键安全重试。

## 发布：准备、直传、提交

### 准备上传

`POST /v1/uploads` 使用 ApiKey 与 Idempotency-Key，字段以 OpenAPI 为准：purpose、目标/base、payloadHash、payloadBytes。publish 无目标与 base；update 两者必填且检查 owner。prepare 先重新认证并检查 deleted/expired，再读取同键记录；已 committed 的成功操作允许在 closed 后恢复，但不签发新的写 URL。

数据库唯一约束固定 uploadId、Taco UUID、revision UUID 和对象路径。相同元信息重复请求复用同一条 reservation；不同内容返回 IDEMPOTENCY_MISMATCH。pending 可续签 URL，但不延长总预约期限、不重分配身份；abandoned 不可复活。

建议预约最长 24 小时、单次 URL 最长 15 分钟，且 URL 截止不得超过预约截止。响应只有 pending 才有 PUT URL；committed 返回原 uploadId/status，CLI 重放最终提交。签发前在短事务中登记本次授权最晚截止，再到 Blob 控制面签发；清理据此知道最晚可能写入时间。签发失败只留下保守截止，不提前回收。

### 私有 Blob 直传

客户端将完整 `{protocol,snapshot,importedComments?}` 的 JCS UTF-8 字节直传 Blob。限制单个服务端生成路径、PUT、application/json、payloadBytes 和 32 MiB 上限；`allowOverwrite=false`、`addRandomSuffix=false`。这不是任意 URL 上传或执行 HTML 的入口。

签名 URL 是临时能力凭据，不进日志/终端/分享包；Host ApiKey 不发向 Blob。客户端不能拿它读取或覆盖其他对象。URL 可被重复请求，安全性来自路径不可覆盖，不假称签名本身天然单次使用。PUT 响应丢失时允许先尝试提交，由 Host 核实对象。

### 校验和最终提交

1. 收到小型提交请求，验证身份、uploadId 归属、目标、base、原幂等键。若已提交且仍允许服务，返回原结果，不依赖重新上传。
2. 仅按数据库登记路径读取自有 Blob，不接收客户端 URL。计数字节、核对 payloadHash，解析并验证协议/白名单/路径/navigation/锚点/PNG/UTF-8 大小，计算 JCS(snapshot) 的 contentHash。声明大小和摘要都不是可信校验结果。
3. 进入最终短事务，按锁序再次验证 Key、reservation、Taco；先拒绝 deleted/expired，再重放已提交收据，再检查新写入的 open/base。成功重试不会因后来 closed/base 变化而失败。
4. 初次创建 Taco 或更新 current 指针，插入 revision、导入线程基线、revision.published、投影和成功收据，reservation 标记 committed，同一事务提交。导入评论不创建批准或完成状态。
5. 返回成功。响应丢失以原 uploadId/Key 恢复同一 UUID；不是“上传成功就算发布”。

两个不同更新可完成 Blob 上传，但同一 base 最多一个提交。失败对象不可见，等待清理。所有公开读取通过数据库检查 committed 与生命周期，Blob 路径不是分享入口。

## 回收与生命周期

回收在短事务锁住 reservation，与提交竞争 pending→abandoned 或 pending→committed。只有 abandoned 且没有 revision 引用的对象允许删除。不能单凭年龄清理或覆盖 committed 对象。

已发 PUT URL 无法靠数据库标记立即撤销。清理必须等最后签发 URL 过期并留出在途上传余量；之后重复扫描 abandoned 对象，处理迟到上传，不能假定一次删除就永远不存在。数据库不可核验时宁可延迟回收。reservation 墓碑/幂等边界保留到必要期限，避免旧请求重新创建已删除 Taco。

open 可写；closed 只读可导出；deleted/expired 在 API 检查中立即停服并异步清理 Blob/记录。订阅每轮查询先检查生命周期，删除后不再发送新批次；已入网络的字节不能撤回，连接终止存在轮询传播延迟。关闭不表示所有人批准，外部公开副本不可撤回。

可用受凭据保护的 Vercel Cron 扫描小批次回收记录；读取/写入接口仍必须自行检查 expiresAt，不依赖 Cron 准时触发。无后台回收服务就不能宣称已实施自动物理清理。

## 评审提交与投影

所有线程固定 revision；全局讨论只是 anchor=null，不是跨版本空间线程。定位失败保留引文并标记 stale，不猜另一个位置。离线 deletedAt 消息必须只有 `[Deleted message]`，不恢复原文。

同键重放原响应和状态码；不同键但状态未变化返回 200/changed=false/event=null（包括从未批准时撤回），并保存无变化收据。真正变更返回 201/changed=true/完整 Event，在同一事务追加事件、投影和收据。close 使用自身的 Taco 状态响应，不套用评审 mutation DTO。

同一参与者新增评论/回复使其 completed 失效；批准可撤回；新 revision 不继承批准。匿名身份只能说明相同凭据持有者，不证明实际人员。

## WebSocket 尾读与恢复

从 PostgreSQL 同一读快照取得 Taco 状态与 H。默认 ready(cursor=H,live)，之后不断按已发送游标读取更大的事件；先捕获 H 再尾读之间的新记录不会丢失，因为数据库保留它们，不依赖内存连接注册。

带 after 时检查 0≤after≤H，发送 replay ready(cursor=after,replayThrough=H)，有界补发 `(after,H]`，checkpoint(H)，再尾读。不能在 ready 时跳过未输出的历史。无法补读的旧游标报 CURSOR_EXPIRED，不能静默跳到现在。

首版约 1 秒轮询持久日志，同 Function 内同 Taco 可共享一次尾读；多实例独立读取仍正确。不引入 Redis 作为事件权威或额外实时供应商。代价是轮询查询、连接驻留和约秒级延迟，部署前需按实际并发核算费用。

慢消费者只保留有界队列；超过边界断开，由客户端持已输出游标补读。提交后实例崩溃、新部署、maxDuration 或网络断线均从数据库恢复。CLI 的“已完成”只指完整 stdout 行写出，不保证 Agent 已处理。

轮换使用 close1012，建议 240 秒，重连不要求同实例。仅空间真实关闭时，在最后事件和 checkpoint 后发送 close1000、reason=taco.closed；带有效 after 的已关闭空间允许补读，即使 after=H。无 after 的关闭空间报 TACO_CLOSED。普通 EOF 或平台终止不能冒充评审完成。

## 高水位分页、导出与留存

版本/评审分页捕获 H；后续不透明游标绑定 Taco/revision/H 及线程、参与者两套偏移。投影需从导入基线和 sequence≤H 事件重建，或使用等价的版本化读模型；不能把当前可变投影当作过去 H 的快照。单页两个数组分别有界，hasMore 表示任意一组未读完。

导出先在短一致性读中捕获 H 和 Taco 元信息，再按不可变 revision/事件边界流式读取；不能将新标题/current 指针与旧事件截面混装。不持有整个下载期的数据库事务。importedThreads 每项包含 revisionId；PNG 正文完整包含，不导出过期后无法取回的资源引用。

私有 Blob 不对外发签名 GET URL；公开内容由 Host 生命周期检查后流式代理，Cache-Control:no-store。HTTP 在输出前可报结构化错误，输出后失败必须中断；客户端完成解析与协议检查之前不能原子改名成成功文件。流式豁免不等于无限执行时长，超时失败明确报告，不伪造完整 JSON。

留存天数仍待确定。capabilities 与 expiresAt 明示实际策略；null 表示需手动删除。事件不无说明地早于正文清理；策略变更不能静默缩短已有承诺。
