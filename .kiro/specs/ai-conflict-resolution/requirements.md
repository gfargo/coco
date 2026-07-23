# Requirements: AI-Assisted Merge Conflict Resolution — CLI Extension

## Introduction

The TUI-based AI conflict resolution workflow (#1369) shipped in 0.78: the `M` key on the
conflicts surface parses conflict markers, asks the model for per-region proposals, and presents
them in a review panel (y accept / e edit / n reject / Y accept-all). The data layer
(`conflictRegionActions.ts`, `conflictAiActions.ts`) and the runtime integration
(`useConflictResolutionActions.ts`) are production-proven.

This spec extends that foundation into **standalone CLI commands** so conflict resolution can be
used outside the TUI — in scripts, CI, editor integrations, and simple terminal workflows where
launching the full workstation is overkill:

```bash
coco resolve status          # report conflicted files + operation type
coco resolve explain         # explain each conflict without writing files
coco resolve                 # propose + interactively apply resolutions
coco resolve --apply         # auto-apply all proposals (for scripting)
```

It also introduces a dedicated **dynamic-model task** (`conflictResolve`) so the conflict
workflow can route to a higher-context model independently of commit-message generation, and
adds **confidence metadata** per proposal so the user (and `--apply` mode) can make informed
accept/skip decisions.

## Glossary

- **ConflictRegion**: The structured representation of one `<<<<<<<`…`>>>>>>>` marker block,
  already defined in `src/git/conflictRegionActions.ts`.
- **Proposal**: A per-region resolution with replacement text, rationale, and confidence, already
  defined in `src/git/conflictAiActions.ts` (extended with `confidence` in this spec).
- **Operation**: The in-progress git state — merge, rebase, cherry-pick, or revert — detected via
  `getInProgressOperationType()`.
- **Dynamic-model task**: A named slot in coco's per-task model routing (`resolveDynamicService`).
  Adding `conflictResolve` lets users pin a high-context model for this workflow independently.
- **Plan mode**: Generate proposals and display them without writing any files.
- **Apply mode**: Write accepted resolutions atomically to disk (reusing `applyConflictResolution`).

---

## Requirements

### Requirement 1: `coco resolve status` — local conflict state report

**User Story:** As a developer or CI script, I want a quick machine-readable summary of the
current conflict state, so I can decide whether to invoke resolution tooling.

#### Acceptance Criteria

1. WHEN `coco resolve status` is run in a repository with no in-progress operation, THE command
   SHALL print "No operation in progress" and exit 0.
2. WHEN an operation is in progress with conflicted files, THE command SHALL print the operation
   type, the count of conflicted files, and each file's path and status code (e.g. `UU`, `DU`).
3. WHEN `--json` is passed, THE command SHALL emit a JSON object containing `operation`,
   `conflictedFiles` (array of `{path, indexStatus, worktreeStatus}`), and `count`.
4. THE command SHALL NOT make any remote or LLM calls.
5. THE command SHALL exit 1 when conflicts are present (for CI gating) and 0 otherwise.

---

### Requirement 2: `coco resolve explain` — conflict explanation without file writes

**User Story:** As a developer, I want to understand what each side of a conflict is trying to
do before deciding how to resolve it, without the tool modifying my files.

#### Acceptance Criteria

1. WHEN `coco resolve explain` is run, THE command SHALL parse conflict markers in each
   conflicted file and ask the configured LLM to explain what each side appears to be doing.
2. THE command SHALL output one explanation per conflict region, including the file path, line
   range, ours-label, theirs-label, and a natural-language summary of the semantic intent of
   each side.
3. THE command SHALL NOT write to any file in the working tree.
4. WHEN `--json` is passed, THE output SHALL be a JSON array of explanation objects.
5. WHEN `--file <path>` is passed, THE command SHALL scope its analysis to that single file.
6. WHEN no conflicted files exist, THE command SHALL print "No conflicts to explain" and exit 0.
7. THE command SHALL use the `conflictResolve` dynamic-model task for LLM routing.
8. WHEN the API key is missing, THE command SHALL fail hard with the standard missing-key error
   (same as `coco review` / `coco commit`).

---

### Requirement 3: `coco resolve` — interactive resolution with proposals

**User Story:** As a developer, I want the AI to propose resolutions for my conflicts and let
me accept, edit, or skip each one interactively, so I stay in control while saving time.

#### Acceptance Criteria

1. WHEN `coco resolve` is run interactively, THE command SHALL parse conflict regions,
   generate proposals via the LLM, and present each proposal with its rationale and confidence.
2. FOR EACH proposal, THE command SHALL prompt the user with choices: accept (a), edit in
   $EDITOR (e), skip (s), or abort (q).
3. WHEN the user accepts a proposal, THE command SHALL apply the resolution atomically via
   `applyConflictResolution` and report success.
4. WHEN the user edits a proposal, THE command SHALL open the proposed text in `$EDITOR`, then
   apply the edited text on save.
5. WHEN the user skips a proposal, THE command SHALL leave that region's markers untouched and
   move to the next region.
6. WHEN all regions in a file are resolved, THE command SHALL stage the file via `git add`.
7. WHEN `--file <path>` is passed, THE command SHALL scope resolution to that single file.
8. WHEN `--dry-run` is passed, THE command SHALL display proposals without writing files (plan
   mode — equivalent to explain + proposed text).
9. WHEN `--json` is passed with `--dry-run`, THE command SHALL emit proposals as JSON.
10. WHEN the API key is missing, THE command SHALL fail hard with the standard missing-key error.

---

### Requirement 4: `coco resolve --apply` — non-interactive batch apply

**User Story:** As a CI pipeline or script, I want to auto-apply AI conflict resolutions when
the model is confident, so simple merge conflicts don't block automated workflows.

#### Acceptance Criteria

1. WHEN `--apply` is passed, THE command SHALL apply all proposals without interactive prompts.
2. THE command SHALL skip (not apply) any proposal with confidence below a configurable threshold
   (default: `medium`). Skipped regions remain conflicted.
3. WHEN all regions in a file are resolved after apply, THE command SHALL stage the file.
4. THE command SHALL print a summary: files resolved, regions applied, regions skipped (with
   reasons), and regions that failed to apply.
5. THE command SHALL exit 0 if all conflicts are resolved, exit 1 if any remain unresolved.
6. WHEN `--json` is passed, THE summary SHALL be emitted as a JSON object.

---

### Requirement 5: Confidence metadata per proposal

**User Story:** As a developer, I want to know how confident the model is about each proposal,
so I can focus my manual review on the uncertain resolutions.

#### Acceptance Criteria

1. THE LLM prompt SHALL request a `confidence` field per proposal with values `high`, `medium`,
   or `low`.
2. THE confidence SHALL be displayed alongside each proposal in both interactive and JSON output.
3. IN `--apply` mode, proposals below the configured confidence threshold SHALL be skipped.
4. THE confidence threshold SHALL be configurable via `--confidence <level>` flag (default:
   `medium`, meaning only `low` is skipped).

---

### Requirement 6: Dedicated `conflictResolve` dynamic-model task

**User Story:** As a user, I want to route conflict resolution to a high-context model
(separate from my commit-message model), so complex conflicts get the attention they need.

#### Acceptance Criteria

1. THE dynamic-model routing system SHALL recognize `conflictResolve` as a valid task key.
2. WHEN `service.model` is `"dynamic"`, conflict resolution commands SHALL resolve their model
   via `resolveDynamicService(config, 'conflictResolve')`.
3. WHEN no explicit `conflictResolve` task override is configured, THE system SHALL fall back to
   the `review` task profile (both are high-context, analytical workloads).
4. THE `coco doctor --cost` output SHALL include `conflictResolve` entries when present in the
   usage ledger.

---

### Requirement 7: Per-region chunking for large files

**User Story:** As a developer working on large conflicted files, I want the tool to handle
token budget limits gracefully, so it doesn't fail or produce degraded output on big conflicts.

#### Acceptance Criteria

1. WHEN the total token estimate of all regions in a file exceeds the model's context budget,
   THE command SHALL chunk regions into batches that fit within budget and make separate LLM
   calls per batch.
2. EACH batch SHALL include the file path and operation context so the model retains awareness
   of the surrounding codebase.
3. THE command SHALL reassemble proposals from multiple batches into a single ordered list before
   presenting them to the user.
4. WHEN a single region alone exceeds the model's context budget, THE command SHALL skip that
   region with a warning ("region too large for AI resolution") rather than failing the entire
   file.

---

### Requirement 8: Safety and error handling

**User Story:** As a developer, I want the tool to fail safely and never corrupt my working
tree, so I can trust it during stressful conflict situations.

#### Acceptance Criteria

1. THE command SHALL re-read and re-parse the conflict file immediately before each apply
   operation to ensure the target region still exists (guard against concurrent edits).
2. THE command SHALL use atomic file writes (tmp + rename) for all resolution applies (already
   implemented in `applyConflictResolution`).
3. WHEN apply fails for a region (content mismatch, disk error), THE command SHALL report the
   failure, skip that region, and continue with remaining regions.
4. THE command SHALL never run `git add` on a file that still contains conflict markers.
5. WHEN the LLM call fails or is cancelled, THE command SHALL report the error and exit without
   modifying any files.
6. THE command SHALL validate that a proposed resolution contains no conflict markers before
   applying it.
