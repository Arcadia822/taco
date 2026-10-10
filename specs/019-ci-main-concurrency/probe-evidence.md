---
title: TACO-63 并发取消实测原始记录
status: Completed
date: '2026-10-10'
author: omp
---

## 1. 测什么

`cancel-in-progress` 在 GitHub 上的三个行为，全部用真实运行测量，不引用文档：

1. `true` 时，同组新运行是否杀掉**正在运行**的运行。
2. `false` 时，同组新运行是否放过**正在运行**的运行。
3. `false` 时，**队列中**的运行与更新的运行相遇会怎样。

## 2. 测试面 A：taco 仓库探针分支

分支 `probe/ci-concurrency`（测量后已删除，其提交未进入 main）。两个工作流除 `cancel-in-progress` 外完全相同：

```yaml
name: Probe concurrency true
on:
  push:
    branches: [probe/ci-concurrency]
concurrency:
  group: probe-true
  cancel-in-progress: true
jobs:
  hold:
    runs-on: ubuntu-latest
    steps:
      - run: echo "run ${{ github.run_id }} started"; sleep 45; echo "run ${{ github.run_id }} survived"
```

第二个文件同形，`group: probe-false`、`cancel-in-progress: false`。三次推送的提交为 `861c5cf`（08:16:58）、`6e43b70`（08:17:15，+17s）、`5c5cde7`（08:17:33，+18s）。

| 工作流 | run id | 提交 | 事件时间 | 完成时间 | 结论 |
| --- | --- | --- | --- | --- | --- |
| probe-true | 38037335702 | `861c5cf` | 08:16:58 | 08:17:31 | cancelled |
| probe-true | 38037353201 | `6e43b70` | 08:17:15 | 08:17:49 | cancelled |
| probe-true | 38037368820 | `5c5cde7` | 08:17:33 | 08:18:40 | success |
| probe-false | 38037335708 | `861c5cf` | 08:16:58 | 08:17:48 | success |
| probe-false | 38037353185 | `6e43b70` | 08:17:15 | 08:17:34 | cancelled |
| probe-false | 38037368840 | `5c5cde7` | 08:17:33 | 08:18:39 | success |

读法：`true` 下每个新运行都杀掉了前一个；`false` 下最先启动的运行跑满 50 秒拿到 success，而队列中的 `6e43b70` 在 `5c5cde7` 到达后 1 秒被取消。

## 3. 测试面 B：默认分支名恰好是 main 的一次性仓库

taco 仓库自身的 main 分支无法在合并前触发修复后的工作流，因此用一次性私有仓库 `Arcadia822/taco-ci-probe`（默认分支 `main`，测量后已删除）载入**修复所用的同一表达式**：

```yaml
name: CI
on:
  push:
    branches: [main, side]
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
jobs:
  hold:
    runs-on: ubuntu-latest
    steps:
      - run: echo "ref=${{ github.ref }} run=${{ github.run_id }}"; sleep 45
```

| 分支 | run id | 事件时间 | 完成时间 | 结论 |
| --- | --- | --- | --- | --- |
| main（第 1 次推送，08:21:04） | 38037569695 | 08:21:04 | 08:21:54 | success |
| main（第 2 次推送，08:21:21，+17s） | 38037585492 | 08:21:21 | 08:22:45 | success |
| side（第 1 次推送，08:21:48） | 38037612138 | 08:21:48 | 08:22:24 | cancelled |
| side（第 2 次推送，08:22:09，+21s） | 38037631392 | 08:22:09 | 08:23:14 | success |

两次 main 推送都拿到结论，且先后串行完成（08:21:54、08:22:45）。`github.ref` 的实际取值取自运行日志：main 分支为 `refs/heads/main`，side 分支为 `refs/heads/side`。

## 4. 复现方式

1. 在任意分支落两个探针工作流（同组、同 job，只有 `cancel-in-progress` 不同，job 中含 45 秒 `sleep`）。
2. 三次推送，间隔约 18 秒。
3. `gh run list --workflow=<file> --limit 5 --json databaseId,headSha,status,conclusion,createdAt,updatedAt` 读结论。
4. 验证表达式本体时，需要一个默认分支名为 `main` 的仓库，才能让 `github.ref` 取到 `refs/heads/main`；用分支名与 main 不同的仓库无法测到 `false` 这一侧。

`gh run view <id> --log` 会打印 `ref=<值>`，用于确认表达式两个操作数的实际取值。
