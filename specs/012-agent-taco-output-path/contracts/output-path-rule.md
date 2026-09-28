---
title: 'Taco 输出目录与规则契约（设计稿）'
status: 'Draft'
---

> **迁移说明**：本文件是设计期的权威契约草稿。实现阶段（`tasks.md` T2）把本文内容**原样迁入** `skills/taco/references/output-path.md`，并把本文件替换为指向该路径的指针文件（标题 + 迁移说明 + 链接），使任何时刻只有**一份**可漂移的权威契约。理由：安装只拷贝 `skills/taco/**`，`specs/**` 不会被安装，权威必须落在安装可见的路径上。

## 1. 目的与范围

定义两件事，供任何消费 Taco skill 的 Agent 执行：

1. **规则声明**：项目如何用一行机器可读的声明指定 `.taco.html` 的输出目录。
2. **决策级联**：没有声明或声明不适用时，产物应落在哪。

不在范围内：bundle `taco/files` v1 的结构与 `root` 语义、`pack.mjs` 的 `--out` 参数语义与默认值、Spec Kit 扩展的安装方式。

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
| 未闭合围栏/注释 | 扫描到未闭合的 fenced code block 或 HTML 注释即 `malformed`（不按"无声明"降级） |
| 符号链接 | 规则文件本身是符号链接即 `malformed`（与 `extensions/taco/bin/taco.mjs` 的 `readPolicyFile` 一致） |
| 目录存在性 | 声明不要求目录已存在；由写盘环节创建 |

## 3. 规则来源（两条，同属 L2）

| 来源 | 产生条件 | 规则值 |
| --- | --- | --- |
| S1 显式声明 | 指令文件中有 `taco-output-dir` | 声明的 `<value>` |
| S2 扩展约定 | 项目**实际安装了** Taco Spec Kit 扩展（存在 `.specify/extensions/taco/assets/taco-shell.html` 或 `taco-shell-lite.html`） | `{feature_dir}/`（`feature_dir` = 本次被打包目录的仓库相对路径） |

判定规则：

- 只有 S1 → 用 S1。
- 只有 S2 → 用 S2。
- S1 与 S2 同时存在：若解析后**指向同一目录**则取该目录；否则 `conflict`，停止并列出两个来源。
- 仅有 `.specify/`（已初始化 Spec Kit 但未安装 Taco 扩展）→ **不产生规则**，继续通用级联。不得因为 `.specify/` 的存在而改变输出位置。

## 4. 解析类型与语义

单文件解析与全链解析的返回类型必须分开，避免把跨文件冲突误归到单文件：

```text
parseFile(text) -> { state: 'absent' | 'ok' | 'malformed', value?, line?, reason? }
resolveRule(chain) -> { state: 'absent' | 'ok' | 'conflict' | 'malformed', dir?, sources[], reason? }
```

`conflict` 只可能出现在 `resolveRule`；`malformed` 可能来自任一文件。

`{feature}` 的取值 = **本次被打包目录（DOC_DIR）的 basename**，由调用方传入 DOC_DIR 推导，不接受手工输入的 `--feature`。含 `{feature}` 且 DOC_DIR 缺失、DOC_DIR 等于仓库根、或 basename 无法安全作为路径段时 → `needs_feature`，停止并询问用户；**不得**降级到其他级别。

## 5. 决策级联

| 级别 | 条件 | 目标 |
| --- | --- | --- |
| L0 | 用户本次请求中显式给出输出位置 | 见 §5.1 |
| L1 | 本次是刷新既有 `.taco.html` | 该文件现有路径 |
| L2 | §3 的 S1/S2 任一成立 | 规则目录 |
| L3 | 仓库内存在 `docs/`、`doc/`、`documents/`、`specs/` | 首个存在者之下的 `Tacos/` |
| L4 | 是 git 仓库但无上述目录 | `<repo>/Tacos/` |
| L5 | 非 git 上下文（或明确为跨项目/个人文档） | `~/Documents/Tacos/` |

### 5.1 L0 的精确语义

`--requested <path>` 接受两种形态，其余一律拒绝：

1. **目录** → 目标文件为 `<该目录>/<portableTitleBase(title)>.taco.html`。
2. **以 `.taco.html` 结尾的文件路径，且文件名 stem 已等于 `portableTitleBase(title)`** → 直接使用。

拒绝（`malformed`，并给出"要么改标题、要么改请求路径"的具体提示）：

- 文件路径但不是 `.taco.html`；
- 文件 stem 与 `portableTitleBase(title)` 不一致（`pack.mjs` 会以 `Taco title requires filename …` 拒绝，设计上在解析阶段就前置拦截）。

`portableTitleBase` 与 `pack.mjs` 第 64–69 行同算法：NFKC 归一化 → 非字母数字下划线连字符替换为 `_` → 折叠/裁剪 `_`、`-` → 空值回退 `Untitled`。

**禁区优先于 L0**：目标落在 skill 目录、extension 目录、模板目录、`node_modules/`、`.git/` 之内时，无论谁指定都拒绝写盘（`forbidden`），并报告该路径。

### 5.2 上下文判定

- `workspaceRoot` = 对 DOC_DIR（缺省为 cwd）执行 `git rev-parse --show-toplevel`；成功即为项目上下文（L2–L4）。若 DOC_DIR 传入的是子目录，仍以其 git 顶层作为 `workspaceRoot`，并校验 DOC_DIR 位于该顶层之内。
- 失败（不在任何仓库内）→ 个人上下文（L5）。此时若 DOC_DIR 与 cwd 明显属于某个工程目录树（存在 `.git` 之外的工程标志如 `package.json`、`pyproject.toml`），报告 `workspaceRoot-not-git` 告警但仍按 L5 处理、不自动升级为 L4。
- 个人归档目录 = `process.env.HOME ?? process.env.USERPROFILE` 下的 `Documents/Tacos`（Windows 用 `%USERPROFILE%`）。两者都缺失 → `needs_home`，停止并报告，不落到 cwd。

### 5.3 路径安全

所有目标路径（含 L0 绝对路径）写盘前统一校验：

- 解析 `realpath` 的**已存在前缀**，要求其真实路径不落在禁区（§5.1）之内；目录内出现中途替换的符号链接同样按 `realpath` 判定。
- 目标文件若已存在且是符号链接 → 拒绝（与 `pack.mjs` 第 786–787 行一致）。
- 目标文件已存在、且其 `docId` 既不是本次要刷新的既有 Taco 的 `docId`，也不是本次迁移的来源 `docId` → `conflict`，停止；**不得**让 `pack.mjs` 把它当作 prior bundle 合并。

## 6. 刷新与迁移

- **刷新（L1）**：目标路径与 bundle `root` 保持不变；`docId`、`comments`、`navigation`、`checkpoints`（含文档状态）与未知字段全部保留。`root` 从既有 bundle 读取，`pack.mjs` 会强制 `priorBundle.root === --root`。
- **迁移**：仅在用户显式要求时发生（L0 指定新位置 + 已存在旧文件）。执行顺序必须保证审阅状态不丢：
  1. 读取并校验旧 bundle（`docId`、`root`、`comments`、`checkpoints`、未知字段）；
  2. 把旧 `.taco.html` **复制**到新路径（此时新路径的 bundle 与旧文件逐字段相同）；
  3. 对新路径执行打包，`pack.mjs` 会把新路径上的副本当作 prior bundle 合并，从而保留身份与全部状态；
  4. 校验新文件 `docId` 与旧文件一致、`comments`/`checkpoints`/`navigation` 未丢失；
  5. 报告"旧路径 → 新路径"；**不删除**旧文件，除非用户显式要求。
- 目标父目录不存在时，由写盘环节先创建（`mkdir -p`）再打包；`pack.mjs` 只负责原子写文件，不创建父目录。
- 重复执行同一决策输入必须逐字节可复现（同一目录、同一文件名）。

## 7. 报告

写盘前必须能报告：命中级别、规则来源（用户指令 / 既有文件 / S1 文件:行 / S2 扩展 / 探测到的目录）、目标绝对路径、文件名，以及告警：

| 告警 | 条件 | 后果 |
| --- | --- | --- |
| `gitignored` | `git check-ignore` 命中目标 | 仍写盘；报告"不会被纳入版本控制"；不改 `.gitignore` |
| `git-unavailable` | `git` 不可用 | 仍写盘；跳过忽略检查 |
| `workspaceRoot-not-git` | 见 §5.2 | 按 L5 处理 |

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
| `taco-output-dir: specs/{feature}/{feature}` | 重复占位符当前不受支持 |
| `taco-output-dir: specs/{sprint}` | 未知占位符 |

### 8.3 边界

以下两处**都不算**声明：

- HTML 注释形式：`<!-- taco-output-dir: docs/Tacos -->`
- 位于 fenced code block 内的一行 `taco-output-dir: docs/Tacos`

同一文件里既有示例又有真实声明时，以真实声明为准；只有示例则视为未声明。

## 9. 向后兼容

- `pack.mjs` 直接调用时行为完全不变：`--out` 默认值仍是 `<DOC_DIR>/<portableTitleBase(title)>.taco.html`。
- 按本契约运行的 Agent：**未声明规则的仓库**不再默认写 cwd 根，而按 L3/L4/L5 落盘。这是有意的行为变更，必须在 `skills/taco/SKILL.md` 与安装文档中显式说明。
- 无 schema 变更；既有 `.taco.html` 不受影响。
- 完全未安装本 reference 的旧版 skill：行为与引入前一致（回落到 `pack.mjs` 默认值），不会因缺少本契约而失败。

## 10. 契约演进

键名、查找链、失败语义的变更属于契约变更，必须同步：本文件（或迁移后的 `skills/taco/references/output-path.md`）、`skills/taco/scripts/output-path.mjs`、`tests/output-path.test.ts`、`skills/taco/SKILL.md` 的摘要。未来要支持绝对路径或更多占位符时，必须显式扩展 `value` 语法并定义冲突与安全规则，不得由实现自行放宽。
