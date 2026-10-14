---
title: 'TACO-81 主要功能验证与无需 Agent 的 CI'
feature_id: TACO-81
status: In Progress
---

## 目标

把现有 verify-taco 的主要功能配方落成可重复执行的浏览器场景，并把固定断言、CLI 本地工具箱和本地 Tacobin 验证纳入 GitHub CI。所有 CI 验证由 Node、Playwright、Vitest 和现有构建工具执行，不使用 Agent、模型服务或生产凭据。

## 覆盖与验收

| 面                  | 必须验证的主要行为                                                                                                                                     | 独立证明                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete 浏览与搜索 | 分类展开、重复文件名、侧栏选择、大纲、键盘搜索命中/无结果、嵌入 HTML 沙箱                                                                              | 实际 UI、可见正文、公开只读 API、网络记录                                                                                                                   |
| 编辑与文件管理      | Markdown 富文本/源码、frontmatter 属性、JSON/YAML/纯文本、Mermaid、PNG、新建、重命名、删除、分类/导航                                                  | UI 输入与确认、下载并重开后的 bundle                                                                                                                        |
| 评论                | 文本选择、作者、回复、消息编辑/删除 tombstone、解决/重开、面板切换与草稿                                                                               | 实际选择/按钮操作、评论状态、保存重开                                                                                                                       |
| 保存与 Handoff      | 主按钮/菜单/快捷键下载、身份与元数据保留、剪贴板交接、下载交接、只读边界                                                                               | 保存的文件、clipboard 内容、重开、无外联                                                                                                                    |
| Checkpoints         | graph、状态、依赖就绪、instructions、缺失文件创建、重命名/删除后原路径保持 missing                                                                     | 实际仪表盘/菜单、公开 API、下载重开                                                                                                                         |
| 变体与公共 UI       | Complete 离线、Lite 离线源码降级、主题、语言、窄屏面板与键盘路径                                                                                       | 真实浏览器、无 CDN 依赖的确定性降级                                                                                                                         |
| CLI 本地工具箱      | new/init/pack/verify/inspect/diff/extract、listen、两轮评审反馈与 refresh、变体/旧壳兼容                                                               | `scripts/smoke-local-toolbox.mjs` 的真实 CLI/浏览器/receipt 检查（`npm run test:toolbox`，CI `test-and-build`）                                             |
| Tacobin 与远程 CLI  | 真实 CLI publish/subscribe/handoff、Host shell、真实编辑 autosave、独立重开、评论、无 listener/有 listener Handoff、陈旧状态冲突、未知 Taco 订阅退出码 | `scripts/smoke-host.mjs` 的 9 个场景：真实 Next HTTP 路由、临时 SQLite、CLI 子进程、浏览器与服务器独立状态（`npm run test:host`，CI `host-smoke` 独立 job） |
| 已有契约            | 内核/协议、安全、Host API、CLI/扩展操作与 Spec Kit 安装                                                                                                | 保留现有 Vitest 与扩展安装 CI（Spec Kit 0.16.5 / 1.0.1 矩阵），不复制已有断言                                                                               |

浏览器 registry（`scripts/registry.mjs` 加 6 个域模块）是浏览器执行的唯一清单，共 **51** 个场景：browse-search 9、edit-files 15、comments 7、save-handoff 7、checkpoints 7、variants 6。本地 Host smoke 注册 **9** 个场景：open、autosave、reopen、comment、handoff:no-listener、handoff:listener、conflict、csrf、cli:unknown-taco。CLI 域不在 registry 内，`npm run test:verify -- --feature cli` 选中 0 个场景：两个 direct-command CLI 场景（`cli/pack-extract`、`cli/review-diff-extract`）放在 `scripts/cli.mjs`，作为 ad-hoc 模块由同一个 harness 以 `verify.mjs --scenario` 在 CLI 构建后独立执行（CI 已接入独立步骤）；更完整的 CLI/监听器与 Host 往返仍由 `npm run test:toolbox` 与 `npm run test:host` 承担。registry 的结构问题（模块导入失败、空 cases、未知 feature、重复 id）与零选中都非零退出。

每个自动场景都有有意义的结果断言。不得以仅启动、零测试、无断言、跳过或 mocked echo 宣称覆盖。固定场景不是 Agent eval。源码编辑器等路径必须经过真实 UI；公开 API 用于读取和断言，禁止通过内部 setter 注入结果。

## 实现约束

沿用现有 script-backed Playwright runner、隔离实例、doctor、截图/ARIA/actions/network/trace 和 finally cleanup。场景按用户领域组织；套件登记表是执行场景的唯一清单，失败退出非零，失败证据必须保留并由 CI 上传。每个案例记录自身 `cleanup` 结果：按 trace → context → browser → server 释放自己启动的资源（先留存 trace 再关 context），server 关闭后调用 `closeAllConnections()` 断开连接，端口再用 `AbortSignal` 探测，超时记为 `timeout` 而非 `closed`；每一步都受 `boundedCleanup` 上限约束并把结果写入该资源的 `cleanup.<资源>`。setup 的每个 await 都通过 `setupOperation`/`setupCancelled` 与显式取消竞速——这是必需防线：在本仓库 pinned Playwright 下，`context.close()` 会让仍在飞行中的 `context.newPage()` 永不 settle（两个 close 都返回），未竞速的 await 会拖住事件循环并以 exit 13 结束，只有 `browser.close()` 能让它 reject。native 浏览器 launch 受剩余 case 预算约束，doctor fetch 用 `AbortSignal.timeout(5000)`。Host 在每条路径上把 SIGTERM/SIGINT handler 保留到清理结束、只走一次清理并留下 summary（SIGTERM 退出 143），不得在 `finally` 里提前摘掉 handler。

内部 skill 使用项目统一的 `.agents/skills/verify-taco/` 入口，迁移全部脚本与文档引用，不保留 `.cursor` 兼容镜像。fixture 从当前生成 shell 只替换 `#taco-document` 数据块，包含多格式、分类、重复 basename、Checkpoint graph/instructions/missing file；不入库生成的 `.taco.html`。

CLI 复用现有 Bun 构建。Host 复用内置 fixture/ui helper，但使用现有 SQLite 适配器、自有临时数据库和随机 CSRF secret，清除会指向生产服务的环境覆盖，不读取生产评审。只关闭自身进程和端口。CLI 始终输出 JSON：断言必须解析完整 stdout，只对日志投影做截断（Host receipt 曾因 `tail(stdout, 8000)` 丢掉 JSON 首部而被误判为解析失败）。CI 必须能在无模型 API key 下完成；既有模型生成的 UI preview 不作为本任务通过依据。

## 自动化与人工边界

主要功能固定输入和预期结果都可由脚本自动验证，不需要 Agent。Agent 用于探索新问题或编写新场景；人负责视觉品质、文字质量、真实交付体验与审美判断。runner 在 `suite.json` 的 `humanBoundaries` 固定 5 条不得由自动场景宣称通过的边界：原生文件选择器权限与真实 OS 文件处理、真实系统默认浏览器与用户已打开会话、Lite 变体的线上 CDN、生产部署与云存储权限、Agent 对交付 bundle 的实际消费。不能把替身句柄证明等同于真实 OS 权限。

## 设计 Checkpoint

本轮改变验证基础设施，不改变公开协议、领域模型或生产数据迁移。两个独立设计分别比较现有脚本 runner 扩展与标准 `playwright/test`（现有包可直接提供，依赖增量同为 0）。选择扩展现有 runner：保留独立目录的证据、不可变产物与现有 ad-hoc `--scenario`，避免迁移第二套 runner/reporting。六个功能模块复用固定 harness/helper，真实 CLI 与 Host 各保留独立生命周期。不存在需要人判断的新产品方向或高成本迁移，额外人类 checkpoint 不适用。

## 体积与依赖预算

prepare 估算：Complete/Lite 纯 shell 增量均 0 字节；安装用 `skills/taco/` 和发布包增量 0 字节；内部 verify skill 预计增加 65,536 字节；仓库验证脚本与说明预计增加约 143,360 字节。生成的验证 `.taco.html` 文档数据预计每份 4–16 KiB，属于验证数据，不计纯 shell 增长。新增依赖 0，新增生产联网行为 0；CI 只保留既有依赖/浏览器安装网络，测试服务均为本地。

改动前同口径实测基线（`HEAD` = aaa4ea9，UTF-8 字节）：Complete `skills/taco/taco-shell.html` 2,740,554；Lite `skills/taco/taco-shell-lite.html` 191,340；安装用 `skills/taco/` 目录 19,652,706（45 个 regular file）；内部 verify skill `.cursor/skills/verify-taco/` 51,377（12 个文件）。

develop 同口径实测（同度量：纯 shell 只看 `skills/taco/taco-shell*.html` 自身；内部 verify skill 指目录内 regular file 合计；仓库验证脚本与说明指本轮新增/修改的验证脚本与 spec/治理文本）：

| 面                    | 估算或基线                            | 实测                               | 偏差                        |
| --------------------- | ------------------------------------- | ---------------------------------- | --------------------------- |
| Complete 纯 shell     | 2,740,554                             | 2,740,554                          | 0（0%）                     |
| Lite 纯 shell         | 191,340                               | 191,340                            | 0（0%）                     |
| 安装用 `skills/taco/` | 19,652,706                            | 19,652,706                         | 0（0%）                     |
| 内部 verify skill     | 估算 +65,536（基线 51,377 / 12 文件） | 370,939 / 24 文件（增量 +319,562） | 比估算多 254,026（+387.6%） |
| 仓库验证脚本与说明    | 估算 +143,360                         | +111,107                           | 比估算少 32,253（−22.5%）   |

内部 verify skill 超出估算：实现了 6 个域模块、共享 fixture/UI/lifecycle helper、两个完整 CLI 命令与文件往返场景，并纳入原生选区、取消和失败证据的防护；格式化后的 `scripts/cli.mjs` 为 44,658 字节。仓库验证脚本与说明采用 prepare 相同口径，计量集合为 `scripts/smoke-host.mjs`、`scripts/smoke-local-toolbox.mjs`、`specs/023-major-verification/spec.md`（包含本文件自身）、`specs/verify-taco-skill/spec.md`、`LESSONS.md`、`CONTRIBUTING.md`。保留的基线来自 `aaa4ea9`，最终逐文件字节与汇总在本地证据 `artifacts/verify-taco/final-byte-report.json`；生成产物、证据、CI 配置与 package 命令字段不混入这个脚本/说明集合。

产物与示例数据单独计量，不参与纯 shell 判断：`dist-single/Taco_Spec.taco.html` 2,853,621 字节，含内嵌文档数据且被 `.gitignore` 忽略；验证生成的 `.taco.html` 与截图/trace 落在 gitignored `artifacts/` 下，证据字节不是产品字节。禁止用含数据的 `dist` 产物判断 shell 体积。

## 设计综合与验证记录

实施拆分为 runner/fixture/helper、浏览与编辑、评论与保存、Checkpoints/变体以及本地 Host 五个互不重叠的文件域；主代理整合 CI、命令、技能文档并统一验证。同一个 PR #153 关联 TACO-81、GitHub #152。

CI 入口（`.github/workflows/ci.yml`，三 job）：`test-and-build` 依次跑 `npm run check` → `npm run test:browser` → `npm run test:verify -- --out artifacts/verify-taco/ci-suite`（51 个 registry 场景，CI 拒绝 filter）→ Bun 构建 CLI → `node .agents/skills/verify-taco/scripts/verify.mjs --scenario .agents/skills/verify-taco/scripts/cli.mjs --out artifacts/verify-taco/ci-cli`（2 个 direct-command CLI 场景）→ `TACO_SMOKE_OUT=artifacts/smoke-toolbox npm run test:toolbox`，随后校验 `extensions/taco/assets/taco-shell.html`、`extensions/taco/templates`、`skills/taco` 无未提交差异，并以 `if: always()` 上传 `artifacts/verify-taco/` 与 `artifacts/smoke-toolbox/`；`host-smoke` 构建 CLI 后跑 `npm run test:host -- --out artifacts/smoke-host/ci`（9 个场景）并 `if: always()` 上传 Host 证据；`spec-kit-extension` 保留 Spec Kit 矩阵。全部不使用 Agent、模型服务或生产凭据。

技能同步直接更新内部 `verify-taco`；安装用 skill 与官网无新增用户能力，本轮无需改动其公开内容。

### 验证结果

以下结论来自实际执行与保留的结果清单，固定场景通过不代表人工边界已经通过。

- 浏览器套件（51 注册）：**51/51 通过**。最终证据 `artifacts/verify-taco/suite-2026-10-14T08-45-42.358Z-6b375975/suite.json`：`ok:true`，registered / selected / executed / passed 均 51，failed 0，`humanBoundaries` 5 条；包括新增原生光标、末段与精确选区断言。中间的 41/51 失败清单保留作为回归红证据。
- 本地工具箱：两轮真实 CLI/浏览器/receipt/refresh 往返通过，原生文末定位和整段选区断言也通过。最终证据目录 `artifacts/smoke-toolbox/final-selection/taco-toolbox-smoke-5NJa0B/` 保留了两轮截图、交接与刷新产物。
- 本地 Host（9 注册）：**9/9 通过**。最终证据 `artifacts/smoke-host/final-selection/summary.json`（`ok:true`，0 failed；浏览器、服务器、端口、CLI 子进程与临时 workspace 均关闭或清理）。清理期信号：旧探针 `artifacts/smoke-host/cleanup-signal-a164f9bc/cleanup-signal-proof.json` 只实证 `summaryRetained: false`（其 `survivingOwnedGroups: []`，不能据此称真实进程遗留）；修复后 `artifacts/smoke-host/cleanup-signal-b5161716/cleanup-signal-proof.json` 为 `summaryRetained: true`、exit code 143、`interrupted: SIGTERM`、资源均关闭。
- Host 总结写入竞态：相同真实信号调度下，修复前 `artifacts/smoke-host/summary-race-before/summary.json` 为 `ok:true`、`interrupted:null`，进程却退出 143；修复后 `summary-race-after/summary.json` 为 `ok:false`、`interrupted:SIGTERM`，与退出 143 一致，9 个产品场景仍全部通过且资源全部关闭。
- 直接 CLI 场景：`cli/pack-extract`、`cli/review-diff-extract` 两项通过。最终证据 `artifacts/verify-taco/2026-10-14T08-45-42.189Z-b2d3b591/result.json`（`ok:true`），完整命令输出在 `cli-commands.json`，产物、截图及 scratch 清理证明均保留。
- 生命周期与原生命中探针：全部符合预期。孤儿 setup 证据 `artifacts/verify-taco/lifecycle-87991ba5/probes.json`（`deadline-500: Unclosed setup: Setup settling timed out after 3000ms`，同时其余资源仍报 closed）；加入 `setupOperation`/`setupCancelled` 竞速后的 `artifacts/verify-taco/lifecycle-ed5e833e/probes.json`（4 项探针组 `ok:true`：3 个 deadline 场景各自 `ok:false`、已获取资源全 closed、端口 closed、trace 在启动时留存）；原生命中探针 `artifacts/verify-taco/caret-6f65dbf3/result.json`（`ok:true`，`cleanup` 全 closed，端口 closed）。
- 技能 frontmatter：`quick_validate.py` 输出 `valid: true`、`errors: []`、`warnings: []`。
- 仓库检查：`npm test` 的 67 个测试文件、788 项测试全部通过，`npm run build` 通过并生成 `dist-single/Taco_Spec.taco.html`。`npm run test:browser` 已在构建产物上通过，实际选择并渲染文件，6 条 warning 保留为告警。
- GitHub CI 的当前提交结论与可下载证据见同一个 [PR #153 的 Checks](https://github.com/Arcadia822/taco/pull/153/checks)。开发完成并通过必要检查后，该 PR 转为 Ready for review。
- 原生富文本定位回归：新增末段断言后，中间套件为 41/51；探针证明 DOM 光标与编辑器选区晚一个任务同步。原生起点→终点移动加有界等待的 A/B 对照为未等待 4/4 失败、等待后 4/4 通过，且末段与精确选区断言保持。代表性证据在 `artifacts/verify-taco/ab-1-*`、`val4-*`、`val5-1` 和 `valsrc*`；失败套件完整保留。
- 交付样例 `tmp/TACO-81-verification.taco.html` 已通过真实浏览器验证（`artifacts/verify-taco/2026-10-14T08-49-38.515Z-273032f1/result.json`，`ok:true`、全部资源关闭）。其 15 个 fixture 文件涵盖多格式、评论与 Checkpoints；载体逐字节匹配本次生成的 Complete shell，保留原有 `docId`、navigation 与 Checkpoints。另有 145 个已跟踪的安装 skill、扩展镜像与 Host 文件逐字节匹配改动前基线，确认无产品发布或官网内容变化。
