---
title: Taco Skill
status: 已完成
summary: 让 Agent 会写、会刷新、会读评审结果
---

## 是什么

Taco Skill 是一个 Agent 能力包（`skills/taco/`）。装上之后，你的 Agent 就知道：

- 怎样把一个文档目录打包成 Taco；
- 怎样在不丢评论的前提下刷新同一个 Taco；
- 怎样读取你的修改和评论，改回仓库里的源文件。

**安装 skill 就是完整安装。** 它自带生产 shell、参考文档和脚本，不需要 npm 包、CLI 或任何构建，离线可用。

## 安装

把这句话交给 Agent：

```text
阅读 https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md ，按其中步骤为我安装 Taco；安装完成后，向我介绍 Taco 怎么用。
```

或者自己执行：

```bash
npx skills@latest add arcadia822/taco --skill=taco
```

`npx skills` 不可用时，直接把 `skills/taco/` 目录拷到 Agent 的 skills 目录也可以。

## Agent 会做什么

### 生成与刷新

- 复制 skill 自带的 shell，只把文档写进其中的数据块，不改动应用本身；
- 刷新时保留文档身份（`docId`）、评论线程、导航和检查点，所以你重新打开的始终是「同一个」Taco；
- 默认排除隐藏文件和其他 `.taco.html`，拒绝普通 HTML 源文件。

### 打开给你看

生成后，Agent 会把文件作为可点击的链接给你，宿主允许时直接在浏览器里打开。它会如实说明是「给了链接」「已打开」还是「已打开并验证」，不会把后台检查说成你已经看到了。

### 处理你的评审

- 读取「交接改动」的文本，或你保存后的 `.taco.html`；
- 把每条修改和评论对应到源文件；
- 打包后源文件如果又被改过，或某处 diff 无法干净应用，**只报告冲突，不覆盖**；
- 不编造评论，不替你把讨论标成已解决。

### 遵循项目约定

如果项目里有 `.taco/` 检查点模板，或 `AGENTS.md`、Spec Kit 之类已有的流程约定，Agent 会按它们决定写哪些文档、要不要检查点。小改动不会被套上一整套阶段流程。

### 更新提醒

每个工作会话开始时，skill 会比较自身版本和最新发布版本。有新版本只在回复末尾提一句，不会自行升级。

## 可选：Spec Kit 集成

如果你在用 [GitHub Spec Kit](https://github.com/github/spec-kit)，可以额外安装 Taco 扩展。它会在 specify、plan、tasks 等步骤之后自动刷新每个 feature 的 Taco，并提供 `speckit.taco.review` 导入评审结果，遇到冲突只报告不写入。

```bash
specify extension add taco --from https://github.com/Arcadia822/taco/releases/latest/download/taco-extension.zip
```

这是需要显式请求的项目级接线；不用 Spec Kit 时完全不需要它。

## 边界

- skill 只负责本地文件；分享链接和在线评审需要 [Tacobin](03-Tacobin.md)。
- 被评审的目录始终是事实来源。Taco 里没有的文件，Agent 不会因此删除仓库里的对应文件。
