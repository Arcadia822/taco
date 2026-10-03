---
title: Review a plan locally
status: Complete
scenario: You and your own agent, no Tacobin needed
---

## When to use this

Your agent wrote a design and you want to review it carefully on your own computer, then send your feedback back for revision. All you need is the [Taco Skill](../Features/02-Taco-Skill.md) and a browser.

## 1. Ask the agent for a plan as a Taco

```text
Write a design for "export orders as CSV", covering requirements, technical approach, and API,
in specs/order-export/, and give it to me for review as a Taco.
```

The agent writes Markdown in `specs/order-export/` (perhaps with Mermaid flows and an OpenAPI file) and packs it into `specs/order-export/order-export.taco.html`.

## 2. Open the Taco

The agent gives you a clickable link to the file, opens it in your browser when the host allows, and tells you which of these actually happened:

- **Link provided**: open it yourself;
- **Opened**: it should already be visible in your browser;
- **Opened and verified**: the agent also checked that the page loaded correctly.

## 3. Review

### Give specific feedback

Select the text and click **Comment**. The more specific the comment, the more likely the agent gets it right the first time:

| Vague | Specific |
| --- | --- |
| This looks off | Exports over 100,000 rows should become an async job with an in-app notification when done, instead of blocking the request |
| Rethink the API | `GET /exports/{id}` must return `expiresAt` so the UI can warn before the download link expires |

### Edit directly

For typos, wording, and obvious small issues, edit the text yourself. It is faster than writing a comment.

### Comment on diagrams and code

You can comment on a single node in a flowchart or a single line in a code block. The agent will know exactly which node or line you mean.

## 4. Hand off

Click **Handoff** in the top-right corner. Taco copies this round's result to the clipboard; you do not need to save first. Paste it to your agent. It receives something like this:

```markdown
I have completed modifications and comments in the Taco review page. Please sync the following changes:
- Document title: "order-export"

## Changes
--- specs/order-export/spec.md
+++ specs/order-export/spec.md
@@ -12 +12 @@
-Export files are kept for 7 days.
+Export files are kept for 3 days.

## Comments
- [specs/order-export/plan.md:18] Quote: "The export is generated synchronously in the request"
  - **lin**: Over 100,000 rows this should become an async job with an in-app notification.
```

Alternatively, click **Save** to write the changes into the `.taco.html`, then tell the agent to read that file.

## 5. The agent processes it

The agent will:

1. Map every edit and comment to the source files in the repository;
2. Update the source files and explain, for each comment, whether it changed something, only explained, or needs your decision;
3. Refresh the **same** Taco and open it again.

If someone changed the source files after packing, or an edit cannot be applied cleanly, the agent reports the conflict and stops instead of silently overwriting.

## 6. Check round two

The reopened Taco keeps its identity and all its comment threads:

- Go back to each comment and check whether the quoted text was changed as requested;
- Click **Resolve** when you are satisfied;
- Reply in the thread if not, and start another handoff.

The agent never resolves comments for you; closing a discussion is always a human decision.

## Common questions

**What if I closed the browser without saving?**
You are warned before closing with unsaved changes. **Handoff** itself does not require saving: what it copies is the complete result of the round.

**What does a conflict report mean?**
You reviewed the content as it was when packed. If the source files changed afterwards, your feedback may no longer apply, so the agent shows you the specific conflict and diff and lets you decide.

**Complete or Lite?**
Use Complete for files you only view locally or send to people who may be offline; use Lite when you are online and care about file size. See [Taco](../Features/01-Taco.md).
