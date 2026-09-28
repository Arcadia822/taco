---
title: '012-agent-taco-output-path 技术方案'
feature_id: '012-agent-taco-output-path'
created: '2026-09-28'
status: 'Draft'
---

## 1. 实现策略

本特性**只改文档与项目配置**，不含代码：

```text
权威契约（设计期：specs/012-*/contracts/output-path-rule.md）
      │ 实现时译为英文迁入
      ▼
skills/taco/references/output-path.md        ← 唯一权威，随 skill 安装
      │
      ├── skills/taco/SKILL.md               新增输出位置章节 + 主流程改为直接写数据块
      ├── docs/agent-installation.md         Assemble 步骤改为直接写数据块 + reference 清单
      ├── .taco/config.yaml                  本仓库自我声明 outputDir: specs/{feature}
      └── extensions/taco/{commands/update.md, skills/taco-speckit/SKILL.md, README.md}
                                             一句：扩展项目 ⇒ S2（feature 目录）
```

不新增脚本、不新增测试文件、不改 `src/` 与 `packages/`、不手改模板镜像。

## 2. 落盘顺序（写进 SKILL.md 的可照做序列）

无脚本、无 CLI。顺序固定，不得调换（契约 §5.1）：

1. **定目标**：按级联（spec.md §4）确定产物目录、文件名与标题；产出报告行 `L? → <绝对路径>（依据：…）`。命中 L0 文件形态时标题取该文件名 stem（且该 stem 必须是规范形式）。
2. **读入内存**：读目标文件（若存在）的 `#taco-document` 数据块，以及所选 shell（若目标不存在）。**不得**先把 shell 复制到目标路径。
3. **占用判定**：目标不存在 → 新建；解析为同一路径 → 刷新；别的 `docId` → 停止；同 `docId` 但非同一文件 → 默认停止（迁移需用户显式授权并先报告状态差异）。
4. **构造新 bundle**：按下表保留字段，生成完整 JSON。

| 字段 | 规则 |
| --- | --- |
| `docId`、`comments`、`navigation`、`checkpoints`、`access`、`collab`、未知顶层字段 | 原样保留 |
| 标题 | 刷新时保留既有 bundle 的标题；目标文件名 stem 与其归一化结果不一致 → 报告冲突并停止 |
| 每个 file 的 `id` | 保留 |
| `blocks` | 仅当该文件新旧 `content` 字节完全相同时保留；内容变化即丢弃 |
| `sourceHash` | 内容变化时重算 |
| 打包集合 | 排除所有 `*.taco.html`；若产物目录等于被打包目录，报 `output-in-input` 告警 |

5. **转义与自校验**（落盘前提）：按 `references/bundle-format.md` 序列化并转义；对**将要写入的那一份字符串**做解析校验与形态校验（必需字段、`root` 与各 `path` 一致、path 唯一且安全）。宿主没有解析能力 → 停止（`unverifiable`），不写文件。
6. **备目录**：目标父目录不存在则创建（临时文件必须与目标同目录）。
7. **原子替换**：完整 HTML 写到同目录临时文件 → `rename` 覆盖目标；失败保留原文件。
8. **校验与报告**：按校验阶梯（spec.md §8 / 契约 §6）取 V1/V2 中最高的可用级别，并写明级别（V2 必须声明"未做运行校验"）。

迁移（仅用户显式要求）：第 3 步改用"目标已存在即默认停止"的规则，只有用户显式授权覆盖、且报告已列出目标与来源的状态差异后才继续；之后走 4–8 步，并校验 `docId` 与 `comments`/`checkpoints`/`navigation` 逐字段一致；不删旧文件。

## 3. 上下文判定

- **仓库识别不依赖 git 命令**：从被打包目录（缺省 cwd）向上查找 `.git/` 目录，或内容形如 `gitdir: <路径>` 的 `.git` 文件（worktree/submodule）；到文件系统根仍未找到 → 不在仓库内（L5）。
- `git` 命令只服务可选的忽略检查：`git check-ignore` 命中 → `gitignored` 告警；命令不可用 → `gitignore-unavailable` 告警，均不改变仓库判定。
- `HOME ?? USERPROFILE` 皆缺失 → `needs_home`，停止，不落到 cwd。
- 被打包目录是仓库根 → 命中 LR：跳过项目规则与目录探测，产物落 `<repo>/tacos/`（契约 §4）。

## 4. 文档接线

### 4.1 权威契约的落位

1. 设计期：`specs/012-agent-taco-output-path/contracts/output-path-rule.md`（中文）。
2. 实现第一步：**语义等价地译为英文**写入 `skills/taco/references/output-path.md`（skill 侧文档沿用既有英文），逐条核对语义一致（级联与仓库根例外、`.taco/config.yaml` 语法与失败语义、L0 规范文件名、保留字段与 `blocks` 规则、占用规则、落盘七步、校验阶梯）。
3. 同时把中文稿替换为指针（标题 + 迁移说明 + 链接），此后不再演进。

理由：安装只拷贝 `skills/taco/**`（见 `docs/agent-installation.md` 的安装步骤），`specs/**` 不随安装分发。

### 4.2 `skills/taco/SKILL.md`（新增章节 + 主流程收敛）

- 新增 `## Where to write .taco.html`（置于 `## Workflow` 之前）：级联摘要（含小写 `tacos`、个人归档、仓库根例外）、`.taco/config.yaml` 的位置与键、L0 文件名↔标题规则、落盘七步、校验阶梯、报告与告警清单；`## Workflow` 步骤 1 引用该章节。
- **把现有以脚本为主流程的表述收敛为零依赖**：开篇的 "this skill ships the assembler … prefer `scripts/pack.mjs`"、bundle 写入规则、`## Workflow` 步骤 1 的命令示例、`### 2. Check what the reviewer will see`、`## Report format` 中依赖脚本退出码/输出结构的表述，都改为"直接写数据块 + 校验阶梯"。
- `pack.mjs` 与 `references/bundle-format.md` 的手工写块契约关系需重新表述：手工写块是**默认**路径，脚本（若保留）是可选辅助，绝不作为创建、刷新或校验的必经路径。

### 4.3 `skills/taco/references/bundle-format.md`

它目前把脚本写成"拥有载体"的工具与无浏览器时的验证手段（现状：`assembler owns carrier`、"写块是工具工作"、"无浏览器时运行脚本"）。实现阶段需把这三处改为：写块由 Agent 直接完成、写前自校验是落盘前提、校验按 V1/V2 阶梯声明；**保留**序列化、转义、原子替换与形态规则（它们是安全写块的事实依据）。职责边界：`output-path.md` 管"写到哪里、什么时候写、写完怎么声明"，`bundle-format.md` 管"数据块本身长什么样、如何安全写入"。

### 4.4 `docs/agent-installation.md`

- Assemble 步骤改为直接写数据块（含落盘七步与校验阶梯），并把脚本改为可选辅助。
- reference 清单补 `output-path.md`。
- 补一句：产物目录由级联决定（不再默认写 cwd），并说明这是相对旧版的有意行为变更。

### 4.5 `.taco/config.yaml`（本仓库自我应用）

```yaml
version: 1
outputDir: specs/{feature}
```

使设计规格与其评审产物同目录（与 `specs/011-*` 既有形态一致），并作为该契约的真实用例。已确认不冲突 `tests/agent-instructions.test.ts` 与 `tests/templates.test.ts` 的现有断言。

### 4.6 `extensions/taco/`

`commands/update.md`、`skills/taco-speckit/SKILL.md`、`README.md` 各加一句：已安装扩展 ⇒ 产物在 feature 目录（契约中的 S2），附可选链接。不复制语法表，不要求扩展依赖 skill 的 reference。

## 5. 验证

按 spec.md §8 执行，并留下可复现记录（输入目录、前/后绝对路径、失败码、数据块读取与状态比对）：

1. **文档一致性**：级联顺序与级别命名（L0/L1/LR/L2/L3/L4/L5）、失败类型集合、小写 `tacos`、校验阶梯（V1/V2）、落盘顺序，四处文本一致；只有一份完整语法表；落盘步骤不把脚本/CLI 当作必经路径。
2. **五类验收场景**：每类同时核对产物位置与 bundle `root`/内部引用。
3. **逐分支走查**：配置缺键/版本错/顶层非 mapping/重复键、S1–S2 冲突、仓库根打包（仓库内有 `docs/` 时仍落 `<repo>/tacos/`）、非规范 L0 文件名、L3 顺序、L4、L5 无 `HOME`、无 `git` 命令、禁区、`output-in-input`、`unverifiable`（无解析能力时不落盘）、迁移到不存在的父目录、迁移目标已存在、内容变化后 `blocks` 丢弃。
4. **校验阶梯实测**：至少一次 V1（打开标签页跑 `window.taco.validate()` 得 `ok: true`）与一次 V2（仅解析核对并声明"未做运行校验"）。
5. **回归**：`npm test` 与 `npm run check` 通过；两项既有测试只作回归防护，不作为级联或手写数据块正确性的证明。

不新增自动化测试：本特性无代码产物，对文档措辞做源文本断言不构成有效覆盖（取舍记录在 spec.md §6）。

## 6. 兼容性

- 无 bundle schema 变更；既有 `.taco.html` 不受影响，刷新后路径、标题与 `root` 不变。
- 未配置 `.taco/config.yaml` 的仓库：不再默认写 cwd 根，改按 L3/L4/L5 落盘——**有意的行为变更**。
- 只安装 Spec Kit 扩展的项目：行为与现在一致（feature 目录），不依赖本契约。
- 旧版 skill（无本 reference）：行为与引入前一致。

## 7. 实施顺序

1. 契约稿评审通过（不改动 `pack.mjs` 文件本体）。
2. 契约译为英文迁入 `skills/taco/references/output-path.md`；中文稿降级为指针；逐条核对语义。
3. `SKILL.md`：新增输出位置章节 + 主流程收敛为零依赖（§4.2）。
4. `references/bundle-format.md`：脚本优先与工具独占写入的表述收敛（§4.3）。
5. `docs/agent-installation.md`：Assemble 步骤与 reference 清单。
6. `.taco/config.yaml` 落盘（本仓库自我应用）。
7. `extensions/taco/` 三处一句话。
8. 五类场景 + 逐分支走查 + 校验阶梯实测 + `npm test`/`npm run check`。
9. 交付 `.taco.html` 供人工核对，并在报告里给出级别/依据/路径/文件名/标题/校验级别/告警。

## 8. 交付

- 评审载体 `.taco.html`（本设计的中文源文件打包），路径与命名按本契约自身规则确定。
- 报告含：命中级别、依据、产物绝对路径、文件名、标题、校验阶梯级别与结果、告警、未决项。
