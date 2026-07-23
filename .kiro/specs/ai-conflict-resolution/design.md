# Design: AI-Assisted Merge Conflict Resolution — CLI Extension

## Key Source References

<!-- These are the existing files this spec extends or modifies. -->
#[[file:src/git/conflictAiActions.ts]]
#[[file:src/git/conflictRegionActions.ts]]
#[[file:src/git/operationData.ts]]
#[[file:src/git/operationActions.ts]]
#[[file:src/lib/langchain/utils/dynamicModels.ts]]
#[[file:src/workstation/runtime/conflictResolutionState.ts]]
#[[file:src/workstation/runtime/hooks/useConflictResolutionActions.ts]]
#[[file:src/workstation/surfaces/conflicts/index.ts]]
#[[file:src/workstation/surfaces/conflicts/input.ts]]
#[[file:src/index.ts]]

## Overview

This feature surfaces the existing TUI-only AI conflict resolution (#1369) as standalone CLI
commands (`coco resolve status`, `coco resolve explain`, `coco resolve`). The design
reuses the proven data layer (`conflictRegionActions.ts`, `conflictAiActions.ts`,
`operationData.ts`, `operationActions.ts`) and extends it with a thin command layer, a dedicated
dynamic-model task, confidence metadata, and per-region chunking for large files.

The architecture follows coco's established layering:

```
src/commands/resolve/           ← NEW: yargs command (config + handler + prompt)
src/git/conflictAiActions.ts    ← EXTEND: confidence field, explain workflow, chunking
src/git/conflictRegionActions.ts  ← UNCHANGED: parsing + atomic apply
src/git/operationData.ts        ← UNCHANGED: operation detection + file list
src/git/operationActions.ts     ← UNCHANGED: ours/theirs/stage/continue/abort
src/lib/langchain/utils/dynamicModels.ts  ← EXTEND: add 'conflictResolve' task
```

---

## Existing Files Modified (with specific changes)

| File | What changes |
|------|--------------|
| `src/git/conflictAiActions.ts` | Add `confidence` to `ProposalsSchema` + `ConflictResolutionProposal` type. Update `CONFLICT_PROMPT_TEMPLATE` with confidence instruction. Change `resolveDynamicService(config, 'commit')` → `resolveDynamicService(config, 'conflictResolve')` on line ~126. Add chunking logic (batch loop around the existing `executeChain` call). Add new `runConflictExplanationWorkflow` export + `ConflictExplanation`/`ConflictExplanationResult` types. |
| `src/git/conflictRegionActions.ts` | In `applyConflictResolution`, add a marker-validation guard before `writeFileAtomic` — test the `replacement` string against `CONFLICT_OURS_MARKER`/`CONFLICT_SEPARATOR_MARKER`/`CONFLICT_THEIRS_MARKER` and return early with an error if any match. |
| `src/lib/langchain/utils/dynamicModels.ts` | Add `'conflictResolve'` to the `DynamicTask` union type. Add fallback entry: when `conflictResolve` has no explicit override, resolve to the `review` task's config (then default). |
| `src/lib/config/types.ts` | Add `'conflictResolve'` to the `DynamicTask` enum/union (wherever the schema-generation reads valid task names from). |
| `src/workstation/runtime/conflictResolutionState.ts` | Add optional `confidence?: 'high' \| 'medium' \| 'low'` to `LogInkConflictProposal` type (additive, no runtime breakage). |
| `src/workstation/runtime/hooks/useConflictResolutionActions.ts` | In `startConflictResolution`, where proposals are mapped from the workflow result into `LogInkConflictProposal[]` (~line 108), pass through `proposal.confidence`. |
| `src/workstation/surfaces/conflicts/index.ts` | In `renderProposalPanel`, append confidence badge to the `strip` line (task 13, cosmetic). |
| `src/index.ts` | Mount the new `resolve` command (`.command(resolveCommand)` alongside existing commands). |
| `schema.json` | Regenerated automatically by `npm run build:schema` after type changes. |

## New Files Created

| File | Purpose |
|------|---------|
| `src/commands/resolve/index.ts` | Re-export for yargs mounting |
| `src/commands/resolve/config.ts` | Yargs command definition, builder, `ResolveOptions` type |
| `src/commands/resolve/handler.ts` | Dispatcher: routes to status/explain/resolve |
| `src/commands/resolve/statusHandler.ts` | Status subcommand (local-only, no LLM) |
| `src/commands/resolve/explainHandler.ts` | Explain subcommand (LLM, no writes) |
| `src/commands/resolve/resolveHandler.ts` | Resolve subcommand (LLM + apply, interactive/apply/dry-run) |
| `src/commands/resolve/prompt.ts` | Explain prompt template (resolve uses the existing one in `conflictAiActions.ts`) |
| `src/commands/resolve/*.test.ts` | Co-located unit tests for each handler |
| `src/commands/resolve/*.integration.test.ts` | Integration tests using temp-git fixture (gated by `COCO_RESOLVE_IT` env) |

---

## Command Structure

A single yargs command with subcommands, following the `pr create` pattern:

```
coco resolve status              # local-only, no LLM
coco resolve explain [--file F]  # LLM explain, no writes
coco resolve [--file F]          # interactive resolve (default subcommand)
coco resolve --dry-run           # plan mode (show proposals, no writes)
coco resolve --apply             # batch apply for CI/scripts
```

All subcommands inherit global flags (`--json`, `--quiet`, `--repo`, `--verbose`).

### File layout

```
src/commands/resolve/
  index.ts            # re-export for yargs mounting
  config.ts           # yargs command definition + builder + types
  handler.ts          # orchestrator: status/explain/resolve dispatch
  statusHandler.ts    # status subcommand logic
  explainHandler.ts   # explain subcommand logic (LLM)
  resolveHandler.ts   # resolve subcommand logic (LLM + apply)
  prompt.ts           # explain + resolve prompt templates
```

---

## Data Models

### Extended `ConflictResolutionProposal` (modify `src/git/conflictAiActions.ts`)

```typescript
export type ConflictResolutionProposal = {
  regionIndex: number
  resolution: string
  rationale: string
  confidence: 'high' | 'medium' | 'low'  // NEW
}
```

The existing TUI consumer (`useConflictResolutionActions.ts`) already destructures known fields
and passes them into `LogInkConflictProposal` — adding `confidence` is additive; the TUI can
display it in the proposal panel's status strip without breaking changes.

### `ConflictExplanation` (new type in `src/git/conflictAiActions.ts`)

```typescript
export type ConflictExplanation = {
  regionIndex: number
  oursIntent: string   // what the "ours" side is trying to do
  theirsIntent: string // what the "theirs" side is trying to do
  conflictNature: string // why these changes conflict
}

export type ConflictExplanationResult =
  | { ok: true; explanations: ConflictExplanation[]; message: string }
  | { ok: false; message: string; details?: string[]; cancelled?: boolean }
```

### Command argv types (`src/commands/resolve/config.ts`)

```typescript
export interface ResolveOptions extends BaseCommandOptions {
  subcommand: 'status' | 'explain' | undefined  // undefined = resolve (default)
  file?: string
  apply?: boolean
  dryRun?: boolean
  confidence?: 'high' | 'medium' | 'low'
  json?: boolean
}

export type ResolveArgv = Arguments<ResolveOptions>
```

---

## Prompt Strategy

### Explain prompt (`src/commands/conflict/prompt.ts`)

Narrow, read-only prompt — one call per file (or per chunk if large). The workflow function
(`runConflictExplanationWorkflow`) lives in `src/git/conflictAiActions.ts` alongside the
existing resolve workflow; the prompt template is defined in the command layer since it's
CLI-specific (the TUI doesn't need an explain-only mode today).

```
You are analyzing git merge conflicts in `{path}` during a {operation}.

For each conflict region, explain:
1. What the "ours" side ({oursLabel}) is trying to accomplish.
2. What the "theirs" side ({theirsLabel}) is trying to accomplish.
3. Why these changes conflict (semantic explanation, not just "same lines changed").

{conflicts}

{format_instructions}
```

Schema: array of `{ region: number, oursIntent: string, theirsIntent: string, conflictNature: string }`.

### Resolve prompt (extend existing `CONFLICT_PROMPT_TEMPLATE` in `src/git/conflictAiActions.ts`)

Add a `confidence` field to the existing schema and format instructions:

```
- For each proposal, include a "confidence" field: "high" (both sides are clearly compatible
  and the merge is mechanical), "medium" (reasonable inference but manual review recommended),
  or "low" (ambiguous intent, multiple valid resolutions exist).
```

The schema addition:

```typescript
const ProposalsSchema = z.object({
  proposals: z.array(z.object({
    region: z.number(),
    resolution: z.string(),
    rationale: z.string(),
    confidence: z.enum(['high', 'medium', 'low']),  // NEW
  })),
})
```

### Prompt budget and chunking

Both prompts use `estimatePromptTokens` (via the shared tokenizer) to measure total region
content. When the estimate exceeds 80% of the model's context window (looked up from the
provider registry or defaulting to 8192 tokens as a safe floor):

1. Sort regions by file order.
2. Greedily pack regions into batches where each batch fits within budget.
3. Each batch carries the file path, operation, and a note "regions N–M of K total".
4. Results are reassembled in region-index order before return.

A single region that alone exceeds budget is skipped with a `confidence: 'low'` and a rationale
of "Region too large for model context — resolve manually."

---

## Dynamic-Model Task Integration

### `resolveDynamicService` extension (`src/lib/langchain/utils/dynamicModels.ts`)

Add `'conflictResolve'` to the `DynamicTask` union. The fallback chain when no explicit override
exists:

```
conflictResolve → review → (default model)
```

Rationale: conflict resolution and code review are both analytical, high-context tasks that
benefit from the same model tier. Users who override `review` to a thorough model automatically
get that for conflicts too, unless they explicitly set `conflictResolve`.

### Config schema

The existing `service.dynamicModelOverrides` record already accepts string keys — adding
`conflictResolve` requires only updating the `DynamicTask` type and the schema description
enum. Example config:

```json
{
  "service": {
    "model": "dynamic",
    "dynamicModelOverrides": {
      "conflictResolve": { "model": "claude-sonnet-4-20250514", "provider": "anthropic" }
    }
  }
}
```

---

## Interactive Resolve Flow (stdout mode)

Reuses `@inquirer/prompts` (already a dependency) for the per-proposal review loop:

```
┌─ src/commands/resolve/resolveHandler.ts ───────────────────────────────┐
│                                                                        │
│  1. getConflictedFiles(git) → files                                    │
│  2. for each file (or --file):                                         │
│     a. getConflictFileRegions(git, path) → regions                     │
│     b. chunk regions if needed                                         │
│     c. runConflictResolutionWorkflow({regions, ...}) → proposals       │
│     d. for each proposal:                                              │
│        - print: region lines, ours/theirs, proposed, confidence        │
│        - prompt: (a)ccept / (e)dit / (s)kip / (q)uit                   │
│        - accept → applyConflictResolution(git, path, region, text)     │
│        - edit   → open in $EDITOR, then apply edited text              │
│        - skip   → continue                                             │
│        - quit   → break out of all loops                               │
│     e. if file marker-free → git add                                   │
│  3. print summary                                                      │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### `--apply` mode (non-interactive)

Same flow but replaces the interactive prompt with a confidence-threshold gate:

- `confidence >= threshold` → apply automatically
- `confidence < threshold` → skip (report as "below confidence threshold")

Default threshold: `medium` (skip only `low`). Configurable via `--confidence high|medium|low`.

### `--dry-run` mode

Runs the LLM call, prints/emits proposals (with confidence + rationale), but never calls
`applyConflictResolution`. This is the "plan" mode — useful for previewing what the AI would
do, piping to review tooling, or auditing before committing to applies.

---

## Integration with Existing TUI

The TUI's `useConflictResolutionActions` hook already calls `runConflictResolutionWorkflow`
from `conflictAiActions.ts`. That function currently routes through `resolveDynamicService(config,
'commit')` — switching it to `'conflictResolve'` (this spec's task 1) improves the TUI too, since
conflict resolution benefits from a higher-context model than commit-message generation.

The remaining changes to that module (confidence field, chunking) flow through to the TUI
automatically:

- `LogInkConflictProposal` gains a `confidence` field (additive).
- The proposal panel in `conflicts/index.ts` can optionally render confidence as a badge
  (`[H]`/`[M]`/`[L]`) — a follow-up cosmetic enhancement, not blocking for this spec.
- Chunking is transparent to the TUI: `runConflictResolutionWorkflow` already returns
  assembled proposals; it just handles multi-batch internally now.

**Note:** The `explain` workflow is CLI-only for now. A future TUI enhancement could expose
intent summaries in the conflicts surface (e.g. an `E` key that shows per-region explanations
in the proposal panel area before the user requests full resolution via `M`), but that's a
separate design effort — the explain workflow function lives in `conflictAiActions.ts` and would
be consumable from the TUI hook when ready.

---

## Exit Codes

| Command | Condition | Exit |
|---------|-----------|------|
| `status` | No operation or no conflicts | 0 |
| `status` | Conflicts present | 1 |
| `explain` | Success | 0 |
| `explain` | LLM failure | 1 |
| `resolve` | All conflicts resolved | 0 |
| `resolve` | Some conflicts remain | 1 |
| `resolve --apply` | All resolved | 0 |
| `resolve --apply` | Any remain (skipped or failed) | 1 |

---

## Error Handling

All error states follow the existing `BranchActionResult` / `commandExit` patterns:

| Condition | Behaviour |
|-----------|-----------|
| No operation in progress | Print info, exit 0 (status) or "nothing to resolve" (resolve) |
| LLM call fails | Print error, exit 1, no files modified |
| LLM cancelled (signal) | Print "cancelled", exit 1, no files modified |
| Region content mismatch at apply time | Skip region, report, continue with next |
| Proposed resolution contains conflict markers | Skip proposal, report as "invalid resolution" |
| File fully resolved → `git add` fails | Report staging failure, still exit success for resolution |
| `--file` path not in conflicted list | Print error, exit 1 |
| Single region exceeds token budget | Skip with warning, continue with remaining regions |

---

## Testing Strategy

### Unit tests (co-located `*.test.ts`)

- `config.ts` — yargs builder produces correct argv for each subcommand variant.
- `statusHandler.test.ts` — mocks `getConflictedFiles` + `getInProgressOperationType`; asserts
  stdout/JSON output, exit codes.
- `explainHandler.test.ts` — mocks `getConflictFileRegions` + `executeChain`; asserts
  explanation structure, `--file` scoping, empty-state path.
- `resolveHandler.test.ts` — mocks `runConflictResolutionWorkflow` + `applyConflictResolution`;
  asserts interactive flow (mocked inquirer), `--apply` confidence gating, `--dry-run` no-write,
  staging on full resolution, skip-on-marker-in-proposal.
- `prompt.test.ts` — asserts prompt template rendering, region formatting, chunking logic.

### Integration tests (`*.integration.test.ts`)

- Gated by `COCO_RESOLVE_IT` environment variable (self-skip without it), following the GitLab
  integration test pattern (`COCO_GITLAB_IT`).
- Temp-git fixture with a deterministic merge conflict (two branches editing the same line).
- Runs `statusHandler` against the real repo → asserts correct file list.
- Runs `resolveHandler --dry-run` with a mocked LLM → asserts proposals are generated from
  real parsed regions without modifying the working tree.

### Snapshot coverage

- JSON output shapes for `--json` across all three subcommands (pin structure, not LLM content).

---

## Sequence Diagram: `coco resolve`

```
User runs: coco resolve --file src/lib/utils.ts

  handler.ts
    │
    ├─ getInProgressOperationType(git)  →  'merge'
    ├─ getConflictedFiles(git)          →  [{path: 'src/lib/utils.ts', ...}]
    ├─ filter to --file                 →  [target file]
    │
    ├─ getConflictFileRegions(git, path)  →  {ok: true, regions: [...]}
    ├─ estimateTokens(regions)
    │   └─ if over budget → chunk into batches
    │
    ├─ for each batch:
    │   └─ runConflictResolutionWorkflow({path, regions, operation, signal})
    │       └─ executeChain({llm, prompt, variables, parser})
    │           └─ LLM returns proposals with confidence
    │
    ├─ reassemble proposals in region order
    │
    ├─ for each proposal (interactive loop):
    │   ├─ display: region context + proposed resolution + confidence
    │   ├─ inquirer prompt: (a)ccept / (e)dit / (s)kip / (q)uit
    │   │
    │   ├─ if accept:
    │   │   ├─ validate: no conflict markers in resolution
    │   │   └─ applyConflictResolution(git, path, region, resolution)
    │   ├─ if edit:
    │   │   ├─ write proposal to tmp file
    │   │   ├─ spawn $EDITOR
    │   │   ├─ read edited text
    │   │   ├─ validate: no conflict markers
    │   │   └─ applyConflictResolution(git, path, region, editedText)
    │   └─ if skip/quit: continue/break
    │
    ├─ if file marker-free:
    │   └─ git add path
    │
    └─ print summary + exit code
```

---

## Configuration Example

```json
{
  "service": {
    "model": "dynamic",
    "dynamicModelOverrides": {
      "conflictResolve": { "model": "claude-sonnet-4-20250514" }
    }
  }
}
```

CLI usage:

```bash
# Quick status check (CI gate)
coco resolve status --json

# Understand conflicts before resolving
coco resolve explain --file src/lib/config.ts

# Interactive resolve (default)
coco resolve

# Auto-apply confident resolutions in CI
coco resolve --apply --confidence medium --json

# Preview what would happen
coco resolve --dry-run --json
```
