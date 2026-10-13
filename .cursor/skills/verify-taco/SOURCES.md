---
title: "verify-taco sources and decisions"
---

## Sources

| Source | Trust | Contribution |
| --- | --- | --- |
| `scripts/smoke-built-shell.mjs` | repo-owned, high | loopback/file smoke contract: bundle/API parity, splash detach, selected-row + reader selectors |
| `scripts/smoke-local-toolbox.mjs` | repo-owned, high | proven edit/comment/checkpoint/download/listener recipe and `showSaveFilePicker` fallback override |
| `.github/workflows/scripts/capture-preview.mjs` | repo-owned, high | readiness gate, isolated contexts, loopback serving for headless runs |
| `src/file-browser.ts`, `src/file-navigation.ts`, `src/comments-controller.ts`, `src/checkpoint-view.ts`, `src/source-editor.ts`, `src/new-file-dialog.ts` | repo-owned, high | stable selectors, entry points, status/comment/file-menu semantics |
| `package.json`, `CONTRIBUTING.md` | repo-owned, high | build/test/browser-install commands |
| `skills/taco/templates/spec/bundle.json` | repo-owned, high | valid Checkpoint graph fixture for checkpoint scenarios |
| Nowledge Mem 04e51f13-29a0-44b6-86d3-30367a3f1dea | owner memory, asserted | existing browser smoke gotchas (Playwright 1.64.0, validate() shape, rendered-block comparison) |
| `create-verification-skill` instructions and `skill-writer` references | upstream procedure, high | skill shape, four-H2 feature map, evidence/cleanup contract, description/validation requirements |

## Decisions

- Class `workflow-process`, shape `script-backed-workflow`: lifecycle plus loopback serving is fragile boilerplate and belongs in an executable helper; feature recipes stay data in the map. Simpler inline guidance rejected: cleanup/evidence semantics must be identical across cold agents.
- Primary surface is the built standalone Complete `.taco.html` browser product (README product boundary). CLI/extension/Host are secondary and explicitly out of this map's claim.
- Loopback HTTP is the sanctioned headless channel (Codex must not autonomously navigate `file://`). The helper owns the ephemeral port and blocks extra origins by default.
- Headless `showSaveFilePicker` disable is confined to the save scenario as an explicit production-boundary override; native directory-write verification is out of scope.
- Checkpoint coverage uses the repo's valid `templates/spec` graph because the default production bundle has none; scenarios must never mutate that seed.

## Gaps and changelog

- `2026-10-12` generated and executed: default browse scenario passed; edit+save/reopen scenario passes as the mapped second proof. Feature map entries for comments/checkpoints/source-editing/unpack/listener are grounded in source and shared prior art but were not all executed in this run — record per-entry proof when verifying those paths.
- Lite shell, `taco-cli` toolbox and Tacobin Host have separate surfaces and are not covered by this skill's claims.
