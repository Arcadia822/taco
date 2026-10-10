---
title: main 分支的 CI 结论不可被取消（TACO-63）
status: Implementing
date: '2026-10-10'
author: omp
---

## 1. 问题与证据

`.github/workflows/ci.yml` 的 `concurrency.cancel-in-progress` 为 `true`，对 workflow 覆盖的所有 ref 生效。两次 main 推送间隔小于一次运行时长时，后一次推送会取消前一次正在运行的 CI。

被取消的实例（`gh run list --workflow=ci.yml`，各次均为 `push` 到 main，conclusion `cancelled`）：

| 运行提交 | 时间 (UTC) | 下一提交 | 突发类型 |
| --- | --- | --- | --- |
| `f0fae0e` | 10-02 07:55:03 | `fa5d036`（取消） | 3 连击之首 |
| `fa5d036` | 10-02 07:55:06 | `e6eacb6`（成功） | 3 连击之中 |
| `9569c41` | 10-02 08:31:26 | `7b87ad7`（成功） | 2 连击之首 |
| `9995e99e` | 10-02 14:48:36 | `0db62bb`（成功） | 2 连击之首 |
| `be44b192` | 10-04 14:47:10 | `7db923f`（成功） | 2 连击之首 |
| `42c03604` | 10-05 02:38:55 | `b3deff9`（成功） | 2 连击之首 |
| `846db285` | 10-09 15:22:37 | `438d084`（成功） | 2 连击之首 |

在 10-02 至 10-09 区间内，main 分支共有 22 次 push 触发的 CI 运行，其中 7 次被取消。包含 4 次 2 连击以及 1 次 3 连击（10-02 07:55）。

影响止于结论缺失，不构成验证缺口：main 线性推进，后续提交的运行覆盖累计状态（被取消的提交均为后续成功运行的祖先提交）。

## 2. 前提审查

任务原始前提（TACO-62 借鉴 Magpie 的做法）：main 的绿构建信号是发版的依赖，被取消会让发版失去就绪信号。逐项核对：

| 假设 | 证据 | 结论 |
| --- | --- | --- |
| main 有必需状态检查 | `gh api repos/Arcadia822/taco/branches/main/protection` → 404 `Branch not protected`；`.../rulesets` → `[]` | 不成立 |
| 有工作流消费 CI 结论 | 四个工作流内无 `workflow_run`，无 `gh run` 查询 | 不成立 |
| 发版等待 main 的绿运行 | `nightly-release.yml` 自行执行 `npm run check` 后提交并打标；`deploy-tacobin.yml` 轮询生产 `/deploy.json` 自证生效 | 不成立 |

结论：本仓库没有 CI 门禁的发版链路，因此本修复交付的不是「发版就绪信号」，而是**每个落到 main 的提交都留下结论记录**（审计、排查「某提交是否验证过」）。修复范围按修正后的目标取最小。

## 3. 决策与备选

采用：`cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`。

| 方案 | 表述 | 取舍 |
| --- | --- | --- |
| 条件取消（采用） | `github.ref != 'refs/heads/main'` | PR 与后续新增的分支推送仍取消；main 运行不被打断 |
| 仅 PR 取消 | `github.event_name == 'pull_request'` | 与触发器列表耦合；日后新增 push 分支时静默失去取消 |
| 每提交独立并发组 | `group: ...-${{ github.ref == 'refs/heads/main' && github.sha \|\| github.ref }}` | main 上完全不取消、每提交必有结论，代价是突发推送时并发运行数不设上限 |
| 维持 `true` | 现状 | 接受 main 上的结论缺失 |

选择条件取消而非每提交独立组：历史 5 次突发中，4 次为 2 连击，条件取消可完全覆盖这 4 次的结论保留；对于偶发的 3 连击（历史上 10-02 出现过 1 次），条件取消依然能保护首个运行跑完并给最新提交结论，仅中间待运行会被取消。相较于每提交独立组带来的突发并发数无上限风险，当前方案为最合理的工程折中。
## 4. 改动

`.github/workflows/ci.yml`：`concurrency` 块的 `cancel-in-progress` 改为条件表达式，并加注释说明原因、证据与残留局限。无其他文件改动。

## 5. 验证证据

同一表达式在两种 ref 形态下的实测（详见 [probe-evidence.md](probe-evidence.md)）：

| 测试面 | `github.ref` | `cancel-in-progress` | 突发 | 结果 |
| --- | --- | --- | --- | --- |
| 一次性仓库 main（2 连击，间隔 17s） | `refs/heads/main` | `false` | 2 次推送 | `success`、`success`（两次都拿到结论） |
| 一次性仓库 side 分支（间隔 21s） | `refs/heads/side` | `true` | 2 次推送 | `cancelled`、`success` |
| taco 仓库探针分支，`cancel-in-progress: true` | `refs/heads/probe/ci-concurrency` | `true` | 3 次推送，间隔 18s | `cancelled`、`cancelled`、`success` |
| taco 仓库探针分支，`cancel-in-progress: false` | 同上 | `false` | 3 次推送，间隔 18s | `success`、`cancelled`（队列中）、`success` |

`ref=refs/heads/main` 与 `ref=refs/heads/side` 取自运行日志中 `github.ref` 的实际打印值，不是推断。

静态校验：`actionlint 1.7.12` 对四个工作流零告警；`prettier --check` 通过（`.github` 在 `format:check` 范围内）。

## 6. 体积与依赖影响

估算（prepare）：`.github/workflows/ci.yml` 增加约 350 字节（注释 + 表达式）；交付产物（`skills/taco/`、Complete/Lite shell、`dist-single/`、扩展 zip、`.taco.html`）0 字节；无新增依赖，无新增联网行为。

实测（develop）：`ci.yml` 2,615 → 2,954 字节（+339 字节，+13.0%）；交付产物 0 字节。与预估 350 B 相比偏差为 -11 B。实测方式为字节比较与 diff 路径核对：`git diff --name-only main` 中不含 `skills/taco`、`dist-single`、`extensions`、`src`、`scripts`、`packages` 任一路径，因此 shell 与 skill 产物字节不变。
阈值判定：AGENTS.md 的 ≥1% 或 ≥32KB 告知阈值针对 shell 产物；本次未触及任何 shell 或 skill 文件，不触发告知阈值。

发版影响：`check-changes.mjs` 的组件路径不含 `.github/` 与 `specs/`，本次改动不触发任何组件发版。

## 7. 残留局限与后续

- 3 连击以上仍会丢结论：实测中 `6e43b70` 的运行于 08:17:34 被取消，距 `5c5cde7` 到达仅 1 秒。`cancel-in-progress: false` 只保护已经在运行的运行，队列中只保留最新的一个待运行。
- 未新增常驻守卫：把该策略固化为 `scripts/` 下的检查会让 `taco` 组件进入发版判定（`scripts` 在组件路径内），为一个 CI 策略触发版本发布不划算。该策略第二次被改错时再按结构固化。
- 若日后要求「main 上每个提交必有结论」，升级路径为第 3 节的每提交独立并发组，而不是继续加条件。
