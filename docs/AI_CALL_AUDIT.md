# AI Call Audit

This audit inventories the remote AI call paths in Coco as of `0.32.0` and defines the
observability fields needed before dynamic model routing.

## Call Sites

| Subsystem | Entry point | Task metadata | Current input source | Budget behavior | Retry behavior |
| --- | --- | --- | --- | --- | --- |
| Commit | `src/commands/commit/handler.ts` | `commit-message`, `commit-message-conventional` | Staged file summaries from `fileChangeParser` | `enforcePromptBudget` trims `summary` before the final LLM call | Schema parsing retries up to provider/config limits; commitlint can trigger regeneration |
| Changelog | `src/commands/changelog/handler.ts` | `changelog`, `changelog-with-diff`, `changelog-only-diff` | Commit log details, optional condensed commit diffs, or branch diff summary | `enforcePromptBudget` trims `summary` before the final LLM call | Single chain call today |
| Recap | `src/commands/recap/handler.ts` | `recap` | Current changes or commit history for a timeframe | No explicit final prompt budget enforcement yet | Single chain call with fallback text on parsing errors |
| Review | `src/commands/review/handler.ts` | `review`, `review-branch` | Staged, unstaged, untracked, or branch diff summaries | No explicit final prompt budget enforcement yet | Single chain call today |
| Diff summarization | `src/lib/parsers/default/utils/summarizeDiffs.ts` | `summarize-directory-diff` | Directory-grouped file diffs | Stops once condensed diff groups are below `maxTokens`; processes in bounded waves | No retry beyond chain internals |
| Large-file summarization | `src/lib/parsers/default/utils/summarizeLargeFiles.ts` | `summarize-large-file` | Individual file diffs over `maxFileTokens` | Runs only when the whole diff is already over budget | Returns original diff on summary failure |
| Autofix | `src/lib/autofix` | External CLI, not LangChain | Review findings and user-selected fixes | No LLM provider call inside Coco; delegates to configured CLI | Adapter-specific process behavior |

## Runtime Observability

Verbose logging now emits structured, prompt-safe metadata from the shared LangChain paths:

```text
[llm] task=commit-message command=commit provider=openai model=gpt-4o retryAttempt=1 promptTokens=1180 variableKeys=summary,format_instructions,additional_context
```

Logged fields intentionally exclude API keys, raw prompt content, diff content, and model output. The current fields are:

- `task`: the workflow-specific operation.
- `command`: CLI command when applicable.
- `provider` and `model`: selected service identity when known.
- `retryAttempt`: schema-chain attempt count when available.
- `promptTokens`: tokenizer-based estimate of rendered prompt or summarization input.
- `inputDocuments` and `inputChunks`: summarization input shape.
- `parser`: parser class name when known.
- `variableKeys`: prompt variable names only, not values.

## Model Strategy Notes

Lower-risk cheaper/faster candidates:

- `summarize-large-file` and `summarize-directory-diff`: usually extractive compression; good candidates for smaller or faster models.
- `recap`: often lower-risk prose when not used for commit history decisions.
- Changelog without diffs: structured commit metadata tends to need less context than raw diff analysis.

Higher-context or higher-quality candidates:

- `commit-message` when summaries include many unrelated changes or commitlint retries occur.
- `changelog-with-diff` and `changelog-only-diff` for large branch diffs.
- `review` and `review-branch`, where missing an issue is more costly than prose quality variation.

## Follow-Ups

- Add persisted aggregate counters for total LLM operations per command run.
- Add optional estimated cost calculation once provider model pricing is configurable.
- Route summarization tasks to cheaper dynamic-model profile entries.
- Route large branch diff and review tasks to larger-context profile entries.
- Add final prompt-budget enforcement to recap and review, matching commit/changelog behavior.
