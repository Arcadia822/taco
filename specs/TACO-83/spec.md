---
title: "TACO-83：紧邻标点的评论锚点定位修复"
status: "实施中"
issue: "https://linear.app/castrel/issue/TACO-83/factory-e2eservice-live-20261015-b4d9-live3-fixcomments"
---

## 结论与范围

仅修复 `src/comment-position.ts` 的 Markdown 可见文本投影及必要行为回归。实际实现中 `isDelimiterSyntax` 只判断标记两侧是否为空白，导致 `The **spec**.`、`(**spec**)`、行内代码紧邻冒号等合法标记残留，渲染面捕获的跨标记引用不能映射回源码。直接源码匹配仍优先，投影必须保留 UTF-16 源位置映射，不变更评论协议、Handoff 协议或 UI。

## 方案与验证

按 CommonMark 的 Unicode 空白、标点及左右 flanking 判断强调标记；保留下划线单词内约束。行内代码应遵循成对等长反引号，不把其内容当强调或转义语法。保留字面量标点与无效标记。沿用已有定位、行号与评论行为测试，不增加依赖或联网行为。

验收使用提供的 `test_comment_anchor_punctuation.mjs`，另运行相关行为回归、仓库 checks 和生产构建。在构建的 Complete 产物上通过真实划词、评论、Handoff、保存与重新打开验证，留存截图、剪贴板文本和结构化结果。检查 installable skill 与 Host 关联：生产 shell 须由构建同步；若 Host 仅共享定位实现且无独立协议/说明变化，不修改官网内容。

## prepare：体积与依赖预算

基线提交：`9540e98d004685f1e5c2acdbddc150745467404b`。实现前测量（2026-10-15）：

| 口径 | 改动前字节 | 预计增量 |
| --- | ---: | ---: |
| Complete 空文档 skill shell | 2,740,554 | +2,048（约 0.075%） |
| Lite 空文档 skill shell | 191,340 | +2,048（约 1.070%） |
| skill 目录常规文件内容之和（45 文件） | 19,652,706 | +4,096 |
| skill 目录 `du -sb`（含目录项） | 19,693,666 | +4,096 |
| Complete `.taco.html` | 构建后单列文档数据 | shell 约 +2,048；默认文档数据预计 +0 |
| extension 镜像 / CLI 发布 shell | 由构建生成 | 与对应变体同量级，不重复计算 shell 阈值 |

不新增依赖、联网、字体或资源。Lite 估算相对增长可能超过 1%，交付时明确报告实测数字及原因；不以含文档的产物总量代替纯 shell 测量。

## develop：实测与验证

最终实现已通过格式检查、20 条 lessons 校验、67 个文件的 822 项测试，以及 `npm run build`（含 TypeScript 和 Complete / Lite / Host shell gate）。相关 143 项行为测试单独通过，最终生产浏览器烟测通过。实际构建与 prepare 对比如下：

| 口径 | 估算增量 | 实测结果 | 实测增量 | 相对增长 | 与估算偏差 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Complete skill shell | +2,048 | 2,741,230 | +676 | 0.0247% | -1,372 |
| Lite skill shell | +2,048 | 191,893 | +553 | 0.2890% | -1,495 |
| skill 文件内容之和（45 文件） | +4,096 | 19,657,991 | +5,285 | 0.0269% | +1,189 |
| skill 目录 `du -sb` | +4,096 | 19,698,951 | +5,285 | 0.0268% | +1,189 |

纯 shell 增长低于保守预算；skill 合计包含六份生成模板，故超过初始目录估算。无新增依赖或生产联网。Complete `.taco.html` 为 2,854,297 字节，较基线 2,853,621 增加 676；默认文档数据不变（+0）。两种纯 shell 均未达到 1% / 32 KB 阈值。

审查发现仅 flanking 无法区分未配对字面量，已增加配对与完整 run 处理。尝试复用 `marked` 静态导入后，Lite 离线 gate 拒绝 external import；已删除该方案，保持现有离线边界，仅在本文件实现 Unicode punctuation/flanking、成对标记及等长代码 span。行为回归覆盖未配对星号、长下划线、代码中的字面量、跨行代码与空行段落边界；未修改构建配置或新增联网。

skill 与 Host 关联方案：由原构建同步两个 skill shell、extension / skill 模板、CLI 内置资源、Host shell 和官网 demo，不手改生成文件；不改 skill 流程或官网文案。官网已启动并实际浏览 `http://127.0.0.1:3183/`，截图位于 `artifacts/verify-taco/TACO-83-host-preview.png`。

### 真实行为证据

用户已提供修复前失败观察，未为确认重复运行故障。实现核查证实空白判断无法剥离标点相邻的闭合标记。修复后生产 shell 通过 10 个实际渲染段落的原生键盘划词、评论提交、引用跳转、真实剪贴板 Handoff、未保存修改路径、下载保存与重新打开。完整证据：

- `artifacts/verify-taco/TACO-83-punctuation-final/result.json`：最终实现的真实浏览器结果；同目录保留 doctor、13 steps、页面错误与拥有资源清理结果。
- 同目录 `handoff.txt`：`spec.md` changed path diff、10 条评论对应源码行号 3 / 5 / 7 / 9 / 11 / 13 / 15 / 17 / 19 / 21，无 position lost。
- 同目录 `review.json`、`trace.zip`、`punctuation-comments-handoff.png`、`punctuation-saved-reopened.png`、`TACO-83-reviewed.taco.html`：真实用户操作与保存重开证据。仅 native picker 使用已记录的下载 fallback；不声称验证 listener、OS 打开或模型接收。
- 可交互产物：`/tmp/factory-taco-journey.IfXmXu/worker/dist-single/Taco_Spec.taco.html` 与 `/tmp/factory-taco-journey.IfXmXu/worker/tmp/TACO-83.taco.html`。

### 阻塞与交接

指定命令 `node tests/e2e/acceptance/test_comment_anchor_punctuation.mjs /tmp/factory-taco-journey.IfXmXu/worker` 实际退出 1：`MODULE_NOT_FOUND`。只读搜索 worker、相邻 live / checkout / project 及可访问 `/root`、`/tmp` 等路径均无该文件；未创建替代测试、未修改验收标准。必须由协调者提供真实验收文件并运行后才能将 PR 从 Draft 改 Ready。本次不假报 Ready。
