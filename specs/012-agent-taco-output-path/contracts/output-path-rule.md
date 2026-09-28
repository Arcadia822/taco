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

- 只规定**产物的位置与文件名**，以及项目规则的语法与失败语义。
- 不规定 bundle 的数据结构、`root` 语义、序列化与转义规则（那是 `skills/taco/references/bundle-format.md` 的权威内容）。
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
| `version` | 否 | 省略视为 1；给出且 ≠ 1 → 拒绝（不按旧规则误读更新版 schema） |
| `outputDir` | 是（规则生效时） | 输出目录，**仓库相对** POSIX 路径，可含一个 `{feature}` 占位符 |

解析规则：

| 情形 | 结果 |
| --- | --- |
| 文件不存在 | 无规则（落到级联下一级） |
| YAML 解析失败 | `malformed`，停止；不猜测 |
| 文件存在但无 `outputDir` | `malformed`（项目声明了 Taco 配置却没有输出目录，属配置错误，不静默忽略） |
| `outputDir` 为空串或非字符串 | `malformed` |
| `.taco/` 或 `config.yaml` 是符号链接 | `malformed`，停止（与仓库既有的策略文件读取策略一致） |
| 出现未知键 | 忽略，不报错（前向兼容；Agent 不因未知键改写该文件） |

`outputDir` 取值约束（安全，等价于路径段规则）：

- 必须相对**仓库根**：禁止首部 `/`、`~`、盘符、反斜杠。
- 禁止空段、`.`、`..`。
- 禁止通配符 `*` `?` `[` `]`。
- 不得以 `.taco.html` 结尾（声明的是目录）。
- `{feature}` **至多出现一次**；其他 `{...}` 或未闭合 `{` → `malformed`。
- `{feature}` 的替换值 = **被打包目录（DOC_DIR）的 basename**；DOC_DIR 缺失或 basename 无法安全作为路径段（含 `/`、`.`、`..`）→ `needs_feature`，停止并询问，不降级。

**写入权限**：`.taco/config.yaml` 是项目配置。Agent 只有在用户显式要求时才创建或修改它，绝不自动生成、绝不因为"顺手"而改写未知键。

## 3. 规则的第二个来源：已安装的扩展

| 来源 | 成立条件 | 规则值 |
| --- | --- | --- |
| S1 `.taco/config.yaml` | 见 §2 | `outputDir` 解析结果 |
| S2 扩展约定 | 项目**实际安装**了 Taco Spec Kit 扩展（存在 `.specify/extensions/taco/assets/taco-shell.html`；仅 lite shell 时只在刷新既有 Lite Taco 时成立） | 被打包目录（DOC_DIR）本身 |

- 只有 S1 → 用 S1；只有 S2 → 用 S2。
- 两者成立且**指向同一目录** → 用该目录。
- 两者成立且指向**不同**目录 → `conflict`，停止并列出两个来源。
- 仅有 `.specify/`（已初始化 Spec Kit 但未装 Taco 扩展）→ **不产生规则**，继续通用级联；不得因为 `.specify/` 的存在改变输出位置。
- S2 只是**承认扩展既有的落点约定**；扩展可独立安装且自包含，其正常工作不依赖本契约或任何 skill 文件。

## 4. 产出位置级联

| 级别 | 条件 | 产物 |
| --- | --- | --- |
| L0 | 用户本次显式给出输出位置 | 见 §4.1 |
| L1 | 本次是刷新既有 `.taco.html` | 该文件现有路径 |
| L2 | §3 的 S1 或 S2 成立 | 规则目录 |
| L3 | 仓库内存在 `docs/`、`doc/`、`documents/`、`specs/` | 首个存在者之下的 `tacos/` |
| L4 | 是 git 仓库但没有上述目录 | `<repo>/tacos/` |
| L5 | 非 git 上下文 | `~/Documents/tacos/` |

顺序固定，取第一个可用级。目录名统一小写 `tacos`。

### 4.1 L0 的精确语义

`--requested`（会话中用户给出的位置）接受两种形态：

1. **目录** → 产物 = `<该目录>/<标题的归一化文件名>`。
2. **以 `.taco.html` 结尾的文件路径** → 产物 = 该文件，且**该文件名 stem 就是 bundle 标题**（文件名决定标题）；用户此前若给过不同标题，以文件名 stem 为准并报告。

其他形态（非 `.taco.html` 的文件路径）→ `malformed`，提示改为目录或 `.taco.html`。

**文件名与标题的关系**：文件名 stem = 标题的归一化结果（NFKC → 非字母数字下划线连字符替换为 `_` → 折叠并裁剪 `_`/`-` → 空值回退 `Untitled`）。二者互为唯一对应，不存在"文件名与标题不一致"的合法状态。

**禁区优先于 L0**：产物落在 skill 目录、扩展目录、模板目录、`node_modules/`、`.git/` 之内时，无论谁指定都拒绝（`forbidden`）。

### 4.2 上下文判定

- `workspaceRoot` = 对 DOC_DIR（缺省 cwd）执行 `git rev-parse --show-toplevel`；DOC_DIR 是子目录时以该顶层为仓库根，并校验 DOC_DIR 位于其内。
- 解析不到仓库根 → L5（个人上下文）；若 DOC_DIR/cwd 存在工程标志（`package.json`、`pyproject.toml` 等）则附 `workspaceRoot-not-git` 告警，仍按 L5，不自动升级为 L4。
- 个人归档目录 = `HOME ?? USERPROFILE` 下的 `Documents/tacos`。两者皆缺失 → `needs_home`，停止并报告，不落到 cwd。
- **DOC_DIR 就是仓库根**时不特殊停止：产物按级联取 `<repo>/tacos/`。被打包内容与 bundle `root` 的合法性由落盘流程按 `references/bundle-format.md` 负责，不属于本契约。

### 4.3 路径安全

- 产物路径按 `realpath` 的**已存在前缀**判定：不得落在禁区（§4.1）之内，也不得通过中途替换的符号链接指向这些位置。
- 产物文件已存在且是符号链接 → 拒绝。

## 5. 刷新、迁移、首次创建

### 5.1 刷新（L1）

路径不变；`docId`、`comments`、`navigation`、`checkpoints`（含文档状态）、每个 file 的 `id` 与 `blocks` 缓存、以及未知字段全部保留。只替换本次意图变更的字段。

### 5.2 迁移（仅用户显式要求）

**占用预检必须排在复制之前**，否则会覆盖别人的评审文件：

1. 读取并校验旧文件的数据块（`docId`、`comments`、`checkpoints`、未知字段）；
2. 预检新目标：目标已存在且其 `docId` ≠ 旧文件的 `docId` → `conflict`，立即停止，**不建目录、不复制**；
3. 创建目标父目录（若不存在）；
4. 把旧 `.taco.html` 复制到新路径（此时新路径上是一份身份与状态完整的 Taco）；
5. 在新路径上按 §5.1 的刷新语义落盘；
6. 校验新文件的 `docId` 与 `comments`/`checkpoints`/`navigation` 逐字段与旧文件相同；
7. 报告"旧路径 → 新路径"。**不删除**旧文件，除非用户显式要求。

### 5.3 首次创建

- 目标父目录可能不存在：**先创建目录再写文件**。
- 目标文件若已存在且不是本次刷新/迁移的对象 → 见 §6 的占用规则。

### 5.4 占用规则

产物文件已存在时的判定：

| 情形 | 结果 |
| --- | --- |
| 是本次刷新的对象 | 正常刷新 |
| 是本次迁移的来源（已被复制到该路径） | 正常继续 |
| 其他 | `conflict`，停止并报告；不得把别人的评审文件当成刷新对象合并 |

### 5.5 幂等

相同输入（仓库根、DOC_DIR、操作类型、既有文件、用户指令、`.taco/config.yaml` 内容）→ 相同产物目录、文件名与标题。

### 5.6 无外部依赖的落盘方式

产物由 Agent 直接写入：复制技能自带的 shell（或既有 Taco）到目标路径，把 `taco/files` v1 bundle JSON 写进 `#taco-document` 数据块，并按标题写 `<title>`；文件其余字节不动。

- 不调用任何脚本、CLI 或运行时：不需要 Node、不需要 `pack.mjs`、不需要 `taco-cli`。
- 序列化、转义与原子替换的规则以 `skills/taco/references/bundle-format.md` 为权威；本契约不复制这些规则。
- 校验同样不依赖脚本：有评审标签时用 `window.taco.validate()`；否则按 `references/bundle-format.md` 的形态规则检查数据块可解析且满足必需字段。

## 6. 报告

落盘前必须能给出可核对的结论，并在交接报告里写明：

- 命中级别（L0–L5）与依据（用户指令 / 既有文件 / `.taco/config.yaml` / 扩展安装 / 探测到的目录）；
- 产物**绝对路径**、**文件名**与**标题**；
- 告警：`gitignored`（产物被 `git check-ignore` 命中 → 报告"不会被纳入版本控制"，仍落盘，**不改** `.gitignore`）、`git-unavailable`、`workspaceRoot-not-git`。

失败（`malformed` / `conflict` / `needs_feature` / `needs_home` / `forbidden`）一律不落盘，也不"取最合理的一个"。

## 7. 示例

### 7.1 合法

```yaml
# .taco/config.yaml
version: 1
outputDir: specs/{feature}
```

DOC_DIR = `specs/012-agent-taco-output-path` → 产物目录 `specs/012-agent-taco-output-path`，文件 `012-agent-taco-output-path.taco.html`。

```yaml
outputDir: docs/reviews
```

→ 产物目录 `docs/reviews`（目录不存在则先创建）。

### 7.2 非法

| 输入 | 原因 |
| --- | --- |
| `outputDir: /abs/tacos` | 绝对路径 |
| `outputDir: ~/Documents/tacos` | 家目录简写；规则只允许仓库相对路径 |
| `outputDir: ../outside` | 越出仓库根 |
| `outputDir: docs\tacos` | 反斜杠 |
| `outputDir: docs/tac*` | 通配符 |
| `outputDir: docs/review.taco.html` | 声明的是目录 |
| `outputDir: specs/{feature}/{feature}` | 占位符重复 |
| `outputDir: specs/{sprint}` | 未知占位符 |
| 文件存在但无 `outputDir` | 声明了配置却没有输出目录 |
| `version: 2` | 更新版 schema，拒绝误读 |

## 8. 向后兼容

- 未配置 `.taco/config.yaml` 的仓库：行为按 L3/L4/L5 落盘。**这是相对"默认写在 cwd 根"的有意变更**，必须在 `skills/taco/SKILL.md` 与安装文档写明。
- 无 schema 变更；既有 `.taco.html` 不受影响，刷新后路径与 `root` 不变。
- 不安装本 reference 的旧版 skill：行为与引入前一致。

## 9. 契约演进

键名、级联顺序、失败语义的变更必须同步：`skills/taco/references/output-path.md`、`skills/taco/SKILL.md` 的摘要、`docs/agent-installation.md`、`extensions/taco/` 的三处说明。未来要支持绝对路径或更多占位符，必须显式扩展语法并定义冲突与安全规则。
