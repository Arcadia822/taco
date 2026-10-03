---
title: FAQ
status: Complete
---

## Why an HTML file?

Because everyone already has a browser. A `.taco.html` opens with a double-click, with no software to install, no account, and no server. It is still an ordinary file you can commit, email, and archive.

## Does it work offline?

The Complete edition is fully offline: every editor and rendering library is embedded in the file. The Lite edition loads its editors from a public CDN; if loading fails, Markdown can still be edited as source.

## How does it work with git?

The Markdown in your repository is authoritative: commit, diff, and review it as usual. The Taco file can be committed alongside the documents or generated only for review.

## Will it mess up my Markdown?

No. Taco never reformats your source while rendering, and anything you did not change does not appear in the handoff diff.

## How does the agent get my comments?

Two ways: click **Handoff** to copy your edits and comments for the agent, or save the file and let the agent read the data inside the `.taco.html`. With Tacobin, the agent fetches a handoff snapshot through `taco-cli`.

## Does it support real-time collaboration?

A local Taco does not. For online review with several people, use [Tacobin](../Features/03-Tacobin.md): multiple reviewers can edit and comment at the same time, with autosave.

## Which files are supported?

Markdown, Mermaid, JSON, YAML (with an OpenAPI overview), PNG/SVG images, and audio/video. Other text files are shown as source. For security, plain `.html` source files cannot be packed into a Taco.

## How big is a Taco?

The application part is about 2.7 MB for Complete and about 180 KB for Lite, plus your documents.

## Do I need Spec Kit or Checkpoints?

Neither. Both are optional; any Markdown folder can become a Taco.

## Is it open source?

Yes, under the MIT license, at [github.com/Arcadia822/taco](https://github.com/Arcadia822/taco). Taco's inspiration and core code come from [Bento](https://github.com/nyblnet/bento).
