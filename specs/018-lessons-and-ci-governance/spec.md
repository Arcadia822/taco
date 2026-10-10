---
title: '018-lessons-and-ci-governance'
feature_id: '018-lessons-and-ci-governance'
created: '2026-10-10'
status: 'Review'
issue: 'https://github.com/Arcadia822/taco/issues/121'
linear: 'https://linear.app/castrel/issue/TACO-66'
input: |-
  TACO-66: 建立 Agent 踩坑经验复盘清单 (LESSONS.md) 与 CI 规则闭环
---

# Feature Specification: Lessons Learned & CI Governance (TACO-66)

## 1. Background & Problem

During extensive human-agent collaboration across Taco features, recurring pitfalls and regressions have emerged (e.g. local dependency drift polluting test environments, cross-surface version desynchronization, unhandled markdown mark combinations, headless DOM crashes).

Previously, governance instructions lived dispersed in `AGENTS.md` and ad-hoc chat sessions. Without structural enforcement, lessons decay over time, leading to repetitive engineering friction and regression.

## 2. Goals & Non-Goals

### 2.1 Goals

1. Establish a single authoritative register `LESSONS.md` in the repository root tracking failure modes, root causes, evidence, and guard mechanisms.
2. Formulate an unambiguous **Escalation Protocol**: any failure mode triggered $\ge 3$ times (`Occurrences >= 3`) MUST be escalated to a structural mechanism (CI gate, type constraint, pre-commit hook, or binding AGENTS rule).
3. Introduce an automated validation script `scripts/check-lessons.mjs` wired into `npm run check` and CI to verify:
   - Header and section structural integrity.
   - Strict metadata formatting and horizontal whitespace.
   - Code-fence isolation respecting fence delimiter and length ($`\ge 3`$).
   - Escalation Index vs Lessons Register parity ($1:1$ ID match, occurrence match, status match).
   - Occurrences count auditable parity against `#### Evidence` bullet items.
   - Verified existence of all backticked repository paths in `Guard`.
4. Provide comprehensive regression tests (`tests/check-lessons.test.ts`) guaranteeing validator accuracy under valid and mutated inputs without mutating repository `LESSONS.md`.
5. Maintain zero added runtime/network dependencies and zero byte growth on shipped shells/skills.

### 2.2 Non-Goals

- No changes to product frontend, editor runtime, or host contracts.
- No modifications to published skills or extension assets (`skills/taco/` shell byte delta: 0).
- No new external npm packages or network-based verification steps.

## 3. Structural Design & Architecture

### 3.1 Metadata & Register Schema

Every lesson in `LESSONS.md` adheres to the following specification:

```markdown
### LESSON-NNN: Title

- **ID**: `LESSON-NNN`
- **Category**: `<category>`
- **Occurrences**: <whole integer>
- **Status**: `open` | `escalated` | `archived`
- **Guard**: <backticked repo paths / mechanisms>

#### Symptom

<description of failure manifestation>

#### Root Cause

<underlying technical cause>

#### Evidence

- <date> — <reference>: <description>

#### Prevention & Escalation

- <concrete prevention rules and guards>
```

### 3.2 Escalation Protocol

- `Occurrences < 3`: `Status` is `open` (or `archived`). Guard may optionally be present early.
- `Occurrences >= 3`: `Status` must be `escalated`. Validator halts with exit code 1 if un-escalated.
- Auditing: Declared `Occurrences` must equal the number of items in `#### Evidence`.

## 4. Size & Dependency Impact Measurement

| Metric                                                   | Target / Budget | Measured Actual | Status |
| :------------------------------------------------------- | :-------------: | :-------------: | :----: |
| Added npm dependencies                                   |        0        |        0        |  PASS  |
| Added network requests                                   |        0        |        0        |  PASS  |
| `skills/taco/SKILL.md` byte delta                        |     0 bytes     |     0 bytes     |  PASS  |
| `skills/taco/taco-shell.html` byte delta                 |     0 bytes     |     0 bytes     |  PASS  |
| `skills/taco/taco-shell-lite.html` byte delta            |     0 bytes     |     0 bytes     |  PASS  |
| `extensions/taco/assets/taco-shell.html` byte delta      |     0 bytes     |     0 bytes     |  PASS  |
| `extensions/taco/assets/taco-shell-lite.html` byte delta |     0 bytes     |     0 bytes     |  PASS  |

## 5. Verification & Testing

- `node scripts/check-lessons.mjs`: Verified exit code 0 on clean repository `LESSONS.md`.
- `npx vitest run tests/check-lessons.test.ts`: 11/11 tests pass validating mutation rejection, fence delimiter/length/trailing-text handling, occurrences-evidence parity, index guard validation, and index synchronization.
