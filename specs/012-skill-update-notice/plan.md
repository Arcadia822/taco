# 实施计划 - Taco 更新提示

> 设计源文件：`spec.md`（权威，§5.3 为脚本输出契约，§5.5 为信任边界）。
> 本计划在设计评审通过后执行；当前仅完成设计，不含实现提交。

## 阶段 1：版本标记与同步器

- [ ] 新增 `scripts/sync-skill-version.mjs`：读取 `package.json` 的 `version`，以 `"<version>\n"` 原子写入 `skills/taco/VERSION`（临时文件 + `rename`）；内容相同则报告 `unchanged` 且不重写；支持 `--dir <skill-dir>` 以便测试。
- [ ] `package.json`：新增脚本 `"sync:version": "node scripts/sync-skill-version.mjs"`；并在 `build` 链末尾（`scripts/sync-extension-shell.mjs` 之后）追加同一命令，保证完整构建后工作树无漂移。
- [ ] 运行 `npm run sync:version` 生成 `skills/taco/VERSION`，确认内容等于 `package.json` 版本。
- [ ] `skills/taco-release/SKILL.md` 步骤 3.1：在更新 `package.json` / `extension.yml` 版本号之后、`npm run check` 之前插入 `npm run sync:version`，并将 `skills/taco/VERSION` 纳入提交（`git add` 已含 `skills/taco/`）。
- [ ] `AGENTS.md`：注明 `skills/taco/VERSION` 是构建生成物，禁止手改；改动镜像类生成物后重新生成。

## 阶段 2：探测脚本

- [ ] 新增 `skills/taco/scripts/check-update.mjs`，实现 `spec.md` §5.3：
  - [ ] 参数：`--json`、`--repo <url|path>`、`--timeout <ms>`、`--cli-bin <path>`、`--no-cli`；值校验按 §5.2（只接受 `https://` 或绝对本地路径，拒绝 `-` 前缀与其他协议）；非法用法 `exit 2`。
  - [ ] 环境变量：`TACO_UPDATE_CHECK=off` 立即短路（零 spawn、零请求）；`TACO_CLI_BIN` 等价 `--cli-bin`。
  - [ ] 已安装版本：读取脚本同目录 `../VERSION`（区分「缺失」与「不可解析」两种 reason）；`taco-cli --version` 解析 `binaryVersion`，仅在绝对路径常规可执行文件时执行。
  - [ ] 远端探测：`git ls-remote --tags --refs <repo>` 首选，GitHub Releases API 仅在「`git` 不可用且 `--repo` 未被覆盖」时回退；三段纯数字 tag 匹配，预发布一律忽略；无可用 tag ⇒ 该组件 `latest/updateAvailable=null` 且 `ok` 不变。
  - [ ] 加固与限额：每次探测独立硬超时（默认 3000 ms）+ 64 KiB 输出上限；`git` 与 `taco-cli` 以独立进程组启动（`detached: true`），超时/超限用 `process.kill(-pid, 'SIGKILL')` 终止整个进程组；`git` 以精简 env（`PATH`/`HOME`/`LANG`）、`GIT_CONFIG_GLOBAL=/dev/null`、`GIT_CONFIG_SYSTEM=/dev/null`、`GIT_TERMINAL_PROMPT=0`、`GIT_ASKPASS`/`SSH_ASKPASS` 不可用、`-c credential.helper=` 运行，**子进程 cwd 固定在中立目录**（`os.tmpdir()`，绝不在项目目录内），仓库参数前插入 `--`。
  - [ ] 组件独立判定：`skill` 不可读 ⇒ `ok:false` + reason 且完全静默；`cli` 不可读/超时/超限 ⇒ 仅 `cli.installed/updateAvailable=null`，`ok` 与 `skill` 结论不受影响。
  - [ ] 输出：默认一行英文摘要（含被跳过项标注）；`--json` 输出 §5.3 契约对象（键集合与类型精确符合）；检查完成一律 `exit 0`。
  - [ ] 无副作用：零写入、不读项目内容、不外发本地数据、无凭据。

## 阶段 3：Agent 契约（SKILL.md 与相关指南）

- [ ] `skills/taco/SKILL.md`：
  - [ ] 在 `When to use` 之后、`Workflow` 之前新增「检查更新（每次工作会话一次）」小节：命令、只读结果、静默条件、MUST NOT 自主升级、原始输出不得贴给用户，并**披露**会自动执行 `taco-cli --version` 且可用 `--no-cli`/`TACO_UPDATE_CHECK=off` 关闭。
  - [ ] 在 `Report format` 末尾增加一句：仅当 `updateAvailable === true` 时在最终回复末尾追加一句话，文案按 §5.4 模板并以对话语言选择。
- [ ] `docs/agent-installation.md`：安装文件清单显式加入 `VERSION`（现有 5 条 bullet）；`Verify before reporting success` 加入 `VERSION` 与 `scripts/check-update.mjs` 的存在与可执行检查；`Use the skill` 之前补 bootstrap 说明（旧快照需一次手动重装）；新增「更新提示」小节。
- [ ] `extensions/taco/policies/taco-agent-policy.md`：追加同一条契约（新装/干净安装生效；已安装项目按 `manual-merge`）。
- [ ] `README.md`、`README.zh-CN.md`：Quickstart 之后一句话说明「有更新会提示、不会自动升级」。

## 阶段 4：测试与验证

- [ ] `tests/update-check.test.ts`（新增）：按 `spec.md` §8.1 的 18 项实现，桩程序放临时目录（`--cli-bin` / `PATH` 前置注入）；超时用例使用 `exec sleep 5` 与派生睡眠两种桩，并断言无残留进程。
- [ ] `tests/version.test.ts`（修改）：断言已提交的 `skills/taco/VERSION` 与 `package.json` 一致。
- [ ] 运行 `npm run sync:version && NODE_OPTIONS="${NODE_OPTIONS:-} --no-experimental-webstorage" npm run check`（顺序体现 §6.1 的发版要求）。
- [ ] 手工 smoke（§8.2）：真实网络 `--json`；`TACO_UPDATE_CHECK=off` / `--repo /nonexistent` / `--timeout 200` 三个容错场景；真实打包流程确认提醒位置，并区分「正常的 `.taco.html` 写入」与「检查动作的零写入」；扩展策略迁移用两个组合各验证一次（旧 CLI+旧 block ⇒ `unchanged`；新策略+旧 block ⇒ `manual-merge` 且未写入）。
- [ ] 生成并交付验证用 `.taco.html`（`specs/012-skill-update-notice/012-skill-update-notice.taco.html`），供用户直接打开核对。

## 阶段 5：交付与评审收尾

- [ ] 对照 `spec.md` §3 的 AC-1…AC-8 逐条自查，在 PR 描述中给出证据（含 §8.3 的映射）。
- [ ] 在 PR 描述中记录 bootstrap 约束、§7 迁移后果、§5.5 残余风险与 §9 非目标，供评审（含仍需用户确认的 §10 各项）。
