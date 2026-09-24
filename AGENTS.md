# Taco document routing

Write new Taco Markdown metadata as leading YAML frontmatter. Put the document title in `title`; do not add an H1 solely to repeat that title, and do not imitate YAML with a heading such as `## title: "..."`. New specs begin their body at H2 or lower.

Stage placement comes from the file tree itself: `spec.md`, `plan.md`, and `tasks.md` route by filename, and known Spec Kit convention paths such as `research.md`, `data-model.md`, `quickstart.md`, `contracts/`, and `checklists/` route by Taco's built-in rules. Every other document stays Unassigned until a reviewer groups it with Taco's built-in Category control, which records the grouping in the Taco file's navigation manifest.

Classification is a Taco capability, not a document property: do not write a routing or scope key into documents. The deprecated `taco_scope` property and the legacy `**Taco scope**: ...` form are not read and must not be generated.

# Taco contributor agent rules

These instructions apply to Agents working in the Taco source repository.

When a user asks an agent to install, use, package, or review Taco, read `README.md`, `docs/agent-installation.md`, and `extensions/taco/README.md` before acting.

- Taco currently ships from source. Build `dist-single/Taco_Spec.taco.html`; do not invent an npm package or treat a development-server URL as the product.
- Installing Taco means installing the `skills/taco/` skill. The Spec Kit extension in `extensions/taco/` is an optional, explicitly requested project-level integration and is never part of the default installation.
- Keep the installable skill consistent with its canonical source: `skills/taco/taco-shell.html` is the production shell with its `#taco-document` block emptied to `<script type="application/taco+json" id="taco-document"></script>` and a generic `<title>`, and `skills/taco/templates/` is a generated, byte-identical mirror of `extensions/taco/templates/`. Do not hand-edit either mirror; regenerate it.
- Install `extensions/taco/` only into the exact initialized Spec Kit project named or confirmed by the user.
- Keep the reviewed directory canonical. Assemble or refresh a `.taco.html` by copying the shell and writing the `taco/files` v1 bundle JSON into the `#taco-document` block — that data block is the only agent-writable part of the file. Never modify the shell's HTML, CSS, or scripts, and preserve `docId`, `comments`, and `navigation` across every refresh. Data-block-only editing is the supported workflow; the CLI is not required.
- Preserve canonical `file:` URLs in packaged HTML. Every `.html` or `.htm` entry keeps the absolute canonical `file:` URL that identifies it; the optional CLI's `pack` validates it, and any missing or mismatched value is a packaging error. Never substitute a `data:` or Blob preview URL, and never rewrite an existing URL while editing the data block.
- Present a generated `.taco.html` through the Agent GUI's native clickable file/artifact surface, and open it in the user's browser whenever the host permits local `file://` navigation. Report `presented as a clickable file`, `opened`, or `opened and verified` truthfully: a headless boot check is internal evidence and is not user-visible presentation. In Codex, return a clickable absolute file link and let the user's click open it in Browser; do not attempt autonomous `file://` navigation or substitute a `data:` URL. Use a separate tab so an existing unsaved review survives.
- Provide a verifiable Taco deliverable: After completing development and verification of any feature or fix, always build and provide a `.taco.html` file (such as `dist-single/Taco_Spec.taco.html`, or placed in the project `tmp/` directory, e.g. `tmp/<feature>.taco.html`, which is gitignored) so the user can directly open, interact with, and verify the implemented functionality in their browser.
- Conflict boundary: when the optional extension CLI is installed, preview every review import with `sync --dry-run --json` and stop on any conflict; never use `--force` without explicit authorization for the exact conflict paths. When importing through Handoff or a saved file without the CLI, diff the received content against the canonical files yourself and stop on any change you cannot attribute. Never resolve a conflict by silently choosing one side.
- Treat collaboration-enabled Taco files as potentially credential-bearing. Follow `docs/agent-installation.md` before sending their contents to any external model, service, log, or ticket. Local inspection remains allowed, and revocation or key reset is an explicit user action.
- Tacobin deploys only from a pushed `tacobin-v*` tag. `packages/host/vercel.json` disables Git-triggered Vercel deployments, and the tag drives the Deploy Tacobin workflow, which calls the project's Deploy Hook; a branch push, a pull request, or the tag by itself publishes nothing.

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
