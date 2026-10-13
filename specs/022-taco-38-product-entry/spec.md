---
title: "TACO-38：统一产品定位、Agent 安装入口与指南自身演示"
feature_id: TACO-38
status: in_progress
---

## 范围与已确认决策

1. **首屏定位与入口**：
   - 中文主标语：`跟 Agent 把设计过清楚，不费力。`
   - 中文辅助说明：`清晰易读、便于版本管理、支持一键 Handoff 的单文件设计评审工作区。`
   - 英文采用自然等义表达，不夸大质量或效率数字；同步更新 `packages/host/src/app/layout.tsx` 页面标题、描述与 OpenGraph/Twitter 元数据。
   - 首屏仅保留 `For Agent` 安装指令，移除首屏 `Skill` 安装命令框。英文指令：`Fetch https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md and follow it to install the Taco skill and taco-cli, creating the directories if needed. Then reply Installed taco. plus a short summary of how to make a Taco.`

2. **安装模型与默认触发边界**：
   - 默认安装同时包含 `taco` skill 与 `taco-cli`（需要时创建目录）；Spec Kit 扩展仍仅在用户显式要求时安装。安装指令不自动打包当前对话方案，不改写项目规则或预设默认流程。安装失败如实报告原因，不设计旁路。
   - 安装成功后回复 `Installed taco.`，先说明 Taco 基本能力，再说明默认使用范围：仅在多文件复杂设计需要人评审拍板，或用户主动要求时使用 Taco；日常探索聊天与简单修复不打包，不因单篇文档长度触发；内嵌 `.html` 单页为沙箱只读展示，不宣称其可直接编辑或支持 HTML 原文锚点评论。
   - `taco-configure`（TACO-79）与本地 CLI 代存（TACO-80）尚未实现，不写为可用功能，不预设配置项。

3. **第二屏指南自身演示与进阶能力顺序**：
   - 保持现有「点击 Handoff → `AgentTerminal` 回放 → 切换 `after` iframe」交互，将演示内容替换为 Taco 指南自身（`taco-guide.taco.html` 与 `after/taco-guide.taco.html`），在指南《概览》（`Overview.md`）新增一段关于默认使用边界的说明。
   - 演示评论保持 `open`，Agent 回复后等待人类确认，移除终端中旧的 `• Resolved comment` 与强制 `• Checkpoint` 步骤，清理旧 `008-taco-host-contract.taco.html` 宿主演示副本。
   - 官网进阶能力按 **Checkpoints 第一、Tacobin 第二、Spec Kit 第三** 排列；CLI 不作为面向人的独立功能章节或首屏/章节安装框，仅保留在 Agent 安装与使用说明中。

4. **文档与生成链同步**：
   - `docs/taco-guide/build.mjs` 成为唯一生成器：每语言只 `pack` 一次，克隆 bundle 派生 `after` 版本，重算被改文件的 `sha256`、删除 `blocks` 缓存、按修改后文本重新解析评论锚点，并保持评论 `status: "open"`、不改动 Checkpoints；`package.json` 的 `build` 直接调用该脚本，删除旧的 `scripts/refresh-host-demo.mjs` 壳替换逻辑与 4 个无源 `008` 宿主演示副本（`specs/008-taco-host-contract/` 的 CLI 测试 fixture 不动）。
   - 同步 `README.md`、`README.zh-CN.md`、`specs/001-taco-bento-product/README.md`（镜像）、`docs/agent-installation.md`、`docs/taco-guide/{zh-Hans,en}/taco/**`、`skills/taco/SKILL.md`、`skills/taco/references/reviewing.md`、`extensions/taco/README.md`。

## 体积与依赖预算

改动前同口径基线（记录于 `tmp/taco-38-baseline.txt`）：
- `skills/taco/taco-shell.html`（Complete 纯 shell）：2,740,554 B
- `skills/taco/taco-shell-lite.html`（Lite 纯 shell）：191,340 B
- `dist-single/Taco_Spec.taco.html`（Complete 默认产物）：2,853,111 B
- `skills/taco/` 递归文件总字节：19,649,749 B（其中 `SKILL.md` 48,907 B，`references/reviewing.md` 9,306 B）
- 项目文档：`docs/agent-installation.md` 18,983 B，`README.md` 18,731 B，`README.zh-CN.md` 16,971 B，`specs/001-taco-bento-product/README.md` 17,466 B
- `packages/host/public/demo/` 递归文件总字节：16,577,335 B（含 4 个旧 `008` Complete HTML 与 2 个 `taco-guide` Complete HTML，共 6 个文件）

| 产物 | prepare 预计增量 | develop 实测增量 | 偏差原因 |
| --- | ---: | ---: | --- |
| Complete skill shell (`skills/taco/taco-shell.html`) | 0 B | **0 B**（2,740,554 → 2,740,554 B） | 未修改浏览器 shell runtime |
| Lite skill shell (`skills/taco/taco-shell-lite.html`) | 0 B | **0 B**（191,340 → 191,340 B） | 同上 |
| Complete `.taco.html` (`dist-single/Taco_Spec.taco.html`) | +1,500 B | **+514 B**（2,853,111 → 2,853,625 B） | README 镜像数据变化及序列化转义，较估算少 986 B |
| `skills/taco/` 递归文件总字节 | +1,200 B | **+2,957 B**（19,649,749 → 19,652,706 B） | 安装契约与默认触发规则、评审和 Checkpoint references 同步，较估算多 1,757 B |
| 文档：`README.md` / `README.zh-CN.md` / `specs/001` 镜像 / `docs/agent-installation.md` | +2,500 B | **+362 B**（63,151 → 63,513 B：README −770、中文 README −762、镜像 +495、安装文档 +1,399） | README 删去旧 CLI 专属段落、改为精确口径后净减；安装文档因新增「双组件安装 + 首用契约」增大 |
| 文档：`docs/taco-guide/**` 源文件 | +2,000 B | **+3,857 B**（47,205 → 51,062 B，16 个文件） | 超出预估 1,857 B：开篇定位改写、双语文档补装/首用契约、交接渠道与只读 HTML 说明、Lite 体积数字校正 |
| 生成脚本：`docs/taco-guide/build.mjs`（改写）与 `scripts/refresh-host-demo.mjs`（删除） | — | **+717 B**（build.mjs +2,507、refresh-host-demo.mjs −1,790） | before/after 单一生成器取代旧的 008 壳替换逻辑，旧入口连同其代码一起删除 |
| `packages/host/public/demo/` 递归文件总字节 | −5,460,000 B | **−5,449,698 B**（16,577,335 → 11,127,637 B） | 删除 4 个旧演示，增加 2 个指南 after 版本，较估算多 10,302 B |
| 官网源文件（`packages/host/src/`：page/layout/agent-terminal） | — | **−1,184 B**（62,811+7,393+3,819 → 62,317+7,173+3,349） | 首屏 Skill 行、人向 CLI 章节与终端旧步骤移除，终端文案改为 locale 数据驱动 |

最终构建实测纯 shell 两个变体均增长 **0 B**，未触及 1% / 32 KB 告知阈值。文档与演示数据增长不计入纯 shell。引入 **0 个新依赖、0 项新产品联网行为**，沿用既有安装下载行为。

实测命令为 `npm run check`，其构建链生成 Shell、CLI 内嵌资产和双语指南。字节数使用文件 `stat.size`，目录按递归文件字节合计，比较本轮保留的改动前基线。

## 生成物与构建口径（交给主 Agent 执行）

本需求只改源文件；以下生成物必须由 `npm run build` 重建后提交，否则 CI 的「Verify committed build artifacts」与 `format:check`/测试会拦住：

| 生成物 | 变化原因 | 预期 |
| --- | --- | --- |
| `packages/host/public/demo/<locale>/taco-guide.taco.html` | 指南源文件更新（新定位、安装口径、Lite 体积） | 内容更新 |
| `packages/host/public/demo/<locale>/after/taco-guide.taco.html` | 新增：Agent 已改完的演示状态 | 新文件 |
| `packages/host/public/demo/<locale>[/after]/008-taco-host-contract.taco.html` | 旧演示入口 | 已删除，不再生成 |
| `extensions/taco/assets/taco-shell.html`、`packages/host/assets/taco-shell.html` | 内嵌默认 bundle 含 `specs/001-taco-bento-product/README.md`（镜像同步后 +495 B，另加 `<` 转义开销） | 各约 +520 B |
| `packages/cli/src/generated/assets.ts` | 内嵌 `skills/taco/SKILL.md` 与 `references/**` | 约 +2,115 B |
| `skills/taco/taco-shell.html`、`skills/taco/taco-shell-lite.html`、`extensions/taco/assets/taco-shell-lite.html` | 空数据块纯 shell，runtime 未改 | 预期与基线逐字节一致（Lite 资产同理） |
| `dist-single/Taco_Spec.taco.html`（gitignored） | 默认 bundle 内容变化 | 仅本地构建产物 |

验证命令：`npm run build` → `npm run check` → `npm run test:browser`，随后 `git status --porcelain --untracked-files=all -- extensions/taco/assets/taco-shell.html extensions/taco/templates skills/taco` 应为空。
