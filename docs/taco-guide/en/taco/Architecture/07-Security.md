---
title: Security
status: Complete
---

## Write only the data block

Agents may change only a Taco's data block and `<title>`. The shell's HTML, styles, and scripts are never touched, so every Taco runs the same reviewable application code.

## Path safety

- Every file path must sit under `root`;
- Absolute paths, `..`, backslashes, and anything pointing outside the folder are rejected;
- When importing review results, every changed path is checked by the same rules and rejected if it escapes.

## No HTML source files

Plain `.html` and `.htm` files cannot go into a Taco; packing fails explicitly instead of skipping them silently. This keeps executable pages out of document content. The `.taco.html` product container itself is not affected.

## Images

PNGs are embedded as validated binary data, up to 10 MiB each, and preserved byte for byte across review rounds.

## Nothing invented, nothing overreached

- Agents never invent comments, hashes, or verification results;
- They never resolve discussions on a person's behalf;
- On a change they cannot attribute, they stop and report instead of silently picking a side in a conflict.

## Collaboration credentials

A Taco with Tacobin online collaboration enabled may carry access credentials:

- Do not send its content to external models, services, logs, or tickets without permission;
- Viewing it locally is unrestricted;
- Revoking or resetting keys is an explicit user action.

## Preflight before publishing

`taco-cli publish --dry-run` runs locally and lists the files, content hash, and size to be published without sending any network request. Publish for real only after checking it.
