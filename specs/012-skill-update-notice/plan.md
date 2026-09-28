# 实施计划 - Taco 更新提示

> 设计源文件：`spec.md`（权威，Frozen；§5.3 为脚本输出契约，§5.5 为信任边界）。
> 状态：**阶段 1–4 已实现并自测通过**（`npm run check` 全绿：45 个测试文件 / 469 用例），等待独立审查与人工评审。

## 阶段 1：版本标记与同步器 ✅

- [x] 新增 `scripts/sync-skill-version.mjs`：读取 `package.json` 的 `version`，以 `"<version>\n"` 原子写入 `skills/taco/VERSION`（临时文件 + `rename`）；内容相同则报告 `unchanged` 且不重写；支持 `--skill-dir <dir>` 以便测试。
- [x] `package.json`：新增脚本 `"sync:version": "node scripts/sync-skill-version.mjs"`；`scripts/build-shells.mjs` 末尾（`build-template-htmls.mjs` 之后）调用同一脚本，保证完整构建后工作树无漂移。
- [x] 运行 `npm run sync:version` 生成 `skills/taco/VERSION`（当前 `0.11.0`），第二次运行报告 `unchanged`。
- [x] `.github/workflows/nightly-release.yml`：taco 本体发版步骤中，版本号更新之后、`npm run check` 之前执行 `npm run sync:version`（并保留 `git add ... skills/taco/`）。原 `skills/taco-release/SKILL.md` 已删除（发版逻辑只在 CI），故改 CI 而非改文档。
- [x] `AGENTS.md`：注明 `skills/taco/VERSION` 是构建生成物，禁止手改。

## 阶段 2：探测脚本 ✅

- [x] 新增 `skills/taco/scripts/check-update.mjs`，实现 `spec.md` §5.3：
  - [x] 参数：`--json`、`--repo <url|path>`、`--api-base <url>`、`--timeout <ms>`、`--cli-bin <path>`、`--no-cli`、`--no-cache`；`--repo` 只接受 `https://` 或绝对本地路径（被覆盖时禁用 HTTP 回退与扩展查询），`--api-base` 只接受 `https://api.github.com` 或环回地址；非法用法 `exit 2`。
  - [x] 环境变量：`TACO_UPDATE_CHECK=off` 立即短路（零 spawn、零请求、零写入）；`TACO_CLI_BIN`、`TACO_UPDATE_CACHE_TTL`、`TACO_UPDATE_CACHE_DIR`。
  - [x] 已安装版本：读取脚本同目录 `../VERSION`（区分「缺失」与「不可解析」两种 reason）；`taco-cli --version` 解析 `binaryVersion`，仅在解析为绝对、常规、可执行文件时执行。
  - [x] 远端探测：**首选 git tag 列表**（`git ls-remote --tags --refs -- <repo>`）；仅当 `--repo` 未被覆盖且 git 尝试失败时，回退到 `GET https://api.github.com/repos/Arcadia822/taco/tags?per_page=100`（Node 内置 `fetch`，常量 UA、`redirect: manual` 视为失败、分页由基址构造且最多 2 页）；三段纯数字 tag 匹配（取最大值），预发布一律忽略；无可用 tag ⇒ 该组件 `latest/updateAvailable=null` 且 `ok` 不变。
  - [x] 扩展（D1）：仅当 cwd 向上找到 `.specify/extensions/taco/extension.yml` 时查 releases，取**带可安装扩展包的最高版本**（资产名形如 `taco-extension-v<版本>.zip`）；无资产 ⇒ 不提示；查询失败只让该组件为 unknown。
  - [x] 加固与失败映射：每次尝试独立 3000 ms 超时、tags/git/taco-cli 64 KiB 上限、releases 1 MiB 上限；git 以精简 env + `GIT_CONFIG_GLOBAL/SYSTEM=/dev/null` + 禁用交互与 askpass + `-c credential.helper=` 运行，**cwd 固定在中立目录**（`os.tmpdir()`），仓库参数前插入 `--`；HTTP 403/429 ⇒ `rate-limited`、非 2xx/非 JSON ⇒ `http-error`、连接失败 ⇒ `network-unavailable`；同通道不重试。`git`/`taco-cli` 以独立进程组启动，超时/超限用 `process.kill(-pid, 'SIGKILL')` 终止整个进程组。
  - [x] 组件独立判定：`skill` 不可读 ⇒ `ok:false` + reason 且完全静默；`cli` 不可读/超时/超限 ⇒ 仅该组件降级，`ok` 与 `skill` 结论不受影响。
  - [x] 输出：默认一行英文摘要（含被跳过项标注）；`--json` 输出 §5.3 契约对象（键集合与类型精确符合）；检查完成一律 `exit 0`。
  - [x] 副作用（D4）：只写一个 15 分钟 TTL 缓存（`~/.cache/taco/update-check.json`，`0o600`，仅版本比较结果；`--no-cache`/`TACO_UPDATE_CACHE_TTL=0` 完全禁用），不读项目内容，请求不含凭据与本地数据。

## 阶段 3：Agent 契约（SKILL.md 与相关指南）✅

- [x] `skills/taco/SKILL.md`：新增「Check for updates once per work session」小节（命令、静默条件、MUST NOT 自主升级、原始输出不外露、披露会自动执行 `taco-cli --version` 且可关闭）；`Report format` 末尾增加「有更新才补一句」的规则。
- [x] `skills/taco/references/update-notice.md`（新增）：用户可见文案模板（中英）、何时说/何时不说，以及用户要求升级时按渠道给出的命令。
- [x] `docs/agent-installation.md`：**安装入口改为「优先 npx skills，失败或结果不完整时回退整目录拷贝」**（含非交互写法与 `npx skills@latest list` 验证）；文件清单加入 `VERSION`；验证清单覆盖两种安装路径；新增「更新提示」「卸载与升级」小节与 bootstrap 说明。
- [x] `extensions/taco/policies/taco-agent-policy.md`：追加同一契约（D2：只对新装/干净安装生效，既有安装走 `manual-merge`）。
- [x] `README.md`、`README.zh-CN.md`：安装入口同步为 npx skills 优先，并说明「有更新会提示、不会自动升级」。

## 阶段 4：测试与验证 ✅

- [x] `tests/update-check.test.ts`（新增 23 项）：git 通道用本地临时仓库 + PATH 前置的记录型 `git` 桩（断言 argv/env/cwd 加固）与恶意 `.git/config` 隔离；HTTP 回退用 `node:http` 夹具（请求次数/路径/请求头、302 拒绝、异域 Link 不跟随、分页 ≤2、限额、非 JSON）；`taco-cli` 桩经 `--cli-bin` 注入（含挂起与超量）；扩展的 archive 驱动与响应体积；缓存的命中/TTL/损坏/禁用/不可写；参数边界与契约键集合。
- [x] `tests/version.test.ts`：断言已提交的 `skills/taco/VERSION` 与 `package.json` 一致。
- [x] 运行 `npm run sync:version && NODE_OPTIONS="${NODE_OPTIONS:-} --no-experimental-webstorage" npm run check` → exit 0（469 passed）。
- [x] 手工 smoke（§8.2，全部实测）：真实网络 `--json`（skill 0.11.0 无更新、`taco-cli` 0.1.4 → 0.2.1）；仅含 Node 的 PATH 验证 HTTP 回退（`source=github-tags-api`）；`--repo /nonexistent` 验证被覆盖时不回退；`TACO_UPDATE_CHECK=off`、`--api-base http://127.0.0.1:9`、`--timeout 200` 三个容错场景；扩展实测 0.5.0 → 0.6.0 提示、0.6.0 不提示；缓存命中；策略迁移两个组合（旧 CLI+旧 block ⇒ `unchanged`；新策略+旧 block ⇒ `manual-merge` 且未写入）。
- [x] 生成并交付验证用 `.taco.html`（`specs/012-skill-update-notice/012-skill-update-notice.taco.html`）。

## 阶段 5：交付与评审收尾 ⏳

- [x] 对照 `spec.md` §3 的 AC-1…AC-8 逐条自查，在 PR 描述中给出证据（含 §8.3 的映射）。
- [x] 在 PR 描述中记录 bootstrap 约束、§7 迁移后果、§5.5 残余风险、§11.1/§11.2 的用户意见修订与 §9 非目标。
- [ ] 独立 reviewer（未参与实现）审查完整 diff；逐项修复并复验（结论与修复记录见 PR 描述）。
- [ ] 保持 PR 为待人工评审状态，不自行合并。
