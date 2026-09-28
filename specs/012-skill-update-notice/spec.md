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
| AC-2 | `docs/agent-installation.md`（Agent 安装指南）包含同一契约的可执行表述、安装文件清单（含 `VERSION`）与验证清单更新；`extensions/taco/policies/taco-agent-policy.md` 的新版本对新装/干净安装的 Spec Kit 项目生效（既有安装受 `prepare-policy` 的 fail-safe 约束，详见 §7） | Issue 验收标准 1「及相关 Agent 指南」 |
| AC-3 | 失败路径（离线、超时、`git` 缺失、`VERSION` 缺失或不可解析）一律 `exit code 0` + `ok:false` + `reason`，绝不让 Taco 工作失败；`taco-cli` 未安装或版本不可解析属于正常降级（`cli:null` 或 `cli.installed:null`），不影响 `ok`，也不阻断工作 | Issue 验收标准 2 |
| AC-4 | **脚本自身**零文件写入、零本地内容外发：检查发出的网络请求只读取远端公开 tag 列表，不携带任何本地路径、项目内容或凭据；范围明示——脚本自动执行的唯一本机程序是 `taco-cli --version`（可由 `--no-cli` / `TACO_UPDATE_CHECK=off` 关闭），该程序自身的行为由用户环境的信任模型承担，见 §5.5 与 §10.5 | 本规格安全性要求 |
| AC-5 | 存在可用更新时输出的提醒文案与 §5.4 模板一致，且**明确声明未升级**；无更新或结果未知时不输出任何字样 | Issue 期望行为 2 |
| AC-6 | 任何路径下都不会触发安装/升级命令：脚本只 spawn `git ls-remote` 与 `taco-cli --version`，不含任何写文件或安装路径；SKILL.md 以 MUST NOT 级别禁止自主升级；该约束由结构审查 + 真实流程烟测保证（无法由单元测试证明） | Issue 验收标准 3 |
| AC-7 | 单元/端到端测试覆盖：有更新、无更新、版本领先、`cli` 缺失/不可解析、`VERSION` 缺失/不可解析、远端不可达/超时/输出超限、禁用开关短路、预发布 tag、非默认 `--repo` 不回退 GitHub API、JSON 契约字段 | §8 |
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

1. **首选**：`git ls-remote --tags --refs <repo>`
   - 一次请求返回全部 tag；无认证、无速率限制（实测 25 tag ≈ 1.3 s）。
   - `^v(\d+\.\d+\.\d+)$` → taco 本体最新版本（`taco-cli-v*`、`tacobin-v*` 因前缀不同天然排除）。
   - `^taco-cli-v(\d+\.\d+\.\d+)$` → taco-cli 最新版本。
2. **回退：GitHub Releases API**（**前提**：`--repo` 未被覆盖且 `git` 不可用）`GET https://api.github.com/repos/Arcadia822/taco/releases?per_page=100`，从 `tag_name` 取同样的两类版本。
3. 两者都失败 → `ok:false` + `reason`，静默。`--repo` **被覆盖时不得回退**到 GitHub API（本地路径或第三方仓库与默认仓库无关，回退会产生错误结论）：此时直接 `ok:false, reason:"network-unavailable"` 或 `"git-unavailable"`。

Tag 解析规则：

- 只接受形如 `v<x>.<y>.<z>` / `taco-cli-v<x>.<y>.<z>` 的**三段纯数字** tag；预发布与非匹配 tag（`v1.2.0-rc.1`、`v1.2`、`release-1` 等）一律忽略，不做 semver range 匹配。
- 若远端没有任何可用的本体 tag（或没有任何可用的 `taco-cli` tag），该组件 `latest=null`、`updateAvailable=null`——这是「无法比较」，不是传输失败：`ok` 不受影响，也不输出提示。缺少 `taco-cli` tag 绝不能被当成网络故障。

约束与加固（安全审查结论，必须实现）：

- **默认超时 3000 ms**（`--timeout` 可调）**适用于每一次探测**（`git` 子进程、`taco-cli` 子进程、HTTP 请求）；超时即 `SIGKILL` 子进程并放弃该项，**不重试**。HTTP 使用 `AbortSignal.timeout`。
- **输出上限**：`git` 与 `taco-cli` 的 stdout 各截断至 64 KiB，超限即终止该探测并跳过（避免超长输出拖垮会话）。
- **Git 执行环境隔离**：以精简环境变量（仅 `PATH`、`HOME`、`LANG`）与 `GIT_CONFIG_GLOBAL=/dev/null`、`GIT_CONFIG_SYSTEM=/dev/null`、`GIT_TERMINAL_PROMPT=0`、`GIT_ASKPASS`/`SSH_ASKPASS` 置为不可用、`-c credential.helper=` 运行，避免继承用户的 `http.extraheader`、`url.*.insteadOf`、代理或凭据助手；不使用 `gh` CLI，不读取任何凭据。
  - **子进程 cwd 必须是中立目录**（`os.tmpdir()`），绝不在项目/仓库目录内启动：git 还会读取「包含当前工作目录的仓库」的 `.git/config`，仅隔离全局与系统配置不足以挡住项目级 `url.*.insteadOf` 与 `http.extraheader`。
  - 代价（明示）：仅通过 Git 配置文件设置代理的环境下，探测会失败并静默——这是刻意的隐私优先取舍。
- **子进程终止**：`git` 与 `taco-cli` 均以独立进程组启动（`detached: true`），超时或超限时以 `process.kill(-pid, 'SIGKILL')` 终止**整个进程组**，避免 `git` 的远程助手或 CLI 的派生进程残留。
- **参数边界**：生产调用固定 `https://github.com/Arcadia822/taco.git`；`--repo` 覆盖值只接受 `https://` 开头的 URL 或绝对本地路径，拒绝以 `-` 开头的值、其他协议与相对路径；向 git 传参时在仓库参数前插入 `--` 终止选项。
- **不做结果缓存**：首选探测无速率限制，且契约规定每次工作会话最多检查一次；引入缓存会带来陈旧结果与额外状态文件，收益不成立（见 §9）。

### 5.3 检查脚本契约（新增 `skills/taco/scripts/check-update.mjs`）

```sh
node scripts/check-update.mjs [--json] [--repo <url|path>] [--timeout <ms>] [--cli-bin <path>] [--no-cli]
```

- **默认输出**：一行人类可读摘要（英文，供日志阅读），例如
  `Taco update check: skill 0.11.0 -> 0.12.0 (update available); cli 0.1.4 -> 0.2.1 (update available)`。
  无更新时输出 `Taco update check: up to date (skill 0.11.0)`。
- `--json`：**输出单个 JSON 对象**（契约标识 `schema: "taco-update-check/1"`），字段集合与类型即为接口契约，测试逐字段断言（本仓库无 JSON Schema 校验器，故不引入额外依赖）：

  | 字段 | 类型 | 语义 |
  | :--- | :--- | :--- |
  | `schema` | `"taco-update-check/1"` | 契约标识（固定值） |
  | `checkedAt` | string | 检查时刻，ISO 8601 UTC |
  | `ok` | boolean | **传输与本地主对象**是否可用：远端探测成功 **且** skill 版本标记可读。为 `false` 时调用方必须静默 |
  | `reason` | string \| null | `ok:false` 时的机器可读原因，取值集合：`disabled`、`git-unavailable`、`github-api-unavailable`、`network-unavailable`、`timeout`、`output-limit-exceeded`、`installed-version-marker-missing`、`installed-version-unreadable`；`ok:true` 时为 `null` |
  | `source` | `"git-ls-remote"` \| `"github-releases-api"` \| null | 实际生效的探测通道；`ok:false` 时为 `null` |
  | `skill` | object | `{ installed: string\|null, latest: string\|null, updateAvailable: boolean\|null }` |
  | `cli` | object \| null | 与 `skill` 同构；本机未安装 `taco-cli`（或未通过信任检查）时为 `null` |

  `installed`/`latest` 为无 `v` 前缀的三段 semver 字符串（`^\d+\.\d+\.\d+$`），不可读时为 `null`；`updateAvailable` 仅在两者都已知时给出布尔值，否则为 `null`。
- **组件独立性（部分成功规则）**：`skill` 与 `cli` 各自独立判定，一个组件不可比较绝不使另一个失效：
  - 远端可达 + `VERSION` 可读 → `ok:true`；`skill.updateAvailable` 按比较结果给出。
  - `VERSION` 缺失 → `ok:false`、`reason:"installed-version-marker-missing"`、`skill.installed/updateAvailable=null`；`VERSION` 存在但不可解析 → `ok:false`、`reason:"installed-version-unreadable"`。两种情况下调用方一律静默，**不得**只报告 `cli` 的更新（主对象未知时不做任何提示，避免半截结论）。
  - `taco-cli` 不存在 → `cli:null`，`ok` 与 `skill` 不受影响。
  - `taco-cli` 存在但 `--version` 不可解析、超时或超输出上限 → `cli.installed=null`、`cli.updateAvailable=null`，`ok` 保持 `true`，`skill` 的结论照常可用；人类可读摘要中标注该项被跳过（不写入 `reason`，因为 `reason` 只描述 `ok:false`）。
  - 远端可达但某组件没有任何可用 tag → 该组件 `latest=null`、`updateAvailable=null`（见 §5.2），`ok` 保持 `true`。
- **退出码**：检查完成一律 `exit 0`（含 `ok:false`）——检查失败不是脚本失败，不得让调用方误判为打包失败。参数用法错误（未知 flag、`--repo` 取值不被允许）返回 `exit 2`，因为那属于 Agent/作者错误，需要被立刻发现。
- **环境变量**：
  - `TACO_UPDATE_CHECK=off` → 立即输出 `ok:false, reason:"disabled"` 并 `exit 0`；**不 spawn 任何子进程、不发起任何请求**。
  - `TACO_CLI_BIN` → 覆盖 `taco-cli` 可执行文件路径（与 `--cli-bin` 等价）。与 `--cli-bin` 同为**受信调用方 / 测试专用**入口，取值不得来自项目内容（见 §5.5）。
- **CLI 探测的信任前提**（`taco-cli`）：仅在可执行文件解析为**绝对路径、且为常规可执行文件**时执行 `taco-cli --version`；否则 `cli:null`。本机已安装的 CLI 视为用户已授权在其环境执行的程序——Agent 自动执行 `--version` 与该用户手动执行同一命令属同一信任级别，此前提写入 §5.5。
- **副作用**：零写入、零本地内容外发（见 AC-4）。检查脚本自身的输出（原始日志行）不得作为交付内容展示给用户（见 §5.4 禁止项）。

### 5.4 触发契约与文案（写入 `SKILL.md`）

**触发时机**：每次 Taco 工作会话的第一次 Taco 动作（打包、刷新、消费评审）之前执行一次；同一会话内不再重复执行。

**披露要求**（写入 `SKILL.md`）：该小节必须说明检查会在本机执行 `taco-cli --version`（仅当存在该命令）、检查失败一律静默，以及可用 `--no-cli` 或 `TACO_UPDATE_CHECK=off` 关闭；不得把自动执行描述为「纯读取」。

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
- 不得把检查命令的原始输出（`--json` 内容或英文日志行）贴给用户；用户可见的只有上表的一句话模板。
- 不得把检查结果或 Taco 内容（含协作凭据）外发到任何外部服务；检查只读取远端公开 tag 列表。

### 5.5 信任边界与残余风险

| 项 | 前提/风险 | 处理 |
| :--- | :--- | :--- |
| 远端 tag 列表 | 探测结果会被 Agent 转述给用户；仓库被转移/劫持或网络中间人可影响结果 | 只用于陈述「有可用版本」，不执行任何安装/写入；文案只嵌入受锚定的三段数字版本号，因此恶意 tag 名无法注入 Markdown 或控制字符 |
| 用户级 Git 配置 | 全局/系统配置可能携带认证头、URL 重写或代理 | `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` 指向 `/dev/null`、禁用交互与凭据助手；代价是「仅靠 Git 配置走代理」的环境探测失败并静默 |
| 项目级 Git 配置 | 位于 cwd 所在仓库的 `.git/config`（可由下载而来的含 `.git/` 目录触发）同样会被 git 读取 | **子进程 cwd 固定在中立目录**（`os.tmpdir()`），绝不在项目目录内启动；§8.1 第 18 项以恶意本地配置回归验证 |
| 本机 `taco-cli` | `PATH` 上被替换的可执行文件会被自动执行 | 仅接受解析为绝对路径的常规可执行文件；`--cli-bin`/`TACO_CLI_BIN` 仅限受信调用方与测试；该自动执行在 `SKILL.md` 中明示，可用 `--no-cli` 或 `TACO_UPDATE_CHECK=off` 关闭 |
| `--repo` 覆盖 | 调用方可指向任意位置 | 仅限 `https://` URL 与绝对本地路径，拒绝 `-` 前缀与其他协议，git 参数以 `--` 终止；非默认 `--repo` 不回退 GitHub API |
| 资源占用 | 子进程挂起、输出失控或派生进程残留 | 每次探测独立硬超时 + 64 KiB 输出上限；进程组级 `SIGKILL`（§5.2） |

**残余风险（明示、本期不消除）**：脚本无法证明被执行的 `taco-cli` 只做只读输出。若本机 CLI 已被替换，其行为超出本机制可控范围——这与「Agent 会执行本机任意命令」的既有信任模型同源，本特性只新增「每会话自动执行一次 `--version`」。处理方式是**如实披露 + 可关闭**（`--no-cli`、`TACO_UPDATE_CHECK=off`），而不是假装 AC-4 能覆盖外部程序；AC-4 因此显式限定为「脚本自身的读写与网络请求」。消除该残余风险需要对 CLI 做沙箱隔离，属于本期范围之外（见 §9.9），并作为待确认项列入 §10.5。

---

## 6. 受影响组件与改动清单

| 组件 | 改动 | 类型 |
| :--- | :--- | :--- |
| `skills/taco/scripts/check-update.mjs` | 新增探测脚本（§5.3） | 新增 |
| `skills/taco/VERSION` | 新增版本标记，构建生成（§6.1） | 新增（生成物） |
| `scripts/sync-skill-version.mjs` | 从 `package.json` 写入 `skills/taco/VERSION` | 新增 |
| `package.json` | 新增 `sync:version` 脚本并接入 `build` 链；`build` 末尾（`sync-extension-shell.mjs` 之后）执行同步 | 修改 |
| `skills/taco/SKILL.md` | 在 `When to use` 之后、`Workflow` 之前新增「检查更新（每次工作会话一次）」小节；在 `Report format` 末尾补一句提醒规则 | 修改 |
| `docs/agent-installation.md` | 安装文件清单（现有 5 条 bullet，`scripts/**` 已涵盖新脚本）显式加入 `VERSION`；`Verify before reporting success` 清单加入 `VERSION` 与 `check-update.mjs`；`Use the skill` 之前补 bootstrap 说明；新增「更新提示」小节 | 修改 |
| `extensions/taco/policies/taco-agent-policy.md` | 追加一条同等契约（对新装/干净安装的 Spec Kit 项目生效；已安装项目按 §7 走 `manual-merge`） | 修改 |
| `README.md`、`README.zh-CN.md` | Quickstart 之后一句话说明「有更新会提示、不会自动升级」 | 修改 |
| `skills/taco-release/SKILL.md` | 发版步骤 3.1：版本号更新后、`npm run check` 之前执行 `npm run sync:version`，并把 `skills/taco/VERSION` 一并提交 | 修改 |
| `AGENTS.md` | 仓库规则中注明 `skills/taco/VERSION` 为生成物，勿手改 | 修改 |
| `tests/version.test.ts` | 断言已提交的 `skills/taco/VERSION`（`trim()` 后）与 `package.json` 版本一致 | 修改 |
| `tests/update-check.test.ts` | 新增脚本端到端与契约测试（§8） | 新增 |

### 6.1 `VERSION` 为何是构建生成物，以及它与检查顺序的配合

`skills/taco/templates/` 已是「构建生成的镜像」这一既有惯例（`AGENTS.md` 明确禁止手改镜像、要求重新生成）。沿用同一惯例，把 `VERSION` 交给构建生成，可让版本同步不依赖发版操作者的记性。

但 `npm run check` 的顺序是 `format:check` → `npm test` → `npm run build`（`package.json`），即**测试早于构建**。若只把同步器挂在 `build` 末尾，发版时先改 `package.json` 再跑 `npm run check`，测试会读到上一版本的 `VERSION` 而失败，构建根本不会执行。因此：

- 同步器同时作为独立脚本暴露（`npm run sync:version`），发版流程在改完版本号后、跑 `npm run check` 之前显式执行；
- `build` 链末尾仍会执行同一同步器，保证任何一次完整构建后的工作树都不留漂移；
- `tests/version.test.ts` 断言的是**已提交内容**的一致性，二者配合才能既在发版时通过、又能捕获手工改动 `VERSION` 或漏提交的漂移。

内容格式固定：`0.11.0\n`（单行、无前缀）。不写入任何其他字段——脚本只做等值/大小比较，多字段只会制造解析分支。

---

## 7. 迁移与兼容

| 情形 | 行为 | 说明 |
| :--- | :--- | :--- |
| 旧安装（快照早于本特性） | 不会执行检查，也没有相关文案 | 旧 `SKILL.md` 不含该契约；这是机制自身的 **bootstrap 约束**：用户需要一次手动重装/刷新才能获得更新提示能力。文档必须写明，避免被误解为缺陷 |
| 脚本存在但 `VERSION` 缺失（拷贝不全） | `ok:false, reason:"installed-version-marker-missing"`，静默 | 不编造版本、不推测「一定有更新」 |
| `VERSION` 存在但内容不可解析 | `ok:false, reason:"installed-version-unreadable"`，静默 | 与「缺失」区分，便于定位拷贝/构建问题 |
| `taco-cli` 未安装 | `cli:null`，跳过该项 | 在最终回复中也不提示安装 |
| `taco-cli` 过旧、`--version` 输出不可解析，或其探测超时/超输出上限 | `cli.installed=null`、`cli.updateAvailable=null`，`ok` 不变，`skill` 结论仍可用 | 不做字符串猜测；只丢失该组件的信息 |
| 远端可达但某组件无可用 tag（只有预发布等） | 该组件 `latest/null`、不提示 | 属于「无法比较」，不算传输失败 |
| 网络不可用 / `git` 缺失 / 超时 / 输出超限 | `ok:false` + `reason`，静默 | 主线交付不受影响 |
| 仅靠 Git 配置走代理的环境 | 探测失败并静默 | §5.2 的 Git 环境隔离（不读取用户 Git 配置）带来的明示代价 |
| 已安装 Taco Spec Kit 扩展的项目，重跑 `prepare-policy` | 返回 `manual-merge` 并拒绝写入 | `extensions/taco/bin/taco.mjs` 要求既有 managed block 与新策略**完全一致**才允许替换；策略文本变更即触发 fail-safe。既有行为，本期沿用，合并方式见 `extensions/taco/README.md` |
| 仓库 checkout 内工作（贡献者） | 版本通常等于或领先最近 tag → 静默 | 贡献者环境本身即最新源 |

无破坏性变更：不改动 bundle 格式、shell、CLI 命令面与任何既有文件格式；新增文件与既有安装流程向后兼容。

---

## 8. 验证方案

### 8.1 自动化（Vitest，`tests/update-check.test.ts`）

测试用「环境替身」与既有先例一致（`tests/skill-pack.test.ts`、`tests/release-scripts.test.ts` 均以 `execFileSync` 跑脚本 + 临时目录/临时仓库）：临时 git 仓库作 `--repo`（本地路径，已验证可用），桩程序放临时目录并通过 `--cli-bin` 或 `PATH` 前置注入。

1. **有更新**：本地仓库打 tag `v0.10.0`、`v0.11.0`、`taco-cli-v0.2.0`；`VERSION=0.10.0`；`--cli-bin` 指向输出 `{"binaryVersion":"0.1.4"}` 的桩 → `skill={0.10.0,0.11.0,true}`、`cli={0.1.4,0.2.0,true}`、`source="git-ls-remote"`、`ok=true`。
2. **无更新**：`VERSION=0.11.0` → `skill.updateAvailable=false`。
3. **版本领先**：`VERSION=0.12.0` → `updateAvailable=false`（不得报「降级」）。
4. **cli 降级三种形态**：`--no-cli` → `cli=null`；`--cli-bin` 指向不存在的绝对路径 → `cli=null`（信任检查拒绝）；`--cli-bin` 指向输出非 JSON 的桩 → `cli.installed=null`、`cli.updateAvailable=null`，且 **结论不受影响**（`ok=true`、`skill` 照常）（组件独立性）。
5. **版本标记异常**（`VERSION`）：无 `VERSION` → `ok=false, reason="installed-version-marker-missing"`；内容为 `abc` → `ok=false, reason="installed-version-unreadable"`；两者 `updateAvailable=null`，且**不得只报告 cli 更新**。
6. **远端不可达**：`--repo <不存在的绝对路径>` → `ok=false`、`reason="network-unavailable"`、`exit code 0`、stdout 可解析。
7. **超时与进程组终止**：PATH 前置 `git` 桩两种写法各测一次——（a）`exec sleep 5`（直接子进程即睡眠进程）、（b）`sh -c 'sleep 5'` 形态（睡眠为派生进程）；`--timeout 200` 下断言 `reason="timeout"`、脚本总耗时远小于 5 s，且**两种写法后都不残留相关进程**（验证进程组级 kill）。
8. **输出超限**：`git` 桩输出 > 64 KiB → `reason="output-limit-exceeded"`，子进程被终止，不阻塞。
9. **禁用开关短路**：`TACO_UPDATE_CHECK=off` + 会写标记文件的 `git` 桩 → `reason="disabled"` 且标记文件不存在（证明**零调用**，而非「调用后失败」）。
10. **预发布/缺失 tag**：仓库仅 `v1.2.0-rc.1` → `skill.latest=null`、`ok=true`、无提示；仓库无 `taco-cli-v*` → `cli.latest=null`、`cli.updateAvailable=null`、`ok=true`（不得判成网络失败）。
11. **非默认仓库不回退 API**（`--repo` 被覆盖时）：`--repo <本地路径>` + PATH 前置失败的 `git` 桩 → `source=null`、`ok=false`，且 `source` 不得为 `github-releases-api`。
12. **参数边界**：`--repo -x`、`--repo ftp://host/x`、未知 flag → `exit code 2`。
13. **Git 调用加固**：PATH 前置记录型 `git` 桩（dump argv + env 到文件）→ 断言 argv 含 `--tags`、`--refs`、仓库参数前有 `--`、含 `-c credential.helper=`；env 含 `GIT_CONFIG_GLOBAL=/dev/null`、`GIT_TERMINAL_PROMPT=0`，且不含继承的 `GIT_CONFIG_*` 用户配置或凭据变量。
14. **契约字段**：`--json` 键集合恰为 `schema`/`checkedAt`/`ok`/`reason`/`source`/`skill`/`cli`；各字段类型、semver 正则、`null` 语义与 §5.3 表格一致；`skill`/`cli` 子对象键集合精确断言（不新增 JSON Schema 校验依赖）。
15. **版本标记同步**（`VERSION`）：`tests/version.test.ts` 断言 `skills/taco/VERSION.trim() === packageJson.version`。
16. **构建生成**：`node scripts/sync-skill-version.mjs` 对临时目录运行时写入 `"<version>\n"` 且幂等（第二次运行报告 `unchanged`，不重写文件）。
17. **CLI 侧的超时与限额**（`taco-cli`，与第 7、8 项等价）：`--cli-bin` 分别指向挂起桩与无限输出桩 → `cli.installed=null`、`cli.updateAvailable=null`、`ok=true`，且 **skill 的更新提示仍可用**（验证 CLI 探测失败不连带失效）。
18. **项目级 Git 配置隔离**（两项可观测断言，不用「本地传输＋HTTP 头」这种不可观测的组合）：
    - 在临时目录构造含恶意 `.git/config`（`url.<evil>.insteadOf = https://github.com/`、`http.extraheader`）的仓库，**以该目录为 cwd** 启动脚本并指向本地 `--repo` → 断言探测按指定仓库完成、重写规则未生效（证明子进程使用了中立 cwd）。
    - 用**与脚本相同的加固参数与中立 cwd** 运行 `git config --list --show-origin`（由测试自身 spawn，只读）→ 断言生效配置中不存在来自用户全局、系统或该恶意仓库的 `http.extraheader` / `url.*.insteadOf` 条目。这是对「有效配置已隔离」的直接观测；**不声称已观测到真实 HTTPS 请求头**（那需要受控 HTTPS 端点，属实现期可选项）。

### 8.2 手工 smoke（必须真实执行，作为交付证据）

- 真实网络下运行 `node skills/taco/scripts/check-update.mjs --json`：`source="git-ls-remote"`、`skill.latest="0.11.0"`、`cli.installed` 与本机 `taco-cli --version` 一致（当前 `0.1.4`）、`cli.latest="0.2.1"`、`cli.updateAvailable=true`。
- 容错场景：`TACO_UPDATE_CHECK=off`、`--repo /nonexistent`、`--timeout 200` 均 `exit code 0`，主线可继续。
- 真实 Taco 打包流程走一遍：确认提醒只出现在最终回复末尾、打包输出未被污染；并确认**除正常的 Taco 打包写入外**（`.taco.html`），检查动作没有产生任何针对 skill 目录、`taco-cli` 安装位置或包管理器的写入，也没有执行任何安装/升级命令（AC-6 的流程证据）。
- 扩展策略的迁移后果验证（两个组合，不可只跑一个）：
  - **旧扩展 CLI + 旧 managed block**（现状复现）：`prepare-policy --dry-run --json` 返回 `unchanged`——证明旧安装不会被误报为故障；
  - **新版扩展文件（含新策略）+ 旧 managed block**：先把本分支的 `extensions/taco/` 覆盖进临时项目，再运行 `prepare-policy --dry-run --json`，返回 `manual-merge` 且写入两份文件均未发生——证明 §7/§9.8 的 fail-safe 判断成立。

### 8.3 与验收标准的映射

- AC-1 → §5.4 契约文本 + `SKILL.md` 改动评审；AC-2 → §6 文档改动 + 8.2 最后一项。
- AC-3 → 8.1 第 5、6、7、8、9、12 项。
- AC-4 → §5.2 的 Git 环境隔离（含中立 cwd 与进程组终止）+ §5.5 + 8.1 第 13、18 项 + 代码结构审查；范围限定见 AC-4 本身与 §10.5。
- AC-5 → 8.1 第 1–4、10、17 项 + §5.4 文案断言。
- AC-6 → §5.4 禁止项 + 代码结构审查（仅 spawn `git ls-remote`/`taco-cli --version`，无写路径）+ 8.2 的流程证据（排除正常打包写入）；**该项无法由单元测试证明**。
- AC-7 → 8.1 第 1–18 项；AC-8 → 8.1 第 15、16 项。

---

## 9. 明确不做（Non-goals 与理由）

1. **不检查 Spec Kit 扩展的更新**（`extensions/taco/`）：扩展的「最新版本」不等于「最新可安装包」——实测仅 `v0.6.0` 发布了 `taco-extension-v0.6.0.zip`，`v0.11.0` 等后续 tag 无资产。以 tag 为准会长期误报「有更新但装不上」；以资产为准又需要额外的 releases API 调用，而扩展发布链路当前处于停用状态，该分支会长期静默。等扩展发布链路恢复后另开 issue 处理。（Issue 本身也只要求检查 skill 与 taco-cli。）
2. **不检查 tacobin 站点版本**：网页端随部署自动更新，不存在「本地副本落后」问题。
3. **不做结果缓存**：首选探测（`git ls-remote`）无速率限制，契约又限定每次会话只检查一次；缓存会引入陈旧结果与额外状态文件。回退通道（GitHub API，60 次/小时未认证）只在 `git` 缺失时启用，风险可接受并在 §5.2 记录。
4. **不做后台定时检查/守护进程**：检查发生在 Agent 工作流内部，不引入常驻进程。
5. **不提供自动升级能力**：脚本不具备安装/写文件能力；升级始终由用户发起。
6. **不改动既有契约面**（bundle 格式、shell、`window.taco` API、`taco-cli` 命令面）：本特性只新增探测脚本与文案契约。
7. **不在仓库贡献者环境内做「与 main 比较」的额外提示**：贡献者 checkout 即最新源，tag 比较已足够。
8. **不新增 Spec Kit 策略 managed block 的跨版本自动替换机制**：`extensions/taco/bin/taco.mjs:986-990` 只在既有 block 与新策略**逐字一致**时视为可替换，否则返回 `manual-merge`——这是既有的 fail-safe 设计（防止覆盖项目自定义）。让「上一版 stock block」可被识别替换需要长期维护一份历史哈希表（现仅有针对 `AGENTS.md` 的 `LEGACY_POLICY_HASHES`），属于独立特性，本期不夹带；既有安装按 `extensions/taco/README.md` 的记录走人工合并。
9. **不对 CLI 做沙箱隔离**（`taco-cli`）：本期接受「本机已安装的 CLI 被视为用户已授权执行」这一信任前提（§5.5 明示残余风险）。

---

## 10. 待评审的开放问题

1. §9.1：是否接受「本期不覆盖 Spec Kit 扩展更新提示」，还是要求在同一期以「资产存在才提示」的保守方式覆盖？
2. §9.8：`extensions/taco/policies/taco-agent-policy.md` 的改动会让**已安装扩展的项目**在重跑 `prepare-policy` 时收到 `manual-merge` 拒绝（fail-safe，既有行为）。接受这个后果并仅在新装项目生效，还是要求本特性同时提供策略 managed block 的受控升级（另需历史哈希表与测试）？若两者都不接受，可考虑本期不动扩展策略文件、只改 skill 与安装指南。
3. §5.1 的 `VERSION` 载体与「构建生成」方案是否认可；是否希望改为 SKILL.md frontmatter（会引入非 Agent Skills 规范字段，故未采用）。
4. §5.4 文案模板的措辞与「未升级」表述是否需要调整。
5. §5.5/AC-4：是否接受把「零本地内容外发」的保证限定为**脚本自身**，并如实披露「每会话自动执行一次 `taco-cli --version`」这一残余风险（可关闭）？替代方案是不自动探测 `PATH` 上的 CLI（会削弱 Issue 要求的「安装了 taco-cli 就一并检查」）。

---

## 11. 独立审查结论（2026-09-28）

两位独立审查者（设计审查、安全审查，均非本文作者）对完整方案做了三轮证据化审查。下表是全部 findings 与处置；所有处置均已落进本文件，并有两轮「接受/仍有异议」的复核记录。

| 编号 | 审查者 | 严重度 | 结论 | 处置 |
| :--- | :--- | :--- | :--- | :--- |
| DR-1 | 设计 | major | 策略文本变更会让既有安装落入 `manual-merge`（fail-safe） | 接受事实并如实记录（§7 / §9.8 / §8.2 两个组合烟测）；**不**新增 managed block 跨版本替换机制，交由用户决策（§10.2） |
| DR-2 | 设计 | major | `check` 先测试后构建，VERSION 同步会被测试先挡住 | 接受：新增 `npm run sync:version`，发版在 `npm run check` 前执行（§6.1、plan 阶段 1） |
| DR-3 | 设计 | major | 部分成功语义（`ok`/`reason`/组件独立）未定义 | 接受：§5.3「组件独立性（部分成功规则）」+「缺失」与「不可解析」拆分 |
| DR-4 | 设计 | major→minor | CLI 子进程缺超时；超时桩可能残留派生进程 | 接受：所有探测独立限时 + 进程组级 `SIGKILL`（§5.2、§8.1 第 7/17 项） |
| DR-5 | 设计 | major | 非默认 `--repo` 仍回退固定 GitHub API 会产生错误结论 | 接受：仅在默认仓库且 `git` 不可用时回退（§5.2、§8.1 第 11 项） |
| DR-6 | 设计 | minor | 超时/禁用开关测试不可靠；AC-6 的「零写操作」表述与正常打包冲突 | 接受：可记录桩 + 两类睡眠桩；AC-6 证据改为结构审查 + 排除正常打包写入（§8.2、§8.3） |
| DR-7 | 设计 | minor | 预发布/缺组件 tag 的行为未定义 | 接受：只接受三段纯数字 tag；缺 tag ⇒ `null` 且 `ok` 不变；移除 `remote-tag-unparseable` |
| SR-1 | 安全 | major | 仅隔离全局/系统 Git 配置挡不住项目级 `.git/config` | 接受：子进程 cwd 固定中立目录 + `git config --list --show-origin` 可观测断言（§5.2、§5.5、§8.1 第 18 项） |
| SR-2 | 安全 | major | 自动执行 `PATH` 上的 `taco-cli` 与「零外发」绝对保证冲突 | 接受其第二方案：AC-4 收窄为**脚本自身**范围 + `SKILL.md` 强制披露 + 可关闭；残余风险与替代方案列入 §10.5，**实施前需用户认可该安全取舍** |
| SR-3 | 安全 | minor | 计划未覆盖 CLI 子进程超时/超限 | 接受：§8.1 第 17 项 |
| SR-4 | 安全 | minor | `--repo` 参数与协议边界未规定 | 接受：协议/路径白名单 + `--` 终止符（§5.2、§8.1 第 12 项） |

终局复核结果：设计审查者回复「无剩余异议」（并给出 §8.2/§8.1/§5.2 的行号锚点）；安全审查者对 SR-1、SR-3 判定接受，SR-2 为**有条件接受**——实施前必须取得用户对该安全取舍的明确认可。因此本设计保持 `Draft`：未经用户确认不得视为 frozen/approved，也不得据此开始实现。
