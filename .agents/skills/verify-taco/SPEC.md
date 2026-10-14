---
title: 'verify-taco maintenance contract'
---

## Intent and scope

Give cold agents and CI an executable path to prove Taco's major workflows through real user actions, including the Agent's actual `taco-cli` commands. Class: workflow-process. Shape: script-backed-workflow. The standalone runner owns browser lifecycle/evidence; domain modules own behavior. The ad-hoc `scripts/cli.mjs` scenario executes the built `taco-cli` entry directly and reopens its artifacts in the browser. Existing toolbox/listener and real local Next/SQLite Host smokes cover full review round trips; Spec Kit installation remains in its existing CI matrix.

## Runtime and evidence contract

Build production HTML, generate synthetic fixtures by replacing only the document data block, launch immutable snapshots on owned ephemeral loopback ports and create fresh Chromium contexts per case. Run a read-only doctor, drive real entry points and retain screenshots/ARIA, actions, network, trace, downloaded/reopened state and result manifests. Close owned resources in finally on success, failure and timeout. Block external network; Mermaid may use an installed version-locked local mirror. Do not reuse an evidence directory or a live credential-bearing review.

## Trigger checks

Should trigger: “verify Taco's saved HTML”; “prove Markdown editing in the actual Taco app”; “capture a Taco comment regression with screenshots”; “test taco-cli pack/diff/extract”; “prove the Agent's local review round trip”. Should not trigger: “install Taco”; “publish a real review to Tacobin”; “review a diff without running the app”. Select the actual browser, local CLI, or local Host commands from the feature map; an unrelated browser pass does not prove a CLI operation.

## Maintenance and validation

Read `SOURCES.md` for provenance and `features/README.md` before choosing coverage. The registry lists the browser suite cases (51 across six domains); the two direct-command CLI cases run as the ad-hoc `scripts/cli.mjs` scenario on the same harness, and the fuller CLI/listener and Host round trips stay with the existing repo smokes. Register consumer-visible boundaries and transitions; reject duplicate IDs, missing run functions, zero selections and CI filtering. No retries, skips or source/document text tests. Maps use four H2 sections in the requested order and leading YAML titles. UI mutations require download/reopen proof; public getters are assertions only. CLI actions use the built executable with argument arrays, retain stdout/stderr/exit codes and assert real filesystem effects. No mocked command responses or separate `verify-cli` product.

Validate skill frontmatter with skill-writer's quick_validate.py. After lifecycle changes execute default arbitrary-bundle browsing and the complete suite, and exercise cleanup with a disposable throwing scenario. Run the existing file:// smoke, actual CLI toolbox/listener smoke and isolated real Host smoke before claiming their surfaces. Retain failure evidence and confirm cleanup outcomes. CI must execute scripts directly without Agent/model/API keys and upload evidence with `if: always()`.

## Limits

Headless proof is internal evidence, distinct from a clickable deliverable opened by the user. Native file/directory picker grants, OS browser transitions, live CDN delivery, production deployment and a model acting on Handoff need their own checks; list them as boundaries rather than passes. Lite offline fallback uses blocked CDN requests. A synthetic fixture supplies Checkpoint graph, instructions and a missing requirement because the default product bundle has none. Host uses fresh SQLite/CSRF and excludes production environment settings; it does not prove Postgres/Blob/Vercel deployment.

## CLI maintenance size budget

Size budget for the CLI-facing maintenance: the prepare estimate allowed +8,192–16,384 bytes for a CLI feature map, two direct-command scenarios and routing corrections. Delivered: `features/cli.md` plus `scripts/cli.mjs` carrying `cli/pack-extract` and `cli/review-diff-extract`, with routing corrections in this file, `SOURCES.md` and the feature map. The CLI module is 44,658 bytes; it exceeds the band because each case packs, inspects, reopens and extracts real artifacts. CI runs it after the CLI build and before the toolbox smoke. Listener round trips remain in `scripts/smoke-local-toolbox.mjs` and `scripts/smoke-host.mjs`. Complete shell, Lite shell, installed `skills/taco/`, product runtime and release package: +0 bytes each. New dependencies: 0. New production networking: 0; the CLI cases use synthetic local files and the owned browser server.

Baselines (same metric, UTF-8 bytes): TACO-81 pre-change `aaa4ea9` internal skill `.cursor/skills/verify-taco/` 51,377 across 12 files; mid-flight snapshot before CLI maintenance 280,952. The final directory measurement and the estimate/measured/deviation table live in [the TACO-81 design source](../../../specs/023-major-verification/spec.md). The final aggregate includes all six browser domains, shared lifecycle helpers, CLI maintenance and their feature maps; it is not an isolated CLI maintenance delta. Complete shell `skills/taco/taco-shell.html` remains 2,740,554 bytes, Lite shell 191,340 bytes and installed `skills/taco/` 19,652,706 bytes. The built `dist-single/Taco_Spec.taco.html` is 2,853,621 bytes including document data, which is excluded from shell-size comparisons.

CLI maintenance measurement: `scripts/cli.mjs` 44,658 bytes and `features/cli.md` 4,802 bytes, +49,460 bytes for these two new files alone versus the prepared +8,192–16,384-byte total budget (+33,076 above its upper bound). The two complete command/UI/filesystem scenarios and retained evidence account for the increase. Complete/Lite shells, installed skill, product runtime and dependencies remain +0.
