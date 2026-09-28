# 实施计划 - Taco 更新提示

> 设计源文件：`spec.md`（权威，§5.3 为脚本输出契约，§5.5 为信任边界）。
> 本计划在设计评审通过后执行；当前仅完成设计，不含实现提交。

## 阶段 1：版本标记与同步器

- [ ] 新增 `scripts/sync-skill-version.mjs`：读取 `package.json` 的 `version`，以 `"<version>\n"` 原子写入 `skills/taco/VERSION`（临时文件 + `rename`）；内容相同则报告 `unchanged` 且不重写；支持 `--dir <skill-dir>` 以便测试。
- [ ] `package.json`：新增脚本 `"sync:version": "node scripts/sync-skill-version.mjs"`；并在 `build` 链末尾（`scripts/sync-extension-shell.mjs` 之后）追加同一命令，保证完整构建后工作树无漂移。
- [ ] 运行 `npm run sync:version` 生成 `skills/taco/VERSION`，确认内容等于 `package.json` 版本。
- [ ] `.github/workflows/nightly-release.yml`：在 taco 本体发版步骤里，更新版本号之后、`npm run check` 之前插入 `npm run sync:version`，并把 `skills/taco/VERSION` 纳入 `git add`（该步骤已包含 `skills/taco/`）。原 `skills/taco-release/SKILL.md` 已随 PR #82 删除，本行改为直接改 CI。
- [ ] `AGENTS.md`：注明 `skills/taco/VERSION` 是构建生成物，禁止手改；改动镜像类生成物后重新生成。

## 阶段 2：探测脚本

- [ ] 新增 `skills/taco/scripts/check-update.mjs`，实现 `spec.md` §5.3：
  - [ ] 参数：`--json`、`--repo <url|path>`、`--api-base <url>`、`--timeout <ms>`、`--cli-bin <path>`、`--no-cli`；`--repo` 只接受 `https://` 或绝对本地路径（被覆盖时禁用 HTTP 回退），`--api-base` 只接受 `https://api.github.com` 或环回测试夹具；非法用法 `exit 2`。
  - [ ] 环境变量：`TACO_UPDATE_CHECK=off` 立即短路（零 spawn、零请求）；`TACO_CLI_BIN` 等价 `--cli-bin`。
  - [ ] 已安装版本：读取脚本同目录 `../VERSION`（区分「缺失」与「不可解析」两种 reason）；`taco-cli --version` 解析 `binaryVersion`，仅在绝对路径常规可执行文件时执行。
  - [ ] 远端探测：**首选 git tag 列表**（`git ls-remote --tags --refs <repo>`）；仅当 `--repo` 未被覆盖且 git 尝试失败时，回退到 `GET https://api.github.com/repos/Arcadia822/taco/tags?per_page=100`（Node 内置 `fetch`，常量 UA `taco-update-check/1`，`redirect: "error"`，分页地址由基址构造且最多 2 页）；三段纯数字 tag 匹配，预发布一律忽略；无可用 tag ⇒ 该组件 `latest/updateAvailable=null` 且 `ok` 不变。
  - [ ] 加固与失败映射：每次尝试独立 3000 ms 超时、64 KiB 输出上限；git 以精简 env（`PATH`/`HOME`/`LANG`）、`GIT_CONFIG_GLOBAL=/dev/null`、`GIT_CONFIG_SYSTEM=/dev/null`、`GIT_TERMINAL_PROMPT=0`、askpass 不可用、`-c credential.helper=` 运行，**cwd 固定在中立目录**（`os.tmpdir()`），仓库参数前插入 `--`；HTTP 用 `AbortSignal.timeout`，403/429 或 `x-ratelimit-remaining: 0` ⇒ `rate-limited`，非 2xx ⇒ `http-error`，连接失败 ⇒ `network-unavailable`；同通道不重试、不缓存。`git`/`taco-cli` 以独立进程组启动（`detached: true`），超时/超限用 `process.kill(-pid, 'SIGKILL')` 终止整个进程组。
  - [ ] 组件独立判定：`skill` 不可读 ⇒ `ok:false` + reason 且完全静默；`cli` 不可读/超时/超限 ⇒ 仅 `cli.installed/updateAvailable=null`，`ok` 与 `skill` 结论不受影响。
  - [ ] 输出：默认一行英文摘要（含被跳过项标注）；`--json` 输出 §5.3 契约对象（键集合与类型精确符合）；检查完成一律 `exit 0`。
  - [ ] 无副作用：零写入（含不做缓存）、不读项目内容、请求不含凭据与本地数据。

## 阶段 3：Agent 契约（SKILL.md 与相关指南）

- [ ] `skills/taco/SKILL.md`：
  - [ ] 在 `When to use` 之后、`Workflow` 之前新增「检查更新（每次工作会话一次）」小节：命令、只读结果、静默条件、MUST NOT 自主升级、原始输出不得贴给用户，并**披露**会自动执行 `taco-cli --version` 且可用 `--no-cli`/`TACO_UPDATE_CHECK=off` 关闭。
  - [ ] 在 `Report format` 末尾增加一句：仅当 `updateAvailable === true` 时在最终回复末尾追加一句话，文案按 §5.4 模板并以对话语言选择。
- [ ] `docs/agent-installation.md`：**安装入口改为「优先 npx skills 安装，失败或结果不完整时回退整目录拷贝」**（命令与验证：`npx skills@latest add arcadia822/taco --skill=taco`，非交互 `-g -a <agent> -y`，验证用 `npx skills@latest list`）；安装文件清单显式加入 `VERSION`（现有 5 条 bullet）；`Verify before reporting success` 加入 `VERSION` 与 `scripts/check-update.mjs` 的存在与可执行检查；`Use the skill` 之前补 bootstrap 说明（旧快照需一次手动重装）；新增「更新提示」小节。
- [ ] `extensions/taco/policies/taco-agent-policy.md`：追加同一条契约（新装/干净安装生效；已安装项目按 `manual-merge`）。
- [ ] `README.md`、`README.zh-CN.md`：Quickstart 之后一句话说明「有更新会提示、不会自动升级」。

## 阶段 4：测试与验证

- [ ] `tests/update-check.test.ts`（新增）：按 `spec.md` §8.1 的 20 项实现——git 通道用本地临时仓库（`--repo <abs path>`）加 PATH 前置的记录型 `git` 桩（断言 argv/env/cwd 加固）+ 恶意 `.git/config` 隔离用例；HTTP 回退用 `node:http` 夹具（断言次数/路径/请求头、重定向与异域 Link、分页、限额）；`taco-cli` 桩经 `--cli-bin` 注入。
- [ ] `tests/version.test.ts`（修改）：断言已提交的 `skills/taco/VERSION` 与 `package.json` 一致。
- [ ] 运行 `npm run sync:version && NODE_OPTIONS="${NODE_OPTIONS:-} --no-experimental-webstorage" npm run check`（顺序体现 §6.1 的发版要求）。
- [ ] 手工 smoke（§8.2）：真实网络 `--json`（记录耗时与响应体量）；以只含 Node 的 PATH 跑一次验证 HTTP 回退、以 `--repo /nonexistent` 验证被覆盖时不回退；`TACO_UPDATE_CHECK=off` / `--api-base http://127.0.0.1:9` / `--timeout 200` 三个容错场景；真实打包流程确认提醒位置，并区分「正常的 `.taco.html` 写入」与「检查动作的零写入」；扩展策略迁移用两个组合各验证一次（旧 CLI+旧 block ⇒ `unchanged`；新策略+旧 block ⇒ `manual-merge` 且未写入）。
- [ ] 生成并交付验证用 `.taco.html`（`specs/012-skill-update-notice/012-skill-update-notice.taco.html`），供用户直接打开核对。

## 阶段 5：交付与评审收尾

- [ ] 对照 `spec.md` §3 的 AC-1…AC-8 逐条自查，在 PR 描述中给出证据（含 §8.3 的映射）。
- [ ] 在 PR 描述中记录 bootstrap 约束、§7 迁移后果、§5.5 残余风险、§11.1/§11.2 的两次用户意见修订与 §9 非目标，供评审（含仍需用户确认的 §10 各项）。
