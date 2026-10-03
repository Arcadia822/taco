---
title: Tacobin
status: 已完成
summary: 分享链接与在线评审中继，配合 taco-cli 使用
---

## 是什么

本地 Taco 适合一个人和自己的 Agent。当评审者不在你的电脑旁——同事、产品、外部合作方——就需要 Tacobin：

- Agent 把 Taco 发布到 Tacobin，得到一个**分享链接**；
- 评审者打开链接，在网页里编辑和评论，内容**自动保存**；
- 评审者点「交接」，正在监听的 Agent 立刻收到通知，取回这一轮的完整结果。

`taco-cli` 是 Agent 这一侧连接 Tacobin 的命令行工具。人不需要安装它；本地评审也用不到它。

## 评审者看到什么

- 和本地 Taco 一样的阅读、编辑、评论界面；
- 第一次评论时填一个名字（自报，无需注册）；
- 改动实时自动保存。保存失败可以重试；遇到冲突时保留你的草稿，确认放弃后才加载最新版本；
- 页头的重叠头像显示当前有哪些人和 Agent 在线，点开可以看完整的监听名单；
- 「保存」按钮仍然可用，用来另存一份本地 Taco。

## 最重要的一条：交接要显式点击

**评论和自动保存都不等于交接，不会唤醒 Agent。** 只有评审者确认这一轮看完、点击「交接」，Tacobin 才会记录一次 `review.handed_off` 事件，Agent 才开始处理。

- 点「交接」时如果没有 Agent 在监听，Tacobin 不会产生交接，而是显示安装 skill、安装 CLI、开始订阅的命令；
- 头像显示在线，只表示 Agent 在监听，不代表你的意见已经被读到或处理。

## taco-cli

安装：

```bash
npm install -g @tacobin/cli
```

Agent 常用的命令：

| 命令 | 作用 |
| --- | --- |
| `taco-cli publish <file.taco.html> --host <origin> --dry-run` | 本地预检：列出将要公开的文件和大小，不发任何请求 |
| `taco-cli publish <file.taco.html> --host <origin>` | 发布，返回给评审者的 `url` 和后续使用的 `tacoId` |
| `taco-cli subscribe <tacoId> --host <origin>` | 等待交接：忽略普通评论和编辑，收到 `review.handed_off` 后退出 |
| `taco-cli subscribe <tacoId> --stream` | 持续接收全部事件 |
| `taco-cli handoff <tacoId> <handoffId> --host <origin>` | 读取这次交接的不可变快照 |
| `taco-cli events <tacoId> --after <sequence>` | 监听中断后补读事件；没人监听时发生的交接也能找回 |

每次发布都会固定一份不可变的基线；改正后的文件需要重新发布，得到一个新的 Taco。

## 安全

- 发布前先用 `--dry-run` 核对要公开的内容；
- 匿名发布会自动签发访问凭据，Agent 会先把它安全保存再上传正文；
- 启用在线协作的 Taco 文件可能携带访问凭据，未经允许不要转发到其他服务、日志或工单里。

## 边界

- Tacobin 不是事实来源。仓库里的文件仍然是权威版本，Tacobin 只承载这一轮评审；
- 发布本身不会修改你的本地文件；
- 目前不支持在线覆盖已发布的版本、私有托管和账号登录。
