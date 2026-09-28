---
title: 'Taco 输出目录规则契约'
---

## 1. 目的

本文件是 `taco-output-dir` 声明的**权威语法契约**。`skills/taco/references/output-path.md`、`skills/taco/SKILL.md`、`extensions/taco/` 下的命令与 skill 都引用它，不各自复述一份。

## 2. 声明语法

在项目的 Agent 指令文件中，声明占**一整行**：

```text
taco-output-dir: <value>
```

精确语法（ABNF 风格）：

```text
line          = key ":" SP value
key           = "taco-output-dir"          ; 大小写不敏感
value         = segment *("/" segment)     ; 不含首尾 "/"
segment       = "{" placeholder "}" / 1*( ALPHA / DIGIT / "_" / "." / "-" )
placeholder   = "feature"                  ; 目前唯一受支持的占位符
```

规则约束：

| 约束 | 说明 |
| --- | --- |
| 每文件至多一条 | 同一文件内出现两条（含相同值）即视为畸形，解析失败 |
| 查找链 | `AGENTS.md` → `CLAUDE.md` → `.cursorrules`，取第一个声明者；链内出现两个不同值即冲突，解析失败 |
| 位置限定 | 位于 fenced code block 或 HTML 注释内的同名行**不算**声明 |
| 相对性 | `value` 必须相对**仓库根**；禁止首部 `/`、`~`、盘符、`\` |
| 安全段 | 禁止空段、`.`、`..` |
| 无通配 | 禁止 `*`、`?`、`[`、`]` |
| 非产物 | `value` 不得以 `.taco.html` 结尾（声明的是目录，不是文件） |
| 占位符封闭 | 只认 `{feature}`；出现其他 `{...}` 或未闭合 `{` 即解析失败 |
| 文件必存在性 | 声明本身不要求目录已存在；写盘时按需创建 |

## 3. 解析语义

```text
parse(text) -> declaration | absent | error
resolve(workspace_root, declaration, feature_name) -> dir | needs_feature | error
```

1. `parse` 逐行扫描，先剥离 fenced code block 与 HTML 注释，再匹配 `line`。
2. `resolve`：
   - 无 `{feature}`：`dir = workspace_root / value`。
   - 含 `{feature}` 且 `feature_name` 已确定（被打包目录的 basename）：替换后解析。
   - 含 `{feature}` 但无法确定 `feature_name`：返回 `needs_feature`，由调用方停止并询问用户；**不得**降级到其他级别。
3. 解析完成后必须校验 `dir` 落在允许范围内（对项目规则：位于 `workspace_root` 之内）。

## 4. 返回值与失败

| 结果 | 触发条件 | 调用方行为 |
| --- | --- | --- |
| `absent` | 链中无任何声明 | 落回级联下一级（L3） |
| `ok` | 恰好一条声明且值合法可解析 | 使用该目录 |
| `conflict` | 链中 ≥2 个文件声明了不同值 | 停止，列出冲突来源与取值，请用户裁决 |
| `malformed` | 同一文件 ≥2 条、值非法、含未知占位符 | 停止，指出文件、行号与原因 |
| `needs_feature` | 含 `{feature}` 但无 feature 上下文 | 停止并询问；不得静默降级 |

失败一律**不写盘**，也不"取最合理的一个"。

## 5. 与级联其他级别的关系

- 声明命中即为 spec.md 3.1 的 **L2**，优先于 L3（文档目录探测）与 L4（仓库根 `Tacos/`）。
- 声明不覆盖 L0（用户本次显式指定）与 L1（刷新既有 Taco）。即：**用户本次说了算 > 既有产物路径不变 > 项目声明 > 探测**。
- 已初始化 Taco Spec Kit 扩展的项目，其 `<FEATURE_DIR>/<feature-name>.taco.html` 约定等价于一条 L2 声明，无需再写 `taco-output-dir`；两者都存在且不一致时按 `conflict` 处理。

## 6. 示例

### 6.1 合法

```markdown
# AGENTS.md

taco-output-dir: docs/Tacos
```

→ 产物目录 `docs/Tacos`。

```markdown
taco-output-dir: specs/{feature}
```

被打包目录为 `specs/012-agent-taco-output-path` 时 → `specs/012-agent-taco-output-path`，产物 `specs/012-agent-taco-output-path/012-agent-taco-output-path.taco.html`。

### 6.2 非法

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

### 6.3 边界

以下两处**都不算**声明：

- HTML 注释形式：`<!-- taco-output-dir: docs/Tacos -->`
- 位于 fenced code block 内的一行 `taco-output-dir: docs/Tacos`

若一个文件里既有"注释/代码块中的示例"又有"真实声明"，以真实声明为准；若只有示例，视为未声明。

## 7. 兼容与演进

- 键名与语义的变更属于契约变更，需要同步本文件、`skills/taco/references/output-path.md` 与解析器测试。
- 未声明的项目：行为与引入本契约前完全一致（回落 L3/L4/L5），不产生新的必填项。
- 未来若需支持绝对路径或更多占位符，必须显式扩展 `value` 语法并给出冲突与安全规则，不得由实现自行放宽。
