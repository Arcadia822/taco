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
                                                 一句"扩展项目 ⇒ S2"，链接为可选便利
```

原则：契约只有一份；其余位置保留简短流程摘要并链接，不复制语法表与失败语义列表。

## 2. 解析器设计（`skills/taco/scripts/output-path.mjs`）

与 `pack.mjs`、`checkpoints.mjs` 同级：skill 自带的 Node 辅助脚本，不是 `taco-cli`；**不新增单独安装步骤**，但必须随 `skills/taco/scripts/**` 一并安装，并在安装核对清单中检查存在。

### 2.1 导出

```js
export const RULE_KEY = 'taco-output-dir'
export const RULE_FILES = ['AGENTS.md', 'CLAUDE.md', '.cursorrules']
export const EXTENSION_ASSETS = '.specify/extensions/taco/assets'

// 单文件：剥离 fenced code block 与 HTML 注释后按契约语法解析
// -> { state: 'absent' | 'ok' | 'malformed', value?, line?, reason? }
export function parseFile(text)

// 规则链：读取 RULE_FILES（S1）+ 判定扩展安装（S2），再合并比较
//   workspaceRoot 仓库根；docDirRel 被打包目录的仓库相对 POSIX 路径；
//   docDirBase 其 basename（用于替换 S1 的 {feature}）；
//   operation 'create' | 'refresh'；existingShellVariant 'complete' | 'lite' | null
// -> { state: 'absent' | 'ok' | 'conflict' | 'malformed'
//          | 'needs_feature' | 'root_unresolvable',
//      dir?, sources[], reason? }
export async function resolveRule({ workspaceRoot, docDirRel, docDirBase, operation, existingShellVariant })

// 级联
// -> { level, dir, file, root, sources[], warnings[], error? }
export async function resolveOutputPath(options)
```

`options`：`{ docDir, operation, requestedPath?, existingTacoPath?, title?, personal?, workspaceRoot?, homeDir?, env? }`。

- `docDir` **必填**；`operation` **必填**（`create` | `refresh`）。二者共同决定上下文判定、S2 判定、`{feature}` 取值与 `root` 建议值。
- `existingTacoPath`（刷新/迁移）除决定 L1 外，还提供 S2 判定所必需的既有 shell 变体。
- 失败类型互斥：`docDir` 等于仓库根 → `root_unresolvable`；`basename(docDir)` 无法安全使用 → `needs_feature`。
- `personal`（CLI `--personal`）是 LP 级别的显式触发输入。
- 不提供 `--feature` 覆盖；上下文不完整时返回 `needs_feature`。
- `title` 缺省回退必须与 `pack.mjs` 对齐：`--title ?? 既有 bundle title ?? portableTitleBase(root)`；导出与 `pack.mjs:64-69` 同算法的 `portableTitleBase`，并在测试中断言一致。

### 2.2 决策顺序

1. 目标路径**禁区检查**（`node_modules/`、`.git/`、skill/extension/templates 目录）——先于一切，含 L0。
2. 解析 `workspaceRoot`：`git rev-parse --show-toplevel`（以 `docDir` 为 cwd）；失败 → 个人上下文。
3. `requestedPath` → `L0`（校验形态：目录，或 stem 对齐的 `.taco.html`；否则 `malformed`）。
4. `existingTacoPath` 且无 `requestedPath` → `L1`。
5. `personal` 或会话已声明的个人意图 → `LP`。
6. `resolveRule({ workspaceRoot, docDirRel, docDirBase, operation, existingShellVariant })`：`ok` → `L2`；`conflict` / `malformed` / `needs_feature` / `root_unresolvable` → 终止。
7. 探测 `docs` → `doc` → `documents` → `specs`（仅目录，按序）→ `L3` = `<found>/Tacos`。
8. git 仓库 → `L4` = `<repo>/Tacos`；否则 `L5` = `<home>/Documents/Tacos`（`HOME ?? USERPROFILE`，皆缺 → `needs_home`）。
9. `root` 推导（见 2.4）与公共后置：路径安全（`realpath` 已存在前缀的包含性 + 禁区）、`{feature}` 替换后再次校验、目标文件符号链接拒绝、目标 `docId` 冲突预检、`git check-ignore` 告警。

### 2.3 写盘序列（文档化，不放脚本里）

解析器不写文件系统。写盘由 Agent 按契约与 SKILL.md 的顺序执行：

新建（`OP=create`；`TITLE` 可选，未给则不加 `--title`）：

```sh
RESULT=$(node skills/taco/scripts/output-path.mjs --doc-dir "$DOC_DIR" \
  --operation create ${REQUESTED:+--requested "$REQUESTED"} ${TITLE:+--title "$TITLE"} --json)
OUT=$(jq -r .file <<<"$RESULT"); ROOT=$(jq -r .root <<<"$RESULT")
mkdir -p "$(dirname "$OUT")"          # pack.mjs 不创建父目录
node skills/taco/scripts/pack.mjs --dir "$DOC_DIR" --root "$ROOT" \
  ${TITLE:+--title "$TITLE"} --out "$OUT"
node skills/taco/scripts/pack.mjs verify "$OUT"
```

刷新（`OP=refresh`；`OUT`/`ROOT` 都来自既有 Taco，不重新推导）：

```sh
RESULT=$(node skills/taco/scripts/output-path.mjs --doc-dir "$DOC_DIR" \
  --operation refresh --existing "$EXISTING" --json)
OUT=$(jq -r .file <<<"$RESULT"); ROOT=$(jq -r .root <<<"$RESULT")
node skills/taco/scripts/pack.mjs --dir "$DOC_DIR" --root "$ROOT" --out "$OUT"
node skills/taco/scripts/pack.mjs verify "$OUT"
```

迁移（用户显式要求；先用同一解析器做占用预检，**复制之前**就要通过）：

```sh
# 解析 + 占用预检：$NEW 已存在且其 docId 与 $EXISTING 不同时，解析器非 0 退出并报告，不得继续
RESULT=$(node skills/taco/scripts/output-path.mjs --doc-dir "$DOC_DIR" --operation refresh \
  --existing "$EXISTING" --requested "$NEW" --json)
NEW=$(jq -r .file <<<"$RESULT"); ROOT=$(jq -r .root <<<"$RESULT")
mkdir -p "$(dirname "$NEW")"   # 先建目录，否则下一步 cp 失败
cp "$EXISTING" "$NEW"          # 复制后 $NEW 上的 bundle 与旧文件逐字段相同
node skills/taco/scripts/pack.mjs --dir "$DOC_DIR" --root "$ROOT" \
  ${TITLE:+--title "$TITLE"} --out "$NEW"
# 校验 docId 与 comments/checkpoints/navigation 逐字段一致；不删除旧文件
```

- `--title` **按需传递**：`pack.mjs:836` 收到空字符串会得到 stem `Untitled`，与省略不同。
- **刷新**：`ROOT` 与 `OUT` 都取自既有 Taco（`--existing`），不重新推导。
- **目标占用预检**：`OUT` 已存在且其 `docId ≠ 本次 docId（刷新对象的或迁移来源的）` → 停止，不调用 pack。
- **DOC_DIR 等于仓库根**：解析器返回 `root_unresolvable`，停止并提示改为指向子目录（空 `--root` 被 `pack.mjs:47-51` 拒绝；写成 `.` 会生成 `./<file>` 形式、不满足文件路径安全规则的 `files[].path`）。

### 2.4 `root` 推导

| 情形 | `root` |
| --- | --- |
| 刷新 | 既有 bundle 的 `root`（读取后原样返回） |
| 新建，项目有约定 | 项目约定值 |
| 新建，无约定 | `basename(docDir)`（= `pack.mjs:780` 默认；本仓库 `specs/011-*` 即此形态） |

`root` 始终**显式**传给 `pack.mjs`，且解析器把它放进返回值与人类可读输出，使"产物落点"与"内部 root"在报告里同时可见。

### 2.5 CLI

```sh
node skills/taco/scripts/output-path.mjs --doc-dir <dir> --operation <create|refresh> \
  [--requested <path>] [--existing <x.taco.html>] [--title "<Title>"] \
  [--personal] [--workspace <root>] [--home <dir>] [--json]
```

- 人类可读：`L2-S1 → /abs/dir  root=012-x  (AGENTS.md:12 taco-output-dir)` + 告警行。
- `--json`：`{ level, dir, file, root, sources, warnings, error? }`。
- 失败非 0 退出码，`--json` 同时带 `error` 字段。

## 3. 文档接线

### 3.1 权威契约的落位

1. 设计期：`specs/012-agent-taco-output-path/contracts/output-path-rule.md`（中文）。
2. 实现第一步：把契约**语义等价地译为英文**写入 `skills/taco/references/output-path.md`（skill 侧文档沿用既有英文），并逐条核对语义一致。
3. 同时把中文稿替换为指针（标题 + 迁移说明 + 指向英文 reference），此后不再演进。

理由：安装只拷贝 `skills/taco/**`（`docs/agent-installation.md` 的安装步骤），`specs/**` 不随安装分发；权威若留在 `specs/` 则安装环境读不到，验收条件 6 无法成立。只保留英文一份，避免两份权威漂移。

### 3.2 `skills/taco/references/output-path.md`（迁入后为权威）

全文即契约：级联表（含 LP）、L0 形态与禁区、L2 的 S1/S2、上下文判定、`root` 推导、写盘序列、刷新/迁移/预检、报告与告警、示例。

### 3.3 `skills/taco/SKILL.md`

- 新增章节 `## Where to write .taco.html`（置于 `## Workflow` 之前）：级联一句话摘要 + 解析器调用 + 写盘序列（`mkdir -p`、`--operation`、显式 `--root`、占用预检）+ "完整规则见 `references/output-path.md`"。
- Workflow 步骤 1 的 `pack.mjs` 示例补 `--root`/`--out` 说明，指向该章节。
- Workflow 步骤 3（Present and open）不变。保持英文。

### 3.4 `docs/agent-installation.md`

- 安装核对清单的 reference 列举补 `output-path.md`。
- "Use the skill" 步骤 1 增加一句：产物目标目录由 `references/output-path.md` 的级联决定，不再默认落在 cwd；说明这是相对旧版的有意行为变更。

### 3.5 `extensions/taco/`

- `commands/update.md`：一句"已安装扩展 ⇒ 产物在 `<FEATURE_DIR>`（契约中的 S2）"，并附契约链接作为**可选**便利。
- `skills/taco-speckit/SKILL.md`、`README.md`：同样一行 + 可选链接。
- 不复制语法表或失败语义：扩展可独立安装且自包含（`extensions/taco/README.md`），其产物位置本来就由扩展自身约定固定，因此**不依赖** skill 的 reference 或解析器可用；只安装扩展的项目照常工作（验收条件 7）。

### 3.6 `AGENTS.md`（本仓库自我应用）

新增一行声明 `taco-output-dir: specs/{feature}`。注意 `tests/agent-instructions.test.ts` 断言 AGENTS.md 不含 `taco_scope:` / `category:`，本键不冲突。

### 3.7 镜像

`skills/taco/templates/` 是 `extensions/taco/templates/` 的生成镜像（见 AGENTS.md）。本设计不改模板，无需重新生成。

## 4. 测试

`tests/output-path.test.ts`（vitest，风格对齐 `tests/skill-pack.test.ts`：`mkdtempSync` 构造 fixture、`execFileSync` 跑 CLI，行为级用真实 `pack.mjs`）。

- 覆盖 spec.md 7.1 的 20 项；其中 **13–20 共 8 项为行为级**（真实打包 + 读回 bundle），覆盖首次创建、L0 写入、个人意图写入、无 CP、刷新、迁移、占用拒绝、模板独立八条写入路径。
- `level` / `error reason` 只作诊断断言。
- git 相关分支用真实 `git init` 临时仓库，目标占用/迁移/首次创建用真实文件系统状态构造。

## 5. 兼容性

- 无 schema 变更；既有 `.taco.html` 不受影响，刷新后路径与 `root` 不变。
- `pack.mjs` 直接调用行为不变：`--out` 默认仍是 `<DOC_DIR>/<portableTitleBase(title)>.taco.html`，`--root` 默认仍是 `basename(DOC_DIR)`；变化只发生在"Agent 按契约选择参数"这一层。
- 按新契约运行的 Agent：无规则仓库不再默认写 cwd 根，而按 L3/L4/L5 落盘——**有意的行为变更**，需在 SKILL.md 与安装文档写明。
- 只安装 Spec Kit 扩展的项目：行为和现在一致（feature 目录），不需要 skill 的 reference 或脚本。
- 旧版 skill（无本 reference 与脚本）：行为与引入前一致，不会因缺少契约而失败。

## 6. 实施顺序

1. 契约评审通过后，先写 13–20 的行为级测试（含首建/迁移/占用拒绝）。
2. `scripts/output-path.mjs` + 全部 20 项测试通过。
3. 契约译为英文迁入 `skills/taco/references/output-path.md`，中文稿降级为指针；逐条核对语义一致。
4. `SKILL.md` 章节 + `docs/agent-installation.md` 两处。
5. `extensions/taco/` 三处一句话接线。
6. 本仓库 `AGENTS.md` 声明 + 五类场景端到端核对。
7. 若涉及 `skills/` 与 `packages/host/`，按 AGENTS.md 提出并执行 skill 与官网同步，并提供本地可访问预览 URL。

## 7. 验证与交付

- `npm test`（含新测试）与 `npm run check` 通过；`pack.mjs` 默认行为回归无变化。
- 真实仓库冒烟：解析 → `mkdir -p` → `pack.mjs --root <解析器给出的 root> --out <解析结果>` → `verify` 无 warning。
- 按 AGENTS.md 要求，构建并交付一个 `.taco.html` 供直接打开核对。
