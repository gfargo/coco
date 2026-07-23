# Implementation Plan: AI-Assisted Merge Conflict Resolution — CLI Extension

## Overview

Extend the existing TUI-only AI conflict resolution (#1369) into standalone CLI commands
(`coco resolve status/explain` + `coco resolve [--apply|--dry-run]`) with a dedicated
dynamic-model task, confidence metadata, and per-region chunking. Each task is one focused PR
off `main`, running the full validation suite (`lint` + `tsc --noEmit` + `test:jest` + `build`).

## Tasks

- [ ] 1. Add `conflictResolve` dynamic-model task
  - [ ] 1.1 Add `'conflictResolve'` to the `DynamicModelTask` type union in `src/lib/langchain/types.ts` (line ~4, after `'largeDiff'`)
  - [ ] 1.2 Add fallback chain in `src/lib/langchain/utils/dynamicModels.ts`: when `conflictResolve` has no explicit override, resolve to the `review` task's model. Also add `'conflictResolve'` to the `DYNAMIC_MODEL_TASKS` array (~line 240) and add default model entries in each provider's `ProviderDynamicDefaults` table (use the same model as `review`)
  - [ ] 1.3 Update `src/lib/langchain/types.ts` `DynamicModelProfile` will auto-include the new key (it's `Partial<Record<DynamicModelTask, ...>>`) — no separate change needed, but verify the schema generator picks it up
  - [ ] 1.4 Update `runConflictResolutionWorkflow` in `src/git/conflictAiActions.ts` (~line 126) to use `resolveDynamicService(config, 'conflictResolve')` instead of the current `resolveDynamicService(config, 'commit')`
  - [ ] 1.5 Write a unit test asserting `resolveDynamicService(config, 'conflictResolve')` resolves through the fallback chain
  - [ ] 1.6 Run `npm run build:schema` and commit the regenerated `schema.json`
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 2. Add confidence field to the existing resolve workflow
  - [ ] 2.1 Extend `ProposalsSchema` in `src/git/conflictAiActions.ts` (~line 58) to include `confidence: z.enum(['high', 'medium', 'low'])`
  - [ ] 2.2 Add `confidence: 'high' | 'medium' | 'low'` to the `ConflictResolutionProposal` type (~line 39)
  - [ ] 2.3 Update `CONFLICT_PROMPT_TEMPLATE` (~line 69) to instruct the model to return a confidence field with clear criteria for each level
  - [ ] 2.4 Add `confidence?: 'high' | 'medium' | 'low'` to `LogInkConflictProposal` in `src/workstation/runtime/conflictResolutionState.ts` (~line 19, additive)
  - [ ] 2.5 In `src/workstation/runtime/hooks/useConflictResolutionActions.ts` (~line 108), where proposals are mapped from `result.proposals` into `LogInkConflictProposal[]`, add `confidence: proposal.confidence`
  - [ ] 2.6 Write unit tests asserting the schema accepts/rejects confidence values and proposals carry it through
  - _Requirements: 5.1, 5.2_

- [ ] 3. Add conflict-marker validation to `applyConflictResolution`
  - [ ] 3.1 In `src/git/conflictRegionActions.ts`, before writing the replacement, check that it contains no conflict markers (`CONFLICT_OURS_MARKER`, `CONFLICT_THEIRS_MARKER`, `CONFLICT_SEPARATOR_MARKER`)
  - [ ] 3.2 If markers are detected, return `{ ok: false, message: 'Proposed resolution contains conflict markers — skipped.' }`
  - [ ] 3.3 Write a unit test with a resolution that embeds `<<<<<<<` and assert it's rejected
  - _Requirements: 8.6_

- [ ] 4. Implement per-region chunking in `runConflictResolutionWorkflow`
  - [ ] 4.1 Add a `tokenBudget?: number` parameter to `runConflictResolutionWorkflow` input
  - [ ] 4.2 Implement `estimateRegionTokens(regions, tokenizer)` helper that sums the ours+theirs+base line counts × ~1.3 token/word estimate (or uses the real tokenizer if available)
  - [ ] 4.3 When total exceeds budget, greedily partition regions into batches that fit
  - [ ] 4.4 Make one LLM call per batch, with a note in the prompt: "Regions {first}–{last} of {total} in this file"
  - [ ] 4.5 Reassemble proposals from all batches in region-index order
  - [ ] 4.6 When a single region alone exceeds budget, skip it: return a synthetic proposal with `confidence: 'low'` and rationale "Region too large for model context"
  - [ ] 4.7 Write unit tests: multi-batch reassembly, single-oversized-region skip, single-batch passthrough (no chunking needed)
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 5. Add the explain workflow (`runConflictExplanationWorkflow`)
  - [ ] 5.1 Create the explain prompt template in `src/commands/resolve/prompt.ts` — per-region explanation without resolution text (CLI-only for now; a TUI "explain mode" panel is a future enhancement)
  - [ ] 5.2 Define `ConflictExplanation` and `ConflictExplanationResult` types in `src/git/conflictAiActions.ts`
  - [ ] 5.3 Define the zod schema: array of `{ region, oursIntent, theirsIntent, conflictNature }`
  - [ ] 5.4 Implement `runConflictExplanationWorkflow({ path, regions, operation, signal })` in `src/git/conflictAiActions.ts` following the same pattern as `runConflictResolutionWorkflow`
  - [ ] 5.5 Reuse the chunking logic from task 4 (extract shared `chunkRegions` helper if needed)
  - [ ] 5.6 Write unit tests: explanation generation, empty-regions early return, cancellation
  - _Requirements: 2.1, 2.2, 2.7_

- [ ] 6. Scaffold `coco resolve` command structure
  - [ ] 6.1 Create `src/commands/resolve/config.ts` — yargs command definition with positional subcommand (`status` | `explain` | default resolve), shared flags (`--file`, `--json`), and resolve-specific flags (`--apply`, `--dry-run`, `--confidence`)
  - [ ] 6.2 Create `src/commands/resolve/index.ts` — re-export for mounting in `src/index.ts`
  - [ ] 6.3 Mount the command in `src/index.ts` alongside existing commands
  - [ ] 6.4 Create `src/commands/resolve/handler.ts` — dispatcher that routes to status/explain/resolve based on subcommand arg
  - [ ] 6.5 Verify `coco resolve --help` renders correctly with `npm run coco -- resolve --help`
  - _Requirements: 1–4 (structural prerequisite)_

- [ ] 7. Implement `coco resolve status`
  - [ ] 7.1 Create `src/commands/resolve/statusHandler.ts`
  - [ ] 7.2 Call `getInProgressOperationType(git)` and `getConflictedFiles(git)`
  - [ ] 7.3 Print operation type, file count, and per-file path + status code to stdout
  - [ ] 7.4 Support `--json` output: `{ operation, conflictedFiles: [...], count }`
  - [ ] 7.5 Exit 1 when conflicts present, 0 otherwise
  - [ ] 7.6 Write unit tests: no-operation path, conflicts-present path, JSON output shape
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 8. Implement `coco resolve explain`
  - [ ] 8.1 Create `src/commands/resolve/explainHandler.ts`
  - [ ] 8.2 Resolve model via `resolveDynamicService(config, 'conflictResolve')`
  - [ ] 8.3 For each conflicted file (or `--file` target): parse regions, call `runConflictExplanationWorkflow`
  - [ ] 8.4 Render explanations to stdout: file path, line range, ours intent, theirs intent, conflict nature
  - [ ] 8.5 Support `--json`: array of explanation objects
  - [ ] 8.6 Handle no-conflicts case: print "No conflicts to explain", exit 0
  - [ ] 8.7 Handle `--file` pointing to a non-conflicted file: error + exit 1
  - [ ] 8.8 Write unit tests: mocked LLM responses, `--file` scoping, empty-state, JSON shape
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [ ] 9. Implement `coco resolve` (interactive mode)
  - [ ] 9.1 Create `src/commands/resolve/resolveHandler.ts`
  - [ ] 9.2 Resolve model via `resolveDynamicService(config, 'conflictResolve')`
  - [ ] 9.3 For each file: parse regions, call `runConflictResolutionWorkflow` (with chunking)
  - [ ] 9.4 Implement the interactive per-proposal loop using `@inquirer/prompts` (select: accept/edit/skip/quit)
  - [ ] 9.5 On accept: validate no conflict markers, then `applyConflictResolution`
  - [ ] 9.6 On edit: write proposal to a temp file, spawn `$EDITOR`, read back, validate, apply
  - [ ] 9.7 On skip: continue to next proposal
  - [ ] 9.8 On quit: break out of all loops
  - [ ] 9.9 After all proposals for a file: if file is marker-free, `git add` via `stageConflictResolved`
  - [ ] 9.10 Print summary: files processed, regions resolved, regions skipped
  - [ ] 9.11 Exit 0 if all resolved, exit 1 if any remain
  - [ ] 9.12 Write unit tests: mocked workflow + inquirer, accept/skip/quit paths, staging logic
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 10. Implement `--dry-run` mode for resolve
  - [ ] 10.1 When `--dry-run` is passed, run the LLM workflow but skip the interactive loop and all applies
  - [ ] 10.2 Print each proposal: file, region lines, ours/theirs preview, proposed text, confidence, rationale
  - [ ] 10.3 Support `--json`: emit full proposal array
  - [ ] 10.4 Write unit test asserting no `applyConflictResolution` calls occur in dry-run
  - _Requirements: 3.8, 3.9_

- [ ] 11. Implement `--apply` mode for resolve
  - [ ] 11.1 When `--apply` is passed, skip interactive prompts; apply proposals that meet confidence threshold
  - [ ] 11.2 Parse `--confidence` flag (default: `medium` — skips `low` only)
  - [ ] 11.3 For proposals below threshold: skip with message "confidence too low"
  - [ ] 11.4 Continue on per-region apply failures (report, don't abort)
  - [ ] 11.5 Stage files that are fully resolved after all applies
  - [ ] 11.6 Print summary: resolved count, skipped count (with reasons), failed count
  - [ ] 11.7 Support `--json` summary output
  - [ ] 11.8 Exit 0 if all resolved, exit 1 if any remain
  - [ ] 11.9 Write unit tests: threshold gating (high/medium/low), partial apply, staging, exit codes
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.3_

- [ ] 12. Integration test with temp-git conflict fixture
  - [ ] 12.1 Create a temp-git helper that produces a deterministic merge conflict (two branches editing the same line of the same file)
  - [ ] 12.2 Gate integration tests behind `COCO_RESOLVE_IT` environment variable (self-skip without it, following the `COCO_GITLAB_IT` pattern)
  - [ ] 12.3 Write integration test for `statusHandler`: asserts real `getConflictedFiles` output against the fixture
  - [ ] 12.4 Write integration test for `resolveHandler --dry-run` with mocked LLM: asserts proposals are generated from real parsed regions without modifying files
  - [ ] 12.5 Write integration test for `resolveHandler --apply` with mocked LLM: asserts file is rewritten and staged after apply
  - _Requirements: 8.1, 8.2 (verified against real git state)_

- [ ] 13. TUI cosmetic: display confidence badge in proposal panel
  - [ ] 13.1 In `src/workstation/surfaces/conflicts/index.ts` `renderProposalPanel`, append a confidence badge (`[H]`/`[M]`/`[L]`) to the region status strip
  - [ ] 13.2 Color-code: green for high, yellow for medium, red for low (theme-aware, falls back to dim)
  - [ ] 13.3 Update the render-snapshot test to capture the badge
  - _Requirements: 5.2 (TUI display of confidence)_

- [ ] 14. Documentation and schema
  - [ ] 14.1 Run `npm run build` (regenerates `schema.json` with `conflictResolve` task + any config additions)
  - [ ] 14.2 Verify `schema.json` has no drift (`git diff schema.json` is clean after build)
  - [ ] 14.3 Add `resolve` to the command list in `src/index.ts`'s help text / command grouping
  - _Requirements: 6.4 (schema), all (docs)_

- [ ] 15. Final validation
  - [ ] 15.1 Run `npm run lint` — 0 new errors
  - [ ] 15.2 Run `npx tsc --noEmit` — clean
  - [ ] 15.3 Run `npm run test:jest` — all pass, no snapshot diffs (except the new confidence badge)
  - [ ] 15.4 Run `npm run build` — succeeds, schema committed
  - [ ] 15.5 Manual smoke: create a merge conflict in a test repo, run each subcommand, verify output

## Notes

- Tasks 1–4 modify the shared `src/git/` data layer and are prerequisites for the command-layer work (5–11). They can be one combined PR or split for review ease.
- Tasks 6–11 are the command layer and can be developed incrementally (status first, then explain, then resolve).
- Task 12 (integration tests) is gated by `COCO_RESOLVE_IT` env var — self-skips without it, mirroring the GitLab integration test pattern.
- Task 13 (TUI cosmetic) is independent and can land anytime after task 2.
- The `$EDITOR` spawning in task 9.6 follows the exact pattern already shipped in `useConflictResolutionActions.ts` (`editConflictProposal`) — extract the spawn logic into a shared helper in `src/lib/utils/` if the duplication bothers.
- Per-region chunking (task 4) is the most algorithmically complex piece; get it right with good test coverage before the command layer consumes it.
- The `explain` workflow (task 5/8) is CLI-only for now. A future TUI enhancement could add an "explain mode" to the conflicts surface (e.g. an `E` key that shows intent summaries for the cursored region in the proposal panel area), but that's a separate spec.
- Missing API key = hard fail (same as `coco review` / `coco commit`). No graceful degradation for LLM-requiring subcommands.
