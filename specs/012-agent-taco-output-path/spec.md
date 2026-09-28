---
title: '012-agent-taco-output-path'
feature_id: '012-agent-taco-output-path'
created: '2026-09-28'
status: 'Draft'
issue: 'https://github.com/Arcadia822/taco/issues/39'
linear: 'https://linear.app/castrel/issue/TACO-9'
input: |-
  TACO-9: 规范 Agent 自主生成 Taco 文件的目标路径决策与存放目录机制
---

## 1. 背景与问题

Agent 自主创建 `.taco.html` 时，落盘位置没有规范：产物经常落在当前工作目录的根，或被 `.gitignore` 忽略的临时目录里，事后无法检索；Spec Kit 扩展另有 `<FEATURE_DIR>/<feature>.taco.html` 约定，但它只存在于扩展文档中，通用 skill 的 Agent 读不到；"模板/示例所在目录"也常被误当成产物应写回的位置。

同一动作在不同会话落在不同位置，落点不可预期、不可事后归档。

## 2. 目标与非目标

### 2.1 目标

1. **确定性的产出位置级联**：工程项目、普通文档目录、仓库根打包、非仓库个人场景都能推出唯一目标路径，并给出可核对的依据。
2. **项目级规则**：项目用 `.taco/config.yaml` 声明输出目录；已安装扩展的项目由扩展既有约定覆盖；两者不一致时明确拒绝。
3. **零外部依赖的落盘**：创建/修改 Taco 不需要脚本、CLI 或运行时；Agent 直接写 `.taco.html` 的 `#taco-document` 数据块。skill 只提供引导与最佳实践。
4. 划清三条互不影响的边界：**产物位置**、**bundle 内部引用**（`root`、`files[].path`、Checkpoint 文档路径）、**模板/示例来源位置**。

### 2.2 非目标

- 不改变 `taco/files` v1 的字段与语义；不规定 `root` 与内部引用路径的合法性判定（属 `references/bundle-format.md`）。
- 不规定序列化与转义算法（同上）；但 `references/bundle-format.md` 的"脚本优先/工具独占写入/无浏览器必跑脚本"表述属于本次要收敛的范围（§7）。
- 不新增脚本、不新增 CLI 能力、不引入云端行为。
- 不自动创建或修改项目配置，不自动修改 `.gitignore`，不自动迁移或删除既有 Taco。
- 不在本设计内删除 `pack.mjs`（是否删除属独立范围，见 §10.2）。

## 3. 零外部依赖的约束（硬约束）

用户明确要求：**创建与修改 Taco 时不依赖任何外部依赖**；**skill 只是引导与最佳实践**；**Agent 直接修改 Taco 文件本体**（`.taco.html`）。

因此设计固定两件事：

1. **落盘方式**：读入既有文件与 shell 到内存 → 构造并校验完整 bundle → 创建父目录（若需要）→ 写同目录临时文件 → 原子 `rename`。全程只写 `#taco-document` 数据块与 `<title>`，文件其余字节不动。不调用脚本、不调用 `taco-cli`、不调用扩展 CLI。
2. **校验方式**：写前自校验是落盘前提（对将写入的字符串解析并核对形态规则）；宿主没有解析能力则**停止**（`unverifiable`），不写文件。写后用校验阶梯声明结果：V1 打开标签页跑 `window.taco.validate()`；V2 仅解析核对并声明"未做运行校验"。**不得**把 V2 表述成 V1。

与仓库现状的关系（如实记录，并在实现阶段一并收敛）：

- `AGENTS.md` 已写 "Data-block-only editing is the supported workflow; the CLI is not required"，与本约束一致。
- `skills/taco/SKILL.md` 的开篇、bundle 写入规则、`## Workflow`、校验与报告章节，以及 `docs/agent-installation.md` 的 Assemble 步骤，当前都以 `node scripts/pack.mjs` 为主流程——**与本约束冲突**。
- 本设计把"把这些章节改为直接写数据块的默认流程"纳入实现范围（见 §7 与 `tasks.md`）；`pack.mjs` 若保留，只能标注为**完全可选**的辅助，且不得成为创建、刷新或校验的必经路径。是否删除该文件不在本设计内处置（§10.2）。

## 4. 产出位置级联

### 4.1 优先级总表

| 级别 | 条件 | 产物 |
| --- | --- | --- |
| L0 | 用户本次显式给出输出位置 | 见 4.2 |
| L1 | 本次是刷新既有 `.taco.html` | 该文件现有路径 |
| LR | **被打包目录就是仓库根**（L0、L1 未命中时） | `<repo>/tacos/` |
| L2 | 项目规则成立（`.taco/config.yaml` 的 `outputDir`，或已装扩展） | 规则目录 |
| L3 | 仓库内存在 `docs/`、`doc/`、`documents/`、`specs/` | 首个存在者之下的 `tacos/` |
| L4 | 是仓库但没有上述目录 | `<repo>/tacos/` |
| L5 | 不在任何仓库内 | `~/Documents/tacos/` |

顺序固定，取第一个可用级；目录名统一小写 `tacos`（含个人归档 `~/Documents/tacos/`，Windows 为 `%USERPROFILE%\Documents\tacos`）。

**LR：仓库根打包是独立级别，跳过 L2 与 L3。** 被打包目录就是仓库根时，`{feature}` 无意义、扩展约定不成立，"仓库内存在 `docs/`/`specs/`"的探测也与打包整个仓库无关，因此项目规则与目录探测都不适用，直接落 `<repo>/tacos/`。L0 与 L1 仍然优先。这样同一输入只有一个结果，即使仓库内存在 `docs/`。

### 4.2 L0：用户显式指定

- **目录形态** → 产物 = `<该目录>/<标题的归一化文件名>`。
- **文件形态**（以 `.taco.html` 结尾，且文件名 stem **已是规范形式**）→ 产物 = 该文件，且该 stem 就是 bundle 标题（文件名决定标题）。
- 其余形态拒绝：非 `.taco.html` 的文件路径；`.taco.html` 但 stem 非规范形式（例如 `My Design.taco.html`——标题若取 `My Design`，运行时会把它归一成 `My_Design.taco.html`，于是"用户给的名字"与"浏览器保存的名字"不一致）。拒绝时给出规范文件名建议，**不静默改写用户给的路径**。
- 用户可给绝对路径。
- **禁区优先**：落在 skill 目录、扩展目录、模板目录、`node_modules/`、`.git/` 之内一律拒绝。

文件名与标题的对应：文件名 stem = 标题的归一化结果（NFKC → 非字母数字下划线连字符替换为 `_` → 折叠并裁剪 `_`/`-` → 空值回退 `Untitled`）。二者互为唯一对应。

### 4.3 L2：项目规则

**S1 配置文件**（`.taco/config.yaml`，仓库根）

```yaml
version: 1
outputDir: specs/{feature}
```

- 语法、约束与失败语义见契约 §2；`{feature}` 替换为被打包目录（DOC_DIR）的 basename，至多一次；basename 不可移植（反斜杠、NUL、尾随空格/点、Windows 保留名）→ `needs_feature`，停止。
- 文件或 `.taco/` 目录不存在 → 无规则；顶层非 mapping、解析失败、重复键、缺 `outputDir`、`version` ≠ 1、符号链接 → 停止（`malformed`）。
- 配置被 `.gitignore` 命中 → 报告 `config-untracked`（本机配置无法共享）。
- Agent 只在用户显式要求时创建或修改该文件。

**S2 已安装的扩展**

- 成立条件：存在 `.specify/extensions/taco/assets/taco-shell.html`（仅 lite shell 时只在刷新既有 Lite Taco 时成立）。
- 规则值：被打包目录（DOC_DIR）本身。
- S1 与 S2 指向同一目录 → 取该目录；不同 → `conflict`，停止并列出两个来源。
- 仅存在 `.specify/` 而未装扩展 → 不产生规则。

### 4.4 仓库识别与上下文

- **仓库识别不依赖 git 命令**：从被打包目录（缺省 cwd）向上查找 `.git/` 目录，或内容形如 `gitdir: <路径>` 的 `.git` 文件（worktree/submodule）；找到即仓库根，到文件系统根仍未找到 → 不在仓库内（L5）。
- `git` 命令只服务可选的忽略检查；命令缺失 → `gitignore-unavailable` 告警，**不改变**仓库判定，也不把"命令不可用"当成"不在仓库内"。
- 判定为 L5 而目录有工程标志（`package.json`、`pyproject.toml` 等）→ 附 `workspaceRoot-not-git` 告警，仍按 L5。
- 个人归档 = `HOME ?? USERPROFILE` 下的 `Documents/tacos`；两者皆缺失 → `needs_home`，停止，不落到 cwd。

### 4.5 报告与告警

落盘前给出可核对的结论，并在报告里写明：命中级别与依据、产物绝对路径、文件名、标题、校验阶梯级别（V1/V2）与结果，以及 `gitignored`、`config-untracked`、`gitignore-unavailable`、`workspaceRoot-not-git`、`output-in-input` 告警与排除项清单。失败（`malformed`/`conflict`/`needs_feature`/`needs_home`/`forbidden`）一律不落盘。

## 5. 刷新、迁移与首次创建

- **落盘顺序固定**：定目标 → 读入内存（既有文件的数据块与所选 shell）→ 占用判定 → 构造新 bundle → 转义并对将写入的字符串自校验 → 创建父目录 → 同目录临时文件 + 原子 `rename` → 校验与报告。**不得**先把 shell 复制到目标路径（那会在校验失败时破坏既有 Taco，且新父目录不存在时直接失败）。
- **刷新（L1）**：保留 `docId`、`comments`、`navigation`、`checkpoints`（含状态）、每个 file 的 `id`、未知字段；标题保留既有 bundle 的值，若目标文件名 stem 与其归一化结果不一致则报告冲突并停止；`blocks` 仅在**该文件新旧内容字节完全相同**时保留，内容变化即丢弃并由运行时重建；`sourceHash` 随内容变化重算。
- **迁移（仅用户显式要求）**：占用预检早于任何写操作。目标已存在即**默认停止**——即使 `docId` 与来源相同，目标也可能是同一 review 的另一个副本并已独立推进评审状态。只有用户显式授权覆盖、且 Agent 已把目标与来源的状态差异列在报告里，才继续。之后按固定顺序落盘、校验 `docId` 与 `comments`/`checkpoints`/`navigation` 逐字段一致，并报告新旧路径；不删除旧文件，除非用户显式要求。
- **首次创建**：父目录不存在则先创建；变体新建默认 Complete，用户显式要求或接收者可靠联网可用 Lite，刷新沿用既有 `taco-shell-variant`；所需 shell 不存在则停止并给出路径，不换变体顶替。
- **产物与被打包集合互斥**：打包时排除所有 `*.taco.html`；若 `outputDir` 解析结果等于被打包目录，落盘后报 `output-in-input` 告警。
- **幂等**：相同输入 → 相同产物目录、文件名与标题。

## 6. 关键决策与取舍

| 决策 | 理由 | 代价 |
| --- | --- | --- |
| 项目规则放 `.taco/config.yaml` | 与项目级配置的直觉一致，不侵入 Agent 指令文件，与 TACO-34 提案的 `.taco/` 家族同族 | 多一个文件与一套 YAML 失败语义（重复键、非 mapping、版本不符都要定义） |
| 零外部依赖，落盘 = 直接写数据块 | 用户硬要求；与 `AGENTS.md` 的 "Data-block-only editing" 一致 | 序列化与转义风险回到 Agent 一侧；必须把 SKILL.md 与安装指南的主流程一并改写（范围比"加一节"大） |
| 校验阶梯 V1/V2 | 无脚本时仍要能自证到什么程度，且必须如实声明级别 | V2 下"解析通过"不等于"界面正确"，只能明示局限 |
| 仓库识别不用 `git` 命令 | 零外部依赖必须自洽；否则无 git 的沙箱会被误判为个人场景 | 需要处理 `.git` 文件（worktree/submodule）形态 |
| 刷新优先于项目规则 | 项目规则变化不得静默搬走正在评审的 Taco | 迁移必须显式，且要新增"目标已存在即默认拒绝"的占用规则 |
| 文件名决定标题，且文件名须是规范形式 | 用户决策（4）+ 保存流程的命名不变量；拒绝非规范名可避免"用户给的名字"被浏览器保存改写 | 显式指定 `My Design.taco.html` 这类名字会被拒绝，需给出规范名建议 |
| L0 不适用于仓库根的规则例外 | 决策 6（落 `<repo>/tacos/`）与 L2 的自有配置冲突，必须让同一输入只有一个结果 | 需要在契约里显式声明例外优先级 |
| 不新增"个人/跨项目"级别 | 用户决策：只按仓库上下文判定 | 在仓库内处理个人文档时，用户必须显式给路径（L0） |
| 不新增自动化测试 | 本特性无代码产物；对文档措辞做源文本断言不构成有效覆盖 | 验收依赖可复现的人工走查记录（§8），确定性弱于自动化测试 |

## 7. 受影响组件

| 组件 | 变更 |
| --- | --- |
| `skills/taco/references/output-path.md`（新增） | **权威契约**（由 `contracts/output-path-rule.md` 译为英文迁入；安装可见） |
| `skills/taco/SKILL.md` | 新增 `## Where to write .taco.html`；并把开篇、bundle 写入规则、`## Workflow`、校验（`### 2`）与报告章节改为**直接写数据块**为默认流程；`pack.mjs` 若提及，只作完全可选的辅助 |
| `skills/taco/references/bundle-format.md` | 删除"assembler 拥有载体 / 写块是工具工作 / 无浏览器必须跑脚本"的表述，改为同等的安全写入规则 + 写前自校验 + V1/V2 阶梯；保留序列化、转义、原子替换与形态规则；明确与 `output-path.md` 的职责边界 |
| `docs/agent-installation.md` | Assemble 步骤改为直接写数据块；reference 清单补 `output-path.md`；补一句"产物目录由级联决定" |
| `.taco/config.yaml`（本仓库，新增） | `version: 1` + `outputDir: specs/{feature}` |
| `extensions/taco/commands/update.md` | 一句：扩展项目 ⇒ 产物在 feature 目录（契约中的 S2），可选链接 |
| `extensions/taco/skills/taco-speckit/SKILL.md` | 同上，一行 |
| `extensions/taco/README.md` | 同上，一行 |
| `specs/012-*/contracts/output-path-rule.md` | 实现后降级为指针文件 |

不涉及：`src/`、`packages/**`、模板镜像（`skills/taco/templates/` 是生成产物，不手改）。

## 8. 验证方案

本特性没有代码产物，**不新增自动化测试**。验证分三层，且必须留下**可复现记录**（输入目录、前/后绝对路径、失败码、数据块读取与状态比对结果）。

### 8.1 文档一致性（人工）

级联顺序与级别命名、仓库根例外、失败类型集合、小写 `tacos`、校验阶梯、落盘顺序，在 `spec.md`、`contracts/output-path-rule.md`、`SKILL.md`、`references/output-path.md` 中一致；全仓库只有一份完整语法表与失败语义表；落盘步骤中不出现脚本/CLI 调用为必经路径。

### 8.2 五类验收场景（TACO-9 评论要求，逐项记录两组结果）

每项同时核对 **(a) 产物位置** 与 **(b) bundle 内部引用**（`root` 与各 `path`）：

| 场景 | 构造 | 期望 |
| --- | --- | --- |
| 用户指定输出位置 | 用户说"生成到 `./tmp/roguelike-tactics-game.taco.html`" | 产物即该文件；bundle 标题 = `roguelike-tactics-game`；`root` 仍为被评审目录 |
| 项目自定义模板/CP 位置 | 项目在 `review/policy/` 放模板，`.taco/config.yaml` 声明 `outputDir: review/tacos` | 产物在 `review/tacos`；模板位置不变、未被复制 |
| 无 CP 的普通文档 | `notes/` 目录，无 Checkpoints | 产物按级联落位；bundle 顶层无 `checkpoints` |
| 仅参考 SDD 示例的新 Taco | 参考 `templates/spec/`，DOC_DIR = `specs/012-agent-taco-output-path` | 产物不在模板目录；Checkpoint 文档 path 以实际 `root` 为前缀 |
| 原路径原状态刷新 | 修改 canonical 文档后重刷新既有 Taco | 路径、标题与 `root` 不变；`docId`/`comments`/`navigation`/`checkpoints` 保留；内容更新且 `blocks` 按内容是否变化处理 |

### 8.3 逐分支走查（每个分支一条记录）

必须实测并记录：配置缺 `outputDir`、`version: 2`、顶层非 mapping、重复键；S1 与 S2 冲突；仓库根打包（叠加 S1 存在时也落 `<repo>/tacos/`）；`--requested` 非规范文件名（拒绝并给规范名）；DOC_DIR 等于仓库根的级联结果；L3 的 `docs` 优先于 `specs`；L4；L5（`HOME` 缺失时停止）；无 `git` 命令时仍能识别仓库；禁区目标；产物与被打包目录相同（`output-in-input`）；迁移到不存在的父目录；迁移目标已存在（默认停止，授权后覆盖并报告状态差异）；内容变化后 `blocks` 被丢弃。

### 8.4 回归

`npm test` 与 `npm run check` 通过。这两项只作为**回归防护**（`tests/agent-instructions.test.ts` 的分类键断言、`tests/templates.test.ts` 的镜像与空 shell 断言），**不作为**级联或手写数据块正确性的证明。

## 9. 风险

| 风险 | 处置 |
| --- | --- |
| 无脚本后序列化/转义/保留字段全靠书面契约，Agent 可能出错 | 落盘顺序写成可照做的七步；自校验步骤强制对**将写入的字符串**解析；权威规则指向 `references/bundle-format.md` |
| `SKILL.md` 与安装指南当前以 `pack.mjs` 为主流程 | 纳入实现范围一并改写（§7）；`pack.mjs` 只作完全可选的辅助 |
| V2 下"解析通过"被误当成"界面正确" | 报告必须写明阶梯级别；V2 必须写"未做运行校验"。宿主连解析能力都没有时不落盘（`unverifiable`），不存在未验证产物 |
| 仓库根打包时 bundle `root` 的合法性 | 归落盘流程按 `references/bundle-format.md` 处理，不在本设计内；产物位置由仓库根例外唯一确定 |
| 配置被 gitignore，队友/CI 得到不同路径 | `config-untracked` 告警；不自动改 `.gitignore` |
| L3 探测在 `docs/` 与 `specs/` 并存时给出非预期结果 | 官方覆盖手段是 `.taco/config.yaml`；报告打印命中级与探测依据 |

## 10. 已确认决策与待决项

### 10.1 已确认（用户决策，按此实现）

1. 项目规则载体：`.taco/config.yaml`（不用 AGENTS.md 单行键）。
2. 不采纳确定性解析脚本；级联是纯文档规则。
3. L3 探测顺序：`docs` → `doc` → `documents` → `specs`。
4. L0 文件形态：文件名决定标题（bundle 标题 = 文件名 stem）；本设计补充约束：stem 必须是规范形式，否则拒绝并给出规范名建议。
5. 不新增"个人/跨项目"级别，只按仓库上下文判定。
6. 被打包目录是仓库根时不停止，产物落 `<repo>/tacos/`；本设计把它实现为 L2 的显式例外，以保证同一输入只有一个结果。
7. 目录名全小写：`docs/tacos/`、`<repo>/tacos/`、`~/Documents/tacos/`。
8. 本仓库自我声明：`.taco/config.yaml` 写 `outputDir: specs/{feature}`。
9. 交付节奏：先落设计，确认后再实现。
10. 零外部依赖：创建/修改 Taco 不依赖脚本、CLI 或运行时；Agent 直接写数据块；skill 只做引导。本设计据此把 `SKILL.md` 与安装指南的主流程改写纳入实现范围。
11. 校验采用 V1/V2 阶梯并如实声明级别；写前自校验是落盘前提，无解析能力时停止（`unverifiable`），不写未验证产物。

### 10.2 待决项

1. **pack.mjs 是否删除**：本设计要求把它从必经路径中移出（只作完全可选的辅助）。是否连同 `tests/skill-pack.test.ts` 一并删除，需要用户定；不删也不影响本设计的验收。
2. `extensions/taco/` 侧是否也统一到 `.taco/config.yaml`（当前设计中扩展只被承认为 S2）。
