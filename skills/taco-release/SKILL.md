---
name: taco-release
description: Taco 多组件自动化发版技能。用于每晚 8 点或手动检查 GitHub main 分支最新提交，对比 taco 本体、taco-cli 与 tacobin 网页端自上次发版以来的代码变动，判定是否触发发版；并在 taco 本体更新时调用 semantic-release / conventional-changelog 工具生成 Release Notes、更新 CHANGELOG 并发布 GitHub Release。
---

# Taco 多组件自动化发版技能 (Taco Release)

本技能负责对 Taco 仓库中的三大核心组件执行变动检查、版本号判定与自动化发版流程：
1. **taco (本体 / 核心包)**：规范解析器、单文件发行包 (`dist-single/`)、Spec Kit 扩展与模板镜像
2. **taco-cli (CLI 工具)**：独立客户端与 npm 包 (`@tacobin/cli`)
3. **tacobin (网页端 / Webpage)**：Vercel 生产宿主与在线 Demo 站点

支持**每晚 8 点定时巡检**模式与**手动触发发版**模式。

---

## 快速入口与脚本工具

技能内置了两个轻量、确定性的辅助脚本：
- **变动检查与发版判定**：
  ```bash
  node skills/taco-release/scripts/check-changes.mjs
  # 支持 --ref 指定目标分支（默认 origin/main 或 HEAD），支持 --json 输出结构化数据
  ```
- **Semantic-Release / Conventional Changelog 生成**：
  ```bash
  node skills/taco-release/scripts/generate-release-notes.mjs --from <last_tag> --to <ref> --version <new_version> --update-changelog --outfile /tmp/release-notes.md
  ```

---

## 组件发版规则与范围矩阵

| 组件名称 | 标签 (Tag) 格式 | 监控路径范围 (Monitored Paths) | 版本声明文件 | 发版与 CI/CD 机制 |
| :--- | :--- | :--- | :--- | :--- |
| **taco** (本体) | `v*.*.*`<br>*(例: `v0.9.0`)* | `src/`<br>`extensions/`<br>`skills/taco/`<br>`dist-single/`<br>`package.json`<br>`scripts/` | `package.json`<br>`extensions/taco/extension.yml` | 本地执行构建与校验 (`npm run check`)，打标签推送；调用 semantic-release 工具链生成 Release Notes 并通过 `gh release create` 发布 GitHub Release |
| **taco-cli** | `taco-cli-v*.*.*`<br>*(例: `taco-cli-v0.1.4`)* | `packages/cli/` | `packages/cli/package.json` | 更新版本并打标签推送；触发 GitHub Actions `.github/workflows/release-cli.yml`，自动构建 4 平台二进制、发布 GitHub Release 并通过 OIDC 推送 npm |
| **tacobin** (网页端) | `tacobin-v*.*.*`<br>*(例: `tacobin-v0.1.4`)* | `packages/host/`<br>`examples/` | `packages/host/package.json` | 更新版本并打标签推送；触发 GitHub Actions `.github/workflows/deploy-tacobin.yml`，调用 Vercel Deploy Hook 自动部署 `main` 分支生产环境 |

---

## 标准工作流 (Release Workflow)

### 步骤 1：远端同步与基准分支检查

在开始检查前，必须确认工作区干净，并拉取远程仓库最新状态：

```bash
# 1. 检查工作区状态（必须为 clean）
git status --porcelain

# 2. 拉取 origin/main 最新提交和 tags
git fetch origin main --tags

# 3. 确认当前分支为 main，并对齐最新远端（如在独立 agent 环境中）
git checkout main
git pull origin main
```

---

### 步骤 2：多组件变动检测与判定 (Change Detection)

运行检测脚本或手动执行 diff 分析各组件自上次 tag 以来是否有监控路径内的变更：

```bash
# 执行自动化检测报告
node skills/taco-release/scripts/check-changes.mjs
```

**手动检测等价命令**：
```bash
# 获取各组件最新 Tag
LATEST_TACO_TAG=$(git tag -l "v[0-9]*.[0-9]*.[0-9]*" --sort=-v:refname | head -n1)
LATEST_CLI_TAG=$(git tag -l "taco-cli-v*" --sort=-v:refname | head -n1)
LATEST_HOST_TAG=$(git tag -l "tacobin-v*" --sort=-v:refname | head -n1)

# 检测变动
git log "${LATEST_TACO_TAG}..origin/main" --oneline -- src extensions skills/taco dist-single package.json scripts
git log "${LATEST_CLI_TAG}..origin/main" --oneline -- packages/cli
git log "${LATEST_HOST_TAG}..origin/main" --oneline -- packages/host examples
```

**版本号升级 (Semver Bump) 规则**：
- 包含 `BREAKING CHANGE:` 或提交类型带 `!:`（如 `feat!: ...`）$\rightarrow$ **MAJOR**
- 包含 `feat:` 或 `feat(...):` $\rightarrow$ **MINOR**
- 包含 `fix:`、`perf:`、`refactor:`、`chore:` 等 $\rightarrow$ **PATCH**
- 无任何匹配路径变更 $\rightarrow$ **无需发版 (NONE)**

---

### 步骤 3：执行对应组件的发版操作

根据步骤 2 的判定结果，按需执行各组件的发版流程（如果某组件无变动则直接跳过）：

#### 3.1 taco (本体) 发版流程
> **特别注意**：taco 本体发版必须严格遵循 semantic-release 规范生成 release notes，且构建包含单文件发行包及镜像同步。

1. **更新版本号**：
   - 根目录 `package.json` 中的 `"version": "x.y.z"`
   - `extensions/taco/extension.yml` 中的 `version: 'x.y.z'`
2. **执行全套测试与构建检查**：
   ```bash
   # 测试需带 --no-experimental-webstorage 避免 Node webstorage 报错
   NODE_OPTIONS="${NODE_OPTIONS:-} --no-experimental-webstorage" npm run check
   ```
   *说明：`npm run check` 会依次执行 `format:check`、`vitest run` 以及 `build`（重新编译单文件并同步 `extensions/taco/assets/taco-shell.html` 与 `skills/taco/` 模板）。*
3. **调用 Semantic-Release 工具生成 Release Notes 并更新 CHANGELOG**：
   ```bash
   node skills/taco-release/scripts/generate-release-notes.mjs \
     --from "$LATEST_TACO_TAG" \
     --to HEAD \
     --version "<new_version>" \
     --update-changelog \
     --outfile /tmp/taco-release-notes.md
   ```
4. **提交变更与打标签**：
   ```bash
   git add package.json extensions/taco/extension.yml CHANGELOG.md extensions/taco/CHANGELOG.md dist-single/ extensions/taco/assets/ skills/taco/
   git commit -m "chore(release): taco v<new_version>"
   git tag -a "v<new_version>" -m "Taco v<new_version>"
   ```
5. **推送远端与创建 GitHub Release**：
   ```bash
   git push origin main
   git push origin "v<new_version>"

   # 通过 GitHub CLI 发布 release 并附带生成的 release notes
   gh release create "v<new_version>" \
     --repo Arcadia822/taco \
     --title "Taco v<new_version>" \
     --notes-file /tmp/taco-release-notes.md
   ```

#### 3.2 taco-cli 发版流程
1. **更新版本号**：
   - `packages/cli/package.json` 中的 `"version": "x.y.z"`
2. **提交与打标签**：
   ```bash
   git add packages/cli/package.json
   git commit -m "chore(release): taco-cli v<new_version>"
   git tag -a "taco-cli-v<new_version>" -m "taco-cli-v<new_version>"
   ```
3. **推送到 GitHub**：
   ```bash
   git push origin main
   git push origin "taco-cli-v<new_version>"
   ```
4. **验证后续 CI/CD 流水线**：
   推送标签后将自动触发 GitHub Actions `.github/workflows/release-cli.yml`：
   ```bash
   gh run list --repo Arcadia822/taco --workflow release-cli.yml --limit 3
   ```
   可使用 `gh run watch` 跟踪直到构建、打包、GitHub Release 与 npm 发布完成。

#### 3.3 tacobin (网页端) 发版流程
1. **更新版本号**：
   - `packages/host/package.json` 中的 `"version": "x.y.z"`
2. **提交与打标签**：
   ```bash
   git add packages/host/package.json
   git commit -m "chore(release): tacobin-v<new_version>"
   git tag -a "tacobin-v<new_version>" -m "tacobin-v<new_version>"
   ```
3. **推送到 GitHub**：
   ```bash
   git push origin main
   git push origin "tacobin-v<new_version>"
   ```
4. **验证 Vercel 部署流水线**：
   推送标签后将自动触发 GitHub Actions `.github/workflows/deploy-tacobin.yml`：
   ```bash
   gh run list --repo Arcadia822/taco --workflow deploy-tacobin.yml --limit 3
   ```

---

### 步骤 4：生成发版报告与汇总

在执行完毕后，输出清晰的执行报告：
- **检查时间与基准 Commit**
- **各组件发版结论**：组件名、原版本 $\rightarrow$ 新版本、Git Tag、发布链接
- **CI/CD 状态**：各触发的 GitHub Actions 运行状态
- **跳过说明**：若无变更，明确标记“未发生代码变动，跳过发版”

---

## 异常处理与安全准则

1. **只在 `main` 分支发版**：严禁在特性分支直接给组件打发布 Tag。由于 Deploy Hook 与发布脚本要求发布 Commit 必须是 `origin/main` 的祖先，非 main 上的 Tag 会被 CI 中断。
2. **测试与环境隔离**：跑 Vitest 时必须保留环境变量 `NODE_OPTIONS="${NODE_OPTIONS:-} --no-experimental-webstorage"`。
3. **构建产物一致性**：更新 taco 本体后，必须运行 `npm run build` 确保 `dist-single/Taco_Spec.taco.html`、`skills/taco/taco-shell.html` 以及各模板 HTML 保持同步且未发生非预期污染。
4. **幂等性**：若当天没有有效 commit 发生，脚本与 Agent 必须安静退出或输出“无需发版”通知，不可创建空版本或冗余 Tag。
