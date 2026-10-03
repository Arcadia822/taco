---
title: Quickstart
status: Complete
time: About 5 minutes
---

## 1. Ask your agent to install Taco

Send this to the agent you use (Claude Code, Codex, Cursor, and others):

```text
Read https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md and install Taco for me following its steps. When you are done, show me how to use Taco.
```

The agent installs the `taco` skill. That is the complete installation: no npm package, CLI, or build step, and it works fully offline afterwards.

You can also run it yourself:

```bash
npx skills@latest add arcadia822/taco --skill=taco
```

## 2. Ask your agent for a plan, as a Taco

```text
Write a design for "export orders as CSV" (requirements, approach, API) in specs/order-export/, and give it to me for review as a Taco.
```

After writing the Markdown, the agent packs the whole folder into `specs/order-export/order-export.taco.html` and opens it in your browser.

## 3. Review in the browser

- Select a sentence, click **Comment**, and write specific feedback;
- Fix typos or wording directly in the text;
- You can also comment on a diagram node or a single line of a code block.

## 4. Hand off to the agent

Click **Handoff** in the top-right corner. A diff of your edits and all open comments are copied to the clipboard. Paste them to your agent.

## 5. Check round two

After updating the source files, the agent refreshes the **same** Taco and opens it again. The comment threads are still there: go through them, click **Resolve** when you are satisfied, or reply to keep the discussion going.

---

To see what each part does, read [Taco](../Features/01-Taco.md), [Taco Skill](../Features/02-Taco-Skill.md), and [Tacobin](../Features/03-Tacobin.md).

> You can also select text and comment, or edit the content, right here on this site. Nothing is saved: reload the page and everything goes back to how it was.
