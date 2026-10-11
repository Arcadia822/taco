# Taco document routing

Write new Taco Markdown metadata as leading YAML frontmatter. Put the document title in `title`; do not add an H1 solely to repeat that title, and do not imitate YAML with a heading such as `## title: "..."`. New specs begin their body at H2 or lower.

The file tree supplies directory Categories: a first-level folder groups its files, while files at the root stay Unassigned. File names such as `spec.md`, `plan.md`, and `tasks.md` have no special routing. An explicit `navigation` manifest can assign virtual files to groups without changing their paths; choose a Category in the new-file dialog or edit that manifest for existing files. Header Category switching is unavailable. Do not infer grouping from document content.

Classification is a Taco capability, not a document property: do not write a routing or scope key into documents. The deprecated `taco_scope` property and the legacy `**Taco scope**: ...` form are not read and must not be generated.

# Taco contributor agent rules

These instructions apply to Agents working in the Taco source repository.

When a user asks an agent to install, use, package, or review Taco, read `README.md`, `docs/agent-installation.md`, and `extensions/taco/README.md` before acting.

- Taco currently ships from source. Build `dist-single/Taco_Spec.taco.html`; do not invent an npm package or treat a development-server URL as the product.
- Installing Taco means installing the `skills/taco/` skill. The Spec Kit extension in `extensions/taco/` is an optional, explicitly requested project-level integration and is never part of the default installation.
- Keep the installable skill consistent with its canonical source: `skills/taco/taco-shell.html` is the production shell with its `#taco-document` block emptied to `<script type="application/taco+json" id="taco-document"></script>` and a generic `<title>`, and `skills/taco/templates/` is a generated, byte-identical mirror of `extensions/taco/templates/`. Do not hand-edit either mirror; regenerate it. `skills/taco/VERSION` is generated from `package.json` by `scripts/sync-skill-version.mjs` (`npm run sync:version`, also run at the end of `npm run build`); do not hand-edit it.
- Install `extensions/taco/` only into the exact initialized Spec Kit project named or confirmed by the user.
- Keep the reviewed directory canonical. Assemble or refresh a `.taco.html` by copying the shell and writing the `taco/files` v1 bundle JSON into the `#taco-document` block — that data block is the only agent-writable part of the file. Never modify the shell's HTML, CSS, or scripts, and preserve `docId`, `comments`, and `navigation` across every refresh. Data-block-only editing is the supported workflow; the CLI is not required.
- Ordinary `.html` and `.htm` source files are unsupported in Taco bundles. Exclude them explicitly when packaging a directory; never confuse this restriction with the `.taco.html` container, which remains the product.
- Present a generated `.taco.html` through the Agent GUI's native clickable file/artifact surface, and open it in the user's browser whenever the host permits local `file://` navigation. Report `presented as a clickable file`, `opened`, or `opened and verified` truthfully: a headless boot check is internal evidence and is not user-visible presentation. In Codex, return a clickable absolute file link and let the user's click open it in Browser; do not attempt autonomous `file://` navigation or substitute a `data:` URL. Use a separate tab so an existing unsaved review survives.
- Provide a verifiable Taco deliverable: After completing development and verification of any feature or fix, always build and provide a `.taco.html` file (such as `dist-single/Taco_Spec.taco.html`, or placed in the project `tmp/` directory, e.g. `tmp/<feature>.taco.html`, which is gitignored) so the user can directly open, interact with, and verify the implemented functionality in their browser.
- Skill & Website Review Sync: 每当在当前仓库执行到代码审查（即开发完成后的审查与测试验证阶段）时，必须检查本次改动是否涉及相关的 skill 内容（`skills/`）以及官网内容（`packages/host/`）。
  - 若涉及，必须向用户 propose 相应的 skill 与官网内容变动方案，并在 propose 的同时直接进行修改。
  - 修改完成后，若官网内容（`packages/host/`）发生变动，必须在本地启动官网服务并向用户提供真实可访问的本地预览 URL。
- Conflict boundary: when the optional extension CLI is installed, preview every review import with `sync --dry-run --json` and stop on any conflict; never use `--force` without explicit authorization for the exact conflict paths. When importing through Handoff or a saved file without the CLI, diff the received content against the canonical files yourself and stop on any change you cannot attribute. Never resolve a conflict by silently choosing one side.
- Treat collaboration-enabled Taco files as potentially credential-bearing. Follow `docs/agent-installation.md` before sending their contents to any external model, service, log, or ticket. Local inspection remains allowed, and revocation or key reset is an explicit user action.
- Tacobin deploys only from a pushed `tacobin-v*` tag. `packages/host/vercel.json` disables Git-triggered Vercel deployments, and the tag drives the Deploy Tacobin workflow, which calls the project's Deploy Hook; a branch push, a pull request, or the tag by itself publishes nothing.
- Issue 管理：需求、任务与缺陷一律用 `linctl` 在 Linear 团队 `TACO` 建 Issue，不手动建 GitHub Issue（Linear 会自动同步到 GitHub）。创建时补全上下文字段：状态 `Backlog`、Linear 内建 `priority`（不用 priority 标签代替）、已有语义 `labels`，以及适用的 `project`。

# Agent 踩坑复盘与规则闭环 (LESSONS.md)

仓库在根目录维护 `LESSONS.md`，用于沉淀与追踪 Agent 协作过程中的高频失误模式、环境与依赖陷阱及架构回归问题。

- **记录原则**：当遇到测试偶发失败、依赖漂移、解析崩溃或工具环境不一致等问题时，在复盘时必须在 `LESSONS.md` 追加记录，写明 ID、类别、复现表象、根因与防范措施。
- **升格机制 (Escalation Protocol)**：
  - 任何失误模式如果累计发生 **3 次及以上**（`Occurrences >= 3`），必须从文本说明升级为**硬性结构阻断**（Structural Mechanism）；
  - 升格载体：在 CI 中添加静态检查门禁（如 `npm run check:lessons` 或 pre-commit hook）、在类型系统建立不可表达状态约束，或提升为 `AGENTS.md` 的强制规范；
  - `scripts/check-lessons.mjs` 会在 `npm run check` 中自动化校验 `LESSONS.md` 的格式完整性与 3 次升格标记状态，防止经验沉淀失效或滞后。

# 体积与依赖预算（prepare 估算 / develop 实测）

每个需求都必须给出体积与依赖影响，并在两个阶段各做一次，缺一不可：

- **prepare（设计/规划）阶段：必须估算。** 在设计源文件（`specs/<feature>/spec.md`）中写明：本次改动预计增加的字节数或比例，落在哪些产物上（skill 目录、Complete shell、Lite shell、`.taco.html` 产物、发布包），以及是否引入新的依赖或联网行为。没有数字的估算不算完成，禁止只写「影响很小」。
- **develop（实现）阶段：必须实测。** 实现后按同一口径重新测量，并与估算并列记录（估算值 / 实测值 / 偏差及原因）。实测方式：构建对应产物并比较字节数，例如
  - `node scripts/build-shells.mjs` 后比较 `dist-single/Taco_Spec.taco.html` 与 `dist-single/Taco_Spec_Lite.taco.html`；
  - skill 目录用 `du`/`wc` 比较 `skills/taco/`；
  - 结论写入 PR 描述与设计源文件。
- **阈值与告知义务：任一 shell（`skills/taco/taco-shell.html`、`skills/taco/taco-shell-lite.html` 及其镜像 `extensions/taco/assets/`、`dist-single/`）相对当前基线增长 ≥ 1%，或绝对增量 ≥ 32 KB，即视为「较大增大」，必须在交付说明中**主动、明确地告知用户**，给出数字、原因与可选替代方案；未达阈值也应在实测记录中给出数字。
- **基线（2026-10-09，`dist-single` 构建产物）**：`Taco_Spec.taco.html` 2,846,082 字节；`Taco_Spec_Lite.taco.html` 296,789 字节；`skills/taco/taco-shell.html` 2,737,618 字节；`skills/taco/taco-shell-lite.html` 188,325 字节。基线变化时同步更新本节。

# Semantic commit messages

All commits in this repository MUST follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```text
<type>(<scope?>)(!?): <subject>
```

The nightly automated release workflow and changelog generator rely directly on commit message structure to detect component changes, determine semver version bumps, and generate release notes. Non-compliant commit messages will be rejected by the local Git `commit-msg` hook (`.githooks/commit-msg`).

- Allowed types:
  - `feat`: A new feature (triggers a `minor` version bump for affected components).
  - `fix`: A bug fix (triggers a `patch` version bump for affected components).
  - `perf`: A code change that improves performance (triggers a `patch` version bump).
  - `docs`: Documentation-only changes.
  - `style`: Changes that do not affect the meaning of code (formatting, white-space, etc.).
  - `refactor`: Code changes that neither fix a bug nor add a feature.
  - `test`: Adding missing tests or correcting existing tests.
  - `build`: Changes affecting build systems or external dependencies.
  - `ci`: Changes to CI configuration files and scripts.
  - `chore`: Other maintenance, tooling, or release commits.
  - `revert`: Reverting a previous commit.

- Breaking changes:
  - Append `!` immediately before the colon (e.g. `feat(kernel)!: redesign document format`) or include `BREAKING CHANGE: <description>` in the commit body. This triggers a `major` version bump.

- Recommended scopes:
  - Scope by affected component or subsystem, e.g. `host`, `cli`, `kernel`, `agents`, `release`, `ui`, `review`. Examples:
    - `feat(host): add landing page animation (#49)`
    - `fix(cli): correct self-description output`
    - `chore(release): bump taco-cli to 0.1.5`
    - `docs(agents): require semantic commit messages`
