# Dynamic Model Routing

Dynamic routing lets users keep a provider fixed while allowing Coco to choose a task-appropriate model.
It is enabled by setting `service.model` to `dynamic`.

```json
{
  "service": {
    "provider": "openai",
    "model": "dynamic",
    "dynamicModelPreference": "balanced",
    "dynamicModels": {
      "summarize": "gpt-4.1-nano",
      "commit": "gpt-4.1-mini",
      "changelog": "gpt-4.1",
      "review": "gpt-4.1",
      "largeDiff": "gpt-4.1"
    }
  }
}
```

## Tasks

Supported task keys are:

- `summarize`: routine diff compression.
- `commit`: final commit message generation.
- `changelog`: final changelog copy generation.
- `review`: code review analysis.
- `recap`: recap generation.
- `repair`: parsing repair and retry work.
- `largeDiff`: large branch or changelog diff condensation.

## Routing Inputs

The current resolver uses:

- Provider: `openai`, `anthropic`, or `ollama`.
- Task: one of the task keys above.
- Preference: `cost`, `balanced`, or `quality`.
- User overrides: `service.dynamicModels`.

Explicit models are preserved. If `service.model` is not `dynamic`, Coco uses that model for every task.

## Defaults

Defaults are provider-specific and intentionally conservative:

- Summarization uses smaller/faster models where available.
- Commit/changelog generation uses balanced models.
- Review, repair, and large-diff tasks use stronger or larger-context models.

User overrides replace individual tasks without requiring a full profile.

## Backward Compatibility

Existing configs continue to work unchanged. The new fields are optional. `dynamicModels`
is ignored unless `service.model` is `dynamic`, but it is still validated when dynamic
routing is resolved so invalid task names fail clearly.
