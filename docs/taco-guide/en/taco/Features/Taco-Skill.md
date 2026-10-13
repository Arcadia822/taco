---
title: Taco Skill
status: Complete
summary: Teaches your agent to write, refresh, and read reviews
---

## What it is

The Taco Skill is the agent skill package (`skills/taco/`), paired with `taco-cli`. Once installed, your agent knows:

- When to use Taco by default: only when a **multi-file complex design needs human review or sign-off**, or when **you explicitly ask for a Taco**. Exploratory chat and simple self-contained fixes stay in the conversation and repository, and document length alone never triggers a Taco;
- How to pack a folder of documents into a `.taco.html` and receive one-click Handoff via `taco-cli open <file.taco.html> --listen` (or `taco-cli listen`);
- How to apply your edits and comments back to the canonical source files and refresh the same Taco in place without losing threads or identity.

## Installation

Give your agent this prompt:

```text
Fetch https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md and follow it to install the Taco skill and taco-cli, creating the directories if needed. Then reply Installed taco. plus a short summary of how to make a Taco.
```

The agent follows `docs/agent-installation.md` to install both the `taco` skill (`npx skills@latest add arcadia822/taco --skill=taco` or directory copy fallback) and `taco-cli` (`@tacobin/cli` or standalone binary), creating directories if needed. The install prompt does not package the current conversation, alter project rules, or set project-wide defaults; if anything fails, the agent reports the real cause without inventing a bypass.

## What the agent does

### Generate and refresh

- Uses the skill's shell and writes your documents only into its data block (or runs `taco-cli pack` / `refresh`), never touching the application itself;
- Keeps the document identity (`docId`), comment threads, navigation, and Checkpoints on refresh, so you always reopen the same Taco;
- Excludes hidden files and other `.taco.html` files by default; HTML source files (`.html`) pack as read-only sandboxed pages without in-page editing or HTML text-selection comment anchors.

### Show it to you

After generating, the agent gives you a clickable link to the file and opens it in your browser when the host allows. It tells you truthfully whether it gave you a link, opened the file, or opened and verified it; it never presents a background check as something you have seen.

### Process your review

- Reads the local listener Handoff receipt, the clipboard Handoff text, or the `.taco.html` you saved;
- Maps every edit and comment to the source files;
- If a source file changed after packing, or a diff cannot be applied cleanly, it **reports the conflict and overwrites nothing**;
- Replies with what changed and **never resolves a comment thread on your behalf**, leaving confirmation to you.

### Follow project conventions

If the project has `.taco/` Checkpoint templates or existing process conventions such as `AGENTS.md` or Spec Kit, the agent follows them to decide which documents to write and whether to use Checkpoints; otherwise it does not forcibly enable Checkpoints. Small changes are not forced through a full staged process.

### Update notice

At the start of each working session, the skill compares its version with the latest release. If a newer one exists it mentions it in one line at the end of a reply; it never upgrades itself.

## Optional: Spec Kit integration

If you use [GitHub Spec Kit](https://github.com/github/spec-kit), you can additionally install the Taco extension. It refreshes each feature's Taco after specify, plan, tasks, and other steps, and provides `speckit.taco.review` to import review results, reporting conflicts instead of writing.

```bash
specify extension add taco --from https://github.com/Arcadia822/taco/releases/latest/download/taco-extension.zip
```

This is project-level wiring you request explicitly; you do not need it without Spec Kit.

## Limits

- Local review works offline; share links and online team review use [Tacobin](Tacobin.md).
- The reviewed folder stays the source of truth. A file missing from the Taco never causes the agent to delete it from the repository.
