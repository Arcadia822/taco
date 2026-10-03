---
title: Tacobin
status: Complete
summary: Share links and an online review relay, used with taco-cli
---

## What it is

A local Taco suits one person working with their own agent. When reviewers are not at your computer, such as colleagues, product managers, or external partners, use Tacobin:

- The agent publishes the Taco to Tacobin and gets a **share link**;
- Reviewers open the link and edit and comment in the browser, with **autosave**;
- A reviewer clicks **Handoff**, the listening agent is notified immediately, and it fetches the complete result of the round.

`taco-cli` is the command-line tool that connects the agent side to Tacobin. People do not need it, and local review does not use it.

## What reviewers see

- The same reading, editing, and commenting interface as a local Taco;
- A name prompt on their first comment (self-reported, no sign-up);
- Changes autosave in real time. A failed save can be retried; on a conflict your draft is kept, and the latest version loads only after you confirm discarding it;
- Stacked avatars in the header show which people and agents are online; click them for the full listener list;
- **Save** still works for keeping a local copy of the Taco.

## The one rule that matters: Handoff is explicit

**Comments and autosave are not a handoff, and they do not wake the agent.** Only when a reviewer finishes the round and clicks **Handoff** does Tacobin record a `review.handed_off` event, and only then does the agent start working.

- If no agent is listening when Handoff is clicked, Tacobin records no handoff and instead shows commands to install the skill, install the CLI, and start subscribing;
- An online avatar only means the agent is listening, not that your feedback has been read or handled.

## taco-cli

Install:

```bash
npm install -g @tacobin/cli
```

Commands the agent uses:

| Command | What it does |
| --- | --- |
| `taco-cli publish <file.taco.html> --host <origin> --dry-run` | Local preflight: lists the files and size to be published, sends no request |
| `taco-cli publish <file.taco.html> --host <origin>` | Publishes and returns the reviewer `url` and the `tacoId` used afterwards |
| `taco-cli subscribe <tacoId> --host <origin>` | Waits for Handoff: ignores ordinary comments and edits, exits after `review.handed_off` |
| `taco-cli subscribe <tacoId> --stream` | Receives every event continuously |
| `taco-cli handoff <tacoId> <handoffId> --host <origin>` | Reads the immutable snapshot of that handoff |
| `taco-cli events <tacoId> --after <sequence>` | Catches up after a disconnect; handoffs made while nobody listened are still retrievable |

Each publication fixes an immutable baseline; a corrected file must be published again as a new Taco. See [Online review](../Guides/02-Online-Review.md) for the full flow.

## Security

- Check what will become public with `--dry-run` before publishing;
- Anonymous publishing issues an access credential automatically; the agent stores it safely before uploading content;
- A Taco with online collaboration enabled may carry access credentials. Do not forward it to other services, logs, or tickets without permission.

## Limits

- Tacobin is not the source of truth. Files in the repository remain authoritative; Tacobin only hosts this review round;
- Publishing does not modify your local files;
- Overwriting a published version online, private hosting, and account sign-in are not supported yet.
