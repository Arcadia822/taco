---
title: Quickstart
status: Complete
time: About 5 minutes
---

## 1. Ask your agent to install Taco

Send this to the agent you use (Claude Code, Codex, Cursor, and others):

```text
Fetch https://github.com/Arcadia822/taco/blob/main/docs/agent-installation.md and follow it to install the Taco skill and taco-cli, creating the directories if needed. Then reply Installed taco. plus a short summary of how to make a Taco.
```

The agent follows the guide to install both the `taco` skill and `taco-cli` (creating directories if needed), then replies `Installed taco.` with a summary of Taco's core capabilities and default scope: Taco is used proactively only when a multi-file complex design needs human review, or when you explicitly ask for one; exploratory chat and simple fixes are not packaged, and document length alone never triggers it. If installation fails, the agent reports the real cause.

## 2. Ask your agent for a plan, as a Taco

```text
Write a design for "export orders as CSV" (requirements, approach, API) in specs/order-export/, and give it to me for review as a Taco.
```

After writing the Markdown, the agent packs the folder into a `.taco.html` file and opens it in your browser (using `taco-cli open <file.taco.html> --listen` when listening locally).

## 3. Review in the browser

- Select a sentence, click **Comment**, and write specific feedback;
- Fix typos or wording directly in the text;
- You can also comment on a diagram node or a single line of a code block; embedded single-page `.html` files are read-only inside a sandbox, so comments about them go on the Markdown document that links to them.

## 4. Hand off to the agent

Click **Handoff** in the top-right corner. When the agent is listening locally, your unsaved edits and open comments are delivered directly; otherwise a diff of your edits and all open comments are copied to the clipboard to paste to your agent.

## 5. Check round two

After updating the source files, the agent refreshes the **same** Taco and opens it again. The comment threads stay open with the agent's replies — the agent never resolves threads on your behalf. Check each item, click **Resolve** when you are satisfied, or reply to keep the discussion going.

---

To see what each part does, read [Taco](../Features/Taco.md), [Taco Skill](../Features/Taco-Skill.md), and [Tacobin](../Features/Tacobin.md).

> You can also select text and comment, or edit the content, right here on this site. This is a standalone Taco: no online listener and no autosave — **Handoff** only copies the content to your clipboard, and you give it to your agent yourself. Edits live in your browser; reload the page and everything goes back to how it was.
