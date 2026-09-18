---
title: 'taco-cli 命令、帮助与内置指南契约'
taco_scope: plan
status: 'Approved'
---

## 范围

这是独立 binary 的目标契约，不是现有 Node 脚本的使用说明。产品决策见 [spec](../spec.md)，HTTP 字段见 [OpenAPI](openapi.yaml)，事件与错误结构见 [JSON Schema](protocol.schema.json)。本文负责命令输入、stdout/stderr、退出、凭据与离线自描述；不复制服务端模型。

命令名 `taco-cli`；Host 命令不嵌套在 host 子命令下。所有发布内容公开，无 public/visibility 开关。首版不提供 login；匿名 publish 通过 ApiKey 引导，不等于无管理保护。

## 命令面

| 命令        | 位置参数                    | 专用选项                                                                                    | 成功 stdout                                        |
| ----------- | --------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| publish     | `<file.taco.html>`          | `--dry-run`、`--request-id <uuid>`                                                          | 发布结果或本地检查结果                             |
| update      | `<tacoId> <file.taco.html>` | 必需 `--base <revisionId>`；`--dry-run`、`--request-id <uuid>`                              | 新 revision 发布结果或本地检查结果                 |
| subscribe   | `<tacoId>`                  | `--after <sequence>`                                                                        | ready/event/checkpoint NDJSON，直到退出            |
| events      | `<tacoId>`                  | `--after <sequence>` 默认 0；`--through <sequence>`；`--limit <integer>` 默认 100、最大 500 | 一页事件、throughSequence、nextCursor、hasMore     |
| close       | `<tacoId>`                  | 无                                                                                          | `{command,host,tacoId,status,closedAt}`            |
| export      | `<tacoId>`                  | 必需 `--output <path>`                                                                      | `{command,host,tacoId,path,throughSequence,bytes}` |
| delete      | `<tacoId>`                  | 无                                                                                          | `{command,host,tacoId,deleted:true}`               |
| help        | `[command...]`              | 无                                                                                          | 分层 JSON 帮助                                     |
| skills list | 无                          | 无                                                                                          | 已内嵌指南清单                                     |
| skills read | `<id> [path]`               | path 默认 SKILL.md                                                                          | 含完整 Markdown content 的 JSON                    |

Host 命令均接受 `--host <origin>`。`--help` 对任何已注册命令只读取帮助，位置参数不必补齐，也不读取文件或网络。无参数、help 和 --help 返回同一顶层帮助。未知命令/选项、重复单值选项及额外位置参数退出 2；不隐式丢弃。不接受 `--json`、`--ndjson`、`--public`。

离线 pack/sync/comments/validate 能力由同一 binary 承接，复用现有文件协议与冲突保护；其迁移时必须同样提供 JSON 帮助与输出，不借此改动 pack 路由或 sync 冲突语义。prepare-template/prepare-policy 是 Spec Kit 集成入口，不作为通用 Host 工作流前提。本轮不重定义这些已有操作的所有选项。

CLI 暂不增加通用 HTTP 代理命令，也不把每个读取/评审 API 都映射成子命令；浏览器使用评审 API，Agent 使用订阅与事件历史。Key 初始化/撤销可通过已定义 API 或运维完成。

## Host、凭据与本地输入

1. Host 优先级：`--host` > `TACO_HOST_URL` > `http://localhost:32167`。只接受 origin；拒绝 userinfo、非根路径、查询和 fragment。远端 HTTPS；HTTP 仅限 localhost/127.0.0.1/[::1]。规范化默认端口和尾斜杠后比较 origin。
2. `TACO_HOST_API_KEY` > 该 origin 的已保存 Key。环境 Key 绑定环境 URL，未设置 URL 则绑定默认 origin。显式 Host 不同即 `CREDENTIAL_HOST_MISMATCH`，不能随覆盖参数发送到另一站点。管理请求不跨 origin 重定向；公开请求也不借重定向带上凭据。
3. 公开 events/subscribe/export 不发 Key；help/skills/dry-run 不读取 Key、不访问网络。update 的 dry-run 只检查参数与本地投影，不能声称 base 仍为当前版本。
4. publish 无 Key 时调用匿名引导并安全保存成功后才上传。优先系统凭据库；文件后端目录 0700、文件 0600，拒绝符号链接，以安全临时文件原子写入。不静默以宽权限保存；失败退出且不上传正文。保存位置类别可报告为 keychain/file，但不输出 secret 或散列。
5. 无效 Key 不降级匿名；update/close/delete 缺少 Key 直接失败。HTTP 错误、诊断、崩溃日志均不得输出 Authorization、cookie、CSRF 或协作密钥。
6. 先本地校验 `.taco.html` 数据块，再按发布白名单投影；不执行 shell。剥离已知敏感元数据；未知字段明确失败。输入 canonical 文件及 `.taco.html` 均不写回云端 ID。

`--dry-run` 结果至少包含 command、dryRun=true、host、contentHash、payloadBytes、files（path/mediaType/bytes）、importedThreadCount、strippedFieldCategories，以及 update 的 baseRevisionId。不得包含正文、PNG data URL、原始 collab 或任何 Key。它报告本版建议限制检查，不伪装已查询远端实际配置；实际上传先读取 capabilities。

## Vercel 发布传输

命令行不新增 upload 子命令；publish/update 内部统一完成以下流程，小文件也不走另一套内联端点：

1. 在内存或受保护临时文件中生成 JCS 发布包，计算 payloadBytes、payloadHash；正文摘要 contentHash 单独计算。
2. 以 ApiKey 和同一 Idempotency-Key 调用 `POST /v1/uploads`，提交 purpose、tacoId/baseRevisionId（首次均 null）、大小与摘要。pending 取得 uploadId 与短期 PUT URL；committed 只有 uploadId，跳过上传直接重放最终提交。
3. 直接 PUT 完整发布包到指定 Blob URL，Content-Type 为 application/json。不得带 Host Authorization，不跟随重定向；uploadUrl 的查询签名全部脱敏。不能将 URL 当成公开分享链接。
4. 小型提交请求：publish 发送 `{protocol:"taco-host/1",uploadId}`；update 再带 baseRevisionId。Host 按登记路径读取 Blob 并完整验证，PostgreSQL 提交成功才输出 PublishResponse。
5. 上传响应丢失时先尝试提交，让 Host 核实对象，而不是覆盖旧路径。上传 URL 到期但 reservation 仍 pending 时，可用同键同元信息重新 prepare；abandoned 不可续签复活。最终响应丢失用原 uploadId/Key 提交重放；重启后同键 prepare 返回原 uploadId，已提交记录不再发写 URL。

完整包仍支持建议 32 MiB，不经过 Function 4.5 MB 入站通道；控制 JSON 建议不超过 64 KiB。网页读取与 export 接收流式 JSON：不得因分块传输将半份 JSON 当成成功。匿名 Key 保管、默认公开和返回 UUID 的用户流程不变。

## 单次结果与失败

单次成功 stdout：一个 UTF-8 JSON 对象加换行，不因 TTY 自动切换格式。publish/update 结果遵循 OpenAPI PublishResponse；其 command 按操作填写，host 为实际已验证 origin。HTTP 204 delete 转换为上述 JSON 结果，不尝试解析空正文。

单次失败 stdout 为空，stderr 最后一行为 ErrorResponse，退出非零；此前允许本节约定的安全请求/重试诊断 JSON 行。requestId 是诊断关联 ID，不是幂等键；本地错误也产生非空关联 ID。错误 details 只列安全字段（JSON 路径、UUID、HTTP 状态、保存后端类别），禁止带原始请求/响应正文。

| 退出码    | 含义                                                   |
| --------- | ------------------------------------------------------ |
| 0         | 完成；订阅确认空间正常关闭                             |
| 1         | 本地 I/O、凭据保存失败、EPIPE 或未分类错误             |
| 2         | 参数、文件、Schema 或协议无效；目标不存在/已删除或到期 |
| 3         | 缺少/无效/撤销凭据、凭据 origin 不匹配或归属失败       |
| 4         | base 冲突、幂等内容不匹配、空间关闭等状态冲突          |
| 5         | 网络、限流或可重试服务故障耗尽                         |
| 6         | CURSOR_EXPIRED，必须明确处理历史缺口                   |
| 130 / 143 | SIGINT / SIGTERM；没有后台接收进程                     |

导出完整 JSON 到目标同目录临时文件，校验格式/协议后以不覆盖既有目标的原子提交方式完成。默认拒绝覆盖文件；失败清除自己创建的临时文件，不能把部分下载改名。文件中包含公开原文、图片及完整事件；stdout 只报告路径和边界，不再次打印归档正文。

## 不确定请求与订阅恢复

publish/update 每次新的逻辑操作生成 UUID 幂等键；显式 `--request-id` 对应 HTTP Idempotency-Key。发出变更前，以 stderr JSON 诊断 `kind=request` 报告 command/host/requestIdempotencyKey，不记录正文。这样未得到成功响应时可用同一 Key、同一输入恢复。相同正文但新逻辑发布仍使用新 Key。

网络故障、429、可重试 5xx 最多额外重试 4 次；指数退避含抖动并尊重 Retry-After，总等待上限建议 60 秒。超限返回退出 5 和原幂等键，结果标为 unknown；不得换 Key 自动重发。保留期之外不保证去重，帮助明确提醒先人工核对。401/403/409/422 不重试。dry-run 不生成远端请求收据。

subscribe stdout 只含 Schema 中 ready/event/checkpoint；WebSocket error 转换为 stderr ErrorResponse，不混入数据 stdout。stderr 可包含 `{kind:"diagnostic",code,message,attempt}`，不等于失败事件。正常数据记录必须逐行完整写出，stdout 背压不能丢数据。

- 默认 after=null：输出 live ready 后以其 cursor 作为起始边界，只看新事件。
- 显式 after：输出 replay ready；只能保存其中原 cursor，不能提前跳到 replayThrough。
- 每个 event 完整写入 stdout 后推进游标；checkpoint 必须在之前数据全部写出后才能推进。这里确认的是 CLI 输出，不是下游 Agent 处理成功。
- 断线在原 Host+Taco 上以已输出游标重连，可能重复；不承诺 exactly-once。成功追平后重置退避；连续不可达 5 分钟退出 5。
- 关闭后的有效 after 可补读至关闭事件；checkpoint 后收到 close code=1000、reason=taco.closed 才确认最终边界。after 已等于关闭序号时允许空补读再正常结束。没有 after 的关闭空间返回 TACO_CLOSED。
- Vercel Function 达到最长时长前主动轮换，建议 240 秒以 code=1012 结束，自动用当前游标连接可能不同的新实例；不能误报 Taco 已关闭，也不要求用户重启命令。轮换短断不算重试耗尽；网络持续不可达仍受 5 分钟上限约束。
- 未确认最终状态的断线/普通 EOF 不能直接退出 0。删除/到期是错误而非“评审结束”。
- Ctrl-C/TERM 停止连接；EPIPE 退出 1；不保存隐式跨进程恢复游标，不拉起 daemon。

HTTP events 的 `--through` 映射 throughSequence。首次请求捕获 H，后续页同时带上该 H 和上一页 nextCursor；不自动跨页拉到无限增长日志，也不把 sequence 转成浮点数。

## 离线帮助契约

所有帮助输出带 `schema: "taco-cli-help/1"`、binaryVersion、command（字符串数组）、summary、positionals、options、environment、output、errors、examples。顶层额外有 commands、publicNotice、skills。空集合明确输出 []，不以缺字段表示暂未撰写。

位置参数项字段 name/type/required/description；选项项 name/type/required/default/description；environment 项 name/default/precedence/description。examples 每项含 invocation/purpose；output 描述 stdout/stderr/streaming，并引用结果类型与必需字段。errors 列 code/exitCode/recovery，不能只有泛化“请求失败”。help 的默认值与解析器必须来自同一命令定义。

顶层公用字段示意（实际命令帮助必须填完整参数、示例和错误列表）：

```json
{
  "schema": "taco-cli-help/1",
  "binaryVersion": "1.0.0",
  "command": ["subscribe"],
  "summary": "订阅公开 Taco 的持久事件流",
  "positionals": [
    { "name": "tacoId", "type": "uuid", "required": true, "description": "目标 Taco UUID" }
  ],
  "options": [
    {
      "name": "--after",
      "type": "sequence",
      "required": false,
      "default": null,
      "description": "排他恢复游标；省略只接收新事件"
    },
    {
      "name": "--host",
      "type": "origin",
      "required": false,
      "default": "http://localhost:32167",
      "description": "覆盖环境 Host"
    },
    {
      "name": "--help",
      "type": "boolean",
      "required": false,
      "default": false,
      "description": "离线输出本命令帮助"
    }
  ],
  "environment": [
    {
      "name": "TACO_HOST_URL",
      "default": "http://localhost:32167",
      "precedence": "--host > environment > default",
      "description": "公开订阅目标，不发送 Key"
    }
  ],
  "output": {
    "stdout": "ready/event/checkpoint，见 ServerFrame",
    "stderr": "ErrorResponse 或 diagnostic JSON",
    "streaming": true
  },
  "errors": [
    {
      "code": "CURSOR_EXPIRED",
      "exitCode": 6,
      "recovery": "查询可读历史边界；明确接受缺口后再选起点"
    },
    { "code": "TACO_CLOSED", "exitCode": 4, "recovery": "使用有效 --after 补读或 export" },
    { "code": "VALIDATION_ERROR", "exitCode": 2, "recovery": "按帮助修正参数或检查协议版本" },
    { "code": "NOT_FOUND", "exitCode": 2, "recovery": "核对 Host 和 Taco UUID" },
    { "code": "TACO_GONE", "exitCode": 2, "recovery": "空间已删除或到期，不能继续读取" },
    { "code": "RETRY_EXHAUSTED", "exitCode": 5, "recovery": "恢复网络后使用已输出游标重新订阅" },
    { "code": "OUTPUT_IO_ERROR", "exitCode": 1, "recovery": "检查输出管道并用已保存游标补读" }
  ],
  "examples": [
    {
      "invocation": "taco-cli subscribe 8e8e2b51-4cad-43d2-a5f6-4f56bcb0a001 --after 41",
      "purpose": "补读并持续接收"
    }
  ]
}
```

1.0.0 是帮助形状示例，不是声明已发布版本。退出信号由公共 output/退出码说明列出，不伪造成服务器错误码。

## binary 内置指南

`skills list` 返回 `{schema:"taco-cli-skills/1",binaryVersion,skills:[{id,version,description,files}]}`。首版 id 为 taco，登记 SKILL.md、references/publishing.md、references/reviewing.md。`skills read` 返回 `{schema:"taco-cli-skills/1",binaryVersion,id,version,path,mediaType:"text/markdown",content}`。完整资源构建时嵌入；没有网络读取、插件下载或运行时安装步骤。

id 和 path 必须在编译清单中精确匹配；拒绝 `..`、绝对路径、URL、反斜杠及未登记文件，退出 2。不能将任意本地文件当作指南返回。

指南必须覆盖：

- SKILL.md：何时本地 pack、何时公开 publish、何时基于明确 base 更新；canonical 本地文件是权威；所有历史与图片公开；默认 JSON 的读取方式。
- publishing.md：本地 validate/dry-run → 安全匿名 Key 保存 → publish → 保存 UUID/链接/幂等键；不执行上传 shell；Key 遗失边界与冲突不能自动覆盖。
- reviewing.md：先 subscribe 等 ready 再等待新反馈；断线补读与重复处理；评论不等于批准；修改 canonical 后重新 pack/update；close/export 的不同含义。
- 作者载体：流程/结构用独立 .mmd，HTTP 用 OpenAPI，消息用 Schema，存储用数据模型；MD 解释决策而不重复维护每个字段。
- 本地评审导入先 validate、sync --dry-run、再安全 sync；不擅自 --force 或 resolved。Host export 是独立归档，不能冒充现有 sync 输入。
- 用宿主原生可点击文件/链接展示 Taco；只有宿主许可才自动打开；不使用 data/Blob URL 绕过限制。

首版发布检查必须证明 help/skills 在断网、没有 Node/Spec Kit/外部 skill 的机器上可用；内容跟随 binary 同版本。本文约定内置资源的交付内容，不在设计阶段伪造已安装的 skill 或 binary。
