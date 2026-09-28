---
title: '012-skill-update-notice'
feature_id: '012-skill-update-notice'
created: '2026-09-28'
status: 'Draft'
issue: 'https://github.com/Arcadia822/taco/issues/53'
linear: 'https://linear.app/castrel/issue/TACO-21'
input: |-
  TACO-21: taco skill 工作时检查 taco 及 taco-cli 更新，任务完成时轻量提醒用户
---

## 1. 背景与目标

Taco 的安装方式是「把 `skills/taco/` 目录整份拷贝到 Agent 的 skill 目录」（见 `docs/agent-installation.md`）。拷贝是**一次性快照**：此后仓库继续发布新版本，本地副本不会自动跟进。同理，可选安装的 `taco-cli` 是独立二进制/npm 包，也需要用户主动升级。

后果有两类：

1. 用户长期停留在旧快照上：拿不到新的 shell、模板、参考文档与打包脚本修复。
2. Agent 未经确认擅自升级会引入不可控的环境变更，甚至中断正在进行的评审。

本特性确立一个**只检测、不升级**的闭环：

```text
Agent 开始 Taco 工作 → 一次轻量更新检查 → 正常完成交付
                      （有可用更新时才在最终回复末尾加一句话）
用户自主决定是否升级 → （用户明确要求时）Agent 才执行升级
```

### 1.1 参考机制

同类工具 `ego lite`（本机已安装的浏览器自动化工具）已经采用该模式：工具自身在输出中提示有可用更新，Agent 在最终回复末尾照实转述、不自行升级，例如「Ego Lite 提示有可用更新；未升级。」。本特性沿用同一机制与文风：**检测结果由工具给出，最终由 Agent 以一句话转述，明确说明未升级**。

### 1.2 目标

- 每次 Taco 工作会话开始时，检查 `taco` skill（本体）是否有可用更新。
- 若本机安装了 `taco-cli`，一并检查其是否有可用更新。
- 检查过程轻量、容错：失败、超时、离线、工具缺失都不阻断主线工作，也不输出噪音。
- 仅在确有可用更新时，在任务交付的最终回复末尾追加一句话，供用户自主决定。
- 任何情况下都不自动执行安装或升级命令，除非用户明确要求。

### 1.3 当前证据（2026-09-28 实测）

| 观测 | 结果 |
| :--- | :--- |
| 本机已安装 skill 副本 `~/.claude/skills/taco/`、`~/.agents/skills/taco/` | 均为 2026-09-22 快照：仅有 `SKILL.md`(16 462 B)、`taco-shell.html`、`templates/`，缺 `references/`、`scripts/` |
| 仓库当前 `skills/taco/SKILL.md` | 24.9 KB，且已含 `references/`、`scripts/` |
| 本机 `taco-cli --version` | `{"schema":"taco-cli-help/1","binaryVersion":"0.1.4", ...}` |
| 远端最新 `taco-cli` 发布 | `taco-cli-v0.2.1`（`gh release list`） |
| 远端 tag 探测 | `git ls-remote --tags --refs https://github.com/Arcadia822/taco.git` → 25 个 tag，耗时约 1.3 s，无认证、无速率限制 |
| GitHub Releases API（未认证） | 15 条 release；`x-ratelimit-limit: 60`（每小时） |
| 扩展安装包资产 | 仅 `v0.6.0` 携带 `taco-extension-v0.6.0.zip`，`v0.11.0` 等后续 tag 无资产 |

最后一行直接决定了一个设计取舍：扩展（Spec Kit extension）不能用「最新 tag」作为升级信号（会长期误报），详见 §9。

---

## 2. 用户场景

### 2.1 场景 S1：存在可用更新（P1）

- **Given** 本机 `skills/taco/VERSION` 为 `0.11.0`，远端最新 tag 为 `v0.12.0`。
- **When** Agent 使用 taco skill 打包/刷新/消费评审。
- **Then**
  - 检查在本次会话的第一次 Taco 动作前完成一次，不在会话内重复检查。
  - 任务正常交付，最终回复末尾追加一句话（见 §5.4），例如：
    `Taco 提示有可用更新：taco skill v0.11.0 → v0.12.0；未升级，可自行决定是否更新。`
  - 不执行任何安装/升级命令。

### 2.2 场景 S2：已是最新（P1）

- **Given** 已安装版本等于远端最新版本（例如在仓库 checkout 内工作，`VERSION` 与 `package.json` 一致）。
- **When** Agent 使用 taco skill。
- **Then** 全程静默：不出现任何更新相关输出，最终回复不含相关句子。

### 2.3 场景 S3：检查失败/离线/超时（P0）

- **Given** 无网络、`git` 缺失、远端返回异常或探测超时。
- **When** Agent 使用 taco skill。
- **Then** 打包、刷新、评审、交付全部照常完成；最终回复不含任何更新提示；Agent 不得因此重试阻塞，也不得向用户报告失败。

### 2.4 场景 S4：未安装 taco-cli（P1）

- **Given** `PATH` 中没有 `taco-cli`。
- **When** 执行更新检查。
- **Then** 仅检查 skill；不提示安装 `taco-cli`；JSON 输出中 `cli` 为 `null`。

### 2.5 场景 S5：skill 与 taco-cli 同时落后（P1）

- **Given** skill `0.11.0`（远端 `0.12.0`）、`taco-cli` `0.1.4`（远端 `0.2.1`）。
- **Then** 合并为同一句话输出两个组件的版本变化（见 §5.4），不拆成多句。

### 2.6 场景 S6：用户要求升级（P2）

- **Given** Agent 已提示存在可用更新，用户回复「升级吧」/「怎么升级」。
- **When** 用户**明确**表达升级意图。
- **Then** Agent 给出准确步骤（指向 `docs/agent-installation.md` 的对应小节与仓库地址），并在用户授权后执行；未获授权时不执行任何写操作。

### 2.7 场景 S7：显式关闭检查（P2）

- **Given** 环境变量 `TACO_UPDATE_CHECK=off`（或 CI/离线环境按此设置）。
- **Then** 跳过检查、保持静默，不产生任何网络请求。

---

## 3. 验收标准

| 编号 | 验收条件 | 对应来源 |
| :--- | :--- | :--- |
| AC-1 | `skills/taco/SKILL.md` 明确规约「会前一次检查 → 交付 → 有更新才一句话提醒 → 绝不自主升级」的契约 | Issue 验收标准 1、3 |
| AC-2 | `docs/agent-installation.md`（Agent 安装指南）与 `extensions/taco/policies/taco-agent-policy.md`（Spec Kit 项目内策略）包含同一契约的可执行表述与安装文件清单更新 | Issue 验收标准 1「及相关 Agent 指南」 |
| AC-3 | 检查脚本在离线、超时、`git` 缺失、`taco-cli` 缺失、版本标记缺失时一律返回可用结果（exit code 0、`ok:false` + `reason`），绝不让 Taco 工作失败 | Issue 验收标准 2 |
| AC-4 | 更新检查不写入任何文件、不读取项目文档内容、不发送任何本地内容或凭据到网络 | 本规格安全性要求 |
| AC-5 | 存在可用更新时输出的提醒文案与 §5.4 模板一致，且**明确声明未升级**；无更新或结果未知时不输出任何字样 | Issue 期望行为 2 |
| AC-6 | 任何路径下都不会触发安装/升级命令：脚本不含安装能力，SKILL.md 以 MUST NOT 级别禁止自主升级 | Issue 验收标准 3 |
| AC-7 | 单元/端到端测试覆盖：有更新、无更新、离线容错、`taco-cli` 缺失、`VERSION` 缺失，以及 JSON 契约校验 | §8 |
| AC-8 | `skills/taco/VERSION` 与 `package.json` 版本在构建后一致，并有测试守护 | §6.1 |

---

## 4. 术语与范围

- **taco skill（本体）**：`skills/taco/` 目录，用户以整目录拷贝方式安装；本特性以其中的 `VERSION` 标记其版本。
- **taco-cli**：可选安装的云端 CLI（`@tacobin/cli` / 独立二进制），仅在做云端发布/评审时需要。
- **远端最新版本**：仓库 `Arcadia822/taco` 上已发布的 tag（发版链路只在 `main` 打 tag，见 `skills/taco-release/SKILL.md`）。
- **检查会话**：一次 Agent 工作任务的上下文；同一会话内最多检查一次。

---

## 5. 机制设计

### 5.1 已安装版本的唯一来源

| 组件 | 已安装版本来源 | 说明 |
| :--- | :--- | :--- |
| taco skill | `skills/taco/VERSION`（脚本所在 skill 目录内的 `VERSION` 文件） | 单行 semver，无 `v` 前缀，末尾换行；由构建从 `package.json` 生成，见 §6.1 |
| taco-cli | `taco-cli --version` 输出 JSON 的 `binaryVersion` 字段 | 仅当 `PATH` 中存在 `taco-cli` 时才探测；该字段由 CLI 构建从 `packages/cli/package.json` 自动同步（PR #70） |

脚本读取的是**自身所在 skill 目录**的 `VERSION`，因此「Agent 正在使用的 skill」即被检查对象，无需推测用户装了哪些副本。

### 5.2 远端最新版本的探测

单次探测，严格按下列顺序回退：

1. **首选：`git ls-remote --tags --refs <repo>`**
   - 一次请求返回全部 tag；无认证、无速率限制（实测 25 tag ≈ 1.3 s）。
   - `^v(\d+\.\d+\.\d+)$` → taco 本体最新版本（`taco-cli-v*`、`tacobin-v*` 因前缀不同天然排除）。
   - `^taco-cli-v(\d+\.\d+\.\d+)$` → taco-cli 最新版本。
2. **回退：GitHub Releases API**（仅当 `git` 不可用时）`GET https://api.github.com/repos/Arcadia822/taco/releases?per_page=100`，从 `tag_name` 取同样的两类版本。
3. 两者都失败 → `ok:false` + `reason`，静默。

约束：

- 默认超时 3000 ms（`--timeout` 可调），超时即放弃，**不重试**。对 `git` 子进程用硬超时终止（`SIGKILL`），对 HTTP 用 `AbortSignal.timeout`。
- **不做结果缓存**：首选探测无速率限制，且契约规定每次工作会话最多检查一次；引入缓存会带来陈旧结果与额外状态文件，收益不成立（见 §9）。
- 不使用 `gh` CLI、不使用任何凭据；只读公开 tag/发布列表。

### 5.3 检查脚本契约（新增 `skills/taco/scripts/check-update.mjs`）

```sh
node scripts/check-update.mjs [--json] [--repo <url|path>] [--timeout <ms>] [--cli-bin <path>] [--no-cli]
```

- **默认输出**：一行人类可读摘要（英文，供日志阅读），例如
  `Taco update check: skill 0.11.0 -> 0.12.0 (update available); cli 0.1.4 -> 0.2.1 (update available)`。
  无更新时输出 `Taco update check: up to date (skill 0.11.0)`。
- **`--json`**：输出单个 JSON 对象，契约见 `contracts/taco-update-check.schema.json`（`schema: "taco-update-check/1"`）。字段：
  - `ok`：远端与本地版本是否都成功读取。
  - `reason`：`ok:false` 时的机器可读原因（如 `network-unavailable`、`git-unavailable`、`installed-version-marker-missing`、`timeout`）。
  - `source`：实际使用的探测通道（`git-ls-remote` / `github-releases-api`），失败为 `null`。
  - `skill`：`{ installed, latest, updateAvailable }`；`latest`/`updateAvailable` 未知时为 `null`。
  - `cli`：同上；未安装为 `null`。
- **退出码**：检查完成一律 `exit 0`（含 `ok:false`）——检查失败不是脚本失败，不得让调用方误判为打包失败。参数用法错误（未知 flag）返回 `exit 2`，因为那属于 Agent/作者错误，需要被立刻发现。
- **环境变量**：
  - `TACO_UPDATE_CHECK=off` → 立即输出 `ok:false, reason:"disabled"` 并 `exit 0`（不发起任何请求）。
  - `TACO_CLI_BIN` → 覆盖 `taco-cli` 可执行文件路径（与 `--cli-bin` 等价），用于非标准安装位置与测试。
- **语义**：
  - 版本比较为严格三段 semver 数值比较；仅当 `latest > installed` 时 `updateAvailable = true`。
  - 已安装版本高于远端（例如仓库 checkout 领先于最近 tag）→ `updateAvailable = false`，静默。
  - `VERSION` 缺失或不可解析 → `skill.installed = null`、`updateAvailable = null`、`ok:false`、`reason:"installed-version-marker-missing"`。
  - `taco-cli --version` 输出不可解析（过旧版本）→ `cli.installed = null`，不提示。
- **副作用**：零写入、零本地内容外发（见 AC-4）。

### 5.4 触发契约与文案（写入 `SKILL.md`）

**触发时机**：每次 Taco 工作会话的第一次 Taco 动作（打包、刷新、消费评审）之前执行一次；同一会话内不再重复执行。

**提醒文案模板**（与 `ego lite` 的机制一致：陈述事实 + 声明未升级）：

| 情形 | 中文（默认，随对话语言） | English |
| :--- | :--- | :--- |
| 仅 skill 有更新 | `Taco 提示有可用更新：taco skill v<installed> → v<latest>；未升级，可自行决定是否更新。` | `Taco notes an available update: taco skill v<installed> → v<latest>; not upgraded — update at your discretion.` |
| 仅 cli 有更新 | `Taco 提示有可用更新：taco-cli v<installed> → v<latest>；未升级，可自行决定是否更新。` | `Taco notes an available update: taco-cli v<installed> → v<latest>; not upgraded — update at your discretion.` |
| 二者都有 | `Taco 提示有可用更新：taco skill v<installed> → v<latest>、taco-cli v<installed> → v<latest>；未升级，可自行决定是否更新。` | `Taco notes an available update: taco skill v<a> → v<b>, taco-cli v<c> → v<d>; not upgraded — update at your discretion.` |

**禁止项**（MUST NOT）：

- 不得在未获用户明确授权时执行任何安装/升级命令（`npm install -g`、拷贝 skill 文件、`specify extension add` 等）。
- 不得因检查结果中断、延迟或改写主线交付内容；提醒只能出现在**最终回复末尾**，一句话，不展开、不重复。
- 不得在无更新、检查失败或结果未知时输出任何更新相关字样。
- 不得把检查结果或 Taco 内容（含协作凭据）外发到任何外部服务；检查只读取远端公开 tag 列表。

---

## 6. 受影响组件与改动清单

| 组件 | 改动 | 类型 |
| :--- | :--- | :--- |
| `skills/taco/scripts/check-update.mjs` | 新增探测脚本（§5.3） | 新增 |
| `skills/taco/VERSION` | 新增版本标记，构建生成（§6.1） | 新增（生成物） |
| `scripts/sync-skill-version.mjs` | 从 `package.json` 写入 `skills/taco/VERSION` | 新增 |
| `package.json` | `build` 链中加入 `node scripts/sync-skill-version.mjs` | 修改 |
| `skills/taco/SKILL.md` | 新增「更新提示」小节；在 `Report format` 末尾补一句提醒规则 | 修改 |
| `docs/agent-installation.md` | 安装文件清单加入 `VERSION` 与 `scripts/check-update.mjs`；新增「更新提示」小节与 bootstrap 说明 | 修改 |
| `extensions/taco/policies/taco-agent-policy.md` | 追加一条同等契约（Spec Kit 项目内生效） | 修改 |
| `README.md`、`README.zh-CN.md` | Quickstart 之后一句话说明「有更新会提示、不会自动升级」 | 修改 |
| `skills/taco-release/SKILL.md` | 发版步骤 3.1 注明 `VERSION` 由构建生成、需随发版提交 | 修改 |
| `AGENTS.md` | 仓库规则中注明 `skills/taco/VERSION` 为生成物，勿手改 | 修改 |
| `tests/version.test.ts` | 断言 `skills/taco/VERSION` 与 `package.json` 一致 | 修改 |
| `tests/update-check.test.ts` | 新增脚本端到端与契约测试（§8） | 新增 |
| `specs/012-skill-update-notice/contracts/taco-update-check.schema.json` | 脚本输出契约 | 新增 |

### 6.1 `VERSION` 为何是构建生成物

`skills/taco/templates/` 已是「构建生成的镜像」这一既有惯例（`AGENTS.md` 明确禁止手改镜像、要求重新生成）。沿用同一惯例，把 `VERSION` 交给构建生成，可让版本同步不依赖发版操作者的记性；`npm run check`（含 `npm test` 与 `npm run build`）与 CI 会在版本漂移时失败。

内容格式固定：`0.11.0\n`（单行、无前缀）。不写入任何其他字段——脚本只做等值/大小比较，多字段只会制造解析分支。

---

## 7. 迁移与兼容

| 情形 | 行为 | 说明 |
| :--- | :--- | :--- |
| 旧安装（快照早于本特性） | 不会执行检查，也没有相关文案 | 旧 `SKILL.md` 不含该契约；这是机制自身的 **bootstrap 约束**：用户需要一次手动重装/刷新才能获得更新提示能力。文档必须写明，避免被误解为缺陷 |
| 脚本存在但 `VERSION` 缺失（拷贝不全） | `ok:false, reason:"installed-version-marker-missing"`，静默 | 不编造版本、不推测「一定有更新」 |
| `taco-cli` 未安装 | 跳过该项 | 在最终回复中也不提示安装 |
| `taco-cli` 过旧、`--version` 输出不可解析 | `cli.installed=null`，静默 | 不做字符串猜测 |
| 网络不可用 / `git` 缺失 / 超时 | `ok:false` + `reason`，静默 | 主线交付不受影响 |
| 仓库 checkout 内工作（贡献者） | 版本通常等于或领先最近 tag → 静默 | 贡献者环境本身即最新源 |

无破坏性变更：不改动 bundle 格式、shell、CLI 命令面与任何既有文件格式；新增文件与既有安装流程向后兼容。

---

## 8. 验证方案

### 8.1 自动化（Vitest，`tests/update-check.test.ts`）

1. **有更新**：临时目录建本地 git 仓库（`--repo <path>`），打 tag `v0.10.0`、`v0.11.0`、`taco-cli-v0.2.0`；skill `VERSION=0.10.0`，`--cli-bin` 指向输出 `{"binaryVersion":"0.1.4"}` 的桩程序 → 断言 `skill = {0.10.0, 0.11.0, true}`、`cli = {0.1.4, 0.2.0, true}`、`source="git-ls-remote"`、`ok=true`。
2. **无更新**：同上但 `VERSION=0.11.0` → `skill.updateAvailable=false`。
3. **版本领先**：`VERSION=0.12.0` → `updateAvailable=false`（不得报「降级」）。
4. **未安装 cli**：`--no-cli` 或 `TACO_CLI_BIN` 指向不存在路径 → `cli=null`，其余不变。
5. **`VERSION` 缺失**：临时 skill 目录无 `VERSION` → `ok=false`、`reason="installed-version-marker-missing"`、`updateAvailable=null`。
6. **远端不可达/超时**：`--repo <不存在的路径>`、`--timeout 1` → `ok=false`、`exit code 0`、stdout 仍可解析。
7. **契约校验**：`--json` 输出对 `contracts/taco-update-check.schema.json` 校验通过（用仓库现有 `ajv`/`yaml` 依赖栈的既有方式，若无现成校验器则以字段断言等价覆盖）。
8. **`VERSION` 同步**：在 `tests/version.test.ts` 断言 `skills/taco/VERSION.trim() === packageJson.version`。
9. **禁用开关**：`TACO_UPDATE_CHECK=off` → `reason="disabled"`、无网络请求（测试中以不可达 `--repo` 佐证不触发探测）。

### 8.2 手工 smoke（必须真实执行，作为交付证据）

- 在本机真实网络下运行 `node skills/taco/scripts/check-update.mjs --json`，确认：`source="git-ls-remote"`，`skill.latest="0.11.0"`，`cli.installed` 与本机 `taco-cli --version` 一致（当前为 `0.1.4`），`cli.latest="0.2.1"`，`cli.updateAvailable=true`。
- 运行 `TACO_UPDATE_CHECK=off` 与 `--repo /nonexistent` 两个容错场景，确认 `exit code 0` 且主线可继续。
- 在真实 Taco 打包流程中走一遍：确认提醒只出现在最终回复末尾，且打包/刷新输出未被污染。

### 8.3 与验收标准的映射

AC-1/AC-2 → §5.4 与 §6 文档改动；AC-3 → 8.1 的第 5、6、9 项；AC-4 → §5.3「副作用」+ 代码评审；AC-5 → 8.1 的 1–4 与 §5.4 文案断言；AC-6 → §5.4 禁止项 + 测试 9；AC-7 → 8.1 全部；AC-8 → 8.1 第 8 项。

---

## 9. 明确不做（Non-goals 与理由）

1. **不检查 Spec Kit 扩展（`extensions/taco/`）的更新**：扩展的「最新版本」不等于「最新可安装包」——实测仅 `v0.6.0` 发布了 `taco-extension-v0.6.0.zip`，`v0.11.0` 等后续 tag 无资产。以 tag 为准会长期误报「有更新但装不上」；以资产为准又需要额外的 releases API 调用，而扩展发布链路当前处于停用状态，该分支会长期静默。等扩展发布链路恢复后另开 issue 处理。（Issue 本身也只要求检查 skill 与 taco-cli。）
2. **不检查 tacobin 站点版本**：网页端随部署自动更新，不存在「本地副本落后」问题。
3. **不做结果缓存**：首选探测（`git ls-remote`）无速率限制，契约又限定每次会话只检查一次；缓存会引入陈旧结果与额外状态文件。回退通道（GitHub API，60 次/小时未认证）只在 `git` 缺失时启用，风险可接受并在 §5.2 记录。
4. **不做后台定时检查/守护进程**：检查发生在 Agent 工作流内部，不引入常驻进程。
5. **不提供自动升级能力**：脚本不具备安装/写文件能力；升级始终由用户发起。
6. **不改动 bundle 格式、shell、`window.taco` API 与 `taco-cli` 命令面**：本特性只新增探测脚本与文案契约。
7. **不在仓库贡献者环境内做「与 main 比较」的额外提示**：贡献者 checkout 即最新源，tag 比较已足够。

---

## 10. 待评审的开放问题

1. §9.1：是否接受「本期不覆盖 Spec Kit 扩展更新提示」，还是要求在同一期以「资产存在才提示」的保守方式覆盖？
2. §5.1 的 `VERSION` 载体与「构建生成」方案是否认可；是否希望改为 SKILL.md frontmatter（会引入非 Agent Skills 规范字段，故未采用）。
3. §5.4 文案模板的措辞与「未升级」表述是否需要调整。
