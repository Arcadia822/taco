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

1. **确定性的产出位置级联**：工程项目、普通文档目录、非项目个人场景都能推出唯一目标路径，并给出可核对的依据。
2. **项目级规则**：项目用 `.taco/config.yaml` 声明输出目录；已安装扩展的项目由扩展既有约定覆盖；两者不一致时明确拒绝。
3. **零外部依赖的落盘**：创建/修改 Taco 不需要脚本、CLI 或运行时；Agent 直接写 `.taco.html` 的 `#taco-document` 数据块。skill 只提供引导与最佳实践。
4. 划清三条互不影响的边界：**产物位置**、**bundle 内部引用**（`root`、`files[].path`、Checkpoint 文档路径）、**模板/示例来源位置**。

### 2.2 非目标

- 不改变 `taco/files` v1 的字段与语义；不规定 `root` 与内部引用路径的合法性判定（属 `references/bundle-format.md`）。
- 不规定序列化、转义、原子替换的实现细节（同上）。
- 不新增脚本、不新增 CLI 能力、不引入云端行为。
- 不自动创建或修改项目配置，不自动修改 `.gitignore`，不自动迁移或删除既有 Taco。
- 不规定打包工具链的取舍（见 §9 的开放性说明）。

## 3. 零外部依赖的约束（本设计的硬约束）

用户明确要求：**创建与修改 Taco 时不依赖任何外部依赖**；**skill 只是引导与最佳实践**；**Agent 直接修改 Taco 文件本体**（`.taco.html`）。

因此本设计的落盘方式固定为：

- 产物 = 复制技能自带的 shell（或既有 Taco）到目标路径 → 把 `taco/files` v1 bundle JSON 写进 `#taco-document` 数据块 → 按标题写 `<title>`；文件其余字节不动。
- 不调用脚本（不需要 Node）、不调用 `taco-cli`、不调用扩展 CLI。
- 序列化与安全的权威是 `skills/taco/references/bundle-format.md`；本设计不复制这些规则。
- 校验：有评审标签时用运行时 `window.taco.validate()`；否则按 `references/bundle-format.md` 检查数据块可解析且满足必需字段。

与仓库现状的关系（如实记录）：

- `AGENTS.md` 已经写明 "Data-block-only editing is the supported workflow; the CLI is not required"，与本约束一致。
- `skills/taco/SKILL.md:132` 当前写 "Prefer `scripts/pack.mjs`"，`docs/agent-installation.md` 的装配步骤也以该脚本为入口，与本约束**不一致**。该不一致的处置（移除、降级为可选校验工具，或保留但改写文档）属于独立决策，不在本设计内单方面修改；本设计只保证自己的落盘流程与验证方案不依赖它。

## 4. 产出位置级联

### 4.1 优先级总表

| 级别 | 条件 | 产物 |
| --- | --- | --- |
| L0 | 用户本次显式给出输出位置 | 见 4.2 |
| L1 | 本次是刷新既有 `.taco.html` | 该文件现有路径 |
| L2 | 项目规则成立（`.taco/config.yaml` 的 `outputDir`，或已安装扩展） | 规则目录 |
| L3 | 仓库内存在 `docs/`、`doc/`、`documents/`、`specs/` | 首个存在者之下的 `tacos/` |
| L4 | 是 git 仓库但没有上述目录 | `<repo>/tacos/` |
| L5 | 非 git 上下文 | `~/Documents/tacos/` |

顺序固定，取第一个可用级；目录名统一小写 `tacos`（含个人归档 `~/Documents/tacos/`，Windows 为 `%USERPROFILE%\Documents\tacos`）。

### 4.2 L0：用户显式指定

- **目录形态** → 产物 = `<该目录>/<标题的归一化文件名>`。
- **文件形态**（以 `.taco.html` 结尾）→ 产物 = 该文件，且**该文件名 stem 就是 bundle 标题**（文件名决定标题）；与之前给过的标题冲突时以文件名 stem 为准并报告。
- 其他形态（非 `.taco.html` 的文件路径）→ 拒绝，提示改为目录或 `.taco.html`。
- 用户可给绝对路径。
- **禁区优先**：落在 skill 目录、扩展目录、模板目录、`node_modules/`、`.git/` 之内一律拒绝。

文件名与标题的对应：文件名 stem = 标题的归一化结果（NFKC → 非字母数字下划线连字符替换为 `_` → 折叠并裁剪 `_`/`-` → 空值回退 `Untitled`）。二者互为唯一对应，不存在"文件名与标题不一致"的合法状态。

### 4.3 L2：项目规则

**S1 配置文件**（`.taco/config.yaml`，仓库根）

```yaml
version: 1
outputDir: specs/{feature}
```

- 语法、约束与失败语义见契约 §2；`{feature}` 替换为被打包目录（DOC_DIR）的 basename，至多一次。
- 文件不存在 → 无规则；YAML 解析失败、存在但缺 `outputDir`、`.taco/` 或 `config.yaml` 是符号链接 → 停止（不猜测）。
- Agent 只在用户显式要求时创建或修改该文件。

**S2 已安装的扩展**

- 成立条件：存在 `.specify/extensions/taco/assets/taco-shell.html`（仅 lite shell 时只在刷新既有 Lite Taco 时成立）。
- 规则值：被打包目录（DOC_DIR）本身。
- S1 与 S2 指向同一目录 → 取该目录；指向不同目录 → 冲突，停止并列出两个来源。
- 仅存在 `.specify/` 而未装扩展 → 不产生规则，继续 L3/L4/L5。
- S2 只是承认扩展既有约定；扩展可独立安装、自包含，不依赖本契约。

### 4.4 上下文判定

- `workspaceRoot` = 对 DOC_DIR（缺省 cwd）执行 `git rev-parse --show-toplevel`；DOC_DIR 是子目录时以其顶层为仓库根并校验包含关系。
- 解析不到仓库根 → L5；若 DOC_DIR/cwd 有工程标志（`package.json`、`pyproject.toml` 等）则附 `workspaceRoot-not-git` 告警，仍按 L5。
- 个人归档 = `HOME ?? USERPROFILE` 下的 `Documents/tacos`；两者皆缺失 → `needs_home`，停止，不落到 cwd。
- **DOC_DIR 就是仓库根**时不特殊停止：产物按级联取 `<repo>/tacos/`。被打包内容的 `root` 合法性由落盘流程负责（见 §9 风险）。

### 4.5 报告与告警

落盘前给出可核对的结论并在报告里写明：命中级别与依据（用户指令 / 既有文件 / `.taco/config.yaml` / 扩展安装 / 探测到的目录）、产物绝对路径、文件名、标题，以及 `gitignored`（产物被忽略 → 报告"不纳入版本控制"，仍落盘，**不改** `.gitignore`）、`git-unavailable`、`workspaceRoot-not-git`。失败一律不落盘。

## 5. 刷新、迁移与首次创建

- **刷新（L1）**：路径不变；`docId`、`comments`、`navigation`、`checkpoints`（含文档状态）、每个 file 的 `id` 与 `blocks` 缓存、未知字段全部保留；只替换本次意图变更的字段。
- **迁移（仅用户显式要求）**：占用预检 → 创建目标父目录 → 复制旧文件到新路径 → 在新路径按刷新语义落盘 → 校验 `docId` 与 `comments`/`checkpoints`/`navigation` 逐字段一致 → 报告新旧路径。**预检必须早于复制**：目标已存在且 `docId` ≠ 旧文件 → 停止，不建目录、不复制。不删除旧文件，除非用户显式要求。
- **首次创建**：目标父目录可能不存在，先创建目录再写文件。
- **占用规则**：产物已存在且不是本次刷新对象、也不是本次迁移来源 → 停止并报告。
- **幂等**：相同输入 → 相同产物目录、文件名与标题。

## 6. 关键决策与取舍

| 决策 | 理由 | 代价 |
| --- | --- | --- |
| 项目规则放 `.taco/config.yaml`（而非在 AGENTS.md 里写单行键） | 与项目级配置的直觉一致；不侵入 Agent 指令文件；与 TACO-34 提案的 `.taco/checkpoints.json` 同族 | 多一个文件与一次 YAML 解析；需要定义缺 `outputDir`/版本不符的失败语义 |
| 零外部依赖，落盘 = 直接写数据块 | 用户硬要求；与 `AGENTS.md` 的 "Data-block-only editing" 一致；Agent 在任何 host 都能做 | 序列化与转义风险回到 Agent 一侧，只能靠 `references/bundle-format.md` 的书面契约约束；本设计无法用自动化测试覆盖落盘正确性 |
| 不采纳确定性解析脚本 | 同上（脚本本身就是外部依赖） | 级联分支（规则冲突、`{feature}`、占用预检）只能靠文档与人工走查保证一致，验收从"测试可复现"降为"文档一致 + 场景走查" |
| 刷新优先于项目规则 | 项目规则变化不得静默搬走正在评审的 Taco | 迁移必须显式；需要占用预检 |
| **文件名决定标题**（L0 文件形态） | 用户决策：文件名是权威，标题取该文件名 stem | 用户先前指定的标题会被文件名改写；需在报告里明说 |
| 目录名全小写 `tacos` | 用户决策；跨 Linux/CI 更稳 | 与 TACO-9 原文的 `Tacos/` 不一致，需在 issue 回复说明 |
| 不新增"个人文档"级别 | 用户决策：只按 git 上下文判定 | 在 git 仓库里处理个人/跨项目文档时，用户必须显式给路径（L0）才能避开项目规则 |
| DOC_DIR = 仓库根时不停止 | 级联只回答"产物放哪"；此时取 `<repo>/tacos/`，被打包内容的 `root` 问题归落盘流程 | 整仓库打包时 `root` 的合法性不在本设计覆盖内（见 §8 风险） |

## 7. 受影响组件

| 组件 | 变更 |
| --- | --- |
| `skills/taco/references/output-path.md`（新增） | **权威契约**（由 `contracts/output-path-rule.md` 译为英文迁入；安装可见） |
| `skills/taco/SKILL.md` | 新增 `## Where to write .taco.html`：级联摘要 + 落盘步骤（复制 shell → 写数据块 → 写标题）+ 报告与告警清单 |
| `docs/agent-installation.md` | reference 清单补 `output-path.md`；"Use the skill" 步骤补一句（产物目录由级联决定、不再默认写 cwd） |
| `.taco/config.yaml`（本仓库，新增） | `version: 1` + `outputDir: specs/{feature}` |
| `extensions/taco/commands/update.md` | 一句：扩展项目 ⇒ 产物在 feature 目录（契约中的 S2），可选链接 |
| `extensions/taco/skills/taco-speckit/SKILL.md` | 同上，一行 |
| `extensions/taco/README.md` | 同上，一行 |
| `specs/012-*/contracts/output-path-rule.md` | 实现后降级为指针文件 |

不涉及：`skills/taco/scripts/**`（本设计不新增脚本）、`src/`、`packages/**`。

## 8. 验证方案

本特性没有代码产物，**不新增自动化测试**。验证由三部分组成，全部如实记录：

### 8.1 文档一致性检查（人工）

1. 级联顺序、级别命名（L0–L5）、失败类型（`malformed` / `conflict` / `needs_feature` / `needs_home` / `forbidden`）、`tacos` 小写与个人归档路径，在 `spec.md`、`contracts/output-path-rule.md`、`SKILL.md`、`references/output-path.md` 中一致。
2. 全仓库只有一份完整语法表与失败语义表（其余位置只做摘要 + 链接）。
3. 落盘步骤中不出现任何脚本/CLI 调用。

### 8.2 五类场景走查（每个场景同时检查产物位置与 bundle `root`/内部引用）

| 场景 | 构造 | 期望 |
| --- | --- | --- |
| 用户指定输出位置 | 用户说"生成到 `./tmp/roguelike-tactics-game.taco.html`" | 产物即该文件，bundle 标题为 `roguelike-tactics-game`；`root` 仍为被评审目录 |
| 项目自定义模板/CP 位置 | 项目在 `review/policy/` 放模板，`.taco/config.yaml` 声明 `outputDir: review/tacos` | 产物在 `review/tacos`；模板位置不变、未被复制进项目 |
| 无 CP 的普通文档 | `notes/` 目录，无 Checkpoints | 产物按级联落位；bundle 顶层无 `checkpoints` |
| 仅参考 SDD 示例的新 Taco | 参考 `templates/spec/`，DOC_DIR = `specs/012-agent-taco-output-path` | 产物不在模板目录；Checkpoint 文档 path 以实际 `root` 为前缀 |
| 原路径原状态刷新 | 修改 canonical 文档后重刷新既有 Taco | 路径与 `root` 不变，`docId`/`comments`/`navigation`/`checkpoints` 状态保留 |

### 8.3 迁移与占用（真实文件系统）

- 迁移到不存在的父目录：建目录 → 复制 → 落盘 → 校验 `docId` 与状态逐字段一致；旧文件仍在。
- 目标已有不同 `docId` 的 Taco：预检即停止，目标文件字节未变，未创建目录。

### 8.4 回归

`npm test` 与 `npm run check` 通过（本设计不改代码，用于确认仓库既有测试与构建未被牵动）。

## 9. 风险

| 风险 | 处置 |
| --- | --- |
| 无脚本后，序列化/转义/保留字段全靠书面契约，Agent 可能出错 | 落盘步骤在 SKILL.md 中写成可照做的顺序，并明确"其余字节不动"；权威规则指向 `references/bundle-format.md`；报告要求回显级联依据，便于事后核对 |
| `SKILL.md:132` 与 `docs/agent-installation.md` 目前以 `pack.mjs` 为主流程，与本约束矛盾 | 本设计不单方面改它；在交付报告中列为待决项，请用户选择处置方向（见 §10） |
| DOC_DIR 就是仓库根时，整仓库打包的 `root` 合法性不在本设计覆盖内 | 契约 §4.2 明确该问题归落盘流程；本设计只保证产物落到 `<repo>/tacos/` |
| L3 探测在同时存在 `docs/` 与 `specs/` 的仓库里给出"看起来对但不是项目想要"的结果 | 官方覆盖手段是 `.taco/config.yaml`；报告必须打印命中级与探测依据 |
| 产物落在被忽略目录 | 报告 `gitignored` 告警，不改 `.gitignore` |

## 10. 已确认决策与待决项

### 10.1 已确认（用户决策，按此实现）

1. 项目规则载体：**项目配置文件名** `.taco/config.yaml`（不用 AGENTS.md 单行键）。
2. **不采纳**确定性解析脚本；级联是纯文档规则。
3. L3 探测顺序：`docs` → `doc` → `documents` → `specs`。
4. L0 文件形态：**文件名决定标题**（bundle 标题 = 用户给的文件名 stem）。
5. **不新增**"个人/跨项目"级别，只按 git 上下文判定。
6. DOC_DIR = 仓库根时**不停止**，产物取 `<repo>/tacos/`。
7. 目录名**全小写**：`docs/tacos/`、`<repo>/tacos/`、`~/Documents/tacos/`。
8. 本仓库**自我声明**：`.taco/config.yaml` 写 `outputDir: specs/{feature}`。
9. 交付节奏：先落设计，确认后再实现（skill 改动不提前落盘）。
10. 落盘**零外部依赖**：Agent 直接写 `.taco.html` 的 `#taco-document` 数据块；skill 只做引导。

### 10.2 待决项（不在本设计内单方面处理）

1. **pack.mjs 的处置**：现状（`80a4899` 引入、`SKILL.md:132` 与 `docs/agent-installation.md` 以其为主流程）与决策 10 矛盾；可选方向：移除、降级为可选的校验工具并改写文档、或按 GitHub #59 的首选改为旁挂形态（`<name>.taco/` + `bundle.json` + 真实文件）。需要用户定方向后另开范围处理。
2. `extensions/taco/` 侧是否也统一到 `.taco/config.yaml`（当前设计中扩展只被承认为 S2）。
3. 级联是否需要在 `SKILL.md` 之外再做机器可读的自我校验（当前设计选择了"不引入脚本"）。
