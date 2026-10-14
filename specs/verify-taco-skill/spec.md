---
title: 'Taco project-local verification skill'
status: planned
---

## Goal and implementation

Create the project-local verification skill for agents proving the built standalone Taco browser surface; its current canonical location is `.agents/skills/verify-taco/` (migrated by TACO-81). Reuse the pinned Playwright dev dependency and current production build. Serve a fresh copy of the built Complete HTML on an ephemeral loopback port; create an isolated browser context. Seed five feature recipes from real UI handles. Prove one recipe through user actions, capture screenshots, accessibility snapshots, trace and observed state, then close only resources created by that run. Evidence lives under gitignored `artifacts/verify-taco/` and survives cleanup. TACO-81 extends this original design with deterministic full-suite and separate CLI/Host coverage.

## Size and dependency budget — prepare

Estimate: new project-local skill, feature map, maintenance notes and executable helper add 24,000–36,000 bytes. Installed `skills/taco/`: +0 bytes. Complete shell: +0 bytes; Lite shell: +0 bytes; built `.taco.html` runtime/data: +0 bytes; release package: +0 bytes. No dependency additions. Verification serves local HTTP only and blocks remote browser requests; existing build/install commands retain their documented behavior.

Captured pre-change byte baselines: Complete `skills/taco/taco-shell.html` = 2,740,554; Lite `skills/taco/taco-shell-lite.html` = 191,340; `skills/taco/` regular-file total = 19,649,749; `dist-single/Taco_Spec.taco.html` = 2,848,302. These are observed checkout baselines, not the older dated values in contributor guidance.

## Acceptance

The skill registers through leading YAML `name` and `description`; includes Launch, Doctor, Drive, Evidence, Cleanup and Helpers; ships a feature index and five mapped features with the four requested H2 sections. Its own end-to-end run passes on built HTML, checks action and resulting user-visible state, verifies a downloaded Taco by reopening it, and confirms evidence survives cleanup. Helper failure paths close the owned server and browser.

## Size and dependency budget — develop

Measured: project-local skill totals 51,377 bytes across 12 files, plus this spec. Estimate was 24,000–36,000 bytes; the skill exceeds the upper estimate by 15,377 bytes (42.7%) because the feature maps and proof-bearing scenarios carry exact selectors and review corrections. Installed `skills/taco/` remains 19,649,749 bytes (+0). Complete shell `skills/taco/taco-shell.html` = 2,740,554 bytes and Lite `skills/taco/taco-shell-lite.html` = 191,340 bytes, identical to the captured baselines (0 bytes / 0%, no threshold crossed). Built `dist-single/Taco_Spec.taco.html` = 2,853,111 bytes, +4,809 bytes from the captured baseline, attributable to bundled document data; pure shells remain unchanged. Release package: +0 bytes. No dependency additions (Playwright 1.64.0 already pinned). Current verification passed repository check (67 test files, 788 tests and build), built-shell smoke, default browsing and edit/download/reopen; an intentionally throwing scenario exited 1 and closed trace/context/browser/server/port. Evidence remains under gitignored `artifacts/verify-taco/`; evidence bytes are not product bytes.

TACO-81 update (2026-10-14): the internal skill now lives at `.agents/skills/verify-taco/`; its estimate, final measured UTF-8 directory bytes and deviation from the preserved `.cursor/skills/verify-taco/` baseline (51,377 bytes / 12 files at `aaa4ea9`) are recorded in [Spec 023](../023-major-verification/spec.md). Installed `skills/taco/` remains 19,652,706 bytes across 45 regular files; Complete shell remains 2,740,554 bytes and Lite shell 191,340 bytes (all +0 bytes / 0%). The 2,853,621-byte built `dist-single/Taco_Spec.taco.html` includes document data and is excluded from shell-size comparisons. Coverage is 51 browser cases across six domains, 9 Host cases and 2 direct-command CLI cases. This round adds verification capability only; installed skill bytes and public website content are unchanged, so neither requires a content update.
