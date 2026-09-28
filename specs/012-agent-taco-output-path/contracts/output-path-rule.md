---
title: 'Taco 产出位置契约（设计稿）'
status: 'Draft'
---

> **迁移说明**：本文件是设计期的权威草稿。实现阶段把本文**语义等价地译为英文**写入 `skills/taco/references/output-path.md`，并把本文件替换为指针（标题 + 迁移说明 + 链接）。此后英文 reference 是唯一权威。

## 1. 目的与范围

规定一件事：**Agent 自主创建或刷新 Taco 文件时，产物落在哪、叫什么名字、按什么顺序写、写完如何声明。**

范围边界：

- 只规定产物的**位置、文件名、落盘顺序与校验声明**。
- 不规定 bundle 的数据结构与序列化细节（`skills/taco/references/bundle-format.md` 是那里的权威），只规定"写前必须自解析校验"这一前提。
- 不引入任何脚本、CLI 或运行时依赖：落盘由 Agent 直接写 `.taco.html` 的 `#taco-document` 数据块完成。
- **不定义项目级配置**：没有 `.taco/config.yaml` 之类的规则文件（用户决定：该配置非必要）。产物位置由级联与用户显式指令决定。
- **不规定扩展的落点**：Spec Kit 扩展对已安装项目有自己的约定（feature 目录），那是扩展自身的职责，不在本契约内，也不改变本契约的级联结果。
- 不规定模板/Checkpoint 示例的来源位置（与产物位置互不影响）。

## 2. 产出位置级联

| 级别 | 条件 | 产物 |
| --- | --- | --- |
| L0 | 用户本次显式给出输出位置 | 见 §2.1 |
| L1 | 本次是刷新既有 `.taco.html` | 该文件现有路径 |
| L2 | **被打包目录就是仓库根**（L0、L1 未命中时） | `<repo>/tacos/` |
| L3 | 仓库内存在 `docs/`、`doc/`、`documents/`、`specs/` | 首个存在者之下的 `tacos/` |
| L4 | 是仓库但没有上述目录 | `<repo>/tacos/` |
| L5 | 不在任何仓库内 | `~/Documents/tacos/` |

顺序固定，取第一个可用级；目录名统一小写 `tacos`（个人归档为 `~/Documents/tacos`，Windows 为 `%USERPROFILE%\Documents\tacos`）。

**L2 是独立级别，跳过 L3**：被打包目录就是仓库根时，"仓库内存在 `docs/`/`specs/`"的探测与"打包整个仓库"无关，因此直接落 `<repo>/tacos/`（与 L4 同一目标）。这样"被打包目录是仓库根"只有唯一解，即使仓库内存在 `docs/`。L0 与 L1 仍然优先。

### 2.1 L0 的精确语义

用户本次给出的位置接受两种形态：

1. **目录** → 产物 = `<该目录>/<标题的归一化文件名>`。
2. **以 Taco 文件名结尾的路径**（`.taco.html`），且其文件名 stem **已经是规范形式**（等于把该 stem 当作标题做归一化后的结果）→ 产物 = 该文件，且**该 stem 就是 bundle 标题**（文件名决定标题）。

其余形态 → `malformed`：

- 非 `.taco.html` 的文件路径；
- `.taco.html` 文件名但 stem **不是规范形式**（例如 `My Design.taco.html`：归一化结果是 `My_Design`，而标题若取 `My Design`，运行时保存时会写成 `My_Design.taco.html`，于是"用户给的名字"与"浏览器保存的名字"不一致）。此时应给出规范文件名建议，**不静默改写用户给的路径**。

用户可给绝对路径。

**文件名与标题的对应**：文件名 stem = 标题的归一化结果（NFKC → 非字母数字下划线连字符替换为 `_` → 折叠并裁剪 `_`/`-` → 空值回退 `Untitled`）。二者互为唯一对应，渲染器与保存流程都依赖它。

**禁区优先于 L0**：产物落在 skill 目录、扩展目录、模板目录、`node_modules/`、`.git/` 之内时，无论谁指定都拒绝（`forbidden`）。

### 2.2 仓库识别（不依赖 git 命令）

从被打包目录（缺省 cwd）向上逐级查找：

1. 存在 `.git/` 目录 → 该目录的父目录即仓库根；
2. 存在 `.git` **文件**且内容形如 `gitdir: <路径>`（worktree / submodule）→ 该行指向的 git 目录的合适上级即仓库根；
3. 到文件系统根仍无 `.git` → 不在仓库内 → L5。

`git` 命令只用于**可选的**忽略检查（§5）；命令缺失时报告 `gitignore-unavailable`，**不改变**仓库判定，也不把"命令不可用"误判为"不在仓库内"。若被打包目录/cwd 存在工程标志（`package.json`、`pyproject.toml` 等）却判定为 L5，附 `workspaceRoot-not-git` 告警。

### 2.3 个人归档

`HOME ?? USERPROFILE` 下的 `Documents/tacos`。两者皆缺失 → `needs_home`，停止并报告，不落到 cwd。

### 2.4 路径安全

- 产物路径按 `realpath` 的**已存在前缀**判定：不得落在禁区（§2.1）之内，也不得通过中途替换的符号链接指向这些位置。
- 产物文件已存在且是符号链接 → 拒绝。
- 产物必须落在被打包集合之外：打包时排除**隐藏路径**（任何以 `.` 开头的文件或目录，例如 `.env`）与所有 `*.taco.html`。刷新时沿用既有 bundle 的 `packOptions.ignore`，并把它与本次排除项一并写入新的 `packOptions`。若产物目录**等于**被打包目录，落盘后报 `output-in-input` 告警。

## 3. 落盘、刷新、迁移

### 3.1 落盘顺序（固定，不得调换）

1. **定目标**：按 §2 得到产物目录、文件名与标题；产出报告行 `L? → <绝对路径>（依据：…）`。
2. **读入内存**：读目标文件（若存在）的 `#taco-document` 数据块，以及所选 shell（若目标不存在）。**不得**先把 shell 复制到目标路径。既有数据块无法解析 → 停止（`malformed`）。
3. **占用判定**（§3.4）：不通过即停止。
4. **构造新 bundle**：按 §3.2 的保留规则生成完整 JSON。
5. **转义与自校验**（落盘前提，不可跳）：按 `references/bundle-format.md` 序列化并转义；对**将要写入的那一份字符串**做解析校验与形态校验（必需字段、`root` 与各 `path` 一致、path 唯一且安全）。宿主没有解析能力 → 停止（`unverifiable`），不写文件。
6. **备目录**：目标父目录不存在则创建（原子替换要求临时文件与目标同目录）。
7. **原子替换**：完整 HTML 写到**同目录的临时文件**，`rename` 覆盖目标；失败保留原文件不动。
8. **校验与报告**：按 §4 声明校验结果，按 §5 报告。

### 3.2 刷新（L1）的字段保留

| 字段 | 规则 |
| --- | --- |
| `docId`、`comments`、`navigation`、`checkpoints`、`access`、`collab`、未知顶层字段 | 原样保留 |
| 标题 | **保留既有 bundle 的标题**；若目标文件名 stem 与其归一化结果不一致 → 报告冲突并停止（不静默改名、不改标题） |
| 每个 file 的 `id` | 保留（评论锚点与 block 身份依赖它） |
| `blocks` | 仅在**该文件新旧内容字节完全相同**时保留；内容变化即丢弃，由运行时重建 |
| `sourceHash` | 内容变化时重算，未变则保持 |
| 打包集合 | 排除隐藏路径与所有 `*.taco.html`（含产物自身）；刷新时沿用既有 `packOptions.ignore` |

### 3.3 迁移（仅用户显式要求）

**占用预检必须早于任何写操作**：

1. 读入旧文件的数据块，校验 `docId`、`comments`、`checkpoints`、未知字段；
2. 目标已存在时（即使 `docId` 与旧文件相同）**默认停止**：目标可能是同一份 review 的另一个副本并已独立推进了评审状态，覆盖会无声丢弃那些状态。只有在用户显式授权覆盖、且 Agent 已把目标与来源的状态差异（评论数、Checkpoint 状态、字段差异）列在报告里之后，才继续；
3. 创建目标父目录；
4. 按 §3.1 的顺序落盘；
5. 校验新文件的 `docId` 与 `comments`/`checkpoints`/`navigation` 逐字段与旧文件一致；
6. 报告"旧路径 → 新路径"。**不删除**旧文件，除非用户显式要求。

### 3.4 占用判定

| 情形 | 结果 |
| --- | --- |
| 目标不存在 | 正常新建 |
| 目标是本次刷新的对象（解析为同一路径） | 正常刷新 |
| 目标存在但属于别的 `docId` | `conflict`，停止 |
| 目标存在且 `docId` 与来源相同（迁移场景） | 默认停止；仅在用户显式授权且已报告状态差异后覆盖 |

### 3.5 首次创建与 shell 变体

- 目标父目录不存在 → 先创建（§3.1 步骤 6）。
- 变体选择：新建默认 Complete（`taco-shell.html`）；用户显式要求 Lite 或接收者环境可靠联网时可用 `taco-shell-lite.html`；刷新沿用既有文件 `<meta name="taco-shell-variant">`（缺省视为 Complete）记录的变体，不得静默改变。
- 所需 shell 在安装目录中不存在 → 停止并给出该路径，不换用另一变体顶替。

### 3.6 幂等

相同输入（仓库根、被打包目录、操作类型、既有文件、用户指令）→ 相同产物目录、文件名与标题。

## 4. 校验阶梯（无脚本、无 CLI）

写前自解析是落盘前提（§3.1 步骤 5）；写后按可用能力声明结果：

| 级别 | 手段 | 声明 |
| --- | --- | --- |
| V1 | 打开 Taco 的标签页 + `window.taco.validate()` | `{ok, issues, findings, counts}`；须 `ok: true` 且无 `error` |
| V2 | 宿主有解析能力但没有浏览器 | "已解析核对、未做运行校验"；不得表述成 V1 |

`validate()` 覆盖渲染与引用正确性；解析通过不等于界面正确，因此 V2 必须显式声明局限。**阶梯只约束"如何声明"**：宿主连解析/读取写入串的能力都没有时，不写任何文件并报告 `unverifiable`，不存在"写入未验证产物"的路径。

## 5. 报告

落盘前给出可核对的结论，并写明：

- 命中级别与依据（用户指令 / 既有文件 / 仓库根打包 / 探测到的目录）；
- 产物**绝对路径**、**文件名**、**标题**；
- 校验阶梯级别（V1/V2）与结果；
- 告警：`gitignored`（产物被忽略 → 仍落盘，**不改** `.gitignore`）、`gitignore-unavailable`、`workspaceRoot-not-git`、`output-in-input`；
- 排除项清单（隐藏路径、`*.taco.html`、既有的 `packOptions.ignore` 命中项），沿用既有报告口径。

失败类型集合（全部**不落盘**）：`malformed`、`conflict`、`needs_home`、`unverifiable`、`forbidden`。不"取最合理的一个"。

## 6. 与 Spec Kit 扩展的关系

已安装 Taco Spec Kit 扩展的项目，产物位置由**扩展自身的约定**决定（`<FEATURE_DIR>/<feature-name>.taco.html`，见 `extensions/taco/commands/update.md`）。本契约：

- 不把扩展安装当作规则来源，不检测也不与之做冲突判定；
- 不要求扩展读取本契约或任何 skill 文件（扩展可独立安装且自包含）；
- 当 Agent 在扩展项目里按扩展约定落盘时，报告的"依据"写扩展约定，而不是本级联的某一级。

这样"一处只有一个规则来源"：扩展项目听扩展，其它项目听本级联，需要自定义位置时用户显式指定（L0）。

## 7. 示例

### 7.1 常见落点

| 被打包目录 | 仓库内存在 | 产物 |
| --- | --- | --- |
| `specs/012-agent-taco-output-path` | `docs/` 与 `specs/` | `docs/tacos/012-agent-taco-output-path.taco.html` |
| 用户显式给 `specs/012-agent-taco-output-path/012-agent-taco-output-path.taco.html` | — | 该校验通过即用该文件（L0） |
| `<repo>`（仓库根） | `docs/` 存在 | `<repo>/tacos/<repo 名>.taco.html`（L2，跳过 `docs/` 探测） |
| `notes/`（仓库内，无 `docs|doc|documents|specs`） | 无 | `<repo>/tacos/…`（L4） |
| 非仓库目录 `/tmp/research` | — | `~/Documents/tacos/…`（L5） |

**本仓库的注意点**：Taco 仓库目前把设计产物放在 `specs/<feature>/<feature>.taco.html`（与 `specs/011-*` 一致），而级联默认会给出 `docs/tacos/`（因为本仓库有 `docs/`）。因此在本仓库出产物时应由用户显式指定路径（L0），或接受级联默认——两者都不会被静默改写，报告会写明命中级。

### 7.2 非法

| 输入 | 结果 | 原因 |
| --- | --- | --- |
| 非 `.taco.html` 的文件路径 | malformed | L0 只接受目录或 `.taco.html` |
| `My Design.taco.html` | malformed | 文件名 stem 不是规范形式；建议 `My_Design.taco.html` |
| 产物落在 `node_modules/`、`.git/`、skill/扩展/模板目录 | forbidden | 禁区优先于 L0 |
| 既有数据块无法解析 | malformed | 不能在不理解既有 bundle 的情况下落盘 |
| 宿主无解析能力 | unverifiable | 无法保证转义可逆与形态正确 |
| 迁移目标已存在（含同 `docId` 副本） | conflict（默认） | 覆盖会丢弃目标已推进的评审状态 |
| L5 且 `HOME`/`USERPROFILE` 皆缺失 | needs_home | 不落到 cwd |

## 8. 向后兼容

- 本契约**不新增**项目级配置，因此未安装 skill 的仓库不产生新文件、不需要迁移。
- 行为的变化只在 Agent 侧：产物不再默认写 cwd 根，而按 §2 级联落位（**有意的行为变更**，须在 `SKILL.md` 与安装文档写明）。
- 无 bundle schema 变更；既有 `.taco.html` 不受影响（刷新后路径、标题与 `root` 不变）。
- 不安装本 reference 的旧版 skill：行为与引入前一致。

## 9. 契约演进

级联顺序、级别命名、失败语义、落盘顺序与校验阶梯的变更必须同步：`skills/taco/references/output-path.md`、`skills/taco/SKILL.md` 的摘要、`docs/agent-installation.md`、`extensions/taco/` 的三处说明。
