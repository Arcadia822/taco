---
title: '014-agent-taco-output-path 技术方案'
feature_id: '014-agent-taco-output-path'
created: '2026-09-28'
status: 'Draft'
---

## 1. 实现策略

本特性**只改文档**：不新增代码、脚本或测试文件，只新增一份随 skill 安装的契约文档（`references/output-path.md`）。

```text
权威契约（设计期草稿留档：specs/014-*/contracts/output-path-rule.md，已降级为指针）
      │ 实现时译为英文迁入
      ▼
skills/taco/references/output-path.md        ← 唯一权威，随 skill 安装
      │
      ├── skills/taco/SKILL.md               新增产出位置章节 + 主流程改为直接写数据块
      ├── skills/taco/references/bundle-format.md   脚本优先表述收敛（保留安全写入规则）
      ├── docs/agent-installation.md         Assemble 步骤改为直接写数据块 + reference 清单
      └── extensions/taco/{commands/update.md, skills/taco-speckit/SKILL.md, README.md}
                                             一句：扩展项目的落点由扩展自身约定决定
```

不涉及：不新增脚本、不新增测试文件、不改 `src/` 与 `packages/`、不手改模板镜像、不删除 `pack.mjs`。

## 2. 落盘顺序（写进 SKILL.md 的可照做序列）

无脚本、无 CLI。顺序固定，不得调换（契约 §3.1）：

1. **定目标**：按级联（spec.md §4）确定产物目录、文件名与标题；产出报告行 `L? → <绝对路径>（依据：…）`。命中 L0 文件形态时标题取该文件名 stem（且 stem 必须是规范形式）。
2. **读入内存**：读目标文件（若存在）的 `#taco-document` 数据块，以及所选 shell（若目标不存在）。**不得**先把 shell 复制到目标路径；既有数据块无法解析则停止（`malformed`）。
3. **占用判定**：目标不存在 → 新建；解析为同一路径 → 刷新；别的 `docId` → 一律冲突停止（用户要求迁移也不覆盖）；同 `docId` 但非同一文件 → 默认停止（迁移需用户显式授权并先报告状态差异）。
4. **构造新 bundle**：按下表保留字段，生成完整 JSON。

| 字段 | 规则 |
| --- | --- |
| `docId`、`comments`、`navigation`、`checkpoints`、`access`、`collab`、未知顶层字段 | 原样保留 |
| 标题 | 刷新时保留既有 bundle 的标题；目标文件名 stem 与其归一化结果不一致 → 报告冲突并停止 |
| 每个 file 的 `id` | 保留 |
| `blocks` | 仅当该文件新旧内容字节完全相同时保留；内容变化即丢弃 |
| `sourceHash` | 内容不变时保留原值；内容变化且宿主具备 SHA-256 能力时重算，否则删除该可选字段（不留过期哈希） |
| 打包集合 | 排除隐藏路径（以 `.` 开头）与所有 `*.taco.html`；刷新时沿用既有 `packOptions.ignore`；若产物目录等于被打包目录，报 `output-in-input` 告警 |

5. **转义与自校验**（落盘前提）：按 `references/bundle-format.md` 序列化并转义；对**将要写入的那一份字符串**做解析校验与形态校验（必需字段、`root` 与各 `path` 一致、path 唯一且安全）。宿主没有解析能力 → 停止（`unverifiable`），不写文件。
6. **备目录**：目标父目录不存在则创建（临时文件必须与目标同目录）。
7. **原子替换**：完整 HTML 写到同目录临时文件 → `rename` 覆盖目标；失败保留原文件。
8. **校验与报告**：按校验阶梯取 V1/V2 中最高的可用级别，并写明级别（V2 必须声明"未做运行校验"）。

迁移（仅用户显式要求）：先按上表判定占用（不同 `docId` 直接冲突停止；同 `docId` 副本默认停止，只有用户显式授权并已报告状态差异才继续），**不提前创建目录**；之后走 4–8 步（含步骤 5 的写前自校验与步骤 6 的建目录），并校验 `docId` 与 `comments`/`checkpoints`/`navigation` 逐字段一致；不删旧文件。

## 3. 上下文判定

- **仓库识别不依赖 git 命令**：从被打包目录（缺省 cwd）向上查找 `.git/` 目录，或内容形如 `gitdir: <路径>` 的 `.git` 文件（worktree/submodule）；到文件系统根仍未找到 → 不在仓库内（L5）。
- `git` 命令只服务可选的忽略检查：`git check-ignore` 命中 → `gitignored` 告警；命令不可用 → `gitignore-unavailable` 告警，均不改变仓库判定。
- `HOME ?? USERPROFILE` 皆缺失 → `needs_home`，停止，不落到 cwd。
- 被打包目录是仓库根 → 命中 L2：跳过目录探测，产物落 `<repo>/tacos/`（契约 §2）。
- 扩展项目 → 产物位置由扩展自身约定决定，报告依据写"扩展约定"，不与级联做冲突判定。
- 本仓库（有 `docs/`）级联默认给 `docs/tacos/`，而既有布局是 `specs/<feature>/*.taco.html`；两者都不静默，靠 L0 显式指定或报告写清命中级。

## 4. 文档接线

### 4.1 权威契约的落位

1. 设计期：`specs/014-agent-taco-output-path/contracts/output-path-rule.md`（中文）。
2. 实现第一步：**语义等价地译为英文**写入 `skills/taco/references/output-path.md`（skill 侧文档沿用既有英文），逐条核对语义一致（级联与 L2 跳过 L3、L0 规范文件名、保留字段与 `blocks` 规则、占用规则、落盘八步、校验阶梯、失败类型与告警、与扩展的关系）。
3. 同时把中文稿替换为指针（标题 + 迁移说明 + 链接），此后不再演进。

理由：安装只拷贝 `skills/taco/**`（见 `docs/agent-installation.md` 的安装步骤），`specs/**` 不随安装分发。

### 4.2 `skills/taco/SKILL.md`（新增章节 + 主流程收敛）

- 新增 `## Where to write .taco.html`（置于 `## Workflow` 之前）：级联摘要（含小写 `tacos`、个人归档、L2 跳过目录探测、扩展项目由扩展决定）、L0 文件名↔标题规则、落盘八步、校验阶梯、报告与告警清单；`## Workflow` 步骤 1 引用该章节。
- **把现有以脚本为主流程的表述收敛为零依赖**：开篇的 "this skill ships the assembler … prefer `scripts/pack.mjs`"、bundle 写入规则、`## Workflow` 步骤 1 的命令示例、`### 2. Check what the reviewer will see`、`## Report format` 中依赖脚本退出码/输出结构的表述，都改为"直接写数据块 + 校验阶梯"。
- `pack.mjs` 只保留为**完全可选**的辅助说明（用户已决：保留文件但降为可选），绝不作为创建、刷新或校验的必经路径。

### 4.3 `skills/taco/references/bundle-format.md`

它目前把脚本写成"拥有载体"的工具、把写块说成工具的工作，并要求无浏览器时运行脚本。实现阶段需把这三处改为：写块由 Agent 直接完成、写前自校验是落盘前提、校验按 V1/V2 阶梯声明；**保留**序列化、转义、原子替换与形态规则（它们是安全写块的事实依据）。职责边界：`output-path.md` 管"写到哪里、什么时候写、写完怎么声明"，`bundle-format.md` 管"数据块本身长什么样、如何安全写入"。

### 4.4 `docs/agent-installation.md`

- Assemble 步骤改为直接写数据块（含落盘八步与校验阶梯），把脚本改为可选辅助。
- reference 清单补 `output-path.md`。
- 补一句：产物目录由级联决定（不再默认写 cwd），并说明这是相对旧版的有意行为变更。

### 4.5 `extensions/taco/`

`commands/update.md`、`skills/taco-speckit/SKILL.md`、`README.md` 各加一句：扩展项目的产物位置由扩展自身约定决定（feature 目录），与通用级联无关，也不做冲突判定；附可选链接。不复制级联表，不要求扩展依赖 skill 的 reference。

## 5. 验证

按 spec.md §8 执行，并留下可复现记录（输入目录、产物绝对路径、失败码、数据块读取与状态比对）：

1. **文档一致性**：级联顺序与级别命名（L0/L1/L2/L3/L4/L5）、失败类型集合、小写 `tacos`、校验阶梯（V1/V2）、落盘顺序，四处文本一致；只有一份完整级联与失败语义表；落盘步骤不把脚本/CLI 当作必经路径；**不残留任何项目级输出配置的规范性表述**（规则、组件与操作步骤中不得再出现 `.taco/config.yaml`、`outputDir` 或规则冲突判定；仅允许否定性说明）。
2. **五类验收场景**：每类同时核对产物位置与 bundle 内部引用。
3. **逐分支走查**：非规范 L0 文件名、非 `.taco.html` 文件、L2（仓库内有 `docs/` 时仍落 `<repo>/tacos/`）、L3 顺序、L4、L5 无 `HOME`、无 `git` 命令、禁区、`unverifiable`、损坏的既有数据块、`output-in-input`、迁移到不存在的父目录、迁移目标已存在、内容变化后 `blocks` 丢弃。
4. **校验阶梯实测**：至少一次 V1（打开标签页跑 `window.taco.validate()` 得 `ok: true`）与一次 V2（仅解析核对并声明"未做运行校验"）。
5. **回归**：`npm test` 与 `npm run check` 通过；三项既有测试只作回归防护，不作为级联或手写数据块正确性的证明。

不新增自动化测试：本特性无代码产物，对文档措辞做源文本断言不构成有效覆盖。

## 6. 兼容性

- 无 bundle schema 变更；既有 `.taco.html` 不受影响，刷新后路径、标题与 `root` 不变。
- **不新增任何项目级配置文件**，因此未安装 skill 的仓库不需要迁移。
- 未配置前置条件的仓库：产物不再默认写 cwd 根，改按 L0–L5 落盘——**有意的行为变更**。
- 只安装 Spec Kit 扩展的项目：行为与现在一致（feature 目录），不依赖本契约。
- 旧版 skill（无本 reference）：行为与引入前一致。

## 7. 实施顺序

1. 契约稿评审通过（`pack.mjs` 保留为可选辅助，不改该文件本体与 `tests/skill-pack.test.ts`）。
2. 契约译为英文迁入 `skills/taco/references/output-path.md`；中文稿降级为指针；逐条核对语义。
3. `SKILL.md`：新增产出位置章节 + 主流程收敛为零依赖（§4.2）。
4. `references/bundle-format.md`：脚本优先与工具独占写入的表述收敛（§4.3）。
5. `docs/agent-installation.md`：Assemble 步骤与 reference 清单。
6. `extensions/taco/` 三处一句话（§4.5）。
7. 五类场景 + 逐分支走查 + 校验阶梯实测 + `npm test`/`npm run check`。
8. 交付 `.taco.html` 供人工核对，并在报告里给出级别/依据/路径/文件名/标题/校验级别/告警。

## 8. 交付

- 评审载体 `.taco.html`（本设计的中文源文件打包），路径与命名按本契约自身规则确定。
- 报告含：命中级别、依据、产物绝对路径、文件名、标题、校验阶梯级别与结果、告警。
