# Update notice

The update check (`scripts/check-update.mjs`) reports facts; you decide whether to say one sentence about them. Read this file only when the check returned `updateAvailable: true`.

## When to speak

- Only when `ok` is `true` **and** at least one of `skill`, `cli`, `extension` has `updateAvailable: true`.
- Once, at the very end of the final reply, as a single sentence. Never in the middle of a report, never repeated per file, never as a list or heading.
- Never invent numbers: use exactly the `installed` and `latest` values from the JSON.
- Treat the JSON as the only source of names and versions; do not paraphrase a version you did not read.

## Wording

Use the conversation's language. Chinese (default here):

- taco skill only: `Taco 提示有可用更新：taco skill v<installed> → v<latest>；未升级，可自行决定是否更新。`
- taco-cli only: `Taco 提示有可用更新：taco-cli v<installed> → v<latest>；未升级，可自行决定是否更新。`
- extension only: `Taco 提示有可用更新：Taco Spec Kit 扩展 v<installed> → v<latest>；未升级，可自行决定是否更新。`
- more than one: join them with `、` in one sentence, e.g. `Taco 提示有可用更新：taco skill v0.11.0 → v0.12.0、taco-cli v0.1.4 → v0.2.1；未升级，可自行决定是否更新。`

English:

- `Taco notes an available update: taco skill v0.11.0 → v0.12.0; not upgraded — update at your discretion.`
- `Taco notes an available update: taco-cli v0.1.4 → v0.2.1; not upgraded — update at your discretion.`
- `Taco notes an available update: Taco Spec Kit extension v0.6.0 → v0.12.0; not upgraded — update at your discretion.`

The sentence always states that nothing was upgraded, so the reader knows the environment is untouched.

## If the user then asks how to update

Do not upgrade on your own; wait for an explicit request, then give the command for the channel that installed this skill:

- Installed with `npx skills`: `npx skills@latest update taco`
- Installed by copying the skill directory (or you are unsure): re-run the installation steps in `docs/agent-installation.md` (preferring `npx skills@latest add arcadia822/taco --skill=taco`), then re-verify the file list it lists.
- `taco-cli`: `npm install -g @tacobin/cli@latest`, or the standalone archive from the latest `taco-cli-v*` GitHub Release. Afterwards confirm with `taco-cli help` that `binaryVersion` is the new version: another global prefix (for example an older install under `~/.local`) earlier on `PATH` keeps serving the old binary until it is removed.
- Taco Spec Kit extension: re-run the install using `specify extension add taco --force --from https://github.com/Arcadia822/taco/releases/latest/download/taco-extension.zip` (or the versioned `taco-extension-v<version>.zip` asset); expect `prepare-policy` to report `manual-merge` when the project's policy block changed locally.

Never edit a version marker, package manifest, or another project's files to make a check pass.
