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

- `skills/taco/scripts/pack.mjs` 的 `--out` 默认值是 `<DOC_DIR>/<Title>.taco.html`（`pack.mjs` 第 783 行）。当 Agent 把当前工作目录当作 `DOC_DIR` 时，产物落在仓库根，污染根目录；当 `tmp/`、`artifacts/` 之类目录被 `.gitignore` 忽略时，产物又容易被静默丢弃，事后无法检索。
- Spec Kit 扩展有另一套约定（`<FEATURE_DIR>/<feature-name>.taco.html`，见 `extensions/taco/commands/update.md`），但它只覆盖已初始化扩展的项目，且只存在于扩展文档里，通用 skill 的 Agent 读不到。
- 两套约定之外的第三个问题：Agent 有时会把"模板/示例所在目录"误当成"产物应写回的位置"。

结果是同一个动作在不同会话里落在不同位置，且落点不可预期、不可事后归档。

## 2. 目标与非目标

### 2.1 目标

1. 定义一条**确定性的输出路径决策级联**，Agent 在任何环境（工程项目 / 普通文档目录 / 非项目个人上下文）都能推导出唯一的 `.taco.html` 目标路径。
2. 提供**机器可读的项目级规则声明**，让项目能显式指定输出目录，并让后续任何会话都能找到它；重复声明幂等，冲突时明确拒绝而不是猜。
3. 在同一份契约里划清三条互不影响的边界：**产物落盘位置**、**bundle `root` 与内部引用路径**、**模板/示例来源位置**。
4. 给出可执行的验证方案（含 TACO-9 要求的五类场景），使该规则不是"靠 Agent 自觉"，而是可复核、可测试。

### 2.2 非目标

- 不改变 `taco/files` v1 bundle 的数据结构，也不改 `root`、`files[].path`、Checkpoint 文档路径的任何语义。
- 不改变 `pack.mjs` 的 `--out` 语义与默认值；本设计只是在 Agent 选择 `--out` 之前补上决策环节。
- 不新增 `taco-cli` 能力，不引入云端/托管相关行为。
- 不自动修改 `.gitignore`、不自动创建项目级模板、不自动迁移既有 Taco。
- 不强制 Spec Kit 扩展安装：级联在普通仓库同样成立。

## 3. 需求：输出路径决策级联

### 3.1 优先级总表

从高到低，取第一个可用级：

| 级别 | 条件 | 目标目录 | 备注 |
| --- | --- | --- | --- |
| L0 | 用户本次请求中显式给出输出路径 | 该路径（原样） | 最高优先级；用户可指定绝对路径 |
| L1 | 本次是**刷新既有 Taco** | 该 Taco 现有路径 | 用户显式要求迁移时才改；未要求则忽略 L2–L5 |
| L2 | 项目规则声明了 `taco-output-dir` | 声明的目录 | 相对仓库根解析，可含 `{feature}` |
| L3 | 仓库内存在文档目录 `docs/`、`doc/`、`documents/`、`specs/` | 第一个存在者之下的 `Tacos/` | 顺序固定为上述四者，不按修改时间挑 |
| L4 | 是 git 仓库但没有上述文档目录 | `<repo>/Tacos/` | 不新建空的 `docs/` |
| L5 | 非项目上下文（不在任何 git 仓库内，或明确是跨项目/个人文档） | `~/Documents/Tacos/` | Windows 用 `%USERPROFILE%\Documents\Tacos` |

文件名固定为 `<Title>.taco.html`（`Title` 即 bundle `title`；`pack.mjs` 已强制文件名 stem 与 title 一致），因此**目标文件 = 目标目录 + 标题**。

### 3.2 上下文判定

- "项目仓库"= `git rev-parse --show-toplevel` 能解析出的工作树根。cwd 位于仓库内即视为项目上下文（L2–L4），否则为个人上下文（L5）。
- 级联按 **当前这次要打包的文档集合** 判定，而不是按 cwd 的字面层级。若同一会话里明确要为一组个人/跨项目文档出 Taco，按 L5 处理，并在报告里说明依据。
- `{feature}` 的取值是**被打包目录（即 bundle `root`）的 basename**。若 `root` 就是仓库根、工作区根或一个多主题目录（没有可命名的单一 feature），含 `{feature}` 的项目规则**不适用**：停下来问用户，不要猜测替代值。

### 3.3 项目级规则声明（L2）

在项目的 Agent 指令文件中声明输出目录，语法与完整约束见 [`contracts/output-path-rule.md`](contracts/output-path-rule.md)。摘要：

```markdown
taco-output-dir: specs/{feature}
```

- 查找链固定为 `AGENTS.md` → `CLAUDE.md` → `.cursorrules`，取**第一个声明**该键的文件。
- 每个文件内**最多一条**声明；未声明则继续下一级。若链中两个文件声明了**不同**的值，停止并请用户裁决（不静默取其一）。
- 值必须是**仓库相对**的 POSIX 路径，可含 `{feature}` 占位符；禁止绝对路径、`~`、`\`、`.`、`..`、空段、通配符，禁止以 `.taco.html` 结尾。
- 出现在 fenced code block 或 HTML 注释里的同名行不算声明。

本项目自身（Taco 仓库）应声明 `taco-output-dir: specs/{feature}`，使设计规格与其评审产物同目录，与 `specs/011-*` 既有形态一致。

### 3.4 与 Spec Kit 扩展的关系

已初始化 Taco Spec Kit 扩展（存在 `.specify/`）的项目，其项目规则就是扩展已固化的约定 `<FEATURE_DIR>/<feature-name>.taco.html`，等价于 L2 命中，**优先于** L3/L4。因此：

- 在 Spec Kit 项目内，级联**不得**再落到 `docs/Tacos/` 或 `Tacos/`。
- 扩展命令与 skill（`extensions/taco/commands/update.md`、`extensions/taco/skills/taco-speckit/SKILL.md`）必须显式说明这一点，并引用同一份契约，避免出现第二套路径规则。

### 3.5 刷新与迁移

- 刷新是指对**同一个** `docId` / 用户指明的既有 `.taco.html` 重新打包。此时目标路径与 bundle `root` **保持不变**，除非用户显式要求迁移。
- 迁移是显式动作：只有用户说"迁到 X"时才改路径；迁移时必须保留 `docId`、`comments`、`navigation`、`checkpoints`（含文档状态）与未知字段，并报告"旧路径 → 新路径"。
- 重复执行同一决策输入，结果必须**逐字节可复现**（同一目标路径、同一文件名）。
- 目标位置已存在一个**不同** `docId` 的文件时，不得覆盖：停下来报告冲突。

### 3.6 报告与告警

写盘前必须能报告：命中的级别、目标绝对路径、依据（用户指令/既有文件/哪条规则/哪个目录探测结果），以及：

- **gitignore 告警**：若目标路径被 git 忽略（`git check-ignore` 命中），明确报告"该产物不会被纳入版本控制"，但**不失败、不修改 `.gitignore`**——个人归档目录被忽略是预期行为。
- **排除清单**：沿用 `pack.mjs` 已有的 `excluded:` 报告。

## 4. 关键决策与取舍

### 4.1 决策：项目规则用单行键，而非第二套 managed block

现有仓库已经有 `<!-- taco:process-policy:start -->` 这类 managed block（`extensions/taco/bin/taco.mjs`）。本设计**不**复用它做输出路径，因为：

- 输出目录是**单标量值**，managed block 需要成对标记 + 重复块检测，成本高于收益；扫描/解析成本也更高。
- 单行键 `taco-output-dir:` 与主机、语言无关，便于任何 harness 用一行 grep 读到，且不侵入 AGENTS.md 的既有结构。

代价：需要自己定义"至多一条声明 + 冲突即停"的规则。已在 3.3 明确。<br>
若评审认为应统一为 managed block，改动范围仅限 3.3 与契约文件语法。

### 4.2 决策：刷新优先于项目规则

项目规则变化（例如团队把产物目录从 `docs/Tacos` 改成 `reviews/Tacos`）不得静默搬走一个正在评审的 Taco——那会让评审者手里的链接、评论锚点上下文失效。因此 L1 位于 L2 之上，迁移必须显式。

### 4.3 决策：`{feature}` 无解析目标时停止，而不是降级

降级会让 Agent 在不该落盘的地方静默产生文件（正是本 issue 要消除的痛点）。停下来的成本是一次交互，误放的代价是一次难以发现的污染。

### 4.4 决策：提供确定性解析脚本，而不是纯自然语言规则

新增 `skills/taco/scripts/output-path.mjs`（skill 自带的辅助脚本，**不是** `taco-cli`，与 `pack.mjs`、`checkpoints.mjs` 同级同性质）：

```sh
node scripts/output-path.mjs --workspace <repo-root> [--existing <x.taco.html>] \
  [--requested <path>] [--feature <name>] [--title "<Title>"] [--json]
```

- 导出 `parseOutputDirRule(text)` 与 `resolveOutputPath(options)`，CLI 只是薄封装。
- 输出命中的级别、目标目录/文件、告警数组；不写文件系统以外的任何东西。
- 理由：级联的判定分支（规则冲突、`{feature}`、gitignore、既有文件）容易被不同 Agent 各自解释；把解析固化成可测试函数后，验收条件从"Agent 自称遵守"变成"测试可复现"。

取舍：增加一个需要维护的脚本（~150 行）与一份测试。相对"路径散落导致产物丢失"的重复成本，值得。若评审倾向纯文档规则，删除 4.4 即可，其余设计不受影响。

## 5. 契约与不变量

1. **产物路径 ⊥ bundle 内部路径**：目标路径与 `root`、`files[].path`、Checkpoint 文档路径、`originPath` 互不推导。`root` 仍是"相对仓库/工作区的安全 POSIX 路径"，目标目录可以落在 `root` 之外（例如 `root = docs/`，产物在 `docs/Tacos/`），也可以落在 `root` 之内（Spec Kit 的 feature 目录即如此）。
2. **模板来源 ⊥ 产物位置**：skill/extension 自带的 `templates/`、示例 `bundle.json`、`empty.taco.html` 位于何处，都不影响产物写到哪里。项目可在自定目录维护模板与 Checkpoint 图；无适用模板时直接从规范目录里的真实文档组装。
3. **不改 shell**：只有 `#taco-document` 数据块与 `<title>` 是 Agent 可写的（既有不变量，本设计不放松）。
4. **不因路径决策写盘到禁区**：绝不写入 skill 目录、extension 目录、模板目录、`node_modules/`。
5. **幂等**：相同输入（workspace、既有文件、用户指令、规则文件内容）→ 相同目标路径。
6. **不猜测**：规则冲突、`{feature}` 无法解析、目标已存在不同 `docId`、值非法 —— 四种情况都停止并报告，不做"最合理"的选择。

## 6. 受影响组件

| 组件 | 变更 |
| --- | --- |
| `skills/taco/SKILL.md` | 新增 "Where to write `.taco.html`" 章节（含级联摘要），并在 Workflow 步骤 1/3 引用 |
| `skills/taco/references/output-path.md`（新增） | 级联与规则的完整说明（机器 + 人可读） |
| `skills/taco/scripts/output-path.mjs`（新增） | 确定性解析器 |
| `tests/output-path.test.ts`（新增） | 覆盖 3.1 各级 + 冲突/非法/幂等/gitignore |
| `docs/agent-installation.md` | "Use the skill" 步骤 1 补一句 + 指向新 reference |
| `extensions/taco/commands/update.md` | 声明 feature 目录规则等价于 L2，并指向同一契约 |
| `extensions/taco/skills/taco-speckit/SKILL.md` | 同上，作为扩展侧唯一路径说明 |
| `extensions/taco/README.md` | 同上（一行 + 链接） |
| `AGENTS.md`（本仓库） | 添加 `taco-output-dir: specs/{feature}` 作为自我应用示例 |

说明：`skills/taco/templates/` 是 `extensions/taco/templates/` 的生成镜像，本设计不触碰；`skills/taco/SKILL.md` 与 `docs/` 是权威源，无镜像同步问题。

## 7. 验证方案

### 7.1 自动化（`tests/output-path.test.ts`）

在临时目录构造 fixture，断言 `resolveOutputPath` 的返回值与告警：

1. L0：`--requested ./dist/review.taco.html` 原样胜出，即使存在既有文件与项目规则。
2. L1：`--existing specs/003-x/003-x.taco.html` 胜出，忽略同仓库的项目规则；`--requested` 与 `--existing` 同时给出时以 `--requested` 为准（显式迁移）。
3. L2：`AGENTS.md` 含 `taco-output-dir: specs/{feature}` + `--feature 012-x` → `specs/012-x`；`CLAUDE.md` 含不同值 → 报冲突并返回失败而非择一。
4. L3：仅存在 `docs/` → `docs/Tacos`；同时存在 `docs/` 与 `specs/` → `docs/Tacos`（顺序固定）；只有 `specs/` → `specs/Tacos`。
5. L4：仓库无 `docs|doc|documents|specs` → `<repo>/Tacos`。
6. L5：workspace 非 git 仓库 → `~/Documents/Tacos`（以 `HOME` 注入断言）。
7. 规则非法值（绝对路径、`..`、反斜杠、通配符、`.taco.html` 结尾）→ 拒绝并给出具体原因。
8. 规则出现在 fenced code block / HTML 注释内 → 视为未声明。
9. 幂等：同一输入重复调用逐字节相同。
10. gitignore：目标被忽略时返回 `gitignored` 告警且仍给出路径。

### 7.2 端到端（手动/脚本，五类场景）

对 TACO-9 评论中要求的场景，各自检查**产物位置**与**内部 `root`/引用路径**独立且正确：

| 场景 | 构造 | 期望 |
| --- | --- | --- |
| 用户指定输出位置 | 用户说"生成到 `./tmp/review.taco.html`" | 产物在指定处；`root` 仍为被评审目录 |
| 项目自定义模板/CP 位置 | 项目在 `review/policy/` 放自己的模板，规则声明 `review/tacos` | 产物在 `review/tacos`；模板文件位置不变、不被复制 |
| 无 CP 的普通文档 | 一个 `notes/` 目录，无 Checkpoints | 产物路径正常，bundle 顶层无 `checkpoints` |
| 仅参考 SDD 示例生成新 Taco | 使用 `templates/spec/` 作为参考，`root = specs/012-*` | 产物不在模板目录；Checkpoint 文档 path 全部指向 `specs/012-*` |
| 原路径原状态刷新 | 修改 canonical 文档后重新打包既有 Taco | 路径不变、`docId`/`comments`/`navigation`/`checkpoints` 状态保留 |

### 7.3 冒烟

对真实仓库跑一次 `node scripts/output-path.mjs --workspace <repo> --title "x" --json`，确认输出与实际期望目录一致；再跑一次 `pack.mjs --out <解析结果>`，`verify` 无 warning。

## 8. 验收条件

1. 在任意真实仓库上，Agent 能在动手前给出一句可核对的路径结论："级别 L?，目标 `<absolute path>`，依据 <…>"，且与 `scripts/output-path.mjs` 的输出一致。
2. `AGENTS.md` 中**至多一条** `taco-output-dir` 声明；重复执行初始化/写入不产生第二条；出现两条不同声明时工具与 Agent 都**拒绝**继续。
3. 刷新既有 Taco 时路径与 `root` 不变，`docId`、`comments`、`navigation`、`checkpoints` 状态全部保留；只有在用户显式要求时才迁移并报告新旧路径。
4. 新会话**仅凭 `AGENTS.md`（含规则声明）与 `skills/taco/references/output-path.md`** 就能回答：这个仓库的产物该写到哪、文件名是什么、以及为什么不是别的目录。
5. `tests/output-path.test.ts` 覆盖 7.1 的 10 项并全部通过；`npm test` 与 `npm run check` 通过。
6. 五类场景（7.2）逐项通过，且每项都验证"产物位置"与"`root`/内部引用"互不影响。
7. 产物落在被 git 忽略的目录时，报告里出现明确告警，且 `.gitignore` 未被改动。

## 9. 风险

| 风险 | 处置 |
| --- | --- |
| L3 的目录探测在混合仓库（既有 `docs/` 又有 `specs/`）里给出"看起来对但项目不想要"的结果 | 用 L2 项目规则作为官方覆盖手段；在报告中显式打印命中级与探测依据，便于察觉 |
| 单行键被 Agent 误当作普通正文而不读 | 在 SKILL.md 与 reference 中给出精确的行格式与查找链；解析脚本给出确定性实现；README/安装文档各一句指引 |
| 新增解析脚本与 `pack.mjs` 默认值语义分叉 | 明确 `pack.mjs` 不变；脚本只产出 `--out` 的建议值，并在测试中对二者做一次联动断言 |
| 个人归档 `~/Documents/Tacos` 在 CI/无 HOME 环境不可用 | L5 仅在非 git 上下文触发；无 `HOME` 时报告"无法解析个人归档目录"并停止，不静默落到 cwd |

## 10. 待评审确认

1. 项目规则的载体是否为单行键 `taco-output-dir: <repo-relative path>`（4.1 的取舍）。
2. 是否采纳 `skills/taco/scripts/output-path.mjs` 解析脚本（4.4 的取舍）；若不采纳，验收条件 5 相应改为纯文档核对。
3. L3 探测顺序固定为 `docs` → `doc` → `documents` → `specs` 是否可接受（本仓库会命中 `docs`，因此本项目必须依赖 L2 声明）。
4. 个人归档目录名与大小写：`~/Documents/Tacos/`（与 TACO-9 原文一致）。
5. 是否在本仓库 `AGENTS.md` 写入 `taco-output-dir: specs/{feature}` 作为自我应用。
