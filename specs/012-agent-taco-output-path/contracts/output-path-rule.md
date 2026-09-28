---
title: 'Taco 输出位置与项目规则契约（设计稿）'
status: 'Draft'
---

> **迁移说明**：本文件是设计期的权威草稿。实现阶段把本文**语义等价地译为英文**写入 `skills/taco/references/output-path.md`，并把本文件替换为指针（标题 + 迁移说明 + 链接）。此后英文 reference 是唯一权威。

## 1. 目的与范围

规定两件事：

1. **项目规则**：项目如何声明 `.taco.html` 的输出目录（`.taco/config.yaml`）。
2. **产出位置级联**：没有规则或规则不适用时，产物落在哪。

范围边界：

- 只规定**产物的位置与文件名**、项目规则的语法与失败语义，以及落盘与校验的**步骤顺序**。
- 不规定 bundle 的数据结构与序列化细节（`skills/taco/references/bundle-format.md` 是那里的权威）。
- 不引入任何脚本、CLI 或运行时依赖：落盘由 Agent 直接写 `.taco.html` 的 `#taco-document` 数据块完成。
- 不规定模板/Checkpoint 示例的来源位置（与产物位置互不影响）。

## 2. 项目规则：`.taco/config.yaml`

位置固定：**仓库根**下的 `.taco/config.yaml`。

```yaml
version: 1
outputDir: specs/{feature}
```

| 键 | 必填 | 语义 |
| --- | --- | --- |
| `version` | 否 | 省略视为 1；给出且 ≠ 1 → `malformed`（不按旧规则误读更新版 schema） |
| `outputDir` | 是（规则生效时） | 输出目录，**仓库相对** POSIX 路径，可含一个 `{feature}` 占位符 |

解析与失败语义（失败集合见 §7）：

| 情形 | 结果 |
| --- | --- |
| 文件不存在（含 `.taco/` 目录不存在） | 无规则，落到级联下一级 |
| 顶层不是 mapping、YAML 解析失败、出现重复键或 YAML merge 键 | `malformed`，停止；不猜测 |
| 文件存在但缺 `outputDir` | `malformed`（声明了配置却没有输出目录，属配置错误，不静默忽略） |
| `outputDir` 非字符串或为空串 | `malformed` |
| `version` 给出且不是整数 1 | `malformed` |
| `.taco/` 或 `config.yaml` 是符号链接 | `malformed`，停止 |
| 出现其它未知普通键 | 忽略，不报错（前向兼容；Agent 不因未知键改写该文件） |

`outputDir` 取值约束：

- 必须相对**仓库根**：禁止首部 `/`、`~`、盘符、反斜杠、NUL。
- 禁止空段、`.`、`..`。
- 禁止通配符 `*` `?` `[` `]`。
- 不得以 `.taco.html` 结尾（声明的是目录）。
- `{feature}` **至多出现一次**；其它 `{...}` 或未闭合 `{` → `malformed`。
- 解析结果**等于仓库根**或**落在配置目录内**（`.taco/`）→ `malformed`（避免把产物写进配置目录或与仓库根混淆）。

`{feature}` 的替换值 = **被打包目录（DOC_DIR）的 basename**，原样保留 Unicode 与空格（与运行时命名行为一致）；但 basename 含反斜杠、NUL、尾随空格/点，或属于 Windows 保留名（`CON`、`PRN`、`AUX`、`NUL`、`COM1`–`COM9`、`LPT1`–`LPT9`）→ `needs_feature`，停止并请用户改用可移植的目录名。

**写入权限**：`.taco/config.yaml` 是项目配置。Agent 只有在用户显式要求时才创建或修改它，绝不自动生成、绝不顺手改写未知键。

**版本控制**：若 `.taco/config.yaml` 被 `.gitignore` 命中，报告 `config-untracked` 告警（本机配置无法被队友与 CI 共享，同一输入可能得到不同路径）。不修改 `.gitignore`。

## 3. 规则的第二个来源：已安装的扩展

| 来源 | 成立条件 | 规则值 |
| --- | --- | --- |
| S1 `.taco/config.yaml` | 见 §2 | `outputDir` 解析结果 |
| S2 扩展约定 | 项目**实际安装**了 Taco Spec Kit 扩展（存在 `.specify/extensions/taco/assets/taco-shell.html`；仅 lite shell 时只在刷新既有 Lite Taco 时成立） | 被打包目录（DOC_DIR）本身 |

- 只有 S1 → 用 S1；只有 S2 → 用 S2。
- 两者成立且**指向同一目录** → 用该目录。
- 两者成立且指向**不同**目录 → `conflict`，停止并列出两个来源。
- 仅有 `.specify/`（已初始化 Spec Kit 但未装 Taco 扩展）→ **不产生规则**，继续通用级联。
- S2 只是承认扩展既有的落点约定；扩展可独立安装且自包含，不依赖本契约或任何 skill 文件。

## 4. 产出位置级联

| 级别 | 条件 | 产物 |
| --- | --- | --- |
| L0 | 用户本次显式给出输出位置 | 见 §4.1 |
| L1 | 本次是刷新既有 `.taco.html` | 该文件现有路径 |
| L2 | 项目规则成立（§3 的 S1 或 S2），**且被打包目录不是仓库根** | 规则目录 |
| L3 | 仓库内存在 `docs/`、`doc/`、`documents/`、`specs/` | 首个存在者之下的 `tacos/` |
| L4 | 是仓库（含仓库根打包）但没有上述目录 | `<repo>/tacos/` |
| L5 | 不在任何仓库内 | `~/Documents/tacos/` |

顺序固定，取第一个可用级；目录名统一小写 `tacos`。

**仓库根例外（决策 6 的落点，唯一解）**：被打包目录就是仓库根时，S1 的 `{feature}` 无意义、S2 亦不成立，**L2 不适用**，直接落 `<repo>/tacos/`（即 L4 的目标）。该例外不改变 L0 与 L1 的优先级：用户显式指定的位置与既有 Taco 的路径仍然优先。

### 4.1 L0 的精确语义

`--requested`（会话中用户给出的位置）接受两种形态：

1. **目录** → 产物 = `<该目录>/<标题的归一化文件名>`。
2. **以 Taco 文件名结尾的路径**（`.taco.html`），且其文件名 stem **已经是规范形式**（等于把该 stem 当作标题做归一化后的结果）→ 产物 = 该文件，且**该 stem 就是 bundle 标题**（文件名决定标题）。

其余形态 → `malformed`：

- 非 `.taco.html` 的文件路径；
- `.taco.html` 文件名但 stem **不是规范形式**（例如 `My Design.taco.html`：归一化结果是 `My_Design`，而且标题若取 `My Design` 会被运行时保存回 `My_Design.taco.html`，导致"用户给的名字"与"浏览器保存的名字"不一致）。此时报告应给出规范文件名建议，**不静默改写用户给的路径**。

**文件名与标题的对应**：文件名 stem = 标题的归一化结果（NFKC → 非字母数字下划线连字符替换为 `_` → 折叠并裁剪 `_`/`-` → 空值回退 `Untitled`）。二者互为唯一对应，渲染器与保存流程都依赖它。

**禁区优先于 L0**：产物落在 skill 目录、扩展目录、模板目录、`node_modules/`、`.git/` 之内时，无论谁指定都拒绝（`forbidden`）。

### 4.2 仓库识别（不依赖 git 命令）

从被打包目录（缺省 cwd）向上逐级查找：

1. 存在 `.git/` 目录 → 该目录的父目录即仓库根；
2. 存在 `.git` **文件**且内容形如 `gitdir: <路径>`（worktree / submodule）→ 该行指向的 git 目录的合适上级即仓库根；
3. 找到文件系统根仍无 `.git` → 不在仓库内 → L5。

`git` 命令只用于**可选的**忽略检查（§7）；命令缺失时报告 `gitignore-unavailable`，**不改变**仓库判定，也不把"命令不可用"误判为"不在仓库内"。若被打包目录/cwd 存在工程标志（`package.json`、`pyproject.toml` 等）却判定为 L5，附 `workspaceRoot-not-git` 告警。

### 4.3 个人归档

`HOME ?? USERPROFILE` 下的 `Documents/tacos`。两者皆缺失 → `needs_home`，停止并报告，不落到 cwd。

### 4.4 路径安全

- 产物路径按 `realpath` 的**已存在前缀**判定：不得落在禁区（§4.1）之内，也不得通过中途替换的符号链接指向这些位置。
- 产物文件已存在且是符号链接 → 拒绝。
- 产物必须落在被打包集合之外：打包时排除所有 `*.taco.html`（沿用既有规则）。若 `outputDir` 解析结果**等于**被打包目录，落盘后报告 `output-in-input` 告警。

## 5. 落盘、刷新、迁移

### 5.1 落盘顺序（固定，不得调换）

1. **定目标**：按 §4 得到产物目录、文件名与标题；产出报告行 `L? → <绝对路径>（依据：…）`。
2. **读入内存**：读目标文件（若存在）的 `#taco-document` 数据块，以及所选 shell（若目标不存在）。**不得**先把 shell 复制到目标路径。
3. **占用判定**（§5.4）：不通过即停止。
4. **构造新 bundle**：按 §5.2 的保留规则生成完整 JSON。
5. **转义与自校验**：按 `references/bundle-format.md` 序列化并转义；对**将要写入的那一份字符串**做解析校验与形态校验（必需字段、`root` 与各 `path` 一致、path 唯一且安全）。
6. **备目录**：目标父目录不存在则创建（原子替换要求临时文件与目标同目录）。
7. **原子替换**：把完整 HTML 写到**同目录的临时文件**，`rename` 覆盖目标；失败时保留原文件不动。
8. **校验与报告**：按 §6 校验，并按 §7 报告。

### 5.2 刷新（L1）的字段保留

| 字段 | 规则 |
| --- | --- |
| `docId`、`comments`、`navigation`、`checkpoints`、`access`、`collab`、未知顶层字段 | 原样保留 |
| 标题 | **保留既有 bundle 的标题**；若目标文件名 stem 与其归一化结果不一致 → 报告冲突并停止（不静默改名、不改标题） |
| 每个 file 的 `id` | 保留（评论锚点与 block 身份依赖它） |
| `blocks` | 仅在**该文件新旧内容字节完全相同**时保留；内容变化即丢弃，由运行时重建 |
| `sourceHash` | 内容变化时重算；内容未变则保持不变 |

**被排除的既有文件**：沿用既有规则（`*.taco.html` 与隐藏路径），并在报告里列出排除项。

### 5.3 迁移（仅用户显式要求）

**占用预检必须早于任何写操作**：

1. 读入旧文件的数据块，校验 `docId`、`comments`、`checkpoints`、未知字段；
2. 目标已存在时（即使 `docId` 与旧文件相同）**默认停止**：目标可能是同一份 review 的另一个副本，且已独立推进了评审状态，覆盖会无声丢弃那些状态。只有在用户显式授权覆盖、且 Agent 已把目标与来源的状态差异（评论数、Checkpoint 状态、字段差异）列在报告里之后，才继续；
3. 创建目标父目录；
4. 按 §5.1 的顺序落盘（构造 → 校验 → 临时文件 → rename）；
5. 校验新文件的 `docId` 与 `comments`/`checkpoints`/`navigation` 逐字段与旧文件一致；
6. 报告"旧路径 → 新路径"。**不删除**旧文件，除非用户显式要求。

### 5.4 占用判定

| 情形 | 结果 |
| --- | --- |
| 目标不存在 | 正常新建 |
| 目标是本次刷新的对象（解析为同一路径） | 正常刷新 |
| 目标存在但属于别的 `docId` | `conflict`，停止 |
| 目标存在且 `docId` 与来源相同（迁移场景） | 默认停止；仅在用户显式授权且已报告状态差异后覆盖 |

### 5.5 首次创建与 shell 变体

- 目标父目录不存在 → 先创建（§5.1 步骤 6）。
- 变体选择：新建默认 Complete（`taco-shell.html`）；用户显式要求 Lite 或接收者环境可靠联网时可用 `taco-shell-lite.html`；刷新沿用既有文件 `<meta name="taco-shell-variant">`（缺省视为 Complete）记录的变体，不得静默改变。
- 所需 shell 在安装目录中不存在 → 停止并给出该路径，不换用另一变体顶替。

### 5.6 幂等

相同输入（仓库根、DOC_DIR、操作类型、既有文件、用户指令、`.taco/config.yaml` 内容）→ 相同产物目录、文件名与标题。

## 6. 校验阶梯（无脚本、无 CLI）

按可用能力自上而下取一级，并在报告里**写明实际用了哪一级**：

| 级别 | 手段 | 产物 |
| --- | --- | --- |
| V1 | 打开 Taco 的标签页 + `window.taco.validate()` | `{ok, issues, findings, counts}`；须 `ok: true` 且无 `error` |
| V2 | 宿主具备读取/解析能力 | 对写入的那一份字符串解析并逐项核对 §5.1 步骤 5 的形态规则；报告"未做运行校验" |
| V3 | 无可用手段 | 报告"**未验证**"，不得声称已验证 |

任何一级都不得被表述为更高级别；V2/V3 之下必须显式声明未运行渲染校验（`validate()` 覆盖的是渲染与引用正确性，解析通过不等于界面正确）。

## 7. 报告

落盘前给出可核对的结论，并写明：

- 命中级别与依据（用户指令 / 既有文件 / `.taco/config.yaml` / 扩展安装 / 探测到的目录 / 仓库根例外）；
- 产物**绝对路径**、**文件名**、**标题**；
- 校验阶梯级别（V1/V2/V3）与结果；
- 告警：`gitignored`（产物被忽略 → 仍落盘，**不改** `.gitignore`）、`config-untracked`、`gitignore-unavailable`、`workspaceRoot-not-git`、`output-in-input`；
- 排除项清单。

失败类型集合（全部**不落盘**）：`malformed`、`conflict`、`needs_feature`、`needs_home`、`forbidden`。不"取最合理的一个"。

## 8. 示例

### 8.1 合法

```yaml
# .taco/config.yaml
version: 1
outputDir: specs/{feature}
```

DOC_DIR = `specs/012-agent-taco-output-path` → 产物目录 `specs/012-agent-taco-output-path`，文件 `012-agent-taco-output-path.taco.html`。

```yaml
outputDir: docs/reviews
```

→ 产物目录 `docs/reviews`（不存在则创建）。

### 8.2 非法

| 输入 | 结果 | 原因 |
| --- | --- | --- |
| `outputDir: /abs/tacos` | malformed | 绝对路径 |
| `outputDir: ~/Documents/tacos` | malformed | 家目录简写；只允许仓库相对路径 |
| `outputDir: ../outside` | malformed | 越出仓库根 |
| `outputDir: docs\tacos` | malformed | 反斜杠 |
| `outputDir: docs/tac*` | malformed | 通配符 |
| `outputDir: docs/review.taco.html` | malformed | 声明的是目录 |
| `outputDir: .` | malformed | 解析结果等于仓库根 |
| `outputDir: .taco/tacos` | malformed | 落在配置目录内 |
| `outputDir: specs/{feature}/{feature}` | malformed | 占位符重复 |
| `outputDir: specs/{sprint}` | malformed | 未知占位符 |
| 缺 `outputDir` | malformed | 声明了配置却没有输出目录 |
| `version: 2` | malformed | 更新版 schema，拒绝误读 |
| 顶层为列表 | malformed | 顶层不是 mapping |
| 重复键 `outputDir` | malformed | YAML 歧义，不同读取方式会得到不同结果 |

### 8.3 边界

以下两处都不算声明：HTML 注释形式（历史遗留）与 fenced code block 内的同名行——**不适用**：`.taco/config.yaml` 是独立 YAML 文件，不存在 Markdown 注释/围栏问题。本设计早期版本的该规则随载体更换一并删除。

## 9. 向后兼容

- 未配置 `.taco/config.yaml` 的仓库按 L3/L4/L5 落盘。**这是相对"默认写在 cwd 根"的有意变更**，须在 `skills/taco/SKILL.md` 与安装文档写明。
- 无 bundle schema 变更；既有 `.taco.html` 不受影响（刷新后路径、标题与 `root` 不变）。
- 不安装本 reference 的旧版 skill：行为与引入前一致。

## 10. 契约演进

键名、级联顺序、失败语义、落盘顺序与校验阶梯的变更必须同步：`skills/taco/references/output-path.md`、`skills/taco/SKILL.md` 的摘要、`docs/agent-installation.md`、`extensions/taco/` 的三处说明。
