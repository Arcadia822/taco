---
title: '012-agent-taco-output-path 技术方案'
feature_id: '012-agent-taco-output-path'
created: '2026-09-28'
status: 'Draft'
---

## 1. 实现策略

本特性的实现是"一份契约 + 一个确定性解析器 + 若干文档接线"，不触碰 bundle 运行时。

```text
契约（权威）
  specs/012-agent-taco-output-path/contracts/output-path-rule.md
        │
        ├── skills/taco/references/output-path.md      面向 Agent 的操作说明（含级联表）
        │        └── skills/taco/SKILL.md              摘要 + 指引
        ├── skills/taco/scripts/output-path.mjs        可执行实现（parse + resolve）
        │        └── tests/output-path.test.ts
        ├── docs/agent-installation.md                 安装/使用侧指引
        └── extensions/taco/{commands/update.md, skills/taco-speckit/SKILL.md, README.md}
                                                       扩展侧声明 feature 目录规则 ≡ L2
```

原则：契约文件是唯一权威；其余位置只做摘要与引用，禁止复述第二份语法表。

## 2. 解析器设计（`skills/taco/scripts/output-path.mjs`）

与 `pack.mjs`、`checkpoints.mjs` 同级：skill 自带的 Node 辅助脚本，不是 `taco-cli`，不参与安装步骤，无外部依赖。

### 2.1 导出

```js
export const RULE_KEY = 'taco-output-dir'
export const RULE_FILES = ['AGENTS.md', 'CLAUDE.md', '.cursorrules']

// 剥离 fenced code block 与 HTML 注释后，按契约语法解析单个文件文本
// -> { state: 'absent' | 'ok' | 'malformed', value?, line?, reason? }
export function parseOutputDirRule(text)

// 全量决策
// -> { level, dir, file, evidence[], warnings[], error? }
export function resolveOutputPath(options)
```

`options`：`{ workspaceRoot, requestedPath?, existingTacoPath?, featureName?, title?, homeDir?, isGitRepo? }`。

### 2.2 决策顺序

与 spec.md 3.1 一一对应，实现上写成显式分支，便于测试与报告：

1. `requestedPath` → `L0`。
2. `existingTacoPath`（且 `requestedPath` 未给）→ `L1`。
3. 依次读 `RULE_FILES`，`parseOutputDirRule`；`ok` → `L2`；`malformed`/链内冲突 → 返回 `error`。
4. 探测 `docs` → `doc` → `documents` → `specs`（仅目录，按此顺序）→ `L3`，目录为 `<found>/Tacos`。
5. `isGitRepo` → `L4`，`<repo>/Tacos`。
6. 否则 `L5`，`<homeDir>/Documents/Tacos`。

通用步骤：

- 路径安全校验（相对性、无 `..`/反斜杠/空段/通配符）复用同一套检查函数；`{feature}` 替换后再次校验并与 `workspaceRoot` 做包含性判断。
- 目标文件名 = `<title 归一化 stem>.taco.html`，与 `pack.mjs` 的 `portableTitleBase` 保持一致的归一化规则（复用同一算法，不复制实现细节）。
- `git check-ignore` 命中目标目录或目标文件 → 追加 `gitignored` 告警（不失败）。实现上用 `git check-ignore -q` 的退出码；`git` 不可用时跳过并记录 `git-unavailable` 告警。
- 不创建任何目录（那是写盘动作）：解析器只返回路径。

### 2.3 CLI

```sh
node skills/taco/scripts/output-path.mjs --workspace <dir> [--requested <path>] \
  [--existing <file.taco.html>] [--feature <name>] [--title "<Title>"] [--home <dir>] [--json]
```

- 人类可读输出：`level L2 → /abs/path/dir (AGENTS.md: taco-output-dir)` 一行 + 告警行。
- `--json` 输出结构化结果，供 Agent 与其他脚本消费。
- 失败（`error`）以非 0 退出码返回，`--json` 时同时打印 `error` 字段。

### 2.4 与 `pack.mjs` 的联动

`pack.mjs` **不改**。解析器输出即 `--out` 的建议值：

```sh
OUT=$(node skills/taco/scripts/output-path.mjs --workspace "$PWD" --title "$TITLE" --json | jq -r .file)
node skills/taco/scripts/pack.mjs --dir "$DOC_DIR" --title "$TITLE" --out "$OUT"
```

测试中做一次联动断言：解析器给出的 `dir` 与 `pack.mjs --out` 实际写入位置一致。

## 3. 文档接线

### 3.1 `skills/taco/references/output-path.md`（新增）

面向 Agent 的操作说明：级联表、`{feature}` 语义、刷新/迁移规则、报告与告警清单、`taco-output-dir` 行格式与查找链、失败即停的四种情况、与本仓库/扩展的示例。语法细表引用契约文件，不复制。

### 3.2 `skills/taco/SKILL.md`

- 新增章节 `## Where to write .taco.html`，置于 `## Workflow` 之前，内容为：级联的一句话摘要 + 决策脚本调用 + "完整规则见 `references/output-path.md`"。
- Workflow 步骤 1 的 `pack.mjs` 命令示例补 `--out` 说明，指向该章节。
- Workflow 步骤 3（Present and open）保持原样：路径决策不改变"呈现 + 打开 + 如实报告"的要求。
- 语言：`SKILL.md` 与 references 为机器/协议文档，保持既有英文，不因本设计改为中文。

### 3.3 `docs/agent-installation.md`

在 "Use the skill" 步骤 1 增加一句：产物目标目录由 `references/output-path.md` 的级联决定，默认不再落在 cwd，并链接该 reference。

### 3.4 `extensions/taco/`

- `commands/update.md`：在步骤 1 或 2 明确"在已初始化扩展的 Spec Kit 项目中，`<FEATURE_DIR>/<feature-name>.taco.html` 等价于 L2 项目规则，级联不得再落到 `docs/Tacos/` 或 `Tacos/`"。
- `skills/taco-speckit/SKILL.md`：同上，一行。
- `README.md`：一行 + 指向契约文件。

### 3.5 `AGENTS.md`（本仓库自我应用）

在 "Taco contributor agent rules" 之外新增一个小节或一行声明：

```markdown
taco-output-dir: specs/{feature}
```

使设计规格的评审产物与其源文档同目录，与 `specs/011-*` 既有形态一致。注意 `tests/agent-instructions.test.ts` 断言 AGENTS.md 不含 `taco_scope:` / `category:`，本键不冲突。

### 3.6 `skills/taco/templates/` 与镜像

`skills/taco/templates/` 是 `extensions/taco/templates/` 的生成镜像（见 AGENTS.md），本设计不修改模板内容，因此无需重新生成。若实现过程中改动模板，必须按既有脚本重新生成镜像而不是手改。

## 4. 测试

`tests/output-path.test.ts`（vitest，风格对齐 `tests/skill-pack.test.ts`：`mkdtempSync` 构造 fixture，直接调用导出函数，必要时 `execFileSync` 跑 CLI）。

覆盖 spec.md 7.1 的 10 项。断言要点：

- 级联级别的**选择**（不只是最终字符串），因为 L2 与 L3 可能巧合地指向同名目录。
- 每个 `error` 分支的**原因码**（`conflict` / `malformed` / `needs_feature`），而不是只断言"抛错"。
- 幂等：同一输入两次调用深比较相等。
- `git check-ignore` 分支用真实 `git init` fixture（临时目录），避免 mock 掉 git 行为。

## 5. 兼容性

- 无 schema 变更；既有 `.taco.html` 不受影响，刷新后路径与 `root` 不变。
- 未声明 `taco-output-dir` 的仓库行为变化仅在于 L3/L4/L5 的兜底：不再默认写 cwd 根，而是写探测目录。这是本特性的目的，属于**有意的行为变更**，需在 skill 与安装文档中显式说明。
- `pack.mjs` 的 `--out` 默认值保持 `<DOC_DIR>/<Title>.taco.html`，以保证直接调用脚本的既有用法不变；Agent 通过级联显式传入 `--out`。

## 6. 实施顺序

1. 契约文件定稿（review 通过后再动手实现）。
2. `scripts/output-path.mjs` + 测试；跑通 10 项。
3. `references/output-path.md` + `SKILL.md` 章节。
4. `docs/agent-installation.md`、`extensions/taco/` 三处接线。
5. 本仓库 `AGENTS.md` 声明 + 五类场景端到端核对。
6. 更新需要同步的 skill/官网内容（若涉及），并按仓库规则提供预览。

## 7. 验证与交付

- `npm test`（含新测试）与 `npm run check` 通过。
- 对真实仓库执行一次解析 + 打包冒烟，`pack.mjs verify` 无 warning。
- 按 AGENTS.md 要求，开发完成后构建并交付一个 `.taco.html`（本设计评审载体）供直接打开核对。
