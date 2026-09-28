# 实施计划 - Taco 更新提示

> 设计源文件：`spec.md`（权威）；机器契约：`contracts/taco-update-check.schema.json`。
> 本计划在设计评审通过后执行；当前仅完成设计，不含实现提交。

## 阶段 1：探测脚本与版本标记

- [ ] 新增 `scripts/sync-skill-version.mjs`：读取 `package.json` 的 `version`，以 `"<version>\n"` 原子写入 `skills/taco/VERSION`（临时文件 + `rename`），内容不变时不重写并打印 `unchanged`。
- [ ] 在 `package.json` 的 `build` 链末尾（或紧随 `scripts/sync-extension-shell.mjs` 之后）加入 `node scripts/sync-skill-version.mjs`。
- [ ] 运行 `npm run build` 生成 `skills/taco/VERSION`，确认内容等于 `package.json` 版本。
- [ ] 新增 `skills/taco/scripts/check-update.mjs`，实现 `spec.md` §5.3：
  - [ ] 参数解析：`--json`、`--repo <url|path>`、`--timeout <ms>`、`--cli-bin <path>`、`--no-cli`；未知参数 `exit 2`。
  - [ ] 环境变量：`TACO_UPDATE_CHECK=off`（短路为 `reason:"disabled"`）、`TACO_CLI_BIN`。
  - [ ] 已安装版本：读取脚本同目录 `../VERSION`；`taco-cli --version` 解析 `binaryVersion`（仅当在 `PATH` 或 `--cli-bin` 中存在）。
  - [ ] 远端探测：`git ls-remote --tags --refs` 首选，GitHub Releases API 回退；硬超时、无重试、无缓存。
  - [ ] 版本比较：严格三段 semver；仅 `latest > installed` 置 `updateAvailable=true`。
  - [ ] 输出：默认一行英文摘要；`--json` 输出符合 `contracts/taco-update-check.schema.json` 的单个对象；检查完成一律 `exit 0`。
  - [ ] 无副作用：不写文件、不读项目内容、不外发任何本地数据、无凭据。

## 阶段 2：Agent 契约（SKILL.md 与相关指南）

- [ ] `skills/taco/SKILL.md`：
  - [ ] 新增「检查更新（每次工作会话一次）」小节：触发时机、命令、只读结果、静默条件、MUST NOT 自主升级。
  - [ ] 在 `Report format` 末尾增加一句：仅当 `updateAvailable === true` 时在最终回复末尾追加一句话，文案按 `spec.md` §5.4 模板并以对话语言选择。
- [ ] `docs/agent-installation.md`：安装清单补入 `VERSION` 与 `scripts/check-update.mjs`；新增「更新提示」小节（含 bootstrap 约束：旧快照需一次手动重装才能获得该能力）。
- [ ] `extensions/taco/policies/taco-agent-policy.md`：追加同一条契约（Spec Kit 项目内的 Agent 同样遵守）。
- [ ] `README.md`、`README.zh-CN.md`：Quickstart 之后一句话说明「有更新会提示、不会自动升级」。
- [ ] `AGENTS.md`：注明 `skills/taco/VERSION` 为构建生成物，禁止手改。

## 阶段 3：发版链路

- [ ] `skills/taco-release/SKILL.md` 步骤 3.1：注明 `VERSION` 由 `npm run check`（build）生成，并随 `skills/taco/` 一并提交；确认 `git add` 列表覆盖该文件。

## 阶段 4：测试与验证

- [ ] `tests/update-check.test.ts`（新增）：按 `spec.md` §8.1 的 9 项覆盖——有更新、无更新、版本领先、cli 缺失、`VERSION` 缺失、远端不可达/超时、契约字段校验、禁用开关。
- [ ] `tests/version.test.ts`（修改）：断言 `skills/taco/VERSION` 与 `package.json` 版本一致。
- [ ] 运行 `NODE_OPTIONS="${NODE_OPTIONS:-} --no-experimental-webstorage" npm run check`。
- [ ] 手工 smoke：真实网络运行 `--json`；`TACO_UPDATE_CHECK=off`、`--repo /nonexistent` 两个容错场景；在真实打包流程中确认提醒只出现在最终回复末尾。
- [ ] 生成并交付验证用 `.taco.html`（`tmp/<feature>.taco.html` 或 `specs/012-skill-update-notice/012-skill-update-notice.taco.html`），供用户直接打开核对。

## 阶段 5：文档与迁移收尾

- [ ] 对照 `spec.md` §3 的 AC-1…AC-8 逐条自查并在 PR 中给出证据。
- [ ] 在 PR 描述中记录 bootstrap 约束与 §9 的非目标，供评审。
