# Implementation Plan - Checkpoint Document Instruction

## Phase 1: Protocol & Data Model
- [ ] Update `packages/protocol/src/checkpoints.ts` to add `instruction?: string` to `CheckpointDocumentRef` and `ResolvedCheckpointDocument`.
- [ ] Update validation in `packages/protocol/src/checkpoints.ts` to validate `instruction` (must be string).
- [ ] Update `resolveCheckpoints` to pass `instruction` through to `ResolvedCheckpointDocument`.
- [ ] Add unit tests in `packages/protocol/test/checkpoints.test.ts`.

## Phase 2: UI & Right Panel
- [ ] Update `src/file-browser.ts`:
  - Extend `AuxiliaryTab` type to `'outline' | 'comments' | 'instruction'`.
  - Add `instructionTab` and `instructionPanel`.
  - Implement dynamic visibility check based on current selected document's checkpoint `instruction`.
  - Implement smooth fallback when switching between documents with/without instructions.
- [ ] Update `src/i18n.ts` for translations.
- [ ] Add styling in `src/styles.css` for `instruction-panel`.

## Phase 3: Verification
- [ ] Run vitest unit tests across protocol and core packages.
- [ ] Build Taco distribution and package verification document.
