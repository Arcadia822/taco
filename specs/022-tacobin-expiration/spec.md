---
title: "TACO-53：Tacobin TTL 过期与审查修复"
feature_id: TACO-53
status: in_progress
---

## 范围与约束

发布默认有效期 30 天，有限 TTL 为正整数秒且不超过 365 天；显式 0/null（CLI 0/none）表示永久。继续使用匿名 Pastebin 模式，不增加账户、Owner、关闭、列表、批量删除或后台物理清理系统。旧库中的 NULL 期限保持永久，更新文档不延长期限。

## 修复决策

1. PostgreSQL 的运行时建表和幂等升级都创建 nullable `expires_at TIMESTAMPTZ`，与 SQLite 对齐。
2. 默认 TTL 只应用于未指定值；显式永久值不落入默认分支。
3. 所有公开文档读取入口消费生命周期状态：页面、状态、历史、评论、事件、监听信息、CSRF 令牌签发及受 Host 控制的 legacy 存储访问在到期后返回 410。历史快照与事件回放不能成为旁路，已到期对象也不再签发写入令牌。
4. 新发布不再写完整正文的公开 Blob 备份；数据库是 canonical 内容。旧公开 Blob URL 无法由 Host guard 撤销，删除既有外部对象属于另一次明确的操作。
5. 已过期对象的首次订阅、重连和在线到期均报告 TACO_GONE 并退出 2；真实游标失效仍报告 CURSOR_EXPIRED 并退出 6。
6. CLI dry-run 与实际发布共享本地 TTL 范围校验；非法参数在网络请求前退出 2。
7. 第二轮深度审查（六路并行评审 + 独立复核）修复的 TTL 执行缺口：上传预约内容（含已提交未消费）在 GET/PUT 时同时校验父 Taco 生命周期与预约期限；legacy 存储键先做规范相对路径校验（拒绝 scheme、查询串、片段、转义与点段别名）再做生命周期判断；legacy 页面与存储的生命周期查询仅对 UUID 目标发起（非 UUID 历史对象跳过查询直接读基线，兼容 PostgreSQL 的 UUID 列）；订阅实时轮询在事件读取后二次校验生命周期，封堵读取与到期竞态的事件泄漏；CLI `update`/`events`/`handoff` 对 410/GONE 统一报告 `TACO_GONE` 并退出 2，退出 6 仅保留真实游标失效；legacy `TacoHostService` 的发布（默认/自定义/永久/非法值）与读取门禁对齐同一 TTL 语义。

契约沿用 [OpenAPI](../008-taco-host-contract/contracts/openapi.yaml)、[流协议 Schema](../008-taco-host-contract/contracts/protocol.schema.json) 和 [CLI 契约](../008-taco-host-contract/contracts/cli.md)。TTL 是未来服务端访问截止时间，不代表物理数据回收或撤回已下载副本。

## 验收与验证

- 空 PostgreSQL 库与旧适配器创建的库均可发布、读取并升级；NULL 永久记录保留。
- 默认、自定义、永久发布与精确到期边界有行为回归覆盖。
- 过期页面和全部兄弟读取路径返回 410；历史列表无法再用于读取正文。
- 新发布不产生永久公开副本，受 Host 控制的 legacy 路径到期后拒绝访问。
- 订阅初始连接、在线到期、重连以及真实游标缺口的错误码和退出码一致。
- 365d 可预检，366d/溢出值在本地拒绝；dry-run 不联网。
- 修复回归用例在旧代码上失败、修复后通过；实际 CLI 与 Next Host smoke 验证端到端行为。
- 第二轮审查回归：12 个新增回归用例在修复前代码上失败、修复后通过（独立 worktree 红绿对照）；覆盖上传内容生命周期、存储键别名、页面 fail-closed、live 订阅读取竞态、CLI 过期退出码与 legacy 服务 TTL；另 1 例固定「更新不延长期限」契约。

## 体积与依赖预算

修复前同口径基线（本工作树构建产物）：Complete `.taco.html` 2,848,302 B；Lite `.taco.html` 299,098 B；Complete skill shell 2,739,838 B；Lite skill shell 190,634 B；CLI `dist/main.js` 3,330,876 B；skill 目录递归文件总字节 14,119,734 B。
| 产物 | prepare 预计增量 | develop 实测增量 | 偏差原因 |
| --- | ---: | ---: | --- |
| Complete `.taco.html` | 0 B | **0 B** (2,848,302 B，与基线逐字节一致) | 不修改离线 shell runtime，符合预期 |
| Lite `.taco.html` | 0 B | **0 B** (299,098 B，与基线逐字节一致) | 不修改离线 shell runtime，符合预期 |
| Complete skill shell | 0 B | **0 B** (2,739,838 B，与基线逐字节一致) | 不修改 shell runtime，符合预期 |
| Lite skill shell | 0 B | **0 B** (190,634 B，与基线逐字节一致) | 不修改 shell runtime，符合预期 |
| CLI 发布入口 `dist/main.js` | +4,096 B | **+4,136 B**（修复轮 +2,235 B、审查修复轮 +1,901 B） | 略超预估 40 B：审查修复轮新增 update/events/handoff 的 TACO_GONE 分派与四个 help 错误表行；无新增依赖 |
| Skill 目录递归文件字节 | +1,024 B | **+588 B** (14,120,322 B) | 仅 publishing.md 三行语义修订 |

实测口径与基线一致（递归文件字节求和；`du` 的块分配数不作为度量）。任一 shell 增量均为 0 B，远低于 1% / 32 KB 告警阈值，无需体积告知。
第二轮审查修复仅触及服务端路由、CLI 源与测试，shells 与 skill 目录增量仍为 0 B。当前构建产物绝对大小另含 main v0.16.0 与 local-toolbox 内容，不归因于本需求。
零新增项目运行时依赖，零新增产品联网行为；修复删除了发布期间非 canonical Blob 写入。验证使用临时 PostgreSQL 二进制（`@embedded-postgres/darwin-arm64` 仅下载到 `/tmp`，修复动态库别名后启动，未写入 `package.json` 或发布包），与项目依赖隔离。估算与实测已并列记录于上表。
