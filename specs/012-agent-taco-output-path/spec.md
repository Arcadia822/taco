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

Agent 自主创建 `.taco.html` 时，落盘位置目前没有规范。实际表现：

- `skills/taco/scripts/pack.mjs:783` 的 `--out` 默认值是 `<DOC_DIR>/<Title>.taco.html`。当 Agent 把当前工作目录当作 `DOC_DIR` 时，产物落在仓库根，污染根目录；当产物落在 `tmp/`、`artifacts/` 之类被 `.gitignore` 忽略的目录时，又容易被静默丢弃，事后无法检索。
- Spec Kit 扩展有另一套约定（`<FEATURE_DIR>/<feature-name>.taco.html`，见 `extensions/taco/commands/update.md:23-24`），但它只存在于扩展文档里：已安装扩展但未写任何规则的项目，通用 skill 的 Agent 读不到这条约定，会落到别处。
- "模板/示例所在目录"有时被误当成"产物应写回的位置"。

结果是同一个动作在不同会话里落在不同位置，且落点不可预期、不可事后归档。

## 2. 目标与非目标

### 2.1 目标

1. 定义**确定性的输出路径决策级联**，Agent 在工程项目、普通文档目录、非项目个人上下文、以及"人在仓库里处理个人文档"的情形都能推导出唯一的 `.taco.html` 目标路径，并给出可核对的依据。
2. 提供**机器可读的项目级规则**：显式声明 `taco-output-dir`，或由"实际安装了 Spec Kit 扩展"这一事实合成等价规则；两者并存且不一致时明确拒绝。
3. 在同一份契约里划清三条互不影响的边界：**产物落盘位置**、**bundle `root` 与内部引用路径**、**模板/示例来源位置**。
4. 给出可执行的验证方案（含 TACO-9 要求的五类场景），使规则可复核、可测试，而不是依赖 Agent 自觉。

### 2.2 非目标

- 不改变 `taco/files` v1 bundle 的数据结构，也不改 `root`、`files[].path`、Checkpoint 文档路径的语义。
- 不改变 `pack.mjs` 的 `--out`/`--root` 语义与默认值；本设计只在"选择参数"之前补上决策环节。
- 不新增 `taco-cli` 能力，不引入云端/托管相关行为。
- 不自动修改 `.gitignore`、不自动创建项目模板、不自动迁移或删除既有 Taco。
- 不强制 Spec Kit 扩展安装：级联在普通仓库同样成立。
- 不支持把整个仓库根当作 `DOC_DIR` 打包（受 `pack.mjs` 的 `root` 约束限制，见 3.6）。

## 3. 输出路径决策级联

### 3.1 优先级总表

从高到低，取第一个可用级：

| 级别 | 条件 | 目标 | 备注 |
| --- | --- | --- | --- |
| L0 | 用户本次请求中显式给出输出位置 | 目录 → `<该目录>/<Title 归一化 stem>.taco.html`；文件 → 该文件（stem 必须已与标题一致） | 见 3.2；禁区优先于 L0 |
| L1 | 本次是**刷新既有 Taco** | 该 Taco 现有路径 | 用户显式要求迁移时才改；未要求则忽略 LP–L5 |
| LP | 明确本次文档属于个人或跨项目 | `~/Documents/Tacos/` | 见 3.3；与用户指令同级 |
| L2 | 项目规则成立（显式声明，或实际安装了 Spec Kit 扩展） | 规则目录 | 见 3.4 |
| L3 | 仓库内存在文档目录 `docs/`、`doc/`、`documents/`、`specs/` | 第一个存在者之下的 `Tacos/` | 顺序固定，不按修改时间挑 |
| L4 | 是 git 仓库但没有上述文档目录 | `<repo>/Tacos/` | 不新建空的 `docs/` |
| L5 | 非 git 上下文 | `~/Documents/Tacos/` | Windows 用 `%USERPROFILE%\Documents\Tacos` |

文件名固定为 `<portableTitleBase(title)>.taco.html`。该归一化与 `pack.mjs:64-69` 同算法（NFKC → 非字母数字下划线连字符替换为 `_` → 裁剪 `_`/`-` → 空值回退 `Untitled`）；`pack.mjs:838-841` 会强制文件名 stem 与标题一致，因此**目标文件 = 目标目录 + 标题**，二者不可各自决定。`title` 的缺省回退也须与 `pack.mjs:836` 一致：`--title ?? 既有 bundle title ?? portableTitleBase(root)`，且**未给标题时不得传空字符串**（传入 `''` 会得到 stem `Untitled`，与省略不同）。

### 3.2 L0：用户显式指定

- 接受**目录**，或**文件名 stem 已等于标题归一化结果的 `.taco.html` 文件路径**。
- 其他形态（非 `.taco.html` 的文件路径、stem 与标题不一致）在解析阶段即拒绝，并提示"改标题或改请求路径"。理由：`pack.mjs` 会以 `Taco title requires filename …` 失败，必须前置拦截而不是让用户撞错误。
- 用户可给绝对路径。
- **禁区优先**：落在 skill 目录、extension 目录、模板目录、`node_modules/`、`.git/` 之内的目标一律拒绝，无论谁指定。

### 3.3 LP：明确的个人/跨项目文档

在 git 仓库里处理一份明确的个人或跨项目文档时，必须能不走项目规则。触发输入是显式的：会话中用户说明，或 CLI `--personal`。

LP 位于 L2 之前（`L0 > L1 > LP > L2 > L3 > L4`），理由：它是用户指令级别的意图声明，不应被项目规则或目录探测改道。

### 3.4 L2：项目规则的两个来源

| 来源 | 产生条件 | 规则值 |
| --- | --- | --- |
| S1 显式声明 | `AGENTS.md` / `CLAUDE.md` / `.cursorrules` 中有 `taco-output-dir:`（语法见契约） | 声明的值，其中 `{feature}` 替换为 `basename(DOC_DIR)` |
| S2 扩展约定 | 见下表"实际安装"判定 | 本次被打包目录的仓库相对路径 |

**S2 的"实际安装"判定**（与 `extensions/taco/commands/update.md:17` 对齐）：

| 本次操作 | 成立条件 |
| --- | --- |
| 新建 Taco | 存在 `.specify/extensions/taco/assets/taco-shell.html` |
| 刷新既有 Taco | `taco-shell.html` 或 `taco-shell-lite.html` 至少其一存在，且与既有 Taco 的 shell 变体一致 |

只有 lite shell 时**新建不构成 S2**：扩展的新建流程本身会因缺少 Complete shell 而停止（`update.md:17`），此时继续通用级联并在报告中说明原因。

- 两者都成立且解析后指向同一目录 → 取该目录。
- 两者都成立但指向不同目录 → 冲突，停止并列出两个来源（不静默择一）。
- 仅存在 `.specify/`（已初始化 Spec Kit 但未安装 Taco 扩展）→ **不产生规则**，继续 L3/L4/L5。不得因为 `.specify/` 的存在而改变输出落点。
- 规则文件本身是符号链接 → 拒绝（与 `extensions/taco/bin/taco.mjs` 的 `readPolicyFile` 同策略）。

`{feature}` 的取值 = **本次被打包目录（DOC_DIR）的 basename**（`docDirRel` 只用于 S2 的目录值）。含 `{feature}` 但 DOC_DIR 缺失、或 basename 无法安全作为路径段时 → 停止并询问用户（`needs_feature`）；DOC_DIR 等于仓库根是另一类终止（`root_unresolvable`，见 3.6）。两者不降级。

本项目自身（Taco 仓库）应声明 `taco-output-dir: specs/{feature}`，使设计规格与其评审产物同目录，与 `specs/011-*` 既有形态一致。

### 3.5 上下文判定

- `workspaceRoot` = 对 DOC_DIR（缺省 cwd）执行 `git rev-parse --show-toplevel`；DOC_DIR 是子目录时以其 git 顶层为 `workspaceRoot`，并校验 DOC_DIR 位于顶层之内。
- 未声明个人意图且解析不到仓库根 → 个人上下文（L5）；若 DOC_DIR/cwd 存在工程标志（`package.json`、`pyproject.toml` 等）则附 `workspaceRoot-not-git` 告警，但仍按 L5，不自动升级为 L4。
- 个人归档目录取 `HOME ?? USERPROFILE`；两者皆缺失 → 停止并报告（`needs_home`），不落到 cwd。

### 3.6 刷新、迁移、首次创建与 `root`

- **刷新**：目标路径与 bundle `root` 均保持不变；`docId`、`comments`、`navigation`、`checkpoints`（含文档状态）与未知字段全部保留；`root` 从既有 bundle 读取后原样传入（`pack.mjs:790-791` 强制 `priorBundle.root === --root`）。
- **迁移**（仅用户显式要求，顺序固定）：读取校验旧 bundle 并做**占用预检**（与最终解析同一次调用，`--existing <旧>` + `--requested <新>`；目标已存在且 `docId` ≠ 旧文件 → 此时即停止，**不得先复制**）→ `mkdir -p` 新目标父目录 → 复制旧文件到新路径 → 对新路径打包（`pack.mjs` 把该副本当 prior bundle 合并，`--title` 未给则省略以沿用副本标题）→ 校验 `docId` 与 `comments`/`checkpoints`/`navigation` 逐字段一致 → 报告新旧路径。不删除旧文件，除非用户显式要求。
- **首次创建**：目标父目录可能不存在，写盘环节必须先 `mkdir -p` 再打包（`pack.mjs:701-703` 的 `atomicWrite` 在目标目录内写临时文件，不创建父目录）。
- **`root` 必须显式传入**，按"刷新 → 既有 bundle 的 `root`；新建 → 项目约定；无约定 → `basename(DOC_DIR)`（= `pack.mjs:780` 默认，也是本仓库 `specs/011-*` 的既有形态）"确定，并写入报告。不依赖默认值，避免刷新时的 root 不匹配只能由 `pack.mjs:790-791` 在打包中途报错。
- **DOC_DIR 等于仓库根**：不支持。空 `--root` 被 `pack.mjs:47-51` 拒绝；写成 `.` 虽能通过 root 校验，却会生成 `./<file>` 形式的 `files[].path`，不满足文件路径安全规则（`pack.mjs:47-49,206-208`）。此情形返回 `root_unresolvable` 并停止，提示改为指向子目录；S2 同样不适用。该终止类型与 `needs_feature` 互斥：仓库根用前者，basename 不可安全使用用后者。
- **目标占用预检**：目标 `.taco.html` 已存在且其 `docId` 既非本次刷新对象、也非本次迁移来源 → 停止并报告（否则 `pack.mjs:854-860` 会把别人的审阅文件当成 prior bundle 合并）。
- **幂等**：相同输入（workspace、DOC_DIR、operation、既有文件、用户指令、规则文件内容）→ 相同目标路径、文件名与 `root`。

### 3.7 报告与告警

写盘前必须能报告：命中级、规则来源（用户指令 / 既有文件 / S1 的 `文件:行` / S2 扩展 / 探测到的目录）、目标绝对路径、文件名、`root`，以及：

- `gitignored`：目标被 `git check-ignore` 命中 → 报告"不会被纳入版本控制"，仍写盘，**不改** `.gitignore`。
- `git-unavailable`：`git` 不可用 → 跳过忽略检查。
- `workspaceRoot-not-git`、`root_unresolvable`：见 3.5 / 3.6。
- `excluded:`：沿用 `pack.mjs` 已有的排除清单。

## 4. 关键决策与取舍

### 4.1 单行键而不是第二套 managed block

仓库已有 `<!-- taco:process-policy:start -->` 形态的 managed block（`extensions/taco/bin/taco.mjs:808-809`）。本设计不复用它承载输出目录，因为输出目录是**单标量值**，成对标记 + 重复块检测的成本高于收益，且单行键与主机、语言无关、一行可 grep。代价：需要自定义"每文件至多一条 + 链内冲突即停"的规则，已在契约 §2 明确。若评审要求统一为 managed block，改动范围仅限契约 §2 与 spec 3.4。

### 4.2 刷新优先于项目规则

项目规则变化（例如从 `docs/Tacos` 改为 `reviews/Tacos`）不得静默搬走正在评审的 Taco——那会让评审者手里的链接与评论上下文失效。因此 L1 高于 L2，迁移必须显式。

### 4.3 `{feature}` 无解析目标时停止

降级会让 Agent 在不该落盘的地方静默产生文件（正是本 issue 要消除的痛点）。停下来的成本是一次交互；误放的代价是一次难以发现的污染。

### 4.4 显式拒绝而不是"调整到最接近的可用值"

L0 的标题/文件名不一致、目标被他人占用、规则冲突、`docDir` 等于仓库根、L5 无 `HOME` —— 一律停止。理由同上：设计目标是把不可预期变成可预期，任何"就近修正"都会重新引入不可预期。

### 4.5 提供确定性解析脚本

新增 `skills/taco/scripts/output-path.mjs`（skill 自带的 Node 辅助脚本，与 `pack.mjs`、`checkpoints.mjs` 同级同性质，**不是** `taco-cli`）：

```sh
node skills/taco/scripts/output-path.mjs --doc-dir <dir> --operation <create|refresh> \
  [--requested <path>] [--existing <x.taco.html>] [--title "<Title>"] \
  [--workspace <root>] [--personal] [--home <dir>] [--json]
```

- `--doc-dir` 与 `--operation` 是**必填**输入：上下文判定、S2 是否成立、`{feature}` 与 `root` 推导都由它们出发，避免"手填 feature 与真实被打包目录脱节"。
- 刷新时 `--existing` 既决定 L1，也提供 `resolveRule` 判定 S2 所必需的既有 shell 变体。
- 不提供 `--feature` 覆盖参数；需要它才能工作说明上下文不完整，应走 `needs_feature` 分支。
- 只做解析与报告，不写文件系统（除读取规则文件、`git rev-parse`/`check-ignore`）。
- 理由：级联的分支（规则冲突、`{feature}`、gitignore、既有文件身份）容易被不同 Agent 各自解释；固化成可测试函数后，验收从"Agent 自称遵守"变为"测试可复现"。
- 安装方式：不新增单独安装步骤，但必须随 `skills/taco/scripts/**` 一并安装，并在安装核对中检查存在。

取舍：增加一个需维护的脚本（约 150 行）与一份测试。若评审倾向纯文档规则，删除 4.5 即可，其余设计不受影响。

### 4.6 权威契约必须落在安装可见路径

权威文本最终位于 `skills/taco/references/output-path.md`。设计期的中文稿 `specs/012-agent-taco-output-path/contracts/output-path-rule.md` 是同一份契约的中文版本，实现时**语义等价地译为英文**迁入（skill 侧文档沿用既有英文，与 `SKILL.md` 及其他 `references/` 一致），中文稿随即降级为指针，不再演进。理由：安装只拷贝 `skills/taco/**`，`specs/**` 不随安装分发。

### 4.7 只安装 Spec Kit 扩展时不需要本契约

扩展是自包含安装，可以不装 skill。扩展自身的产物位置本来就固定为 feature 目录（`update.md` 的既有约定），因此本契约对它的作用仅限于**承认该约定为 S2**，而不是让扩展去读契约。扩展文档只写"扩展项目 ⇒ feature 目录"这一句事实并链到契约（链接为可选便利，不作为扩展正常工作的前提）。

## 5. 契约与不变量

1. **产物路径 ⊥ bundle 内部路径**：目标路径与 `root`、`files[].path`、Checkpoint 文档路径、`originPath` 互不推导。目标目录可以落在 `root` 之外（`root = docs/`，产物在 `docs/Tacos/`），也可以落在 `root` 之内（Spec Kit feature 目录即如此）。
2. **`root` 必须显式确定**：按 3.6 的三种情形取值并显式传入 `pack.mjs`；不得依赖 `--root` 默认值，也不得由产物位置反推。
3. **模板来源 ⊥ 产物位置**：skill/extension 自带 `templates/`、示例 `bundle.json`、`empty.taco.html` 的位置不影响产物写到哪里；项目可在自定目录维护模板与 Checkpoint 图；无适用模板时直接从规范目录里的真实文档组装。
4. **只有 `#taco-document` 与 `<title>` 可写**：本设计不放松既有不变量。
5. **不写禁区**：skill 目录、extension 目录、模板目录、`node_modules/`、`.git/`。
6. **幂等**：相同输入 → 相同目标路径、文件名与 `root`。
7. **不猜测**：规则冲突、`{feature}` 无法解析、`docDir` 等于仓库根、目标被他人占用、L5 无家目录、L0 形态非法 —— 一律停止并报告。

## 6. 受影响组件

| 组件 | 变更 |
| --- | --- |
| `skills/taco/references/output-path.md` | **权威契约**（由设计稿译为英文迁入；安装可见） |
| `skills/taco/SKILL.md` | 新增 "Where to write `.taco.html`" 章节（级联摘要 + 脚本调用 + 写盘序列），Workflow 步骤 1 引用 |
| `skills/taco/scripts/output-path.mjs`（新增） | 确定性解析器（`--doc-dir` 必填，输出含 `root`） |
| `tests/output-path.test.ts`（新增） | 行为级断言（真实打包、刷新、迁移、拒绝） |
| `docs/agent-installation.md` | "Use the skill" 步骤 1 增加一句 + reference 清单补 `output-path.md` |
| `extensions/taco/commands/update.md` | 一句说明"扩展项目 ⇒ S2"，链接契约（可选便利） |
| `extensions/taco/skills/taco-speckit/SKILL.md` | 同上，一行 |
| `extensions/taco/README.md` | 同上，一行 |
| `AGENTS.md`（本仓库） | 添加 `taco-output-dir: specs/{feature}` |
| `specs/012-*/contracts/output-path-rule.md` | 实现后降级为指针文件 |

`skills/taco/templates/` 是 `extensions/taco/templates/` 的生成镜像（见 AGENTS.md），本设计不触碰。

## 7. 验证方案

### 7.1 自动化（`tests/output-path.test.ts`）

解析与拒绝（纯函数级，1–12）：

1. L0 目录形态 → `<dir>/<stem>.taco.html`；L0 文件形态（stem 对齐）→ 原样；L0 文件形态（stem 不对齐）→ 拒绝且原因可辨。
2. L0 未给 `--title` 时按 `既有 bundle title → portableTitleBase(root)` 回退，且与 `pack.mjs` 对同一输入的文件名判定一致。
3. L1（`--existing`）在存在项目规则时仍胜出；`--requested` 与 `--existing` 同时给出 → `--requested` 胜出。
4. LP：git 仓库内 `--personal` → 个人归档目录，而非 L2/L3/L4 结果。
5. L2-S1：`AGENTS.md` 声明 + DOC_DIR → 规则目录；`CLAUDE.md` 声明不同值 → `conflict`；同值 → 取首个；同文件两条（含同值）→ `malformed`。
6. L2-S2（**直接调用导出的 `resolveRule`**，因为公开级联在刷新时由 L1 短路）：`--operation create` 且有 `assets/taco-shell.html` 而无声明 → 命中 DOC_DIR；只有 `.specify/` 无 assets → 落到 L3；只有 `taco-shell-lite.html` 时：`create` → 不成立 S2 并给出原因，`refresh` + 既有 Lite Taco（变体 `lite`）→ 成立，`refresh` + 既有 Complete Taco（变体 `complete`）→ 不成立。另断言：带 `--existing` 的公开解析结果始终是 L1，不受 S2 判定影响。
7. L2 冲突：S1 与 S2 同时存在且不同 → `conflict`；相同 → 取该目录。
8. L3：仅 `docs/` → `docs/Tacos`；同时有 `docs/` 与 `specs/` → `docs/Tacos`；仅 `specs/` → `specs/Tacos`。
9. L4：无文档目录的 git 仓库 → `<repo>/Tacos`。
10. L5：非 git 目录 → `$HOME/Documents/Tacos`（注入 `HOME`）；`HOME`/`USERPROFILE` 皆缺失 → 停止且不返回 cwd。
11. 非法值矩阵（绝对路径、`~`、`..`、反斜杠、通配符、`.taco.html` 结尾、未知占位符、重复占位符）→ `malformed` + 具体原因；规则出现在 fenced code block / HTML 注释 → 未声明；围栏未闭合 → `malformed`；规则文件是符号链接 → `malformed`。
12. 禁区目标（`node_modules/`、skill 目录、extension 目录、`.git/`）→ 拒绝，即使 L0 指定；`docDir` 等于仓库根 → `root_unresolvable`；`basename` 不可安全使用 → `needs_feature`；幂等（同输入两次结果深比较相等）。

行为级（真实 `pack.mjs` + 读回 bundle，13–20，共 8 项，覆盖全部主要写入路径）：

13. **首次创建**：目标父目录不存在；`mkdir -p` 后打包 → 文件落地、`verify` 无 warning、`root` 等于解析器给出的值。
14. **L0 写入路径**：目录形态与文件形态各一次真实打包，落点在解析结果处。
15. **个人意图写入**：`--personal` 在 git 仓库内真实打包 → 落个人归档，读回 `root` 正确。
16. **无 CP 普通文档**：打包结果顶层无 `checkpoints`，sidebar 分组与目录一致。
17. **刷新**：改 canonical 文档后重打包既有文件 → 路径不变、`root` 不变、`docId`/`comments`/`navigation`/`checkpoints` 保留、内容更新。
18. **迁移**：目标父目录不存在时按"建目录 → 复制 → 打包"执行 → 新文件 `docId` 与旧一致，`comments`/`checkpoints`/`navigation` 逐字段相同；旧文件仍在。
19. **目标被他人占用**：目标已有不同 `docId` 的 Taco → 拒绝写盘且目标文件字节未变。
20. **模板来源独立**：参考 `templates/spec/` 但 DOC_DIR 为 `specs/012-x` 时，产物不在模板目录，Checkpoint 文档 path 全部以该 `root` 为前缀。

`level` / `error reason` 仅作诊断断言，不得作为唯一断言。

### 7.2 端到端（五类场景，逐项检查两组结果）

每项都同时检查 **(a) 产物位置** 与 **(b) bundle `root` 与内部引用**：

| 场景 | 构造 | 期望 |
| --- | --- | --- |
| 用户指定输出位置 | 用户说"生成到 `./tmp/roguelike-tactics-game.taco.html`"，标题 `roguelike-tactics-game` | 产物在指定文件；`root` 仍为被评审目录的 basename |
| 项目自定义模板/CP 位置 | 项目在 `review/policy/` 放模板，规则声明 `review/tacos` | 产物在 `review/tacos`；模板文件位置不变、未被复制进项目 |
| 无 CP 的普通文档 | `notes/` 目录，无 Checkpoints | 路径正常，bundle 顶层无 `checkpoints` |
| 仅参考 SDD 示例的新 Taco | 参考 `templates/spec/`，DOC_DIR = `specs/012-agent-taco-output-path` | 产物不在模板目录；Checkpoint 文档 path 以解析器给出的 `root` 为前缀（本仓库为 `012-agent-taco-output-path`，与 `specs/011-*` 同形） |
| 原路径原状态刷新 | 修改 canonical 文档后重打包既有 Taco | 路径与 `root` 不变，`docId`/`comments`/`navigation`/`checkpoints` 状态保留 |

### 7.3 冒烟

在本仓库（已声明 `taco-output-dir: specs/{feature}`）执行：

```sh
node skills/taco/scripts/output-path.mjs --doc-dir specs/012-agent-taco-output-path \
  --operation create --title 012-agent-taco-output-path --json
```

期望命中 L2-S1、返回 `dir = specs/012-agent-taco-output-path` 与 `root = 012-agent-taco-output-path`；随后 `mkdir -p` → `pack.mjs --dir <DOC_DIR> --root <root> --out <file>` → `verify` 无 warning。

## 8. 验收条件

1. Agent 在动手前能给出可核对的结论："级别 L?、目标 `<absolute path>`、文件名 `<stem>.taco.html`、`root` `<value>`、依据 <…>"，且与 `scripts/output-path.mjs` 的输出一致。
2. `AGENTS.md` 中**至多一条** `taco-output-dir` 声明；人工配置后重复执行同一决策不产生第二条；出现两条不同声明或链内冲突时工具与 Agent 都**拒绝**继续。
3. 刷新既有 Taco 时路径与 `root` 不变，`docId`、`comments`、`navigation`、`checkpoints` 状态全部保留；显式迁移后（含目标父目录不存在的情形）新文件携带同一 `docId` 与全部状态，并报告新旧路径。
4. 全新项目（目标目录不存在）能一次跑通落盘：创建目录 → 打包 → `verify` 无 warning。
5. 目标位置已有另一份 `docId` 不同的 Taco 时，拒绝写盘且目标文件字节未变。
6. 新会话**仅凭安装后的文件树**（`AGENTS.md` + `skills/taco/SKILL.md` + `skills/taco/references/output-path.md`）就能回答：这个仓库的产物写到哪、文件名与 `root` 是什么、为什么不是别的目录；不依赖 `specs/**` 是否可达。
7. 只安装 Spec Kit 扩展（未装 skill）的项目仍按扩展既有约定把产物写在 feature 目录，不依赖本契约可达。
8. `tests/output-path.test.ts` 覆盖 7.1 的 20 项（其中 13–20 为行为级）并全部通过；`npm test` 与 `npm run check` 通过。
9. 五类场景（7.2）逐项通过，且每项都验证"产物位置"与"`root`/内部引用"互不影响。
10. 目标落在被 git 忽略的目录时报告 `gitignored` 告警，且 `.gitignore` 未被改动。
11. `pack.mjs` 的 `--out`/`--root` 默认值与无规则项目下的直接调用行为未变（回归测试通过）。

## 9. 风险

| 风险 | 处置 |
| --- | --- |
| L3 探测在混合仓库（既有 `docs/` 又有 `specs/`）给出"看起来对但项目不想要"的结果 | L2 声明作为官方覆盖手段；报告打印命中级与探测依据 |
| 单行键被 Agent 当作普通正文而不读 | SKILL.md 给出精确行格式与查找链；解析脚本给出确定性实现；安装文档各一句指引 |
| 中文设计稿与英文 reference 翻译走样 | 迁移任务以"逐条对照语义"核对，并把 7.1 的 20 项作为一致性回归 |
| S2 依赖 `.specify/extensions/taco/assets/` 的具体路径，扩展结构变化会失效 | 把该路径写进契约并测试；路径变化属于契约变更，需同步三处 |
| 个人归档在 CI/无 HOME 环境不可用 | 停止并报告；不静默落到 cwd |

## 10. 待评审确认

1. 规则载体是否为单行键 `taco-output-dir: <repo-relative path>`（4.1 的取舍）。
2. 是否采纳 `skills/taco/scripts/output-path.mjs`（4.5 的取舍）；若不采纳，7.1 第 1–12 项改为人工核对，行为级 13–20 项保留。
3. L3 探测顺序固定为 `docs` → `doc` → `documents` → `specs`（本仓库会命中 `docs`，因此必须依赖 L2 声明）。
4. L0 的文件形态要求"文件名 stem 已与标题一致"，否则拒绝（4.4 的取舍）。
5. 新增 LP 级别（`--personal` / 会话明确说明）以支持"在仓库里处理个人文档"，其优先级高于 L2（3.3 的取舍）。
6. `root` 不支持仓库根 DOC_DIR，遇到即停止（3.6 的取舍）。
7. 个人归档目录名与大小写：`~/Documents/Tacos/`（与 TACO-9 原文一致）。
8. 是否在本仓库 `AGENTS.md` 写入 `taco-output-dir: specs/{feature}` 作为自我应用。
