---
title: '012-skill-update-notice'
feature_id: '012-skill-update-notice'
created: '2026-09-28'
status: 'Frozen'
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
| 安装方式 | 安装 skill 是整目录拷贝（或由 `npx skills` 复制/链接），不会克隆仓库——本机没有可供 `git` 查询的远端，探测必须走网络 |
| git tag 探测 | `git ls-remote --tags --refs https://github.com/Arcadia822/taco.git` → 25 个 tag，约 1.3 s，无认证、无速率限制 |
| `npx skills` 安装渠道 | 官网给出的命令是 `npx skills@latest add arcadia822/taco --skill=taco`（`skills` 包 v1.7.0，vercel-labs/skills）；`--list` 实测会解析出 `taco`（以及当时仍留在仓库里的 `taco-release`——它不是安装项，已在 PR #82 中随发版流程收归 CI 而删除，之后只列出 `taco`）；`add --copy` 实测把整个 skill 目录（含 `scripts/`、`VERSION`）复制到 `./.claude/skills/taco/`，并在项目根写入 `skills-lock.json`（记录 `source`/`sourceType`/`computedHash`，**不含 semver**）；CLI 另有 `update`/`upgrade`、`list`、`remove` 子命令 |
| GitHub REST `GET /repos/Arcadia822/taco/tags?per_page=100`（未认证） | 200，约 0.9 s，10.6 KB，25 个 tag（按新→旧），Node 内置 `fetch` 直接可用 |
| 同一 API 的 `GET /releases?per_page=100` | 200，约 1.0 s，**95.6 KB**（含 assets 等冗余字段），对「只比版本」而言过重 |
| `GET /releases/latest` | 返回 `taco-cli-v0.2.1`——它是「全仓库最新非预发布 release」，**不是** taco 本体的最新版本，直接用它会产生错误结论 |
| 未认证 REST 限额 | `x-ratelimit-limit: 60`（每小时/IP）；实测一次请求消耗 1 次，剩余 55/60 |
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
- **Then** 跳过检查、保持静默，不产生任何网络请求、也不写任何文件。

### 2.8 场景 S8：Spec Kit 项目里的可选扩展（P2）

- **Given** 当前项目装过 Taco Spec Kit 扩展（`.specify/extensions/taco/extension.yml` 的 `version` 为 `0.6.0`），且远端存在更新的**可安装**扩展包。
- **When** Agent 在该项目里使用 taco skill。
- **Then** 与 skill/cli 合并为同一句话提示扩展的版本变化；若远端最新 tag 没有对应的 `taco-extension-v*.zip` 资产，则**不提示**——「有 tag 但装不上」不算可用更新。

### 2.9 场景 S9：缓存（P3）

- **Given** 15 分钟内已成功检查过一次（默认 TTL）。
- **When** 再次检查。
- **Then** 复用缓存结果、不发请求；`--no-cache` 或 `TACO_UPDATE_CACHE_TTL=0` 时不读写缓存；缓存缺失、损坏或写入失败都不影响结果，也不报错或阻断。

---

## 3. 验收标准

| 编号 | 验收条件 | 对应来源 |
| :--- | :--- | :--- |
| AC-1 | `skills/taco/SKILL.md` 明确规约「会前一次检查 → 交付 → 有更新才一句话提醒 → 绝不自主升级」的契约 | Issue 验收标准 1、3 |
| AC-2 | `docs/agent-installation.md`（Agent 安装指南）包含同一契约、**npx skills 优先的安装入口**、安装文件清单（含 `VERSION`）与验证清单更新；`extensions/taco/policies/taco-agent-policy.md` 的新版本对新装/干净安装的 Spec Kit 项目生效（既有安装受 `prepare-policy` 的 fail-safe 约束，详见 §7） | Issue 验收标准 1「及相关 Agent 指南」 |
| AC-3 | 失败路径（离线、超时、`git` 缺失、`VERSION` 缺失或不可解析）一律 `exit code 0` + `ok:false` + `reason`，绝不让 Taco 工作失败；`taco-cli` 未安装或版本不可解析属于正常降级（`cli:null` 或 `cli.installed:null`），不影响 `ok`，也不阻断工作 | Issue 验收标准 2 |
| AC-4 | **脚本自身**不读取项目文档内容、不外发任何本地数据（唯一的项目内读取是从扩展清单取 `version`，唯一的本地写入是版本比较缓存）：请求只读取远端公开的 tag/发布列表，不携带本地路径、项目内容或凭据；唯一的本地写入是仅含版本比较结果的缓存文件（15 分钟 TTL，`--no-cache` 或 `TACO_UPDATE_CACHE_TTL=0` 可完全禁用，读取/写入失败不影响结果）；脚本自动执行的唯一本机程序是 `taco-cli --version`（可由 `--no-cli` / `TACO_UPDATE_CHECK=off` 关闭），其自身行为由用户环境的信任模型承担（§5.5） | 本规格安全性要求 |
| AC-5 | 存在可用更新时输出的提醒文案与 §5.4 模板一致，且**明确声明未升级**；无更新或结果未知时不输出任何字样 | Issue 期望行为 2 |
| AC-6 | 任何路径下都不会触发安装/升级命令：脚本只发起一次 GitHub Tags API 的 GET 与一次 `taco-cli --version`，不含任何写文件或安装路径；SKILL.md 以 MUST NOT 级别禁止自主升级；该约束由结构审查 + 真实流程烟测保证（无法由单元测试证明） | Issue 验收标准 3 |
| AC-7 | 单元/端到端测试覆盖：有更新、无更新、版本领先、`cli` 缺失/不可解析、**扩展缺失/有更新/无 archive/响应超限**、`VERSION` 缺失/不可解析、远端不可达/超时/输出超限、禁用开关短路、**缓存命中/TTL 过期/损坏/禁用/写失败**、重定向被拒、异域 Link 不跟随、预发布 tag、JSON 契约字段 | §8 |
| AC-8 | `skills/taco/VERSION` 与 `package.json` 版本在构建后一致（发版时在 `npm run check` 之前同步），并有测试守护 | §6.1 |

---

## 4. 术语与范围

- **taco skill（本体）**：`skills/taco/` 目录，用户以整目录拷贝方式安装；本特性以其中的 `VERSION` 标记其版本。
- **taco-cli**：可选安装的云端 CLI（`@tacobin/cli` / 独立二进制），仅在做云端发布/评审时需要。
- **远端最新版本**：仓库 `Arcadia822/taco` 上已发布的 tag（发版链路只在 `main` 打 tag，见 `.github/workflows/nightly-release.yml` 与 `scripts/check-changes.mjs`）。
- **检查会话**：一次 Agent 工作任务的上下文；同一会话内最多检查一次。

---

## 5. 机制设计

### 5.1 已安装版本的唯一来源

| 组件 | 已安装版本来源 | 说明 |
| :--- | :--- | :--- |
| taco skill | `skills/taco/VERSION`（脚本所在 skill 目录内的 `VERSION` 文件） | 单行 semver，无 `v` 前缀，末尾换行；由构建从 `package.json` 生成，见 §6.1 |
| taco-cli | `taco-cli --version` 输出 JSON 的 `binaryVersion` 字段 | 仅当 `PATH` 中存在 `taco-cli` 时才探测；该字段由 CLI 构建从 `packages/cli/package.json` 自动同步（PR #70） |
| Taco Spec Kit 扩展（可选） | 从 cwd 向上逐级查找最近的 `.specify/extensions/taco/extension.yml`，读其 `version` 字段 | 仅当找到该清单时才评估扩展；找不到即视为未安装该扩展（`extension: null`），不报错 |

脚本读取的是**自身所在 skill 目录**的 `VERSION`，因此「Agent 正在使用的 skill」即被检查对象，无需推测用户装了哪些副本。扩展的已安装版本属于**项目级**事实，因此按 cwd 向上查找；向上查找最多 8 层，且不跟随符号链接到项目之外。

### 5.2 远端最新版本的探测（git 首选，HTTP 回退）

**决策**：首选 `git ls-remote --tags --refs <repo>`，回退到 Node 内置 `fetch` 请求 GitHub Tags API。理由与实测依据：

- **git 首选**：只要机器上有 `git`，任何人都能匿名列出公开仓库的 tag —— 无认证、无速率限制、一次请求、约 1.3 s（实测 25 个 tag）。skill 的安装是整目录拷贝，本机没有仓库远端，所以探测必须走网络，但 git 通道本身零额外面额限制。
- **HTTP 回退**：`git` 可能不可用（例如未安装 Xcode CLT 的 macOS 上 `/usr/bin/git` 只是触发安装提示的桩，非交互调用直接失败）、可能被环境策略禁用，此时用 Node 内置 `fetch` 直接读 GitHub Tags API。**无需任何额外二进制**（`curl`、`gh` 都不需要）——Node 已是本 skill 的硬依赖（`scripts/pack.mjs`）。
- **回退条件**：仅当 `--repo` 未被覆盖、且 git 尝试失败（不可执行、超时、非零退出）时才回退。`--repo` 被覆盖（本地路径/镜像）时绝不回退到固定 GitHub API——那会返回与指定仓库无关的版本，产生错误结论。

两条通道产出同一组 tag 字符串：

| 通道 | 命令/请求 | 实测 |
| :--- | :--- | :--- |
| 首选 `git-ls-remote` | `git -c credential.helper= ls-remote --tags --refs -- <repo>` | 25 tag / ≈1.3 s / 无认证 / 无速率限制 |
| 回退 `github-tags-api` | `GET https://api.github.com/repos/Arcadia822/taco/tags?per_page=100`，头 `accept: application/vnd.github+json` + 常量 `user-agent: taco-update-check/1` | 200 / ≈0.9 s / 10.6 KB / 25 tag / 限额 60 次每小时/IP |

- **不用** `/releases/latest`：它返回全仓库最新的非预发布 release（实测为 `taco-cli-v0.2.1`），不是 taco 本体的最新版本。
- **不用** `/releases?per_page=100`：同一目的下响应 95.6 KB（含 assets 等冗余字段），对「只比版本」过重；本节随后会用到它做扩展资产校验（见下文）。
- **版本解析**：`^v(\d+\.\d+\.\d+)$` → taco 本体；`^taco-cli-v(\d+\.\d+\.\d+)$` → taco-cli；其余一律忽略（含 `tacobin-v*`、`v1.2.0-rc.1`、`v1.2`），不做 semver range 匹配。
- **HTTP 分页**：tag 按新→旧返回，只读第 1 页；仅当响应带 `Link: rel="next"` **且**某组件在第 1 页无匹配时才读第 2 页（最多 2 页）。**第 2 页地址不取自响应给出的链接**，而是用已校验的基址自行构造 `page=2`，并同样校验 host 与 path。
- **远端没有可用的本体 tag（或没有可用的 taco-cli tag）** ⇒ 该组件 `latest=null`、`updateAvailable=null`：这是「无法比较」，不是传输失败，`ok` 不受影响，也不输出提示。

约束与加固（安全审查结论，必须实现）：

- **超时**：每次尝试独立 3000 ms（`--timeout` 可调）；只有一次尝试失败才允许切换通道，因此最坏约 2×超时（约 6 s），且只发生在失败路径。**不重试同一通道**。
- **输出上限**：git 的 stdout 与 tags 响应体各 64 KiB；releases 响应体 1 MiB（该端点天然携带 assets 元数据，实测约 96 KB，远超 64 KiB）。超限即终止该尝试并跳过；扩展查询超限只让 `extension.latest=null`，不影响 `ok` 与其它组件。
- **git 执行隔离**：精简环境变量（仅 `PATH`、`HOME`、`LANG`）与 `GIT_CONFIG_GLOBAL=/dev/null`、`GIT_CONFIG_SYSTEM=/dev/null`、`GIT_TERMINAL_PROMPT=0`、`GIT_ASKPASS`/`SSH_ASKPASS` 置为不可用、`-c credential.helper=`；**子进程 cwd 固定在中立目录**（`os.tmpdir()`）（绝不在项目/仓库目录内启动，挡住项目级 `.git/config` 的 `url.*.insteadOf` 与 `http.extraheader`）；仓库参数前插入 `--` 终止选项。
  - 代价（明示）：仅通过 Git 配置文件设置代理的环境下，git 通道会失败并静默——这是刻意的隐私优先取舍。注意回退通道不保证能补救：Node 的 `fetch` 默认不读取 `HTTP_PROXY`/`HTTPS_PROXY` 以外的代理配置，代理仅写在 Git 配置里的环境两条通道都可能失败并静默。
- **子进程终止**：`git` 与 `taco-cli` 均以独立进程组启动（`detached: true`），超时或超限时以 `process.kill(-pid, 'SIGKILL')` 终止**整个进程组**，避免 git 的远程助手或 CLI 的派生进程残留。
- **参数边界**：`--repo` 只接受 `https://` 开头的 URL 或绝对本地路径（本地路径仅供测试与镜像），拒绝以 `-` 开头、其他协议与相对路径。
- **HTTP 回退地址边界**：`--api-base` 只接受两类取值——默认 `https://api.github.com`，或本地测试夹具 `http://127.0.0.1:<port>` / `http://localhost:<port>`；其他主机与协议一律 `exit 2`。
- **重定向**：HTTP 回退的 `fetch` 固定使用 `redirect: "error"`——任何重定向都视为失败（映射为 `http-error`）并静默。
- **限额**：HTTP 回退命中 403/429 或 `x-ratelimit-remaining: 0` ⇒ `rate-limited`。
- **扩展（可选组件）的探测**：扩展的「更新」不仅取决于版本号，还取决于**该版本是否发布了可安装包**（实测仅 `v0.6.0` 有 `taco-extension-v0.6.0.zip`，后续 tag 无资产）。因此仅当 §5.1 找到已安装的扩展清单时，额外发起一次 `GET https://api.github.com/repos/Arcadia822/taco/releases?per_page=100`，取**带可安装扩展包的 release** 中版本号最高者作为 `extension.latest`（资产名匹配 `^taco-extension-v(\d+\.\d+\.\d+)\.zip$`）；没有任何可用资产 ⇒ `extension.latest=null`、不提示。这是本特性唯一使用 releases 端点的场景（tag 通道拿不到资产信息）。该请求失败只让扩展项变为 `null`，不影响 `skill`/`cli` 的结论与 `ok`。
- **结果缓存（15 分钟 TTL）**：检查成功后把**仅含版本比较结果与探测目标摘要**的缓存（字段为 `{ schema, checkedAt, target, source, latest: { skill, cli, extension }, extensionProbed }`；`target` 是 `repo` + `apiBase` 的 SHA-256 十六进制摘要，固定长度且不含原始路径或 URL）写入 `${XDG_CACHE_HOME:-$HOME/.cache}/taco/update-check.json`（大小 < 2 KiB）。TTL 默认 15 分钟（`TACO_UPDATE_CACHE_TTL` 秒，`0` 表示禁用），`--no-cache` 强制忽略并刷新。规则：只有**成功**的远端读取才写入；缓存命中即直接复用（`cached: true`），不发任何网络请求（含扩展的 releases 请求）。缓存**无条件视为不可信输入**：命中前必须校验 schema、`source` 白名单、`checkedAt` 是否在 TTL 内、`target` 摘要与本次探测目标完全一致、`extensionProbed` 为布尔且满足本次需要、三个 `latest` 字段均为 `null` 或三段纯数字版本；任一不符即忽略缓存并重新探测。缓存缺失/损坏/被篡改/不可读/写入失败一律忽略，绝不因此失败或阻断；缓存不写入任何项目内容、凭据或文件路径（目标以不可逆摘要表示）。

### 5.3 检查脚本契约（新增 `skills/taco/scripts/check-update.mjs`）

```sh
node scripts/check-update.mjs [--json] [--repo <url|path>] [--api-base <url>] [--timeout <ms>] [--cli-bin <path>] [--no-cli] [--no-cache]
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
  | `reason` | string \| null | `ok:false` 时的机器可读原因，取值集合：`disabled`、`git-unavailable`、`network-unavailable`、`timeout`、`rate-limited`、`http-error`、`output-limit-exceeded`、`installed-version-marker-missing`、`installed-version-unreadable`、`internal-error`（最外层未知异常兜底）；`ok:true` 时为 `null` |
  | `source` | `"git-ls-remote"` \| `"github-tags-api"` \| null | 实际生效的探测通道；`ok:false` 时为 `null` |
  | `skill` | object | `{ installed: string\|null, latest: string\|null, updateAvailable: boolean\|null }` |
  | `cli` | object \| null | 与 `skill` 同构；本机未安装 `taco-cli`（或未通过信任检查）时为 `null` |
  | `extension` | object \| null | 与 `skill` 同构；当前项目未安装扩展（或扩展无任何可安装资产）时为 `null`，其 `latest`/`updateAvailable` 亦可为 `null` |
  | `cached` | boolean | 本次结果是否来自缓存 |

  `installed`/`latest` 为无 `v` 前缀的三段 semver 字符串（`^\d+\.\d+\.\d+$`），不可读时为 `null`；`updateAvailable` 仅在两者都已知时给出布尔值，否则为 `null`。
- **失败映射与通道回退**：
  - git 通道失败（不可执行 → `git-unavailable`；超时 → `timeout`；非零退出 → `network-unavailable`；stdout 超限 → `output-limit-exceeded`）时，若 `--repo` 未被覆盖则改走 HTTP 回退。
  - HTTP 回退失败：DNS/连接失败或 TLS 错误 → `network-unavailable`；超时 → `timeout`；403/429 或 `x-ratelimit-remaining: 0` → `rate-limited`；其他非 2xx 与 JSON 解析失败 → `http-error`；响应体超限 → `output-limit-exceeded`。
  - `reason` 反映**最后一次尝试**的原因；若 git 不可执行且因 `--repo` 被覆盖而不能回退，则为 `git-unavailable`。两通道都失败 ⇒ `ok:false`，调用方静默。
- **组件独立性（部分成功规则）**：`skill` 与 `cli` 各自独立判定，一个组件不可比较绝不使另一个失效：
  - 远端可达 + `VERSION` 可读 → `ok:true`；`skill.updateAvailable` 按比较结果给出。
  - `VERSION` 缺失 → `ok:false`、`reason:"installed-version-marker-missing"`、`skill.installed/updateAvailable=null`；`VERSION` 存在但不可解析 → `ok:false`、`reason:"installed-version-unreadable"`。两种情况下调用方一律静默，**不得**只报告 `cli` 的更新（主对象未知时不做任何提示，避免半截结论）。
  - `taco-cli` 不存在 → `cli:null`，`ok` 与 `skill` 不受影响。
  - 扩展未安装（cwd 向上找不到 `.specify/extensions/taco/extension.yml`）→ `extension:null`；扩展已安装但其 releases 请求失败、或没有任何带 `taco-extension-*.zip` 资产的 release → `extension.installed` 保留、`extension.latest/updateAvailable=null`，**不影响** `ok` 与其它组件。
  - `taco-cli` 存在但 `--version` 不可解析、超时或超输出上限 → `cli.installed=null`、`cli.updateAvailable=null`，`ok` 保持 `true`，`skill` 的结论照常可用；人类可读摘要中标注该项被跳过（不写入 `reason`，因为 `reason` 只描述 `ok:false`）。
  - 远端可达但某组件没有任何可用 tag → 该组件 `latest=null`、`updateAvailable=null`（见 §5.2），`ok` 保持 `true`。
- **退出码**：检查完成一律 `exit 0`（含 `ok:false`）——检查失败不是脚本失败，不得让调用方误判为打包失败。参数用法错误（未知 flag、`--repo`/`--api-base` 取值不被允许）返回 `exit 2`，因为那属于 Agent/作者错误，需要被立刻发现。
- **环境变量**：
  - `TACO_UPDATE_CHECK=off` → 立即输出 `ok:false, reason:"disabled"` 并 `exit 0`；**不 spawn 任何子进程、不发起任何请求**。
  - `TACO_CLI_BIN` → 覆盖 `taco-cli` 可执行文件路径（与 `--cli-bin` 等价）。与 `--cli-bin` 同为**受信调用方 / 测试专用**入口，取值不得来自项目内容（见 §5.5）。
  - `TACO_UPDATE_CACHE_TTL` → 缓存 TTL 秒数，默认 900；`0` 等价于禁用缓存。
  - `TACO_UPDATE_CACHE_DIR` → 覆盖缓存目录（测试用；默认 `${XDG_CACHE_HOME:-$HOME/.cache}/taco`）。
- **两个覆盖参数的分工**（`--repo`、`--api-base`）：`--repo` 覆盖 git 通道的仓库（仅测试/镜像；被覆盖时禁用 HTTP 回退），`--api-base` 覆盖 HTTP 回退的地址（仅测试夹具）。生产默认值分别为 `https://github.com/Arcadia822/taco.git` 与 `https://api.github.com`。取值约束见 §5.2。
- **CLI 探测的信任前提**（`taco-cli`）：仅在可执行文件解析为**绝对路径、且为常规可执行文件**时执行 `taco-cli --version`；否则 `cli:null`。本机已安装的 CLI 视为用户已授权在其环境执行的程序——Agent 自动执行 `--version` 与该用户手动执行同一命令属同一信任级别，此前提写入 §5.5。
- **副作用**：只写一个缓存文件（见 §5.2）；不读取项目**文档**内容（唯一的项目内读取是扩展清单里的 `version`），不外发任何本地数据（见 AC-4）。检查脚本自身的输出（原始日志行）不得作为交付内容展示给用户（见 §5.4 禁止项）。

### 5.4 触发契约与文案（写入 `SKILL.md`）

**触发时机**：每次 Taco 工作会话的第一次 Taco 动作（打包、刷新、消费评审）之前执行一次；同一会话内不再重复执行。

**披露要求**（写入 `SKILL.md`）：该小节必须说明检查会向 `api.github.com` 发起一次只读 HTTPS GET（请求中只有仓库路径与常量 User-Agent `taco-update-check/1`，无任何本地内容与凭据）、会在本机执行 `taco-cli --version`（仅当存在该命令）、检查失败一律静默，以及可用 `--no-cli` 或 `TACO_UPDATE_CHECK=off` 关闭；不得把自动执行描述为「纯读取」。

**提醒文案模板**（与 `ego lite` 的机制一致：陈述事实 + 声明未升级）：

多个组件同时有更新时**合并为一句**（列举各组件的版本变化，仍只出现一次「未升级」）。情形与文案：

| 情形 | 中文（默认，随对话语言） | English |
| :--- | :--- | :--- |
| 仅 skill 有更新 | `Taco 提示有可用更新：taco skill v<installed> → v<latest>；未升级，可自行决定是否更新。` | `Taco notes an available update: taco skill v<installed> → v<latest>; not upgraded — update at your discretion.` |
| 仅 cli 有更新 | `Taco 提示有可用更新：taco-cli v<installed> → v<latest>；未升级，可自行决定是否更新。` | `Taco notes an available update: taco-cli v<installed> → v<latest>; not upgraded — update at your discretion.` |
| 二者都有 | `Taco 提示有可用更新：taco skill v<installed> → v<latest>、taco-cli v<installed> → v<latest>；未升级，可自行决定是否更新。` | `Taco notes an available update: taco skill v<a> → v<b>, taco-cli v<c> → v<d>; not upgraded — update at your discretion.` |
| 仅有扩展更新 | `Taco 提示有可用更新：Taco Spec Kit 扩展 v<installed> → v<latest>；未升级，可自行决定是否更新。` | `Taco notes an available update: Taco Spec Kit extension v<installed> → v<latest>; not upgraded — update at your discretion.` |

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
| 请求暴露面 | 每次工作会话从用户机器向 GitHub 发一次请求（首选 git 通道为 HTTPS git 协议，回退为 `api.github.com` 的 HTTPS GET），请求中携带仓库路径 | 公开仓库的 tag 列表本就是公开信息（网页/API 皆可查），因此不额外暴露仓库内容；暴露的是「该机器在该时刻访问了该仓库」这一元数据，任何更新检查都有同样性质。请求不含凭据、不含本地路径与项目内容；UA 为常量 `taco-update-check/1`（**不**携带已安装版本） |
| 用户级 Git 配置 | 全局/系统配置可能携带认证头、URL 重写或代理 | `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` 指向 `/dev/null`、禁用交互与凭据助手；代价是「仅靠 Git 配置走代理」的环境 git 通道失败（§5.2） |
| 项目级 Git 配置 | 位于 cwd 所在仓库的 `.git/config`（可由下载而来的含 `.git/` 目录触发）同样会被 git 读取 | **子进程 cwd 固定在中立目录**（`os.tmpdir()`），绝不在项目目录内启动 |
| 未认证限额（HTTP 回退与扩展查询） | 60 次/小时/IP；命中即静默 | git 通道无限制；HTTP 回退只在 git 不可用时启用；扩展查询只在装过扩展的项目里发起一次；15 分钟缓存进一步摊薄 |
| 缓存文件 | 在用户缓存目录写入版本比较结果与探测目标摘要（非项目内容、非原始路径） | 仅版本号、来源、时间戳与 repo+apiBase 的 SHA-256 摘要，< 2 KiB；`--no-cache`/`TACO_UPDATE_CACHE_TTL=0` 可完全禁用；读写失败一律忽略 |
| 本机 `taco-cli` | `PATH` 上被替换的可执行文件会被自动执行 | 仅接受解析为绝对路径的常规可执行文件；`--cli-bin`/`TACO_CLI_BIN` 仅限受信调用方与测试；该自动执行在 `SKILL.md` 中明示，可用 `--no-cli` 或 `TACO_UPDATE_CHECK=off` 关闭 |
| `--api-base` 覆盖 | 调用方可指向任意地址 | 只接受 `https://api.github.com` 或环回测试夹具；`fetch` 使用 `redirect: "error"`，异域 `Link` 不跟随（分页地址由基址构造） |
| 资源占用 | 子进程挂起、响应体异常膨胀或派生进程残留 | 每次探测独立硬超时、64 KiB 响应上限、进程组级 `SIGKILL`（仅 `taco-cli` 子进程） |

**残余风险（明示、本期不消除）**：脚本无法证明被执行的 `taco-cli` 只做只读输出。若本机 CLI 已被替换，其行为超出本机制可控范围——这与「Agent 会执行本机任意命令」的既有信任模型同源，本特性只新增「每会话自动执行一次 `--version`」。处理方式是**如实披露 + 可关闭**（`--no-cli`、`TACO_UPDATE_CHECK=off`），而不是假装 AC-4 能覆盖外部程序；AC-4 因此显式限定为「脚本自身不读取项目文档内容（扩展清单里的 `version` 除外）、只写入版本比较缓存与目标摘要，且不外发任何本地数据」。消除该残余风险需要对 CLI 做沙箱隔离，属于本期范围之外（见 §9.7）；用户已认可该残余风险，记录见 §11.3。

---

## 6. 受影响组件与改动清单

| 组件 | 改动 | 类型 |
| :--- | :--- | :--- |
| `skills/taco/scripts/check-update.mjs` | 新增探测脚本：`git ls-remote` 首选 + GitHub Tags API 回退 + 可选的 `taco-cli --version` 与扩展 archive 查询 + 15 分钟缓存（§5.2、§5.3） | 新增 |
| `skills/taco/VERSION` | 新增版本标记，构建生成（§6.1） | 新增（生成物） |
| `scripts/sync-skill-version.mjs` | 从 `package.json` 写入 `skills/taco/VERSION` | 新增 |
| `package.json` | 新增 `sync:version` 脚本并接入 `build` 链；`build` 末尾（`sync-extension-shell.mjs` 之后）执行同步 | 修改 |
| `skills/taco/SKILL.md` | 在 `When to use` 之后、`Workflow` 之前新增「检查更新（每次工作会话一次）」小节（命令、静默条件、MUST NOT 自主升级、渠道化升级指引）；在 `Report format` 末尾补一句提醒规则 | 修改 |
| `docs/agent-installation.md` | **安装入口改为「优先 npx skills 安装，失败或结果不完整时回退整目录拷贝」**（命令与验证：`npx skills@latest add arcadia822/taco --skill=taco`，非交互写法 `-g -a <agent> -y`，验证用 `npx skills@latest list`）；安装文件清单（现有 5 条 bullet，`scripts/**` 已涵盖新脚本）显式加入 `VERSION`；`Verify before reporting success` 加入 `VERSION` 与 `check-update.mjs`；`Use the skill` 之前补 bootstrap 说明；新增「更新提示」小节（按安装渠道给出升级方式） | 修改 |
| `extensions/taco/policies/taco-agent-policy.md` | 追加一条同等契约（对新装/干净安装的 Spec Kit 项目生效；已安装项目按 §7 走 `manual-merge`） | 修改 |
| `README.md`、`README.zh-CN.md` | Quickstart 之后一句话说明「有更新会提示、不会自动升级」；安装入口同步为 `npx skills` 优先 | 修改 |
| `.github/workflows/nightly-release.yml` | 在 taco 本体发版步骤里，`npm run check` 之前执行 `npm run sync:version`，并把 `skills/taco/VERSION` 纳入 `git add`（原 `skills/taco-release/SKILL.md` 已随 PR #82 删除，发版逻辑只在 CI） | 修改 |
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
| 网络不可用 / 超时 / 响应体超限 | `ok:false` + `reason`，静默 | 主线交付不受影响 |
| 未认证限额命中（403/429） | `ok:false, reason:"rate-limited"`，静默 | 每会话一次请求，正常使用难以命中；15 分钟缓存进一步摊薄该风险（§5.2） |
| 无 `git` 的环境 | 自动走 HTTP 回退（`source="github-tags-api"`） | 回退用 Node 内置 `fetch`，不依赖 `curl`/`gh`；未装 Xcode CLT 的 macOS 上 `/usr/bin/git` 是非交互即失败的桩，也走此路径 |
| 仅靠 Git 配置走代理的环境 | git 通道失败后自动走 HTTP 回退 | §5.2 的 git 环境隔离带来的明示代价；回退仍可能成功 |
| 通过 `npx skills` 安装 | 与拷贝安装等价：`VERSION` 与 `scripts/` 都在 `./.claude/skills/taco/`（或 `~/.claude/skills/taco/`）内，检查照常工作 | 实测 `add --copy` 复制整个 skill 目录；`skills-lock.json` 只记录 `source`/`sourceType`/`computedHash`，不含 semver，故版本来源仍是 `VERSION`；升级走 `npx skills@latest update taco` |
| 项目装过扩展，但远端没有可安装的扩展包 | `extension.latest=null`、不提示 | 「有 tag 但无 archive」不算可用更新（§5.2） |
| 工作目录不在任何 Spec Kit 项目内 | `extension:null` | 不做任何扩展请求 |
| 缓存文件缺失/损坏/被篡改（例如 `latest` 里塞入非版本字符串）/目标不匹配/不可写 | 忽略缓存并正常探测 | 缓存是无条件不可信的优化，不是依赖；任何缓存异常都不得改变结论或阻断 |
| 已安装 Taco Spec Kit 扩展的项目，重跑 `prepare-policy` | 返回 `manual-merge` 并拒绝写入 | `extensions/taco/bin/taco.mjs` 要求既有 managed block 与新策略**完全一致**才允许替换；策略文本变更即触发 fail-safe。既有行为，本期沿用，合并方式见 `extensions/taco/README.md` |
| 仓库 checkout 内工作（贡献者） | 版本通常等于或领先最近 tag → 静默 | 贡献者环境本身即最新源 |

无破坏性变更：不改动 bundle 格式、shell、CLI 命令面与任何既有文件格式；新增文件与既有安装流程向后兼容。

---

## 8. 验证方案

### 8.1 自动化（Vitest，`tests/update-check.test.ts`）

两条通道各用最合适的确定性替身，与既有先例一致（`tests/skill-pack.test.ts`、`tests/release-scripts.test.ts` 均以 `execFileSync` 跑脚本 + 临时目录）：

- **git 通道**：临时目录建**本地 git 仓库**（`--repo <绝对路径>`，已验证 `git ls-remote <本地路径>` 可用）作为 tag 源；另用 PATH 前置的**记录型 git 桩**断言调用参数与环境。
- **HTTP 回退**：本地 `node:http` 夹具提供 tags JSON（`--api-base http://127.0.0.1:<port>`），并断言夹具**实际收到的请求**（次数、路径、方法、请求头）。
- **CLI 桩**（`taco-cli`）：经 `--cli-bin` 注入。

1. **有更新（git 通道）**：本地仓库打 tag `v0.10.0`、`v0.11.0`、`taco-cli-v0.2.0`；`VERSION=0.10.0`；`--cli-bin` 指向输出 `{"binaryVersion":"0.1.4"}` 的桩 → `skill={0.10.0,0.11.0,true}`、`cli={0.1.4,0.2.0,true}`、`source="git-ls-remote"`、`ok=true`。
2. **无更新 / 版本领先（git 通道）**：`VERSION=0.11.0` → `skill.updateAvailable=false`；`VERSION=0.12.0` → 同样 `false`（不得报「降级」）。
3. **git 调用加固**：PATH 前置记录型 `git` 桩（dump argv + env + cwd 到文件）→ 断言 argv 含 `--tags`、`--refs`、仓库参数前有 `--`、含 `-c credential.helper=`；env 含 `GIT_CONFIG_GLOBAL=/dev/null`、`GIT_CONFIG_SYSTEM=/dev/null`、`GIT_TERMINAL_PROMPT=0` 且不含用户凭据变量；**cwd 为中立目录**（不是项目目录）。
4. **项目级 Git 配置隔离**：构造含 `url.<evil>.insteadOf = https://github.com/`、`http.extraheader` 的恶意 `.git/config` 仓库，**以该目录为 cwd** 启动脚本并指向本地 `--repo` → 断言探测按指定仓库完成、重写规则未生效；另用同一加固参数与中立 cwd 运行 `git config --list --show-origin` → 断言生效配置中不存在来自用户全局/系统/该仓库的上述条目（不声称观测到真实 HTTPS 请求头）。
5. **git 不可用 → HTTP 回退**：令 `git` 不可执行（PATH 前置失败桩或空 PATH）+ `--api-base` 指向夹具 → `source="github-tags-api"`、结论与第 1 项一致，且夹具恰收到 1 次 `GET /repos/Arcadia822/taco/tags?per_page=100`。
6. **覆盖仓库时不回退**（`--repo`）：`--repo <不存在路径>` + git 失败 → `ok=false`、`source=null`，且夹具**收到 0 次请求**（`reason` 为 `network-unavailable` 或 `git-unavailable`）。
7. **cli 降级三种形态**：`--no-cli` → `cli=null`；`--cli-bin` 指向不存在的绝对路径 → `cli=null`（信任检查拒绝）；`--cli-bin` 指向输出非 JSON 的桩 → `cli.installed=null`、`cli.updateAvailable=null`，且 `ok=true`、`skill` 结论照常（组件独立性）。
8. **版本标记异常**（`VERSION`）：无 `VERSION` → `ok=false, reason="installed-version-marker-missing"`；内容为 `abc` → `ok=false, reason="installed-version-unreadable"`；两者 `updateAvailable=null`，且**不得只报告 cli 更新**。
9. **限额头与超时参数**：夹具返回 `200` + `x-ratelimit-remaining: 0` → `rate-limited`（即使状态码是 200）；`--timeout 2147483648` 与 `--timeout 0` → `exit code 2`。
10. **超时与进程组终止**：`git` 桩两种写法各测一次——（a）`exec sleep 5`、（b）`sh -c 'sleep 5'`（睡眠为派生进程）；`--timeout 200` 下断言 `reason="timeout"`、总耗时远小于 5 s、两种写法后都不残留相关进程。
11. **输出超限**：`git` 桩输出 > 64 KiB，以及夹具返回 > 64 KiB → `reason="output-limit-exceeded"`，连接/子进程被终止，不阻塞。
12. **HTTP 错误映射与限额**：403（带 `x-ratelimit-remaining: 0`）、403（无该头）、429 → `rate-limited`；500 → `http-error`；200 但响应体非 JSON → `http-error`；DNS/连接失败 → `network-unavailable`。
13. **重定向与跨域 Link**：夹具对第 1 页返回 302（指向另一主机）→ `ok=false`、`reason="http-error"` 且**没有任何请求发往重定向目标**；夹具返回异域 `Link: rel="next"` → 第 2 页请求仍发往初始基址，无新主机收到请求。
14. **HTTP 分页**：第 1 页 100 条不含本体 tag 且带 `Link: rel="next"`，第 2 页含 `v0.11.0` → `skill.latest="0.11.0"`；无 `next` 且无匹配 → `latest=null`、`ok=true`；断言**最多 2 次请求**。
15. **预发布/缺失 tag**：仅含 `v1.2.0-rc.1`、`v1.2`、`release-1` → `skill.latest=null`、`ok=true`、无提示；无 `taco-cli-v*` → `cli.latest=null`、`cli.updateAvailable=null`、`ok=true`（不得判成传输失败）。git 与 HTTP 两条通道各测一次。
16. **参数边界**：`--repo -x`、`--repo ftp://host`、`--api-base http://example.com`、`--api-base ftp://host`、未知 flag → `exit code 2`（`--repo` 只接受 `https://` 或绝对路径；`--api-base` 只接受 `https://api.github.com` 或环回地址）。
17. **禁用开关短路**：`TACO_UPDATE_CHECK=off` + 记录型 `git` 桩 + 夹具 → `reason="disabled"`，且**桩未被调用、夹具收到 0 次请求**（证明短路，而非「调用后失败」）。
18. **契约字段**：`--json` 键集合恰为 `schema`/`checkedAt`/`ok`/`reason`/`source`/`skill`/`cli`；各字段类型、semver 正则、`null` 语义与 §5.3 表格一致；子对象键集合精确断言（不新增 JSON Schema 校验依赖）。
19. **版本标记同步**（`VERSION`）：`tests/version.test.ts` 断言 `skills/taco/VERSION.trim() === packageJson.version`。
20. **构建生成**：`node scripts/sync-skill-version.mjs` 对临时目录运行时写入 `"<version>\n"` 且幂等（第二次运行报告 `unchanged`，不重写文件）。
21. **CLI 侧的超时与限额**：`--cli-bin` 分别指向挂起桩与无限输出桩 → `cli.installed=null`、`cli.updateAvailable=null`、`ok=true`，且 skill 的更新提示仍可用；挂起用例断言子进程被终止且不残留。
22. **扩展（可选组件）**：在临时目录构造 `.specify/extensions/taco/extension.yml`（`version: 0.6.0`），releases 夹具里 `v0.11.0` 无资产、`v0.6.0` 带 `taco-extension-v0.6.0.zip` → `extension={installed:0.6.0, latest:0.6.0, updateAvailable:false}`（有更新的本体 tag、但没有更新的可安装包 ⇒ 不提示）；夹具改为 `v0.12.0` 带 `taco-extension-v0.12.0.zip` → `updateAvailable=true`；无扩展清单时 → `extension:null` 且夹具请求数不增加。
23. **releases 响应体积**：夹具返回约 165 KB 的合法 releases JSON（含 `taco-extension-*.zip` 资产）→ `extension.updateAvailable=true`（证明该端点不受 64 KiB 上限约束）；夹具返回 2 MiB 响应 → `extension={installed, latest:null, updateAvailable:null}` 且 `ok=true`。
24. **缓存**：同一 `TACO_UPDATE_CACHE_DIR` 连续两次运行 → 第二次 `cached=true` 且夹具请求数为 0；把 `checkedAt` 改到 TTL 之外 → 重新探测；写入损坏 JSON、把 `latest.skill` 改成 `bad`、把 `source` 改成白名单外的值、把 `target` 指向另一个仓库 → 一律忽略缓存并重新探测；`--no-cache` 与 `TACO_UPDATE_CACHE_TTL=0` → 不读不写；缓存目录不可写 → 结论不变、`exit code 0`。

### 8.2 手工 smoke（必须真实执行，作为交付证据）

- 真实网络下运行 `node skills/taco/scripts/check-update.mjs --json`：`source="github-tags-api"`、`skill.latest="0.11.0"`、`cli.installed` 与本机 `taco-cli --version` 一致（当前 `0.1.4`）、`cli.latest="0.2.1"`、`cli.updateAvailable=true`；并确认**耗时与响应体量**符合预期（约 1 s / 约 10 KB）。
- 容错场景：`TACO_UPDATE_CHECK=off`、`--api-base http://127.0.0.1:9`（未监听端口）、`--timeout 200` 均 `exit code 0`，主线可继续。
- **回退通道实测**：以只含 Node 的 PATH 运行（例如 `PATH="$(dirname "$(command -v node)")"`），使 `git` 不可发现 → 确认 `source="github-tags-api"` 且结论与 git 通道一致；再用 `--repo /nonexistent` 确认被覆盖时不回退。
- 真实 Taco 打包流程走一遍：确认提醒只出现在最终回复末尾、打包输出未被污染；并确认**除正常的 Taco 打包写入外**（`.taco.html`），检查动作没有产生任何针对 skill 目录、`taco-cli` 安装位置或包管理器的写入，也没有执行任何安装/升级命令（AC-6 的流程证据）。
- 扩展策略的迁移后果验证（两个组合，不可只跑一个）：
  - **旧扩展 CLI + 旧 managed block**（现状复现）：`prepare-policy --dry-run --json` 返回 `unchanged`——证明旧安装不会被误报为故障；
  - **新版扩展文件（含新策略）+ 旧 managed block**：先把本分支的 `extensions/taco/` 覆盖进临时项目，再运行 `prepare-policy --dry-run --json`，返回 `manual-merge` 且写入两份文件均未发生——证明 §7/§9.6 的 fail-safe 判断成立。

### 8.3 与验收标准的映射

- AC-1 → §5.4 契约文本 + `SKILL.md` 改动评审；AC-2 → §6 文档改动 + 8.2 的最后一项。
- AC-3 → 8.1 第 5、6、8、9、10、11、12、13、16 项。
- AC-4 → 8.1 第 3、4、17 项（git 加固、配置隔离、禁用时零调用/零请求）+ 第 5 项的请求头断言（无凭据、无本地内容）+ 第 23 项的缓存边界 + §5.5 + 代码结构审查；范围限定见 AC-4 本身。
- AC-5 → 8.1 第 1、2、7、15、21、22、23 项 + §5.4 文案断言。
- AC-6 → §5.4 禁止项 + 代码结构审查（仅 `git ls-remote`／一次 HTTP GET 与一次 `taco-cli --version`，无写路径）+ 8.2 的流程证据（排除正常打包写入）；**该项无法由单元测试证明**。
- AC-7 → 8.1 第 1–24 项；AC-8 → 8.1 第 19、20 项。

---

## 9. 明确不做（Non-goals 与理由）

1. **不检查 tacobin 站点版本**：网页端随部署自动更新，不存在「本地副本落后」问题。
2. **不做后台定时检查/守护进程**：检查发生在 Agent 工作流内部，不引入常驻进程。
3. **不提供自动升级能力**：脚本不具备安装/写文件能力；升级始终由用户发起。
4. **不改动既有契约面**（bundle 格式、shell、`window.taco` API、`taco-cli` 命令面）：本特性只新增探测脚本与文案契约。
5. **不在仓库贡献者环境内做「与 main 比较」的额外提示**：贡献者 checkout 即最新源，tag 比较已足够。
6. **不新增 Spec Kit 策略 managed block 的跨版本自动替换机制**：`extensions/taco/bin/taco.mjs:986-990` 只在既有 block 与新策略**逐字一致**时视为可替换，否则返回 `manual-merge`——这是既有的 fail-safe 设计（防止覆盖项目自定义）。让「上一版 stock block」可被识别替换需要长期维护一份历史哈希表（现仅有针对 `AGENTS.md` 的 `LEGACY_POLICY_HASHES`），属于独立特性，本期不夹带；既有安装按 `extensions/taco/README.md` 的记录走人工合并。
7. **不对 CLI 做沙箱隔离**（`taco-cli`）：本期接受「本机已安装的 CLI 被视为用户已授权执行」这一信任前提（§5.5 明示残余风险）。
8. **不引入 gh 或 curl 依赖**：HTTP 回退用 Node 内置 `fetch`（Node 已是硬依赖）。`git` 作为首选通道被接受：它是本机普遍存在的命令、无速率限制，其配置隔离成本由 §5.2 的固定加固参数一次性承担；若 git 不可用，回退无需任何额外二进制。

---

## 10. 决策记录（2026-09-28，用户确认）

| # | 决策 | 结论 | 影响 |
| :--- | :--- | :--- | :--- |
| D1 | 扩展是否覆盖 | **覆盖，但只在存在可安装 archive 时提示** | §5.2 新增扩展探测（资产驱动，仅当项目装过扩展时发起）；§5.1 新增扩展版本来源；§2.8 场景 |
| D2 | 扩展策略文件是否本期改 | **改，只对新装/干净安装项目生效** | §6 保留 `policies/taco-agent-policy.md` 改动；既有安装仍走 `manual-merge` 人工合并（§7、§9.6） |
| D3 | 自动执行 `taco-cli --version` 的残余风险 | **接受**：只在本机存在绝对路径的常规可执行文件时执行，`SKILL.md` 明确披露，可用 `--no-cli`/`TACO_UPDATE_CHECK=off` 关闭 | §5.3 信任前提、§5.5 残余风险、§5.4 披露要求 |
| D4 | 结果缓存 | **采用 15 分钟 TTL 缓存**（`--no-cache`、`TACO_UPDATE_CACHE_TTL=0` 可禁用） | AC-4 由「零写入」放宽为「只写一个版本比较缓存」；§5.2 缓存规则、§2.9 场景、§8.1 第 22 项 |
| D5 | 已安装版本的载体 | **独立版本文件**（`skills/taco/VERSION`，构建从 `package.json` 生成，`npm run sync:version` 在 `npm run check` 之前执行） | §5.1、§6.1、§6 改动清单、plan 阶段 1 |

文案措辞（§5.4）未被要求修改，按现模板实现；评审时可在 Taco 上直接提意见。

---

## 11. 独立审查结论（2026-09-28）

两位独立审查者（设计审查、安全审查，均非本文作者）对完整方案做了三轮证据化审查。下表是全部 findings 与处置；所有处置均已落进本文件，并有两轮「接受/仍有异议」的复核记录。

| 编号 | 审查者 | 严重度 | 结论 | 处置 |
| :--- | :--- | :--- | :--- | :--- |
| DR-1 | 设计 | major | 策略文本变更会让既有安装落入 `manual-merge`（fail-safe） | 接受事实并如实记录（§7 / §9.6 / §8.2 两个组合烟测）；**不**新增 managed block 跨版本替换机制（用户已确认，见 §11.3） |
| DR-2 | 设计 | major | `check` 先测试后构建，VERSION 同步会被测试先挡住 | 接受：新增 `npm run sync:version`，发版在 `npm run check` 前执行（§6.1、plan 阶段 1） |
| DR-3 | 设计 | major | 部分成功语义（`ok`/`reason`/组件独立）未定义 | 接受：§5.3「组件独立性（部分成功规则）」+「缺失」与「不可解析」拆分 |
| DR-4 | 设计 | major→minor | CLI 子进程缺超时；超时桩可能残留派生进程 | 接受：所有探测独立限时 + 进程组级 `SIGKILL`（§5.2、§8.1 第 7/17 项） |
| DR-5 | 设计 | major | 非默认 `--repo` 仍回退固定 GitHub API 会产生错误结论 | 接受：仅在默认仓库且 `git` 不可用时回退（§5.2、§8.1 第 11 项） |
| DR-6 | 设计 | minor | 超时/禁用开关测试不可靠；AC-6 的「零写操作」表述与正常打包冲突 | 接受：可记录桩 + 两类睡眠桩；AC-6 证据改为结构审查 + 排除正常打包写入（§8.2、§8.3） |
| DR-7 | 设计 | minor | 预发布/缺组件 tag 的行为未定义 | 接受：只接受三段纯数字 tag；缺 tag ⇒ `null` 且 `ok` 不变；移除 `remote-tag-unparseable` |
| SR-1 | 安全 | major | 仅隔离全局/系统 Git 配置挡不住项目级 `.git/config` | 接受：子进程 cwd 固定中立目录 + `git config --list --show-origin` 可观测断言（§5.2、§5.5、§8.1 第 18 项） |
| SR-2 | 安全 | major | 自动执行 `PATH` 上的 `taco-cli` 与「零外发」绝对保证冲突 | 接受其第二方案：AC-4 收窄为**脚本自身**范围 + `SKILL.md` 强制披露 + 可关闭；残余风险与披露方式见 §5.5，**用户已认可该安全取舍（§11.3）** |
| SR-3 | 安全 | minor | 计划未覆盖 CLI 子进程超时/超限 | 接受：§8.1 第 17 项 |
| SR-4 | 安全 | minor | `--repo` 参数与协议边界未规定 | 接受：协议/路径白名单 + `--` 终止符（§5.2、§8.1 第 12 项） |

### 11.3 冻结决议（2026-09-28，用户确认）

用户答复「可以启动开发了」并逐项确认了本规格的 5 个取舍（详见 §10 决策记录）：D1 扩展按「可安装 archive」覆盖、D2 策略文件本期改（仅对新装生效）、D3 接受自动执行 `taco-cli --version` 的残余风险（披露 + 可关闭）、D4 采用 15 分钟 TTL 缓存、D5 采用独立 `VERSION` 文件。据此本规格状态置为 `Frozen`，作为实施与验收基线；实施中若发现与本文冲突，停下用 ask 请示，不擅自改需求。

终局复核结果：设计审查者回复「无剩余异议」（并给出 §8.2/§8.1/§5.2 的行号锚点）；安全审查者对 SR-1、SR-3 判定接受，SR-2 为**有条件接受**——实施前必须取得用户对该安全取舍的明确认可。因此本设计保持 `Draft`：未经用户确认不得视为 frozen/approved，也不得据此开始实现。

### 11.1 传输方式的两轮变更（2026-09-28，依用户意见修订）

1. **第一轮**：用户指出「安装 skill 不会克隆仓库；`git ls-remote` 依赖外部程序；可以直接用 HTTP 读 GitHub」，于是把探测从「`git` 首选 + Releases API 回退」改为**单一 GitHub Tags API**（Node 内置 `fetch`），并据此撤除 SR-1（项目级 `.git/config` 隔离）、SR-4（`git` 参数与协议边界）、DR-5（非默认 `--repo` 的回退规则）三条针对 git 的审查项。
2. **第二轮**：用户进一步指出「如果任何人都能用，那还是走 git 好，curl 作为 git 的 fallback」，于是**恢复 git 为首选通道**（任何机器只要有 `git` 即可匿名列出公开仓库 tag，无认证、无速率限制），并把 HTTP（Node 内置 `fetch`，等价于 curl 的能力）作为回退，**仅当覆盖参数未被使用且 git 尝试失败时**触发（即 `--repo` 未被覆盖）。
3. **因此重新生效的审查条目**：SR-1、SR-4、DR-5 的加固与测试全部恢复（§5.2 的 git 环境隔离、cwd 中立化、`--` 终止符、`--repo` 取值白名单、被覆盖时不回退）；SR-2/SR-3/DR-4 关于 `taco-cli` 子进程与超时的结论不变。
4. **只保留在 HTTP 通道上的条目**：`redirect: "error"`、分页地址由基址构造、UA 常量 `taco-update-check/1`、`--api-base` 两类取值白名单、限额映射 `rate-limited`。

### 11.2 安装渠道（2026-09-28，依用户意见修订）

用户指出官网已给出 `npx skills@latest add arcadia822/taco --skill=taco`，而 `docs/agent-installation.md` 未写。实测（`skills` v1.7.0）：

- `npx skills@latest add arcadia822/taco --list` 当时解析出 `taco`、`taco-release` 两个 skill；用户指出 `taco-release` 不是安装项（发版已由 CI 承担），随后在 PR #82 中把该 skill 删除、脚本移入 `scripts/`，仓库现在只有 `taco` 一个 skill；
- `add --copy` 会把**整个 skill 目录**（`SKILL.md`、`scripts/`、`VERSION`、模板等）复制到 `./.claude/skills/taco/`，并在项目根写入 `skills-lock.json`（记录 `source`/`sourceType`/`computedHash`，不含 semver）；
- 升级命令为 `npx skills@latest update taco`。

故安装指南改为**「优先 npx skills 安装，失败或结果不完整时回退整目录拷贝」**（§6 改动清单、plan.md 阶段 3）；更新检查本身保持**渠道无关**（版本来源仍是 skill 目录内的 `VERSION`），只在用户询问升级方式时按渠道给出对应命令。
