# Implementation Plan: Workstation Branch Operations

## Overview

This plan adds five branch-level workflows to the coco workstation branches view: merge, reset-to-ref, force-push (via sub-choice from `P`), pull-with-strategy-choice (enhanced `U`), and sync (pull+push compound). Implementation follows the existing layering: git functions first, then undo stack types, then workflow registrations and key handling, and finally wiring the workflow handlers together.

## Tasks

- [x] 1. Add merge and reset git layer functions
  - [x] 1.1 Implement `mergeBranch` and `canFastForward` in `src/git/branchActions.ts`
    - Add `mergeBranch(git, branchName, fastForwardOnly?)` that calls `git.merge([branchName])` (or `--ff-only` when `fastForwardOnly` is true) and returns a `BranchActionResult`
    - Add `canFastForward(git, targetRef)` that uses `git.raw(['merge-base', 'HEAD', targetRef])` + `git.raw(['rev-parse', 'HEAD'])` to detect if current HEAD is an ancestor of targetRef
    - Follow the existing `runAction()` helper pattern for error handling
    - _Requirements: 1.1, 2.1, 2.2, 2.3_

  - [x] 1.2 Implement `resetCurrentBranchToRef` and `isResetBackward` in `src/git/branchActions.ts`
    - Add `resetCurrentBranchToRef(git, targetRef, mode: ResetMode)` that calls `git.reset([`--${mode}`, targetRef])` and returns a `BranchActionResult`
    - Add `isResetBackward(git, targetRef)` that checks if targetRef is an ancestor of HEAD (meaning HEAD has commits beyond targetRef that the reset would discard) using `git.raw(['merge-base', '--is-ancestor', targetRef, 'HEAD'])` — exit 0 means targetRef IS an ancestor of HEAD → reset goes backward; non-zero exit means it's not → reset goes forward or diverges
    - Import `ResetMode` from `src/git/historyActions.ts` (already exported there)
    - _Requirements: 3.1, 3.2, 4.2_

  - [x] 1.3 Write unit tests for new git layer functions in `src/git/branchActions.test.ts`
    - Test `mergeBranch` with mock SimpleGit for success, conflict, and ff-only cases
    - Test `canFastForward` for ahead, behind, and diverged scenarios
    - Test `resetCurrentBranchToRef` for soft/mixed/hard modes
    - Test `isResetBackward` for forward and backward reset cases
    - _Requirements: 1.1, 2.1, 2.2, 3.1, 3.2_

- [x] 2. Extend undo stack with merge and reset entry types
  - [x] 2.1 Add `merge-branch` and `reset-to-branch` variants to `UndoEntry` in `src/workstation/runtime/undoStack.ts`
    - Add `| { kind: 'merge-branch'; label: string; depth: number; workdir?: string; previousSha: string }` to the `UndoEntry` union
    - Add `| { kind: 'reset-to-branch'; label: string; depth: number; workdir?: string; previousSha: string; mode: ResetMode }` to the `UndoEntry` union
    - Extend `performUndo` switch to handle `merge-branch` (calls `restorePreviousHead(git, previousSha, 'hard')`) and `reset-to-branch` (calls `restorePreviousHead(git, previousSha, mode)`)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 2.2 Write unit tests for new undo entry types in `src/workstation/runtime/undoStack.test.ts`
    - Test push/pop of `merge-branch` and `reset-to-branch` entries
    - Test `performUndo` dispatches correctly for the new kinds
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 3. Register new keybindings in `src/workstation/runtime/inkKeymap.ts`
  - [x] 3.1 Add `M`, `Z`, and `S` key bindings for branches context
    - Add `{ keys: ['M'], contexts: ['branches'], label: 'merge', id: 'merge-into-current' }` to `LOG_INK_KEY_BINDINGS`
    - Add `{ keys: ['Z'], contexts: ['branches'], label: 'reset', id: 'reset-to-branch' }` to `LOG_INK_KEY_BINDINGS`
    - Add `{ keys: ['S'], contexts: ['branches'], label: 'sync', id: 'sync-branch' }` to `LOG_INK_KEY_BINDINGS`
    - Verify the existing `inkKeymap.collisions.test.ts` passes (no collisions with existing bindings)
    - _Requirements: 11.1, 11.2, 11.4, 11.6_

- [x] 4. Register new workflow actions in `src/workstation/runtime/inkWorkflows.ts`
  - [x] 4.1 Add `merge-into-current`, `reset-to-branch`, and `sync-branch` workflow registrations
    - Add workflow action objects to `getLogInkWorkflowActions()` with appropriate `id`, `key`, `label`, `description`, `kind`, `requiresConfirmation`, and `warning` fields
    - `merge-into-current`: kind `'destructive'`, requiresConfirmation `true`
    - `reset-to-branch`: kind `'destructive'`, requiresConfirmation `true`
    - `sync-branch`: kind `'normal'`, requiresConfirmation `false`
    - _Requirements: 12.1, 12.2, 12.4_

  - [x] 4.2 Write tests for new workflow registrations in `src/workstation/runtime/inkWorkflows.test.ts`
    - Verify the new workflows are returned by `getLogInkWorkflowActions()`
    - Verify their properties match the design (kind, confirmation requirements)
    - _Requirements: 12.1, 12.2, 12.4_

- [x] 5. Implement choice constants and input handling in `src/workstation/runtime/inkInput.ts`
  - [x] 5.1 Add choice prompt constants (`MERGE_CONFIRM`, `RESET_TO_BRANCH_MODE_CHOICE`, `PUSH_SUB_CHOICE`)
    - Define `RESET_TO_BRANCH_MODE_CHOICE` with soft/mixed/hard options following the existing `pendingChoice` pattern
    - Define `PUSH_SUB_CHOICE` with normal push / force push options
    - The merge flow uses `setPendingConfirmation` directly (no separate choice constant needed)
    - _Requirements: 3.1, 3.4, 10.1, 10.2, 10.3_

  - [x] 5.2 Add `M`, `Z`, `S` key handlers in the branches view action predicate block
    - `M`: guard cursored = current → error status; else → `setPendingConfirmation('merge-into-current')`
    - `Z`: guard cursored = current → error status; else → `setPendingChoice(RESET_TO_BRANCH_MODE_CHOICE)`
    - `S`: guard no upstream → error status; else → `runWorkflowAction('sync-branch')`
    - _Requirements: 1.2, 3.5, 6.6, 11.1, 11.2, 11.4_

  - [x] 5.3 Enhance `P` handler to show push sub-choice instead of direct push
    - Replace the existing direct-push behavior for `P` in branches view with `setPendingChoice(PUSH_SUB_CHOICE)`
    - The sub-choice routes `p` → `push-selected-branch` and `f` → force-push confirmation
    - Force-push option requires y-confirm with danger warning before execution
    - _Requirements: 4.3, 4.4, 10.3, 10.5, 11.3_

  - [x] 5.4 Write tests for new input handling in `src/workstation/runtime/inkInput.test.ts`
    - Test `M` guard (cursored = current → error)
    - Test `Z` guard (cursored = current → error)
    - Test `S` guard (no upstream → error)
    - Test `P` sub-choice dispatch
    - _Requirements: 1.2, 3.5, 6.6, 11.3_

- [x] 6. Checkpoint - Verify keybinding and registration layer
  - Ensure all tests pass (`npm run test:jest`), ask the user if questions arise.
  - Run `inkKeymap.collisions.test.ts` specifically to confirm no key conflicts.

- [x] 7. Implement merge workflow handler
  - [x] 7.1 Add `merge-into-current` handler in `src/workstation/runtime/hooks/useWorkflowAction.ts`
    - Before execution: call `canFastForward(git, cursoredRef)` to determine merge strategy
    - If FF available: call `mergeBranch(git, ref, true)` with ff-only
    - If diverged: call `mergeBranch(git, ref)` for standard merge
    - On success: push `merge-branch` undo entry with pre-merge HEAD, set momentum hint ("Fast-forwarded..." or "Merged...")
    - On conflict: detect via `isOperationConflictError` and route to conflicts view using existing `conflictRecoveryTitles` pattern
    - Add `'merge-into-current': 'Merge stopped on conflicts'` to `conflictRecoveryTitles`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 4.1, 7.1, 7.4, 8.1, 8.3, 9.1, 9.2, 9.3_

  - [x] 7.2 Write tests for merge workflow handler
    - Test FF detection and merge-commit creation paths
    - Test undo entry recording (pre-merge HEAD preserved)
    - Test conflict routing to conflicts view
    - Test self-merge guard prevents execution
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 7.1, 8.1_

- [x] 8. Implement reset-to-branch workflow handler
  - [x] 8.1 Add `reset-to-branch` handler in `src/workstation/runtime/hooks/useWorkflowAction.ts`
    - Accept the mode from the choice prompt payload (soft/mixed/hard)
    - Call `resetCurrentBranchToRef(git, cursoredRef, mode)`
    - On success: push `reset-to-branch` undo entry with pre-reset HEAD and mode
    - Call `isResetBackward(git, cursoredRef)` to determine momentum hint: if backward + has upstream → suggest force-push; otherwise → suggest view history
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.2, 8.2, 8.4, 9.1, 9.2, 9.3, 9.5_

  - [x] 8.2 Write tests for reset-to-branch workflow handler
    - Test soft/mixed/hard mode dispatch
    - Test undo entry recording (previousSha + mode preserved)
    - Test momentum hint selection based on `isResetBackward` result
    - _Requirements: 3.1, 3.2, 3.3, 4.2, 8.2_

- [x] 9. Implement sync workflow handler
  - [x] 9.1 Add `sync-branch` handler in `src/workstation/runtime/hooks/useWorkflowAction.ts`
    - Guard: check upstream exists, else set error status and return
    - Execute pull (ff-only first); if diverged → present strategy-choice (rebase/merge) using existing `isDivergedPullError` detection
    - If pull conflicts → abort sync, route to conflicts view with "Sync interrupted" message
    - If pull succeeded → execute push; on success → "Branch fully synchronized" momentum hint
    - If push fails → set error status with reason, leave pull result intact
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.2, 7.3, 7.4, 9.1, 9.2, 9.3, 9.5_

  - [x] 9.2 Write tests for sync workflow handler
    - Test successful pull+push compound
    - Test divergence triggers strategy choice
    - Test conflict aborts sync and routes to conflicts view
    - Test push failure preserves pull result
    - Test no-upstream guard
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 10. Checkpoint - Verify workflow handlers
  - Ensure all tests pass (`npm run test:jest`), ask the user if questions arise.

- [x] 11. Add footer hints and command palette entries
  - [x] 11.1 Add footer hints for branches view in `src/workstation/runtime/footer.ts`
    - Add `M merge`, `Z reset`, `S sync` to the branches view hint band
    - Respect existing priority ordering and narrow-terminal trimming rules
    - _Requirements: 13.1, 13.4_

  - [x] 11.2 Ensure command palette discoverability
    - Verify `merge-into-current`, `reset-to-branch`, and `sync-branch` appear in the command palette (`:`) when in branches view — they should already appear from the workflow registrations in task 4.1
    - Add `force-push-selected-branch` to command palette if not already registered
    - Add `pull-rebase-current` and `pull-merge-current` entries if not already registered
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 11.3 Write tests for footer hints
    - Verify new hints appear in branches view footer output
    - Verify trimming behavior respects 80x24 floor
    - _Requirements: 13.1, 13.4_

- [x] 12. Final checkpoint - Full validation
  - Run `npm run lint` — zero new problems
  - Run `npx tsc --noEmit` — no type errors
  - Run `npm run test:jest` — all tests pass
  - Verify `inkKeymap.collisions.test.ts` passes
  - Verify `inkKeymap.footerHonesty.test.ts` passes (footer hints match registered bindings)
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The design explicitly states PBT is not appropriate for this feature (git wrappers + UI workflow orchestration); testing uses example-based unit tests and scenario-based integration tests
- The existing `branchActions.ts` already has `forcePushCurrentBranch`, `forcePushBranch`, `pullCurrentBranch`, `pullCurrentBranchRebase`, `pullCurrentBranchMerge`, `pushCurrentBranch`, and error detection helpers (`isNonFastForwardPushError`, `isDivergedPullError`, `isOperationConflictError`) — the new functions build on these patterns
- The existing `undoStack.ts` already imports from `branchActions` and `historyActions` — extending it with two new entry kinds is straightforward
- Checkpoints ensure incremental validation at the integration boundaries (registration layer, then workflow handlers, then full validation)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["4.2", "5.1"] },
    { "id": 5, "tasks": ["5.2", "5.3"] },
    { "id": 6, "tasks": ["5.4"] },
    { "id": 7, "tasks": ["7.1", "8.1", "9.1"] },
    { "id": 8, "tasks": ["7.2", "8.2", "9.2"] },
    { "id": 9, "tasks": ["11.1", "11.2"] },
    { "id": 10, "tasks": ["11.3"] }
  ]
}
```
