# Command Reliability Audit

Date: 2026-04-27

This audit reviews Coco command reliability and test coverage as part of the v1 readiness
work. It focuses on command behavior, testability, prompt/diff budget handling, and remote
AI call observability.

## Summary

The core AI commands now have materially stronger reliability coverage than they did before
the 0.32 line:

- `commit`, `commit split`, and `changelog` have temp-git integration coverage.
- `commit`, `changelog`, `recap`, and `review` enforce rendered prompt budgets before final
  model calls.
- Diff collection and summarization have concurrency and large-change budget tests.
- Dynamic model routing has provider/preference/override coverage.
- Package-level CLI smoke tests validate built CJS, ESM, and packaged binary entrypoints.
- CI runs release gates on Node 22.12.0 and 24.x, with a release dry-run validation step.
- LLM calls emit per-call verbose metadata and per-command summary telemetry.

The remaining v1 reliability work is concentrated in command-boundary testability, `init`
coverage, review integration coverage, and reducing duplicated AI command plumbing.

## Command Matrix

| Command | Unit coverage | Temp-git integration | Prompt budget | LLM telemetry | Main v1 gap |
| --- | --- | --- | --- | --- | --- |
| `commit` | Strong | Yes | Yes | Yes | Direct `process.exit` paths still complicate error coverage |
| `commit split` | Covered through integration | Yes | Uses condensed diff input | Yes | Hunk apply is intentionally fail-closed; broader edge fixtures can grow over time |
| `changelog` | Covered indirectly and through shared utilities | Yes | Yes | Yes | Handler has several direct exits and branch/range validation should be easier to test |
| `recap` | Moderate | No dedicated temp-git integration | Yes | Yes | Timeframe paths are mocked; real-repo coverage would improve confidence |
| `review` | Moderate | No dedicated temp-git integration | Yes | Yes | Needs temp-git integration for working tree and branch review flows |
| `init` | Weak | No | Not applicable | Not applicable | First-run config writing and package setup paths need direct tests |

## Existing Strengths

### Diff Condensation

The default parser now has tests for:

- bounded file diff collection concurrency
- early exit when raw diffs fit the token budget
- large-file pre-processing only when needed
- directory summarization waves capped by `maxConcurrent`
- large staged repo behavior through command integration

This gives good confidence that large diffs avoid runaway git subprocesses and runaway remote
summarization calls.

### Prompt Budgets

Rendered prompt budget enforcement is now applied to:

- commit message generation
- changelog generation
- recap generation
- review generation

The guard accounts for prompt instructions and command-specific context, not only the condensed
diff text. This lowers the risk of provider context limit failures after condensation succeeds.

### Model Routing

Dynamic model routing has tests for:

- explicit model behavior
- OpenAI, Anthropic, and Ollama defaults
- cost, balanced, and quality preferences
- user task overrides
- command-level routing for separate commit and summarization models

### Release Gate

CI now validates:

- Node 22.12.0 and Node 24.x
- lint
- Jest
- build/schema generation
- generated schema drift
- packaged CLI smoke checks
- package dry-run
- release dry-run

## Tracked V1 Gaps

### Add review command temp-git integration coverage

Issue: #651

`review` has unit coverage for prompt budgeting, but it should also exercise real git change
discovery with mocked LLMs. This should include both current working tree review and branch
review against a base branch.

### Replace direct process.exit calls with testable command exits

Issue: #652

Several command handlers exit directly for missing API keys, validation failures, no-result
paths, and abort decisions. That preserves CLI behavior, but it makes tests more brittle and
can bypass cleanup or summary logging. A small command-exit abstraction handled by
`commandExecutor` would make behavior easier to test while preserving exit codes.

### Extract shared diff-to-prompt pipeline for AI commands

Issue: #653

The AI commands now all perform similar setup:

- resolve dynamic task models
- create summary/final LLMs
- call `fileChangeParser`
- enforce rendered prompt budgets
- call `executeChain` or `executeChainWithSchema`
- flush LLM telemetry summaries

Those steps are mostly consistent today, but they are wired manually in each command. A small
shared helper would reduce future drift without hiding command-specific prompt variables and
schemas.

### Add init command test coverage and non-interactive smoke paths

Issue: #654

`init` is the first-run experience and has the weakest direct command coverage. It should have
mocked tests for project/global config writing, canceled confirmation, advanced service-field
parsing, and commitlint/package setup choices. A non-interactive smoke path would also make
CI validation easier.

## Recommendations

1. Fix #651 before deeper `review` feature work. It is the highest-value missing integration
   test because `review` is a core AI command.
2. Fix #652 before broad command UX changes. It will make future command testing cleaner and
   reduce the chance that cleanup/telemetry is skipped.
3. Fix #653 incrementally. Start with shared metadata/options builders before extracting a
   larger prompt pipeline.
4. Fix #654 before v1 onboarding/documentation work. The setup wizard should be highly stable
   before the project invites more first-time users.

## Notes For Future Feature Work

The upcoming `coco log` or visual graph work should start with the same reliability bar:

- no provider/API dependency for the baseline command
- temp-git fixtures for branch topology, tags, merges, and remotes
- deterministic stdout mode before interactive UI
- package-level smoke coverage once the command is exposed
- clear separation between local git graph rendering and optional AI summaries
