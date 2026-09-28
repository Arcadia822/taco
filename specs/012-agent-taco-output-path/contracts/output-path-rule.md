---
title: 'Taco 输出目录与规则契约（设计稿）'
status: 'Draft'
---

> **迁移说明**：本文件是设计期的权威草稿。实现阶段（`tasks.md` T2）把本文**语义等价地译为英文**迁入 `skills/taco/references/output-path.md`，并把本文件替换为指针文件（标题 + 迁移说明 + 链接）。此后英文 reference 是唯一权威，中文版本作为设计记录不再演进。理由：安装只拷贝 `skills/taco/**`（`docs/agent-installation.md` 的安装步骤），`specs/**` 不随安装分发，权威必须落在安装可见的路径上。

## 1. 目的与范围

定义两件事，供任何消费 Taco skill 的 Agent 执行：

1. **规则声明**：项目如何用一行机器可读的声明指定 `.taco.html` 的输出目录。
2. **决策级联**：没有声明或声明不适用时，产物应落在哪。

不在范围内：bundle `taco/files` v1 的结构与 `root` 语义、`pack.mjs` 的 `--out`/`--root` 参数语义与默认值、Spec Kit 扩展的安装方式。

## 2. 规则声明语法

在项目的 Agent 指令文件中，声明占**一整行**：

```text
taco-output-dir: <value>
```

精确语法：

```text
line          = key ":" SP value
key           = "taco-output-dir"          ; 大小写不敏感
value         = segment *("/" segment)     ; 不含首尾 "/"
segment       = "{" placeholder "}" / 1*( ALPHA / DIGIT / "_" / "." / "-" )
placeholder   = "feature"                  ; 目前唯一受支持的占位符
```

| 约束 | 说明 |
| --- | --- |
| 每文件至多一条 | 同一文件内出现两条（含同值）即 `malformed` |
| 查找链 | `AGENTS.md` → `CLAUDE.md` → `.cursorrules`；取首个声明者 |
| 链内冲突 | 两个文件声明了**不同**值即 `conflict`；声明了**相同**值取首个 |
| 位置限定 | 位于 fenced code block 或 HTML 注释内的同名行**不算**声明 |
| 相对性 | `value` 必须相对**仓库根**；禁止首部 `/`、`~`、盘符、`\` |
| 安全段 | 禁止空段、`.`、`..` |
| 无通配 | 禁止 `*`、`?`、`[`、`]` |
| 非产物 | `value` 不得以 `.taco.html` 结尾（声明的是目录） |
| 占位符封闭 | 只认 `{feature}`；其他 `{...}`、未闭合 `{` 一律 `malformed` |
| 占位符唯一 | 同一 `value` 中 `{feature}` **最多出现一次**；出现两次即 `malformed`（与 §8.2 示例一致） |
| 未闭合围栏/注释 | 扫描到未闭合的 fenced code block 或 HTML 注释即 `malformed`（不按"无声明"降级） |
| 符号链接 | 规则文件本身是符号链接即 `malformed`（与 `extensions/taco/bin/taco.mjs` 的 `readPolicyFile` 一致） |
| 目录存在性 | 声明不要求目录已存在；由写盘环节创建 |

## 3. 规则来源（两条，同属 L2）

| 来源 | 产生条件 | 规则值 |
| --- | --- | --- |
| S1 显式声明 | 指令文件中有 `taco-output-dir` | 声明的 `<value>`，其中的 `{feature}` 用 `basename(docDir)` 替换 |
| S2 扩展约定 | 见下方"实际安装"判定 | `docDirRel`（本次被打包目录的仓库相对路径） |

**S2 的"实际安装"判定**（与 `extensions/taco/commands/update.md:17` 的新建/刷新要求对齐）：

| 本次操作 | 成立条件 |
| --- | --- |
| 新建 Taco | 存在 `.specify/extensions/taco/assets/taco-shell.html` |
| 刷新既有 Taco | `.specify/extensions/taco/assets/taco-shell.html` 或 `taco-shell-lite.html` 至少存在其一，且与既有 Taco 的 shell 变体一致 |

只有 `taco-shell-lite.html` 时，新建操作**不构成** S2——因为扩展的新建流程本身会因缺少 Complete shell 而停止（`extensions/taco/commands/update.md:17`）；此时继续通用级联，并在报告中说明原因。

判定规则：

- 只有 S1 → 用 S1。
- 只有 S2 → 用 S2。
- S1 与 S2 同时存在：解析后**指向同一目录**则取该目录；否则 `conflict`，停止并列出两个来源。
- 仅有 `.specify/`（已初始化 Spec Kit 但未安装 Taco 扩展）→ **不产生规则**，继续通用级联。不得因为 `.specify/` 的存在而改变输出落点。
- `docDirRel` 为空（被打包目录就是仓库根）→ S2 不适用，`resolveRule` 返回 `root_unresolvable`（终止，见 §6.4）；不使用 `needs_feature`。

## 4. 解析类型与语义

单文件解析、规则链解析、级联解析的返回类型分开，避免把跨文件冲突误归到单文件：

```text
parseFile(text)                -> { state: 'absent' | 'ok' | 'malformed', value?, line?, reason? }
resolveRule(input)             -> { state: 'absent' | 'ok' | 'conflict' | 'malformed'
                                          | 'needs_feature' | 'root_unresolvable',
                                    dir?, sources[], reason? }
resolveOutputPath(options)     -> { level, dir, file, root, sources[], warnings[], error? }

input = { workspaceRoot, docDirRel, docDirBase, operation,
          existingShellVariant? }        // operation 'create' | 'refresh'
```

- `resolveRule` **必须**接收：
  - `docDirRel`（本次被打包目录的仓库相对 POSIX 路径）与 `docDirBase`（其 basename）——没有它们无法计算 S2 目录，也无法替换 S1 的 `{feature}`；
  - `operation`（`create` | `refresh`）；
  - `existingShellVariant`（`'complete'` | `'lite'` | `null`）——刷新时判定"与既有 Taco 的 shell 变体一致"所必需；新建时为 `null`。
- `conflict` 只可能出现在 `resolveRule`；`malformed` 可能来自任一文件。
- `needs_feature` 的产生位置：`docDirBase` 缺失或无法安全作为路径段（例如含 `/`、`.`、`..`），且该值被 S1 的 `{feature}` 或 S2 需要时——`resolveRule` 返回 `needs_feature`（由 `resolveOutputPath` 转成终止性错误），**不降级**到 L3/L4/L5。
- `root_unresolvable` 的产生位置：`docDirRel` 为空（被打包目录就是仓库根，见 §6.4）。与 `needs_feature` 互斥：仓库根用前者，basename 不可用用后者。
- `{feature}` 的取值 = `docDirBase`（即 `basename(docDir)`），由调用方传入的 DOC_DIR 推导，不接受手工输入的 `--feature`；`docDirRel` 只用于 S2 的目录值，不参与 `{feature}` 替换。

## 5. 决策级联

| 级别 | 条件 | 目标 |
| --- | --- | --- |
| L0 | 用户本次请求中显式给出输出位置 | 见 §5.1 |
| L1 | 本次是刷新既有 `.taco.html` | 该文件现有路径 |
| LP | 用户/会话明确本次文档属于个人或跨项目 | `~/Documents/Tacos/`（见 §5.2） |
| L2 | §3 的 S1/S2 任一成立 | 规则目录 |
| L3 | 仓库内存在 `docs/`、`doc/`、`documents/`、`specs/` | 首个存在者之下的 `Tacos/` |
| L4 | 是 git 仓库但无上述目录 | `<repo>/Tacos/` |
| L5 | 非 git 上下文 | `~/Documents/Tacos/` |

优先关系：`L0 > L1 > LP > L2 > L3 > L4`。LP 高于 L2，因为它和用户指令同级：在 git 仓库里处理一份明确的个人/跨项目文档时，不应被项目规则或目录探测改道。

### 5.1 L0 的精确语义

`--requested <path>` 接受两种形态，其余一律拒绝：

1. **目录** → 目标文件为 `<该目录>/<portableTitleBase(title)>.taco.html`。
2. **以 `.taco.html` 结尾的文件路径，且文件名 stem 已等于 `portableTitleBase(title)`** → 直接使用。

拒绝（`malformed`，并给出"要么改标题、要么改请求路径"的具体提示）：

- 文件路径但不是 `.taco.html`；
- 文件 stem 与 `portableTitleBase(title)` 不一致（`pack.mjs:838-841` 会以 `Taco title requires filename …` 拒绝，设计上在解析阶段前置拦截）。

`title` 的缺省回退必须与 `pack.mjs` 一致（否则解析与打包会对同一输入给出不同判断）：

```text
title = --title ?? 既有 bundle 的 title ?? portableTitleBase(root)
```

`portableTitleBase` 与 `pack.mjs:64-69` 同算法：NFKC 归一化 → 非字母数字下划线连字符替换为 `_` → 折叠/裁剪 `_`、`-` → 空值回退 `Untitled`。

**`--title` 必须"未给即不传"**：`pack.mjs:836` 用 `options.get('title') ?? priorBundle?.title ?? portableTitleBase(rootPath)`，传入空字符串会得到 `''` → stem `Untitled`，与省略时的结果不同。写盘序列只在确实有标题时才加 `--title`。

**禁区优先于 L0**：目标落在 skill 目录、extension 目录、模板目录、`node_modules/`、`.git/` 之内时，无论谁指定都拒绝写盘（`forbidden`）。

### 5.2 LP 与上下文判定

- `LP` 的触发输入是显式的：会话中用户说明"这是个人文档/跨项目随手生成"，或 CLI `--personal`。二者都视为用户指令级别，命中后直接给 `~/Documents/Tacos/`。
- `workspaceRoot` = 对 `docDir`（缺省 cwd）执行 `git rev-parse --show-toplevel`；`docDir` 是子目录时以其 git 顶层为 `workspaceRoot`，并校验 `docDir` 位于顶层之内。
- 未给 `--personal` 且解析不到仓库根 → L5（个人上下文）；若 `docDir`/cwd 存在工程标志（`package.json`、`pyproject.toml` 等）则附 `workspaceRoot-not-git` 告警，但仍按 L5，不自动升级为 L4。
- 个人归档目录 = `HOME ?? USERPROFILE` 下的 `Documents/Tacos`（Windows 用 `%USERPROFILE%`）。两者皆缺失 → `needs_home`，停止并报告，不落到 cwd。

### 5.3 路径安全

所有目标路径（含 L0 绝对路径）写盘前统一校验：

- 解析 `realpath` 的**已存在前缀**，要求其真实路径不落在禁区（§5.1）之内；目录内中途替换的符号链接同样按 `realpath` 判定。
- 目标文件若已存在且是符号链接 → 拒绝（与 `pack.mjs:786-787` 一致）。
- 目标文件已存在、且其 `docId` 既不是本次要刷新的既有 Taco 的，也不是本次迁移来源的 → `conflict`，停止；**不得**让 `pack.mjs:854-860` 把它当作 prior bundle 合并。

## 6. 刷新、迁移与首次创建

### 6.1 刷新（L1）

目标路径与 bundle `root` 保持不变；`docId`、`comments`、`navigation`、`checkpoints`（含文档状态）与未知字段全部保留。`root` 从既有 bundle 读取后原样传入（`pack.mjs:790-791` 强制 `priorBundle.root === --root`）。

### 6.2 迁移（仅用户显式要求）

顺序固定，先建目录再复制，避免 `cp` 因父目录缺失失败：

1. 读取并校验旧 bundle（`docId`、`root`、`comments`、`checkpoints`、未知字段）；
2. `mkdir -p` 新目标的父目录；
3. 把旧 `.taco.html` **复制**到新路径（此时新路径 bundle 与旧文件逐字段相同）；
4. 对新路径打包；`pack.mjs` 会把该副本当 prior bundle 合并，从而保留身份与全部状态；
5. 校验新文件 `docId` 与旧文件一致，`comments`/`checkpoints`/`navigation` 逐字段相同；
6. 报告"旧路径 → 新路径"；**不删除**旧文件，除非用户显式要求。

### 6.3 首次创建

目标父目录可能不存在，写盘环节必须 `mkdir -p` 后再打包（`pack.mjs:701-703` 的 `atomicWrite` 在目标目录内写临时文件，不创建父目录）。

### 6.4 `root` 的确定（与产物位置相互独立）

| 情形 | `root` |
| --- | --- |
| 刷新 | 既有 bundle 的 `root`，读取后原样使用，不重新推导 |
| 新建，项目有约定 | 项目约定值（本仓库既有形态为 feature 目录的 basename，与 `specs/011-*` 的 `root = 011-checkpoint-document-instruction` 同形） |
| 新建，无约定 | `basename(docDir)`（= `pack.mjs:780` 的默认值） |

`root` 必须**显式**传给 `pack.mjs`，不得依赖默认值；解析器把它放在返回值的 `.root` 字段并打印。

**边界：`docDir` 等于仓库根**（`docDirRel` 为空）：本设计**不支持**该打包形态——空 `--root` 被 `pack.mjs:47-51` 拒绝，写成 `.` 虽能通过 root 校验，却会生成 `./<file>` 形式的 `files[].path`，不满足文件路径安全规则（`pack.mjs:47-49,206-208`）。此时返回 `root_unresolvable` 并停止，提示用户改为指向一个子目录。S2 在同一情形下同样不适用。

### 6.5 幂等

相同输入（workspace、`docDir`、operation、既有文件、用户指令、规则文件内容）→ 相同目标路径、文件名与 `root`。

## 7. 报告

写盘前必须能报告：命中级、规则来源（用户指令 / 既有文件 / S1 的 `文件:行` / S2 扩展）、目标**绝对路径**、**文件名**、以及 `root`，并附告警：

| 告警 | 条件 | 后果 |
| --- | --- | --- |
| `gitignored` | `git check-ignore` 命中目标 | 仍写盘；报告"不会被纳入版本控制"；不改 `.gitignore` |
| `git-unavailable` | `git` 不可用 | 仍写盘；跳过忽略检查 |
| `workspaceRoot-not-git` | 见 §5.2 | 按 L5 处理 |
| `root_unresolvable` | 见 §6.4 | 停止 |

失败一律不写盘，也不"取最合理的一个"。

## 8. 示例

### 8.1 合法

```markdown
taco-output-dir: docs/Tacos
```

```markdown
taco-output-dir: specs/{feature}
```

DOC_DIR = `specs/012-agent-taco-output-path` 时 → `specs/012-agent-taco-output-path`，产物 `specs/012-agent-taco-output-path/012-agent-taco-output-path.taco.html`。

### 8.2 非法

| 输入 | 原因 |
| --- | --- |
| `taco-output-dir: /abs/Tacos` | 绝对路径 |
| `taco-output-dir: ~/Documents/Tacos` | 家目录简写；规则只允许仓库相对路径 |
| `taco-output-dir: ../outside` | 越出仓库根 |
| `taco-output-dir: docs\Tacos` | 反斜杠 |
| `taco-output-dir: docs/Tac*s` | 通配符 |
| `taco-output-dir: docs/review.taco.html` | 声明的是目录 |
| `taco-output-dir: specs/{feature}/{feature}` | 占位符重复（每个至多一次） |
| `taco-output-dir: specs/{sprint}` | 未知占位符 |

### 8.3 边界

以下两处**都不算**声明：

- HTML 注释形式：`<!-- taco-output-dir: docs/Tacos -->`
- 位于 fenced code block 内的一行 `taco-output-dir: docs/Tacos`

同一文件里既有示例又有真实声明时，以真实声明为准；只有示例则视为未声明。

## 9. 向后兼容

- `pack.mjs` 直接调用时行为完全不变：`--out` 默认值仍是 `<DOC_DIR>/<portableTitleBase(title)>.taco.html`，`--root` 默认仍是 `basename(DOC_DIR)`。
- 按本契约运行的 Agent：**未声明规则的仓库**不再默认写 cwd 根，而按 L3/L4/L5 落盘。这是有意的行为变更，必须在 `skills/taco/SKILL.md` 与安装文档中显式说明。
- 无 schema 变更；既有 `.taco.html` 不受影响。
- 完全未安装本 reference 的旧版 skill：行为与引入前一致（回落到 `pack.mjs` 默认值），不会因缺少本契约而失败。

## 10. 契约演进

键名、查找链、失败语义的变更属于契约变更，必须同步：本文件（或迁移后的 `skills/taco/references/output-path.md`）、`skills/taco/scripts/output-path.mjs`、`tests/output-path.test.ts`、`skills/taco/SKILL.md` 的摘要。未来要支持绝对路径或更多占位符时，必须显式扩展 `value` 语法并定义冲突与安全规则，不得由实现自行放宽。
