---
title: '008-taco-host-contract'
feature_id: '008-taco-host-contract'
created: '2026-09-17'
status: 'Approved'
taco_scope: spec
issue: 'https://github.com/Arcadia822/taco/issues/27'
---

## 1. 状态与边界

本文是待评审的使用契约与接口设计，不代表命令或服务已实现。用户已确认的方向与本文提出的接口细节分开记录。本文不是实现计划，也不迁移现有目录。

已确认：

- 需求、设计讨论与评审是主要场景；Host 不做长期 canonical 数据源。
- 所有内容默认 public，不做私有空间、团队、成员邀请或复杂 ACL。
- 数据分五类：User、ApiKey、Taco、Revision、评审数据。确认与反馈完成属于评审数据，不冒充正文评论。
- 暂不考虑 Gist。
- taco、taco-cli、taco-host 三个职责模块暂留同一仓库。目标 CLI 为独立可安装的 `taco-cli` binary，不要求用户安装 Node、Spec Kit 或另行安装 skill。
- canonical 文件仍在本地；发布输入仍为 `.taco.html`。Host 不执行上传文件里的脚本，也不托管任意 HTML 应用。
- CLI 订阅为前台长进程，不新增本地 Daemon，不负责唤醒或编排 Agent。
- 部署采用 Vercel。先前托管平台方案不再作为实现路径。

评审确认：默认 JSON 输出；默认全部公开，无公开配置开关；匿名可发布，最小流程不含登录；Host 默认 `http://localhost:32167` 并支持环境变量；Taco 与 Revision 使用 UUID；首版必须有完整 help 与 binary 内置 skill。OAuth `taco-cli login` 延后，当前走 ApiKey。本文的匿名身份自动发 Key、具体 API、退出码、限制与留存仍是实现建议，不代表已实现。

本轮将精确定义拆为独立载体，以下为各自唯一维护位置：

| 文档                                               | 权威边界                                          |
| -------------------------------------------------- | ------------------------------------------------- |
| [HTTP OpenAPI](contracts/openapi.yaml)             | 路由、认证、请求、响应、分页与 HTTP 状态          |
| [协议 JSON Schema](contracts/protocol.schema.json) | 发布快照、导入线程、评审变更、事件与 WebSocket 帧 |
| [数据模型](data-model.md)                          | 五类数据关系、提交边界、投影、回收与故障恢复      |
| [CLI 契约](contracts/cli.md)                       | 命令选项、离线帮助、内置指南、输出与进程行为      |

本文保留目标、约束、使用示例和验收；字段定义不在 Markdown 再维护一份。机器 Schema 只验证结构，UTF-8 字节上限、跨字段关系、归属、路径存在性及事务顺序仍需语义验证。

## 2. 模块与现有代码依据

| 模块      | 当前位置或拟议位置                                   | 边界                                                                           |
| --------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| taco      | `src/`                                               | `taco/files` 协议、模型校验、渲染、锚点与离线编辑保存                          |
| taco-cli  | 当前脚本在 `extensions/taco/bin/`；目标为独立 binary | 复用本地 pack/sync/validate 能力，提供顶层 publish/update/subscribe 与内置帮助 |
| taco-host | 拟新增 `taco-host/`                                  | 用户、ApiKey、公开评审网页、存储、订阅与部署                                   |

CLI 和 Host 复用 taco 的纯协议/校验与必要阅读能力；不互相导入业务实现。taco 离线运行不依赖 Host。共享提取按实际调用需要进行，不新增第四个产品或通用插件框架。

当前源码依据：`extensions/taco/bin/taco.mjs` 的 `parseTacoHtml` 从数据块 JSON.parse 后调用 `validateBundle`，不执行 shell；现有命令由 `main` 分发。`src/model.ts` 定义 files、navigation、comments、position/quote/block 锚点。

现有 CLI 是随 Spec Kit 扩展分发的 Node 脚本，包含 pack、sync、comments、validate、prepare-template、prepare-policy；仓库 package.json 虽声明 taco bin，但包为 private，这不等于已经发布可安装 binary。前四项是通用文件操作，后两项是 Spec Kit 集成辅助；现有安装入口不应成为新 CLI 的产品前提。

目标分发：GitHub Release 提供 macOS/Linux 的 arm64/x64 binary 与 SHA-256 校验文件，命令名统一 `taco-cli`。binary 内嵌必要 shell、协议能力和帮助资源，无需 Node 或 Spec Kit 才能运行。实现语言/打包工具在实现计划中选定，不凭本文声称已有安装 URL。Windows 支持另行决定。Spec Kit 插件作为集成消费者，后续切换到同一 CLI 能力而不是复制一套业务逻辑；本轮只改设计，不删除现有入口。

不能直接当作 Host 校验器的原因：CLI 通用校验只检查正整数版本；浏览器模型允许未来版本冻结阅读，且对非法 navigation 有丢弃行为。Host 发布必须拒绝不支持的版本及无效 navigation，不能静默降级。普通 HTML/HTM 源文件与旧 `sourceUrl` 字段已不受本地 Taco 支持，Host 也必须拒绝，不能通过发布投影重新放宽校验。

## 3. 最小使用流程与自带指南

目标命令为独立 `taco-cli`，不再嵌套 `taco host`。以下是拟议用法，不代表 binary 已发布。`update` 在独立 CLI 中表示发布新 revision，Spec Kit 的本地更新命令最终调用 pack，不占用这一语义。

```sh
# 不需登录、网络或另装 skill，就能了解命令与工作流。
taco-cli help
taco-cli publish --help
taco-cli skills list
taco-cli skills read taco

# 默认 http://localhost:32167；仅检查本地发布数据。
taco-cli publish design.taco.html --dry-run

# 匿名也能直接发布；默认公开，返回 UUID 和分享链接。
taco-cli publish design.taco.html

# 使用发布结果中的 tacoId 和 revisionId。
taco-cli subscribe 8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001
taco-cli update 8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001 design.taco.html --base 993b05fd-2f80-48cc-aafd-1d7564781001
taco-cli events 8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001 --after 0 --limit 100
taco-cli close 8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001
taco-cli export 8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001 --output review-export.json
```

不需 `login`、`--json`、`--ndjson`、`--public` 或必填 `--host`。后续 OAuth 入口为 `taco-cli login`，首版不实现、不在可用命令清单中伪装成可调用命令。已有 ApiKey 可通过环境或本地配置使用；没有 Key 的匿名发布方式见第 4 节。

### Host 与凭据

- Host 优先级：显式 `--host` > `TACO_HOST_URL` > `http://localhost:32167`。选项全局可用；help 列出默认值与覆盖规则。
- 远端只接受 HTTPS；HTTP 仅允许 localhost/127.0.0.1/[::1] 回环地址。规范化为 origin，不接受用户名、密码、查询参数或片段；不得跨 origin 重定向转发凭据。
- ApiKey 优先级：`TACO_HOST_API_KEY` > 对应 origin 的本地凭据。环境 Key 绑定 `TACO_HOST_URL`，未设置 URL 时绑定默认 origin；显式 `--host` 与该绑定不一致则报错，不把 Key 发向另一站点。
- 本地 Key 优先保存到系统凭据库；文件方式须仅当前用户可读写、拒绝符号链接。读取、help、dry-run 和导出不创建身份或写凭据；匿名 publish 创建凭据后告知保存位置类别，不输出 secret。
- 对已存在 Taco 的 update/close/delete 缺少或丢失 Key 时直接失败，不新建匿名身份假装能接管。撤销/无效 Key 也不静默降级成匿名发布。
- `publish/update --dry-run` 仅本地解析与投影，输出文件列表、字节数、摘要、剥离字段类别、评论数量和错误；不打印正文或秘密。
- 发布与更新默认公开，API 也没有 public/visibility 参数。help 与网页醒目说明历史、评论、图片均公开，但不增加上传确认开关。
- 发布/更新不修改 canonical 文件，也不把云端 id/key 写回 `.taco.html`。

### JSON、退出码与帮助

所有命令默认结构化输出，不提供输出格式开关。单次命令成功 stdout 为一个 JSON 对象；失败 stderr 为结构化 error，stdout 为空。订阅 stdout 为逐行 JSON（NDJSON），诊断为 stderr JSON；stdout 不混入提示、进度、浏览器打开信息或 ASCII banner。导出写文件，stdout 只报告文件路径与导出边界。

建议退出码：0 正常结束；1 本地 I/O 或未分类错误；2 输入/协议校验失败；3 认证或归属失败；4 版本/状态冲突；5 网络/限流重试耗尽；6 游标失效；SIGINT 130，SIGTERM 143。旧 Node 脚本行为不在本轮改动范围。

首版必须提供以下离线能力，且帮助请求绝不发生上传或创建用户：

| 入口                                                 | 输出                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `taco-cli` / `taco-cli help` / `taco-cli --help`     | 同一顶层 JSON：版本、简介、命令、Host 默认值、输出规范、公开提示、示例、skills 入口             |
| `taco-cli help publish` / `taco-cli publish --help`  | 同一命令 JSON：位置参数、类型、必需性、默认值、选项、环境变量、凭据规则、示例、结果字段、错误码 |
| `taco-cli skills list`                               | binary 内置指南的 id、描述、版本与可读取文件列表                                                |
| `taco-cli skills read taco`                          | JSON 中的 content 为完整 Markdown 指南，不是安装外部 skill 的链接                               |
| `taco-cli skills read taco references/publishing.md` | JSON 包装的指定内置参考文件；只允许打包时登记的路径，拒绝路径穿越                               |

help 与 skills 内容必须跟随 binary 版本发布；从同一命令定义生成参数帮助，避免文档与解析器漂移。skill 教 Agent：何时 pack/publish/update、如何处理 canonical 文件、选择 .mmd/OpenAPI/数据模型等载体、匿名身份与 ApiKey 保管、解析默认 JSON、先订阅等待 ready、处理冲突、评审后刷新、保存评论、按宿主许可展示或打开 Taco。无需安装 `.agents/skills` 或 Spec Kit 才能阅读和执行通用流程。

本机参考实查：`lark-cli --help` 有 USAGE、EXAMPLES、命令列表和 AI AGENT SKILLS 指引；`lark-cli markdown --help` 提供分层帮助；`lark-cli skills --help` 说明在构建时内嵌 SKILL.md/参考文件，并提供 list/read。只借鉴分层结构与随版本内嵌机制；其原始文本输出与外部 skill 安装建议不照搬，因为本产品要求默认 JSON、无需另装 skill。

关闭后仍能导出；导出也可在开放期间进行。首版建议关闭不可逆，继续评审时发布新 Taco。

发布成功示例：

```json
{
  "command": "publish",
  "host": "http://localhost:32167",
  "tacoId": "8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001",
  "revisionId": "993b05fd-2f80-48cc-aafd-1d7564781001",
  "contentHash": "sha256:<64 lowercase hex>",
  "url": "http://localhost:32167/t/8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001",
  "revisionUrl": "http://localhost:32167/t/8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001/r/993b05fd-2f80-48cc-aafd-1d7564781001",
  "expiresAt": null
}
```

UUID 为格式有效的示例，摘要为占位说明；实现必须计算真实摘要。

## 4. 五类业务数据

### User 与 ApiKey

User 区分 anonymous/registered。匿名 User 是不可冒充实名的持有者身份，不要求注册或 OAuth。将来 provider/subject 唯一，不按可修改名称或邮箱识别用户。首版不实现 OAuth 或网页登录；具体公开字段见 OpenAPI，内部关系见数据模型。

ApiKey 是 User 的高熵随机凭据：明文仅创建响应返回一次，服务端只保存摘要；不出现在 URL、日志、分享数据或导出中。首版无 scopes；一个 Key 代表一个用户，Taco 归属 User 而非 Key。

匿名发布的建议实现：CLI 无凭据时自动调用 `POST /v1/anonymous-credentials`，Host 创建 anonymous User 并签发其 ApiKey；CLI 先安全保存 Key，再发布 Taco。用户只运行 publish，不额外执行登录或注册。这仍使用 User/ApiKey 两类数据，不增加每文档管理 token。该引导接口受限流与滥用控制；不接受客户端指定现有 userId。发 Key 响应丢失时最多留下无 Taco 的匿名身份，由回收策略清理；未持久保存凭据就不上传正文。首个 Taco 发布前凭据已保存，响应丢失可用相同 Key 和幂等键恢复。丢失匿名 Key 后不能用公开 UUID 接管；首版无匿名找回或自动认领流程。已有 User/ApiKey 可由 Host 运维初始化，当前无需 OAuth 即可使用。

### Taco

新 Taco 的标题取初始快照标题；更新版本时一起更新当前标题。旧版本显示自己的标题。分享链接 `/t/{id}` 打开最新版本；固定版本链接 `/t/{id}/r/{revisionId}` 永远对应同一份内容。`docId` 是输入来源标识，不代替 Host Taco ID，也不证明归属。

public 不等于无管理保护：只有 owner 对应的有效 ApiKey 能更新、关闭、删除，包括匿名 owner。无成员权限表。首版不提供全站公开目录，但不得称为私有。公开响应不暴露 ApiKey 或身份系统内部字段。

### Revision

Revision 正文、目录和资源快照不可变。内部 snapshotKey 不进入公开响应；currentRevisionId 只在版本成功提交后切换。字段与存储关系分别见 OpenAPI 和数据模型。

Taco.id 与 Revision.id 及对应引用使用服务器生成的随机 UUID v4，小写带连字符；不是 t_/r_ 前缀或自增序号。排序使用时间、父版本和事件 sequence，不用 UUID 推断顺序。UUID 不是访问凭据。sourceDocId 保留输入协议值，不强制改写成 UUID。

Host 不提供正文在线编辑或任意文件执行。评审者针对读取的固定 revision 发送反馈；发布新版不自动替换正在阅读的正文。

### 评审数据

actor 来源为 ApiKey 识别的 User 或网页访客会话，服务器赋予标识、显示名和 occurredAt，拒绝客户端伪造。首版所有 User 与 guest 均标记 verified=false；ApiKey 的持有不等于实名身份验证。OAuth 验证身份属于后续能力。

类型包括 comment.created、comment.replied、thread.resolved、thread.reopened、review.completed、revision.approved、revision.approval_withdrawn。前两者含完整消息内容；其余为结构化行为，不用特殊评论文案表达。

文件锚点沿用 Taco 的 `path`、`position.start/end`、`quote.exact/prefix/suffix`、可选 `block`。全局讨论 `anchor: null`。锚点按目标 revision 校验路径及范围；无法匹配引文时明确标记 stale，不将评论静默挂到另一处。回复继承线程所属 revision，跨版本回复拒绝。

建议首版新建评审消息采用追加后不可编辑/删除；可补充回复，线程 owner 或 Taco owner 可解决/重开。该限制只针对 Host 新消息，不改变离线评论编辑/墓碑语义。匿名 cookie 丢失后不能凭显示名认领原来的线程或确认；匿名身份不是实名或已验证同意。

反馈完成和确认按 `(revisionId, actorId)` 计算状态。确认可撤回；新版本从未确认开始。review.completed 记录提交时的事件序号；之后同一参与者新增评论/回复，其“反馈完成”状态失效，需再次提交。页面访问、订阅或关闭空间不代表任何人确认。

## 5. 发布数据：安全投影，不是第二套文档模型

传输媒体类型为 application/json，外层 `protocol: "taco-host/1"`。snapshot 是 taco/files v1 的明确发布投影，保留文件模型与锚点，不引入 blocks 业务建模系统。以下是直传 Blob 的发布内容，不是 Function 发布端点的请求体；发布端点只接收小型 uploadId 提交请求。

```json
{
  "protocol": "taco-host/1",
  "snapshot": {
    "format": "taco/files",
    "version": 1,
    "docId": "local-doc-id",
    "title": "设计评审",
    "root": "specs/example",
    "files": [
      {
        "path": "specs/example/spec.md",
        "mediaType": "text/markdown",
        "content": "## 目标\n正文\n"
      }
    ],
    "navigation": {
      "version": 1,
      "entry": "specs/example/spec.md",
      "groups": [{ "id": "spec", "title": "需求", "paths": ["specs/example/spec.md"] }]
    }
  },
  "importedComments": []
}
```

白名单：

- snapshot 顶层仅 format、version、docId、title、root、files、navigation。
- file 仅 id、title、path、mediaType、content、sourceHash、blocks；可选字段仍需严格校验。blocks 只承接现有协议允许的结构与锚点，不能把上传 HTML 当运行代码。
- navigation 保留 version、entry、groups 的 id/title/paths，逐项校验，不静默丢组或文件。
- importedComments 仅接收既有线程/消息/锚点协议字段，包括删除墓碑；所有本地作者标记为 imported/unverified，原 authorId 不绑定 Host User。相同本地线程 ID 在不同 revision 下不会覆盖已有 Host 线程；导入反馈不触发版本确认或反馈完成。
- collab 整体、access、packOptions 等已知本地元数据不发送；未知扩展字段默认拒绝发布并指出 JSON 路径，不能静默删掉可能的内容。已知本地元数据剥离在 dry-run 中报告。
- 普通 HTML/HTM 源文件及旧 `sourceUrl` 字段在本地校验和 Host 发布投影中均明确拒绝；其他非主动执行的 UTF-8 格式保留源码查看。
- PNG 继续使用已有 base64 data URL，校验真实二进制与现有 10 MiB 单图上限。首版不另设任意资源 URL 上传接口，不抓取用户给定远程地址。
- Markdown/blocks/Mermaid 的危险 HTML、URL、外部脚本和上传 CSS 被隔离或清洗。正文源码保留不变；渲染净化不能改写快照。
- 本地与服务端均验证；仅信任 CLI 校验不构成安全边界。协议未来版本拒绝，不能按 v1 猜测。

建议首版完整发布内容上限 32 MiB（UTF-8 JSON 编码后，含 base64），单条评论 16 KiB，最多 2,000 个文件。Vercel Function 入站有 4.5 MB 上限，因此所有 publish/update 统一走“申请上传 → 私有 Blob 直传 → 小请求提交”，不维持一套内联大包旁路。控制请求建议上限 64 KiB。配置由 capabilities 返回；不自动省略图片或截断正文。

contentHash 为 RFC 8785 JCS(snapshot) 的 UTF-8 字节 SHA-256，前缀 sha256:；数组顺序保留，文件内容不得规范化换行。payloadHash 则覆盖完整上传内容字节，包括 importedComments；CLI 用 JCS 编码完整包得到稳定字节。服务端读取 Blob 实测长度、重新计算摘要及校验，不相信客户端声明。相同正文再次发布仍产生独立 revision；只有相同幂等键代表同一次提交。

上传授权限定单个服务端生成路径、PUT、application/json、容量与短有效期，禁止覆盖。URL 是临时能力凭据，不打印、不写入 Taco、不发送 Host ApiKey 到 Blob。提交时只接收 uploadId，服务端按数据库记录读取自有 Blob，绝不抓取客户端任意 URL。上传成功未提交的对象不公开。

## 6. HTTP API v1

生产环境必须 HTTPS；本地默认 `http://localhost:32167`。时间由服务器生成 RFC3339 UTC；Taco/revision 标识为 UUID v4；其他 ID 不透明。sequence 是十进制字符串，不能假定 JavaScript Number 无损。管理请求使用 Bearer ApiKey；公开读取无需身份；匿名发布由 CLI 自动引导，不依赖 login。

[OpenAPI](contracts/openapi.yaml) 定义全部 HTTP 操作及 DTO，不在此复制端点表。发布/更新的安全投影、评审的可辨别联合类型和实时帧引用 [JSON Schema](contracts/protocol.schema.json)，而不是另抄一套字段。

列表默认 limit=100，最大 500。版本/评审列表使用固定高水位的不透明游标；评审页分别限制线程与参与者状态数量，不能用无限 reviewerStates 数组绕过分页。events 使用排他 sequence 和固定 throughSequence。恢复记录须带 Host + Taco ID，不能跨空间套用裸游标。

网页匿名写入前通过同源 POST /v1/guest-session 获取 HttpOnly、SameSite cookie；生产设置 Secure，本地回环 HTTP 仅用于开发。检查 Origin/CSRF，按 IP/会话/Taco 限流，滥用时挑战。公开可读不等于无限匿名写入。不以访客 cookie 认领已发布 Taco；CLI 的匿名 ApiKey 引导与浏览器评审 cookie 是不同用途。凭据创建禁止任意跨域浏览器调用。

## 7. 冲突、幂等与错误

发布、更新、评审 POST 要求 `Idempotency-Key`，由客户端生成随机 UUID；scope 为调用者身份 + 方法 + 资源（首次发布为 User）。Key 到期建议 24 小时，由 capabilities 返回。相同 Key 和相同规范化请求在保存期内返回原结果；同 Key 不同内容为 409 IDEMPOTENCY_MISMATCH。幂等查询必须先重新认证，撤销的 Key 不能通过重放取回管理响应。

CLI 自动网络重试必须复用同一 Key；允许显式 `--request-id` 恢复一次不确定结果。准备上传与最终提交绑定同一 Key、身份、目标、base、payloadHash 和大小，固定 UUID；准备接口可以续签仍 pending 的上传 URL，但不能重复分配或复活 abandoned 记录。超出幂等保留期不能承诺不重复创建；不得自动用新 Key 重试不确定的首次发布。持久收据保存在 PostgreSQL，不依赖 Function 内存。

更新事务先匹配 baseRevisionId，再写新 revision、切换 currentRevisionId 并追加 revision.published 事件。并发两次基于同一 UUID 版本的不同更新只能一个成功，另一个返回 409 REVISION_CONFLICT 和 currentRevisionId。幂等重放先于版本冲突检查；成功更新的重试仍返回原结果。不得自动读取 latest 再覆盖。

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "Base revision is no longer current",
    "retryable": false,
    "requestId": "req_123",
    "details": { "currentRevisionId": "993b05fd-2f80-48cc-aafd-1d7564781002" }
  }
}
```

稳定机器 code 与自然语言 message 分离。HTTP：400 参数错误；401 无效身份；403 非 owner/非线程管理者；404 不存在或跨 Taco 资源；409 冲突/关闭状态；410 过期/删除或游标不可补读；413 超限；422 协议/内容/锚点校验失败；429 限流（Retry-After）；503 临时存储不可用。错误不得包含 Key、完整正文或协作密钥。

只对网络故障、429、明确 retryable 的 5xx 有界退避重试；401/403/409/422 不自动重试。正文上传成功不等于发布成功：必须获得已提交 revision 的响应或同键重放结果。

## 8. 实时事件与 CLI 行为

每个 Taco 的 revision、评审、生命周期变更共享递增 sequence。事件 id 唯一，revisionId 对内容/评审事件必填；生命周期事件为 null。CLI stdout 示意：

```json
{"kind":"ready","protocol":"taco-host/1","tacoId":"8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001","cursor":"41","mode":"live"}
{"kind":"event","id":"ev_42","sequence":"42","tacoId":"8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001","revisionId":"993b05fd-2f80-48cc-aafd-1d7564781001","type":"comment.created","occurredAt":"2026-09-17T10:00:00Z","actor":{"kind":"guest","id":"g_7","displayName":"评审者","verified":false},"data":{"threadId":"th_9","messageId":"m_9","body":"这里的边界需要说明","anchor":null}}
{"kind":"checkpoint","tacoId":"8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001","cursor":"42"}
```

WebSocket 首帧为 `{"type":"subscribe","protocol":"taco-host/1","after":null}`；显式 `--after` 或活动进程恢复时传 sequence 字符串。握手后 10 秒未提供合法首帧则关闭。tacoId 由 URL 指定，不能用帧切换到另一个空间。

初次默认订阅：从 PostgreSQL 一致性读取 Taco 状态与高水位 H，发 ready(cursor=H, mode=live)，随后按持久日志持续读取 sequence>H。H 读取与下一次查询之间的新事件也已入库，因此不依赖“内存注册连接与捕获 H 原子执行”。ready 前的历史通过 events 读取。

恢复/显式补读：捕获 H，发 ready(cursor=客户端已完成游标, mode=replay, replayThrough=H)，有界分页补发 `(after,H]`，发 checkpoint(H)，再持续读取 sequence>H。未来事件留在数据库，不要求全部缓冲进 Function 内存。ready 不是“历史补读完成”；不能提前跳到 replayThrough。

- 发布新版仍用同一 Taco 连接；不重启订阅。
- 活动进程短暂断线，指数退避加抖动，建议连续不可达 5 分钟后退出 5；成功连接并追平后重置。断线诊断写 stderr。
- CLI 在一整行 event 写入 stdout 后推进内存游标；stdout 背压暂停读取，不能丢行。EPIPE 退出，不继续隐藏订阅。可重放、客户端按事件 ID 去重，不承诺接收进程已处理或跨进程 exactly-once。
- 进程退出后不继续接收、不自动拉起；再次启动默认不恢复旧游标。需要补读时显式 `--after`，或调用 events。
- 应用文本 ping/pong 保活，建议 30 秒间隔、90 秒无响应重连；心跳不写日志或 stdout。Vercel 原生 WebSocket 受 Function 最大时长限制；建议配置 300 秒并在 240 秒轮换，以 1012 关闭后带游标重连。这不是 taco.closed，不能退出 0。
- 提交后才从日志分发。跨 Function 实例首版采用有界 PostgreSQL 事件尾读，建议约 1 秒轮询、同实例同 Taco 合并查询；无连接时停止，不持有整段连接期的数据库事务。进程崩溃或部署切换后从日志补读，不依赖实例广播。
- 慢消费者超出有界缓冲则断开并从游标重连，不无限积压内存。不能恢复的旧游标返回 CURSOR_EXPIRED 与最早可读边界，CLI 退出 6，不能静默跳到现在。
- 关闭空间生成 taco.closed，发完事件与 checkpoint 后以 1000、reason=taco.closed 结束连接，CLI 退出 0。已关闭空间带有效 after 仍可补读至关闭边界；after 已等于最终边界时允许空补读。不带 after 的新订阅报 TACO_CLOSED。其他断线包括时长轮换必须重连；删除/到期报错，不承诺终止事件必达。

事件日志是订阅恢复依据，线程和当前确认状态是可重建投影。revision.published、taco.closed 是同一日志的系统记录，不新增第六类业务实体。具体存储关系与恢复边界见 [数据模型](data-model.md)。

## 9. 数据持久性、导出与生命周期

目标部署为 Vercel Functions（Node.js）与静态阅读资源；首版存储建议采用 Marketplace 的 Neon Postgres + 私有 Vercel Blob。PostgreSQL 保存五类业务记录及上传/幂等收据；Blob 保存不可变发布内容。Neon 是具体数据库供应商建议，不把 Marketplace 数据库误称为 Vercel 自营 Postgres。

Blob 上传在数据库事务外完成。最终短事务锁定上传 reservation 和 Taco 行，重验身份、状态与 base，原子提交 revision/current 指针/评审事件/幂等收据。每 Taco 的 sequence 在同一行锁下分配并提交，不使用可能乱序提交的全局数据库 sequence。回收与提交竞争 pending→abandoned/committed 状态，完整算法见 [数据模型](data-model.md)。

Blob store 保持 private 是存储边界，不是产品私有权限。内容仍可公开通过 Host 读取，Host 核对生命周期与归属；不发绕过删除/到期检查的公开 Blob URL 或签名 GET URL。内容响应不使用长期公共缓存。已传到用户设备的公开副本无法撤回。

导出格式 `taco-host-export/1`：高水位一致的 Taco 元信息、全部 revision 快照（包含 PNG）、按 revisionId 归属的原始导入线程、完整评审/系统记录、throughSequence 和导出时间。大版本读取和导出使用流式 application/json 避免普通响应体上限；仍受 Function 最长时长约束，超时必须报失败而不是返回假完整归档。不导出任何凭据；归档不冒充可直接 sync 的 `.taco.html`。

客户端写导出到临时文件后原子改名，默认拒绝覆盖现有文件；错误不得留下被误认为成功的半份文件。

不先锁定 30 天。部署配置可设置公开留存政策，capabilities、发布结果和页面必须显示准确 expiresAt；无自动清理配置时为 null 并明确“需手动删除”，不得宣称已自动到期。建议生产开放前确定有限保留期。策略变更不得静默缩短已有承诺。

open → closed 为只读；open/closed → expired/deleted 停止服务并清理数据。停订阅与关闭/删除是不同操作。自动到期不能冒称已归档；到期前可导出，但无需后台替用户完成归档。因限额或故障未成功持久化的评论必须报告失败，不显示“已提交”。

## 10. 验收场景

这些是实施时必须验证的行为，不是本轮已经运行的测试。

1. 含协作密钥的合法容器：dry-run 只报告剥离类别，发布请求及日志不含 secret；文件中的主动脚本从未执行。
2. 未知协议、无效 navigation、非法路径、未知扩展和超限 PNG/总包：精确失败，不静默遗漏文件。
3. Markdown、目录、PNG 与代码块锚点在 Host 语义保真；普通 HTML/HTM 源文件及 `sourceUrl` 被拒绝，而非执行或静默剥离。
4. 无身份可读当前/旧版本、资源与事件；错误 Key 或另一用户不能管理 Taco；撤销 Key 立即影响新管理请求。
5. 两个不同更新基于同一版本：只有一个成功。响应丢失同键重试：只返回一个 revision；首次发布同键不创建两个 Taco。
6. 用户停留旧版时提交评论/确认：保持旧版归属。导入本地作者不能冒充登录用户，导入评论不能充当审批。
7. 读取订阅高水位后、下一次查询前新增评论：日志尾读无丢失；恢复时持续新增评论：补读与实时切换有序、允许重复但无缺口。
8. 评论提交后分发前崩溃：重连其他 Function 补读成功；达到时长轮换后带游标恢复；stdout 阻塞有背压；Ctrl-C/管道关闭无后台进程。
9. 匿名同名不能认领别人的线程；重复确认不制造多个有效确认；撤回只影响当前参与者；新版本不继承确认。
10. 关闭后不允许写入但可完整导出；到期/删除后旧版本和资源也不可读，外部副本不承诺撤回。
11. 导出固定高水位：包含所有此前记录和资源、不含之后写入，不含任何登录或 API 凭据。
12. 无 Host 配置、网络或账号时，原有离线 pack/sync/validate/read 工作流保持可用。
13. 新机器未安装 Node/Spec Kit/skill、未登录且无 Key：安装 binary 后 help/skills 离线可用，publish 自动匿名引导且 Key 安全落地后发布，随后 update 成功；丢失 Key 不可管理原 Taco。
14. 单次输出、help、skills 都为 JSON，订阅为 NDJSON；不存在必须添加 json/public/host 参数的路径。未知参数报错而不是静默接受。
15. Host 默认 localhost:32167，环境变量覆盖默认，显式参数覆盖环境；跨 origin 凭据不泄漏。无效 Key 不自动降级。
16. API 响应、链接、请求引用中 Taco/revision 标识都是 UUID v4；与来源 docId、事件 sequence 不混淆。
17. 帮助准确列出参数、默认值、环境变量、输出和错误；内置指南与 binary 版本一致，读取不依赖网络或额外 skill 安装；未实现 login 不冒充可用命令。
18. 上传授权、Blob 直传、校验、PostgreSQL 提交各边界失败：同键恢复同一 Taco；不同用户不能提交 uploadId；删除后旧 pending 请求不能复活；回收不能误删并发提交对象；迟到直传对象也会清理。
19. close 已提交但订阅连接断开：带游标补读到关闭边界；after 等于最终边界也可正常结束；无游标不会伪装实时订阅成功。
20. 重复状态操作不同键返回 changed=false/event=null，不伪造事件；同键重放原状态码和结果。导出导入线程带 revisionId，不能串联错版评论。
21. 大于 4.5 MB 且不超过 32 MiB 的合法发布包经 Blob 直传完整保留；Function 只收小请求；重放上传 URL 不能覆盖已校验内容；大响应使用流式 JSON，失败不留下成功文件。

平台依据（2026-09-17 查阅）：[WebSocket 支持与实例/时长边界](https://vercel.com/docs/functions/websockets)、[Function 限制](https://vercel.com/docs/functions/limitations)、[Blob 签名直传](https://vercel.com/docs/vercel-blob/vercel-signed-urls)、[大响应流式传输](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)。这些证明平台能力与约束，不代表已经部署验证。

## 11. 本轮评审处理与实现顺序

本轮以用户消息提供的九条 Arcadia 批注为依据。同步预检通过，dry-run 无冲突；本地评审文件返回 comments=[]、正文 unchanged，实际 sync applied=true，但没有从该文件导入正文修改或线程。以下编号为本文反馈记录，不伪造原始 thread ID，不自动标记任何线程 resolved。

| 批注                                   | 处理                                                           | 状态   |
| -------------------------------------- | -------------------------------------------------------------- | ------ |
| 为什么已有 CLI，是否只是 Spec Kit 插件 | 第 2 节区分通用 Node 脚本、Spec Kit 辅助命令与独立 binary 产品 | 已处理 |
| 要可安装 taco-cli binary               | 确定独立命令名与 binary 分发目标，不以脚本简写替代             | 已处理 |
| login 应走 OAuth，当前可先 ApiKey      | OAuth/login 延后，当前采用 ApiKey，无网页登录依赖              | 已处理 |
| 不做 json 参数                         | 单次命令/help/skills 默认 JSON，订阅默认 NDJSON                | 已处理 |
| 不做 public 配置                       | CLI 和 API 均无公开开关，全部默认公开                          | 已处理 |
| 最小流程无需 login，匿名可发布         | publish 自动匿名引导为实现建议，保留管理保护                   | 已处理 |
| Host 默认值与环境支持，端口 32167      | 定义参数/环境/默认优先级及回环 HTTP 边界                       | 已处理 |
| Taco/Revision 使用 UUID                | 明确 UUID v4，响应、URL 和订阅示例同步                         | 已处理 |
| help 参考 lark-cli，自带 skill         | 实查三条 help 命令，定义分层帮助和 build-time 内置 list/read   | 已处理 |

待确认的实现建议：匿名 User 自动发 Key；首批 binary 平台；Host 评论首版只追加；实际留存期限。它们不阻塞本轮契约修订，但不能被说成已经实现或已经逐项获批。

实现顺序：独立 binary 骨架及同版本 help/skills → 协议投影与匿名/ApiKey 引导 → Host 发布/评论/持久事件闭环 → CLI 与网页 → 并发更新/订阅恢复/安全验证 → 关闭导出与清理。help 不是最后补文档，而是首个交付的一部分。

当前不做：OAuth login、Gist、私有文档、团队 ACL、全文知识库、在线正文协作、任意应用托管、Agent 自动处理反馈。可安装 binary 属于目标范围；安装发布方式不得再以“暂不做新 npm 包”误排除。
