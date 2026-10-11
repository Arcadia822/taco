---
title: 'TACO-60 同一 Taco 的多轮反馈与在线修订'
feature_id: '020-review-feedback-revisions'
created: '2026-10-11'
status: 'In Progress'
linear: 'https://linear.app/castrel/issue/TACO-60'
---

## 目标与验收

同一 Issue 的 review 反馈回到原 `.taco.html`。先按 Handoff 与 canonical 文件检查冲突，再刷新原数据块，保留 `docId`、文件 id、评论历史、navigation、完整 Checkpoint 定义和状态及未知字段。新增研究文件或变更标题不建立第二份 review 文档。第三方 arc-sdlc 的 workflow/integration 不在本仓，交付明确的集成规则。

`taco-cli publish` 创建新的 hosted Taco。`taco-cli update <tacoId> <file> [--base <revisionId>]` 提交同一 Taco 的新修订，URL 仍为 `/t/<tacoId>`。默认读取 Host 当前 revision；可选 `--base` 要求指定版本仍为当前版本。`--dry-run` 只执行本地投影，未传 base 时不查询 Host。CLI help 与内置指南区分两条路径。已有评论及 Checkpoint 状态不回到模板初值。显式过期 base 拒绝且不写入。

## 实现边界

实际生产路径是 `packages/host/src/app/v1/tacos/` 和 `packages/host/src/lib/db.ts`，使用公开发布与公开 review。旧 `packages/host/src/service.ts` 的 authenticated staged revision 不是当前 Next.js 路由的实现，不能仅接入该旧模型。

沿用现有纯数据投影、数据库事务、review 状态与事件序列。两种持久化后端均支持相同契约。原始 publication baseline 和 Handoff 快照继续不可变。revision identity 与当前共享 review 的 state version 分别表示发布与人类 autosave 的并发边界。保持现有公开访问模型，不引入账号、key 或新的联网依赖。

选用独立 UUID revision 记录，不将可变的十分钟 history window 或 decimal state version 冒充 revision。CLI 从现有 state API 获取 CSRF、revisionId 及 state/comments 版本，再提交 revision；未传 `--base` 时使用该 revisionId，显式值优先。HTTP 请求仍包含 `baseRevisionId`，数据库在同一事务中验证 revision、state version 和 comment sequence，更新共享正文并推进事件。对于最近成功 Handoff 后新增的正文、标题、navigation 或 Checkpoint 定义编辑，先拒绝以免覆盖未处理反馈；只有状态变化时保留 Host 现有状态。评论历史保留并按新正文重定位锚点。旧 Taco 以原 tacoId 作为初始 revisionId，不重建原 baseline。

实现遵循 Model the Domain，明确区分 revision UUID 与 review state version。Laziness Protocol 使实现复用现有数据库与 CSRF，不增加新的账户或 staged upload 流程。Prove It Works 要求真实 CLI 到运行中的 Host，而非仅测试旧 service 类。

HostedSession 现有行为不订阅 revision 事件。修订成功后，评审者重新加载原 URL 读取新正文；旧标签页的 autosave 由 stateVersion CAS 拒绝。此次沿用该行为，不新增 SSE 或后台正文同步。

## 第三方 arc-sdlc 集成规则

本仓及已加载 skill 中未找到 arc-sdlc；其文件不在本次修改范围。将以下规则加入 `integrations/taco.md`、`references/lifecycle.md` 与 `workflows/standard.md` 的 review 回合说明：

- 同一 Issue 保留一份 `.taco.html` 的原路径和 `docId`。收到反馈后先检查并应用 canonical 修改，再刷新原数据块；新增研究文件或改标题不创建另一份文档。
- 保留文件 id、评论全部消息及 open/resolved 状态、navigation、未知字段和完整 Checkpoint 定义与状态；不得从模板重新初始化或根据正文猜测完成状态。
- 首次 `taco-cli publish` 记录 `url`、`tacoId`、`revisionId`。后续使用 `taco-cli update <tacoId> <file> --host <origin>`，记录返回的新 revisionId 并继续订阅原 tacoId；若要要求某个版本仍为当前版本，追加可选 `--base <revisionId>`。
- base 过期或尚未处理的人工正文修改导致冲突时，先取回并协调修改。旧 CLI 不支持网络 update 时明确报告，不回退为 publish。

## 体积与依赖预算

口径为文件 UTF-8 字节数与 skill 目录全部文件字节数求和。prepare 估算在实现前记录。

| 产物 | 当前基线字节 | 预计增量字节 | 预计比例 |
| --- | ---: | ---: | ---: |
| Complete `.taco.html` | 2846650 | 0 | 0% |
| Lite `.taco.html` | 297311 | 0 | 0% |
| Complete skill shell | 2738186 | 0 | 0% |
| Lite skill shell | 188847 | 0 | 0% |
| skill 目录 | 14094920 | 4000 | 0.0284% |
| CLI 构建 JS / 发布包 | 80065 | 6000 | 7.494% |
| 本需求 review `.taco.html` | 首次创建，无旧产物 | 约 2746000 总字节 | 无基线 |

预计 Host 源码增加 12000 字节，含两个数据库实现和 route。官网文案增加 500 字节。无新增运行或开发依赖。联网变化仅为用户执行 `update` 时访问已指定 Host 的 revision 路由，local dry-run 不联网。实际构建与测量后填写估算值、实测值及偏差原因。

2026-10-11 追加调整：`--base` 改为可选，默认由 CLI 读取 Host 当前 revision。预计 CLI JS 在 86154 字节基础上增加 500 字节以内，skill 目录增加 500 字节以内，双语指南各增加 300 字节以内；Complete/Lite shell 增量为 0。无新增依赖或请求次数，复用 update 现有的 state 请求。显式 base 仍检查旧版本；默认更新表示调用者有意替换执行时的当前 revision，不能检测本地文件是否基于更早的 revision。

### develop 实测

| 产物 | 预计增量字节 | 实测增量字节 | 偏差原因 |
| --- | ---: | ---: | --- |
| Complete `.taco.html` / Complete skill shell | 0 | 0 / 0 | 本次不改变浏览器运行时 |
| Lite `.taco.html` / Lite skill shell | 0 | 0 / 0 | 本次不改变浏览器运行时 |
| skill 目录 | 4000 | 3724 | 复用刷新脚本并补充默认读取当前 revision 的说明 |
| CLI 构建 JS | 6000 | 6906 | 加入 CSRF、版本 CAS、可选 base 与错误分类 |
| 官网文案源文件 | 500 | 332 | 两种语言共用现有提示位置 |
| 官网英文 / 中文指南 Taco | 未单独估算 | 1123 / 1013 | 将更新命令写入既有文档数据块 |
| Host 数据库实现与新 revision route 源码 | 12000 | 35138 | 两个后端的持久 revision、迁移、Handoff 快照和并发校验 |

CLI 构建 JS 为 86971 字节，较基线 80065 增长 8.63%；无新增依赖。所有 shell 增量均为 0，未触发 shell 体积告知阈值。双语指南刷新保留原 docId、评论和 Checkpoint 数据。

可选 base 调整单独实测：CLI JS 预计 ≤500 字节 / 实测 +817 字节，偏差来自新增错误说明、可选参数 help 和内置指南；skill 预计 ≤500 字节 / 实测 +305 字节；英文与中文指南预计各 ≤300 字节 / 实测 -55、-38 字节。Complete/Lite shell 实测增量仍为 0。

## 验证

真实 CLI 对本地 SQLite Next Host 首次 publish 后连续两轮 update 成功，URL、tacoId、docId、评论消息和 `freeze` 状态保留。过期 base 与未 Handoff 的实际正文编辑均返回冲突，CLI 退出码 4；实际 Handoff 后同一 update 再次成功。浏览器显示第二轮正文与原评论。

`npm run check` 最终通过，57 个测试文件、655 项测试及全部 shell 构建通过。23 项 CLI 测试覆盖可选 base、显式 base 冲突、无 base 时的冲突不重试以及离线 dry-run。真实 CLI 不传 base 更新成功，原 URL 和评论保持不变；dry-run 指向不可访问 Host 仍成功。`npm run test:browser` 通过，内置样本文档有 7 条已有 warning。9 条 LESSONS 校验与格式检查通过。官网预览为 http://127.0.0.1:32168/。

PostgreSQL 源码已审查，未执行数据库运行验证：本机没有 PostgreSQL 二进制，Docker daemon 未启动。额外 `tsc --noEmit -p packages/host/tsconfig.json` 未通过，该配置覆盖了含 `.ts` 导入的共享源码，以及页面、旧 service 等错误；本次缺失的 `CheckpointChange` 导入已修正。仓库正式 `npm run check` 的类型构建通过。
