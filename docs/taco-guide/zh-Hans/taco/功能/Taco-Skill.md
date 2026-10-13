---
title: Taco Skill
status: 已完成
summary: 让 Agent 会写、会刷新、会读评审结果
---

## 是什么

Taco Skill 是面向 Agent 的能力包（`skills/taco/`），配合 `taco-cli` 使用。装上之后，你的 Agent 就知道：

- 何时主动使用 Taco：默认仅在**多文件复杂设计需要人评审拍板**，或**你主动要求**时生成 Taco；日常探索聊天和简单修复直接在对话和代码里完成，不会因为单篇文档较长就打包；
- 怎样把文档目录打包成 `.taco.html`，并通过 `taco-cli open <file.taco.html> --listen`（或 `taco-cli listen`）接收一键 Handoff；
- 怎样读取你的修改和评论、改回仓库源文件，并在不丢评论和身份的前提下原地刷新同一个 Taco。

## 安装

把这句话交给 Agent：

```text
读取 https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md ，按其中步骤安装 Taco skill 与 taco-cli（需要时创建目录）；完成后回复 Installed taco. 并简短说明如何生成一份 Taco。
```

Agent 会按文档同时安装 `taco` skill（优先 `npx skills@latest add arcadia822/taco --skill=taco`，不可用时拷贝 `skills/taco/`）和 `taco-cli`（`@tacobin/cli` 或独立二进制），需要时创建目录。安装指令不会自动打包当前对话方案，也不会修改项目规则或预设默认流程；若安装失败，Agent 会直接报告真实原因，不设计旁路。

## Agent 会做什么

### 生成与刷新

- 复制 skill 自带的 shell，只把文档写进其中的数据块（或使用 `taco-cli pack` / `refresh`），不改动应用本身；
- 刷新时保留文档身份（`docId`）、评论线程、导航和检查点，所以你重新打开的始终是「同一个」Taco；
- 默认排除隐藏文件和其他 `.taco.html`；HTML 源文件（`.html`）打包为沙箱内嵌只读页面，不支持在 HTML 内直接编辑或划词锚定评论。

### 打开给你看

生成后，Agent 会把文件作为可点击的链接给你，宿主允许时直接在浏览器里打开。它会如实说明是「给了链接」「已打开」还是「已打开并验证」，不会把后台检查说成你已经看到了。

### 处理你的评审

- 读取本地监听收到的 Handoff 回执、剪贴板「交接改动」文本，或你保存后的 `.taco.html`；
- 把每条修改和评论对应到源文件；
- 打包后源文件如果又被改过，或某处 diff 无法干净应用，**只报告冲突，不覆盖**；
- 不编造评论，只回复处理结果，**不替你把讨论标成已解决**，等待你确认。

### 遵循项目约定

如果项目里有 `.taco/` 检查点模板，或 `AGENTS.md`、Spec Kit 之类已有的流程约定，Agent 会按它们决定写哪些文档、要不要检查点；没有约定时不强行启用 Checkpoints。小改动不会被套上一整套阶段流程。

### 更新提醒

每个工作会话开始时，skill 会比较自身版本和最新发布版本。有新版本只在回复末尾提一句，不会自行升级。

## 可选：Spec Kit 集成

如果你在用 [GitHub Spec Kit](https://github.com/github/spec-kit)，可以额外安装 Taco 扩展。它会在 specify、plan、tasks 等步骤之后自动刷新每个 feature 的 Taco，并提供 `speckit.taco.review` 导入评审结果，遇到冲突只报告不写入。

```bash
specify extension add taco --from https://github.com/Arcadia822/taco/releases/latest/download/taco-extension.zip
```

这是需要显式请求的项目级接线；不用 Spec Kit 时完全不需要它。

## 边界

- 本地评审可离线运行；团队分享链接和在线评审中继见 [Tacobin](Tacobin.md)。
- 被评审的目录始终是事实来源。Taco 里没有的文件，Agent 不会因此删除仓库里的对应文件。
