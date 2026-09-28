---
title: '012-agent-taco-output-path 技术方案'
feature_id: '012-agent-taco-output-path'
created: '2026-09-28'
status: 'Draft'
---

## 1. 实现策略

"一份权威契约 + 一个确定性解析器 + 一条写盘序列 + 若干文档接线"，不触碰 bundle 运行时。

```text
权威契约（迁入后位于安装可见路径）
  skills/taco/references/output-path.md
        │
        ├── skills/taco/SKILL.md                 级联摘要 + 写盘序列 + 脚本调用
        ├── skills/taco/scripts/output-path.mjs  可执行实现（parseFile / resolveRule / resolveOutputPath）
        │        └── tests/output-path.test.ts   （含真实 pack.mjs 行为断言）
        ├── docs/agent-installation.md           reference 清单 + 一句指引
        └── extensions/taco/{commands/update.md, skills/taco-speckit/SKILL.md, README.md}
                                                 声明 S2 规则并链接同一契约
```

原则：契约只有一份；其余位置保留简短流程摘要并链接，不复制语法表与失败语义列表。

## 2. 解析器设计（`skills/taco/scripts/output-path.mjs`）

与 `pack.mjs`、`checkpoints.mjs` 同级：skill 自带的 Node 辅助脚本，不是 `taco-cli`；**不新增单独安装步骤**，但必须随 `skills/taco/scripts/**` 一并安装，并在安装核对清单中检查存在。

### 2.1 导出

```js
export const RULE_KEY = 'taco-output-dir'
export const RULE_FILES = ['AGENTS.md', 'CLAUDE.md', '.cursorrules']
export const EXTENSION_SHELLS = [
  '.specify/extensions/taco/assets/taco-shell.html',
  '.specify/extensions/taco/assets/taco-shell-lite.html',
]

// 单文件：剥离 fenced code block 与 HTML 注释后按契约语法解析
// -> { state: 'absent' | 'ok' | 'malformed', value?, line?, reason? }
export function parseFile(text)

// 全链：读取 RULE_FILES + 判定扩展安装，合并 S1/S2
// -> { state: 'absent' | 'ok' | 'conflict' | 'malformed', dir?, sources[], reason? }
export async function resolveRule(workspaceRoot)

// 级联
// -> { level, dir, file, sources[], warnings[], error? }
export async function resolveOutputPath(options)
```

`options`：`{ docDir, requestedPath?, existingTacoPath?, title?, workspaceRoot?, homeDir?, env? }`。

- `docDir` **必填**：`workspaceRoot`（缺省时由它推导）、`{feature}` 取值、`--root` 建议值均来自它。
- 不提供 `--feature` 覆盖；上下文不完整时返回 `needs_feature`。
- 导出 `portableTitleBase` 的同算法实现（供文件名与 `pack.mjs` 对齐），并在测试中断言与 `pack.mjs` 一致。

### 2.2 决策顺序

1. 目标路径**禁区检查**（`node_modules/`、`.git/`、skill/extension/templates 目录）——先于一切，含 L0。
2. 解析 `workspaceRoot`：`git rev-parse --show-toplevel`（以 `docDir` 为 cwd）；失败 → 个人上下文。
3. `requestedPath` → `L0`（校验形态：目录，或 stem 对齐的 `.taco.html`；否则 `malformed`）。
4. `existingTacoPath`（且无 `requestedPath`）→ `L1`。
5. `resolveRule(workspaceRoot)`：`ok` → `L2`；`conflict`/`malformed` → 终止。
6. 探测 `docs` → `doc` → `documents` → `specs`（仅目录，按序）→ `L3` = `<found>/Tacos`。
7. git 仓库 → `L4` = `<repo>/Tacos`；否则 `L5` = `<home>/Documents/Tacos`（`HOME ?? USERPROFILE`，皆缺 → `needs_home`）。
8. 公共后置：路径安全（`realpath` 已存在前缀的包含性判定 + 禁区）、`{feature}` 替换后再次校验、目标文件符号链接拒绝、目标 `docId` 冲突预检、`git check-ignore` 告警。

### 2.3 写盘序列（文档化，不放脚本里）

解析器不写文件系统。写盘由 Agent 按契约与 SKILL.md 的顺序执行：

```sh
RESULT=$(node skills/taco/scripts/output-path.mjs --doc-dir "$DOC_DIR" --title "$TITLE" --json)
OUT=$(jq -r .file <<<"$RESULT"); ROOT=$(jq -r .root <<<"$RESULT")
mkdir -p "$(dirname "$OUT")"          # pack.mjs 不创建父目录
node skills/taco/scripts/pack.mjs --dir "$DOC_DIR" --root "$ROOT" --title "$TITLE" --out "$OUT"
node skills/taco/scripts/pack.mjs verify "$OUT"
```

- `--root` 必须显式传入（`pack.mjs:780` 默认 `basename(DOC_DIR)`，会丢掉 `specs/` 前缀）；解析器把建议值放在 `.root` 字段。
- **刷新**：`ROOT` 从既有 bundle 读取，不重新推导。
- **迁移**：先 `cp <旧> <新>`，再对 `<新>` 打包（`pack.mjs` 会把该副本当 prior bundle 合并），最后校验 `docId` 与 `comments`/`checkpoints`/`navigation` 逐字段一致；不删除旧文件。
- **目标占用预检**：`OUT` 已存在且其 `docId ≠ 本次 docId（刷新对象的或迁移来源的）` → 停止，不调用 pack。

### 2.4 CLI

```sh
node skills/taco/scripts/output-path.mjs --doc-dir <dir> \
  [--requested <path>] [--existing <x.taco.html>] [--title "<Title>"] \
  [--workspace <root>] [--home <dir>] [--json]
```

- 人类可读：`L2-S1 → /abs/dir (AGENTS.md:12 taco-output-dir)` + 告警行。
- `--json`：`{ level, dir, file, root, sources, warnings, error? }`。
- 失败非 0 退出码，`--json` 同时带 `error` 字段。
- `--root` 是本设计新增的解析器输出字段（供 `pack.mjs --root` 使用），非 CLI 参数。

## 3. 文档接线

### 3.1 权威契约的落位

1. 设计期权威：`specs/012-agent-taco-output-path/contracts/output-path-rule.md`（本 PR 内容）。
2. 实现第一步：把该内容**原样迁入** `skills/taco/references/output-path.md`。
3. 同时把 `specs/012-agent-taco-output-path/contracts/output-path-rule.md` 替换为指针（标题 + 迁移说明 + 指向 `skills/taco/references/output-path.md`）。

理由：安装只拷贝 `skills/taco/**`（`docs/agent-installation.md` 的安装步骤），`specs/**` 不随安装分发；权威若留在 `specs/` 则安装环境读不到，验收条件 6 无法成立。移动而非复制，保证任何时刻只有一份权威。

### 3.2 `skills/taco/references/output-path.md`（迁入后为权威）

全文即契约：级联表、L0 形态与禁区、L2 的 S1/S2、上下文判定、写盘序列、刷新/迁移/预检、报告与告警、示例。语言沿用 skill 既有英文（与 `SKILL.md` 及其他 `references/` 一致；它是 Agent 运行时读物，不是本设计的"供人阅读的设计源文件"）。

### 3.3 `skills/taco/SKILL.md`

- 新增章节 `## Where to write .taco.html`（置于 `## Workflow` 之前）：级联一句话摘要 + 解析器调用 + 写盘序列（含 `mkdir -p`、显式 `--root`、占用预检）+ "完整规则见 `references/output-path.md`"。
- Workflow 步骤 1 的 `pack.mjs` 示例补 `--root` 与 `--out` 说明，指向该章节。
- Workflow 步骤 3（Present and open）不变。
- 保持英文。

### 3.4 `docs/agent-installation.md`

- 安装核对清单的 reference 列举补 `output-path.md`。
- "Use the skill" 步骤 1 增加一句：产物目标目录由 `references/output-path.md` 的级联决定，不再默认落在 cwd；并说明这是相对旧版的有意行为变更。

### 3.5 `extensions/taco/`

- `commands/update.md`：明确"已安装扩展 ⇒ S2 规则（`<FEATURE_DIR>`）；级联不得再落到 `docs/Tacos/` 或 `Tacos/`"，并链接契约。
- `skills/taco-speckit/SKILL.md`：一行同样说明。
- `README.md`：一行 + 链接。

### 3.6 `AGENTS.md`（本仓库自我应用）

新增一行声明 `taco-output-dir: specs/{feature}`，使设计规格与评审产物同目录。注意 `tests/agent-instructions.test.ts` 断言 AGENTS.md 不含 `taco_scope:` / `category:`，本键不冲突。

### 3.7 镜像

`skills/taco/templates/` 是 `extensions/taco/templates/` 的生成镜像（见 AGENTS.md）。本设计不改模板，无需重新生成。

## 4. 测试

`tests/output-path.test.ts`（vitest，风格对齐 `tests/skill-pack.test.ts`：`mkdtempSync` 构造 fixture、`execFileSync` 跑 CLI，行为级用真实 `pack.mjs`）。

- 覆盖 spec.md 7.1 的 18 项；其中 13–18 项为**行为级**（真实打包 + 读回 bundle 断言），必须占半数以上。
- `level` / `error reason` 只作为诊断断言，不作为唯一断言。
- git 相关分支用真实 `git init` 临时仓库，不 mock。
- 目标占用、迁移、首次创建（父目录不存在）用真实文件系统状态构造。

## 5. 兼容性

- 无 schema 变更；既有 `.taco.html` 不受影响，刷新后路径与 `root` 不变。
- `pack.mjs` 直接调用行为不变：`--out` 默认仍是 `<DOC_DIR>/<portableTitleBase(title)>.taco.html`，`--root` 默认仍是 `basename(DOC_DIR)`；变化只发生在"Agent 按契约选择参数"这一层。
- 按新契约运行的 Agent：无规则仓库不再默认写 cwd 根，而按 L3/L4/L5 落盘——**有意的行为变更**，需在 SKILL.md 与安装文档写明。
- 旧版 skill（无本 reference 与脚本）：行为与引入前一致，不会因缺少契约而失败。

## 6. 实施顺序

1. 契约评审通过后，把 7.1 的期望固化为测试（先写 13–18 行为级）。
2. `scripts/output-path.mjs` + 全部 18 项测试通过。
3. 契约迁入 `skills/taco/references/output-path.md`，设计稿降级为指针。
4. `SKILL.md` 章节 + `docs/agent-installation.md` 两处。
5. `extensions/taco/` 三处接线。
6. 本仓库 `AGENTS.md` 声明 + 五类场景端到端核对。
7. 若涉及 `skills/` 与 `packages/host/`，按 AGENTS.md 提出并执行 skill 与官网同步，并提供本地可访问预览 URL。

## 7. 验证与交付

- `npm test`（含新测试）与 `npm run check` 通过。
- 真实仓库冒烟：解析 → `mkdir -p` → `pack.mjs --root/--out` → `verify` 无 warning。
- 按 AGENTS.md 要求，构建并交付一个 `.taco.html` 供直接打开核对。
