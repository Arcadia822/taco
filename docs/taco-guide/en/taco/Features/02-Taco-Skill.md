---
title: Taco Skill
status: Complete
summary: Teaches your agent to write, refresh, and read reviews
---

## What it is

The Taco Skill is an agent skill package (`skills/taco/`). Once installed, your agent knows how to:

- Pack a folder of documents into a Taco;
- Refresh the same Taco without losing comments;
- Read your edits and comments and apply them to the source files in the repository.

**Installing the skill is the complete installation.** It ships the production shell, reference docs, and scripts. No npm package, CLI, or build is required, and it works offline.

## Installation

Give your agent this prompt:

```text
Read https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md and install Taco for me following its steps. When you are done, show me how to use Taco.
```

Or run it yourself:

```bash
npx skills@latest add arcadia822/taco --skill=taco
```

If `npx skills` is unavailable, copying the `skills/taco/` folder into your agent's skills folder also works.

## What the agent does

### Generate and refresh

- Copies the skill's shell and writes your documents only into its data block, never touching the application itself;
- Keeps the document identity (`docId`), comment threads, navigation, and Checkpoints on refresh, so you always reopen the same Taco;
- Excludes hidden files and other `.taco.html` files by default, and rejects plain HTML source files.

### Show it to you

After generating, the agent gives you a clickable link to the file and opens it in your browser when the host allows. It tells you truthfully whether it gave you a link, opened the file, or opened and verified it; it never presents a background check as something you have seen.

### Process your review

- Reads the Handoff text or the `.taco.html` you saved;
- Maps every edit and comment to the source files;
- If a source file changed after packing, or a diff cannot be applied cleanly, it **reports the conflict and overwrites nothing**;
- Never invents comments and never resolves a discussion on your behalf.

### Follow project conventions

If the project has `.taco/` Checkpoint templates or existing process conventions such as `AGENTS.md` or Spec Kit, the agent follows them to decide which documents to write and whether to use Checkpoints. Small changes are not forced through a full staged process.

### Update notice

At the start of each working session, the skill compares its version with the latest release. If a newer one exists it mentions it in one line at the end of a reply; it never upgrades itself.

## Optional: Spec Kit integration

If you use [GitHub Spec Kit](https://github.com/github/spec-kit), you can additionally install the Taco extension. It refreshes each feature's Taco after specify, plan, tasks, and other steps, and provides `speckit.taco.review` to import review results, reporting conflicts instead of writing.

```bash
specify extension add taco --from https://github.com/Arcadia822/taco/releases/latest/download/taco-extension.zip
```

This is project-level wiring you request explicitly; you do not need it without Spec Kit.

## Limits

- The skill handles local files only; share links and online review need [Tacobin](03-Tacobin.md).
- The reviewed folder stays the source of truth. A file missing from the Taco never causes the agent to delete it from the repository.
