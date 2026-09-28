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
      ├── skills/taco/SKILL.md               级联摘要 + 落盘步骤 + 报告要求
      ├── docs/agent-installation.md         reference 清单 + 一句指引
      ├── .taco/config.yaml                  本仓库自我声明 outputDir: specs/{feature}
      └── extensions/taco/{commands/update.md, skills/taco-speckit/SKILL.md, README.md}
                                             一句：扩展项目 ⇒ S2（feature 目录）
```

不新增脚本、不新增测试文件、不改 `src/` 与 `packages/`。

## 2. 落盘步骤（写进 SKILL.md 的可照做序列）

无脚本、无 CLI。Agent 自己完成，顺序固定：

1. **定目标**：按级联（spec.md §4）确定产物目录、文件名与标题；产出报告行：`L? → <绝对路径>（依据：…）`。命中 L0 文件形态时，标题取文件名 stem。
2. **读既有**：目标文件已存在 → 先读它的数据块；确认 `docId` 属于本次刷新/迁移对象（否则停止）。目标不存在 → 从技能自带 shell 复制（Complete 或 Lite，按 §3 的变体规则）。
3. **备目录**：目标父目录不存在 → 先创建。
4. **落数据块**：把 `taco/files` v1 bundle JSON 写进 `#taco-document`，按标题写 `<title>`；文件其余字节不动。序列化、转义、原子替换的规则以 `skills/taco/references/bundle-format.md` 为权威。
5. **保留态**：刷新/迁移时保留 `docId`、`comments`、`navigation`、`checkpoints`（含文档状态）、每个 file 的 `id` 与 `blocks` 缓存、未知字段。
6. **校验**：有评审标签时 `window.taco.validate()`；否则按 `references/bundle-format.md` 的形态规则检查数据块可解析、必需字段齐全、`root` 与文件 path 一致。
7. **报告**：级别、依据、绝对路径、文件名、标题、告警（`gitignored` / `git-unavailable` / `workspaceRoot-not-git`）。

迁移（仅用户显式要求）在步骤 2 之前插入**占用预检**：目标已存在且 `docId` ≠ 旧文件 → 停止，不建目录、不复制。之后是"建目录 → 复制旧文件 → 按上述步骤 4–6 落盘 → 校验身份与状态逐字段一致 → 报告新旧路径"，不删旧文件。

## 3. Shell 变体与产物命名

- 变体：新建与 Complete 刷新用 `taco-shell.html`；既有 Lite Taco 的刷新沿用 `taco-shell-lite.html`。不得静默改变既有变体。
- 文件名 stem = 标题的归一化结果（NFKC → 非字母数字下划线连字符替换为 `_` → 折叠裁剪 `_`/`-` → 空值回退 `Untitled`）。L0 文件形态下由文件名反推标题。

## 4. 文档接线

### 4.1 权威契约的落位

1. 设计期：`specs/012-agent-taco-output-path/contracts/output-path-rule.md`（中文）。
2. 实现第一步：**语义等价地译为英文**写入 `skills/taco/references/output-path.md`（skill 侧文档沿用既有英文），逐条核对语义一致（级联表、`config.yaml` 语法、失败类型、小写目录、文件名↔标题、占用规则、落盘步骤）。
3. 同时把中文稿替换为指针（标题 + 迁移说明 + 链接），此后不再演进。

理由：安装只拷贝 `skills/taco/**`（见 `docs/agent-installation.md` 的安装步骤），`specs/**` 不随安装分发；权威必须在安装可见的路径上，且只保留一份。

### 4.2 `skills/taco/SKILL.md`

新增章节 `## Where to write .taco.html`，置于 `## Workflow` 之前，内容为：级联摘要（含小写 `tacos` 与个人归档）、`.taco/config.yaml` 的位置与键、L0 文件名↔标题规则、§2 的落盘步骤、报告与告警清单、以及"完整规则见 `references/output-path.md`"。Workflow 步骤 1 引用该章节。保持英文。

### 4.3 `docs/agent-installation.md`

- 安装核对清单的 reference 列举补 `output-path.md`。
- "Use the skill" 步骤补一句：产物目录由级联决定（不再默认写 cwd），并说明这是相对旧版的有意行为变更。

### 4.4 `.taco/config.yaml`（本仓库自我应用）

```yaml
version: 1
outputDir: specs/{feature}
```

使设计规格与其评审产物落在同一目录（与 `specs/011-*` 既有形态一致），并作为该契约的真实用例。已确认不冲突 `tests/agent-instructions.test.ts` 的现有断言。

### 4.5 `extensions/taco/`

`commands/update.md`、`skills/taco-speckit/SKILL.md`、`README.md` 各加一句：已安装扩展 ⇒ 产物在 feature 目录（契约中的 S2），并附可选链接。不复制语法表，不要求扩展依赖 skill 的 reference。

## 5. 验证

按 spec.md §8 执行：

1. **文档一致性检查**（人工）：级联顺序、级别命名、失败类型、小写目录、落盘步骤无脚本调用；全仓库只有一份完整语法表。
2. **五类场景走查**：每类同时核对产物位置与 bundle `root`/内部引用。
3. **迁移与占用**（真实文件系统）：迁移到不存在的父目录可成功且状态逐字段保留；目标被他人占用时预检即停止、目标字节未变。
4. **回归**：`npm test` 与 `npm run check` 通过。

不新增自动化测试：本特性无代码产物，用源文本断言写测试属于"测文档措辞"，不构成有效覆盖（该取舍已在 spec.md §6 记录）。

## 6. 兼容性

- 无 schema 变更；既有 `.taco.html` 不受影响，刷新后路径与 `root` 不变。
- 未配置 `.taco/config.yaml` 的仓库：不再默认写 cwd 根，改按 L3/L4/L5 落盘——**有意的行为变更**，须在 SKILL.md 与安装文档写明。
- 只安装 Spec Kit 扩展的项目：行为与现在一致（feature 目录），不依赖本契约。
- 旧版 skill（无本 reference）：行为与引入前一致。

## 7. 实施顺序

1. 契约稿评审通过；确认 §10.2 的 `pack.mjs` 处置方向（它决定 SKILL.md 里"落盘"章节与其他章节是否还协调）。
2. 契约译为英文迁入 `skills/taco/references/output-path.md`；中文稿降级为指针；逐条核对语义。
3. `SKILL.md` 新章节；`docs/agent-installation.md` 两处。
4. `.taco/config.yaml` 落盘（本仓库自我应用）。
5. `extensions/taco/` 三处一句话。
6. 五类场景走查 + 迁移/占用实测 + `npm test`/`npm run check`。
7. 交付一个 `.taco.html` 供人工核对，并在报告里给出级别/依据/路径/文件名/标题/告警。

## 8. 交付

- 评审载体 `.taco.html`（本设计的中文源文件打包），路径与命名按本契约自身规则确定。
- 报告含：命中级别、依据、产物绝对路径、文件名、标题、告警、未决项。
