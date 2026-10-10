---
title: "TACO-65 单文件浏览器启动冒烟测试"
status: verified
created: 2026-10-10
issue: TACO-65
---

## 目标与验收

CI 在 `npm run check` 构建完成后，用无头 Chromium 打开 `dist-single/Taco_Spec.taco.html`。页面出现未捕获的 JavaScript 异常、内嵌 `taco/files` v1 数据未正确加载、目录未挂载或 Markdown 正文未渲染时，检查必须以非零状态退出。

探针读取真实构建产物，使用页面公开的 `window.taco` API 对照内嵌文件数据，并检查可见目录与正文。验证报告中的 warning 不阻断启动检查，error 阻断检查。所有浏览器等待都有上限，失败后关闭浏览器。

本次只修改开发和 CI 验证。Complete、Lite、Host 的产品运行时、安装流程和 bundle 协议不变。审查时检查 `skills/` 与 `packages/host/` 的适用性，CI 专用验证无需调整两者的内容。

## 设计选择

选择独立 Node ESM 探针 `scripts/smoke-built-shell.mjs`，由 `npm run test:browser` 直接以 headless Chromium 打开真实产物，不使用 Playwright Test runner。理由：单产物启动检查集中在一个脚本，复用仓库既有 `.mjs` 风格与生命周期；runner 会引入测试配置、fixtures 与重试，对单一门禁没有收益。探针只依赖 `playwright` 开发依赖和显式安装的 Chromium。

探针在跳转前订阅 `pageerror`，在跳转后和阅读器挂载后分别断言无未捕获异常。通过 `window.taco` 对照内嵌 `#taco-document`，比较文件路径、`mediaType` 和完整 `content`。侧边栏所选路径必须对应内嵌 Markdown 文件。复用已有 `marked` 解析器，将该文件渲染的文本块与 ProseMirror 阅读区对照，至少一个实际文本块必须一致。最后运行 `validate()`，要求 `ok: true` 且 error 为 0，warning 放行。所有等待都有超时上限，浏览器在 `finally` 中关闭。

本地运行：

```bash
npx playwright install chromium
npm run test:browser
```

探针接受可选的位置参数以指向其他产物路径，用于故障注入验证；不固定文件数量与入口文件名。

## 体积与依赖预算

在实现前读取当前工作树基线。shell 预计增量为 0 字节，未引入产品联网行为。

| 产物 | 当前基线字节 | 预计增量字节 | 实测增量字节 | 偏差与原因 |
| --- | ---: | ---: | ---: | --- |
| Complete `.taco.html` | 2,845,006 | 0 | +1,076 | +0.038%；重建成品数据差异，空文档 shell SHA-256 未变 |
| Lite `.taco.html` | 295,685 | 0 | +1,105 | +0.374%；重建成品数据差异，空文档 shell SHA-256 未变 |
| skill Complete shell | 2,737,618 | 0 | 0 | SHA-256 一致 |
| skill Lite shell | 188,326 | 0 | 0 | SHA-256 一致 |
| `skills/taco/` 全部文件 | 14,091,559 | 0 | 0 | 33 个文件逐个 SHA-256 一致 |
| 扩展发布 zip | 10,638,823 | 0 | 0 | 重建 zip 仍为 44 项；扩展 33 个源文件逐个 SHA-256 一致 |

新增精确版本 `playwright@1.64.0` 开发依赖。registry 查询 `playwright` 与 `playwright-core` 的解包体积合计为 18,689,485 字节；安装后按文件字节求和实测同为 18,689,485 字节，偏差 0。浏览器另行下载，仅发生于开发和 CI。依赖不进入 shell、skill 或产品发布包。源代码与文档预计增加不超过 12 KiB。

测量命令为 `npm run check` 构建后的 `wc -c`、文件字节求和与 SHA-256 对照。扩展包通过 `node scripts/package-extension.mjs --version 0.14.3 --out-dir tmp/taco65-measured-package` 重建。shell 增量均未达到 1% 或 32 KB 阈值。

源代码、lockfile 与文档实测增加 12,595 字节，估算上限 12,288 字节，偏差 +307 字节。文件内容对照与实测记录增加了开发源码体积，这些文件均不进入产品 shell 或扩展发布包。

## 验证记录

实现前通过真实 Chromium 观察当前产物。目录与 Markdown 正文已渲染，公开 API 返回 14 个文件，`validate()` 返回 `ok: true`、0 个 error 和 7 个 warning。当前入口为 `checklists/implementation.md`。探针不固定文件数量或入口名称。

`npm run check` 通过格式检查、54 个测试文件中的 614 个测试、TypeScript 编译与 Complete、Lite、Host 构建。`npm run test:browser` 在重建成品上通过，读取 14 个文件并验证所选文档的实际渲染文本，允许 7 个链接 warning。真实 Chromium 截图确认目录与阅读区渲染。

对成品副本分别注入非法 JSON、未捕获的启动异常、隐藏阅读器、隐藏目录，四个 Node 探针均以状态 1 退出。非法 JSON 与异常触发断言；未渲染的核心 DOM 触发 15 秒超时。故障副本在验证后删除。

最终审查删除了自写 ATX 标题解析器和 6 行说明性注释。使用仅含加粗段落、没有标题的合法 Markdown 副本验证，探针以状态 0 退出；四种故障副本在修正后再次以状态 1 退出。
