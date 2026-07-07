# Release Notes — v0.79.1

> Patch release: 4 commits on `main` since v0.79.0. Two bug fixes, one
> design improvement, one internal refactor. All tests green (332 suites,
> 4616 tests, 68 snapshots).

## What's Changed

`0.79.1` is a patch release addressing two bugs discovered during the
post-0.79.0 audit cycle, plus a workstation design improvement and an
internal decomposition step.

## Bug Fixes

- **Malformed JSON in env vars no longer crashes every command.** A
  `COCO_SERVICE_FIELDS={bad` (or any `COCO_*` value starting with `{` that
  isn't valid JSON) previously threw a raw `SyntaxError` that killed every
  invocation until the var was unset. The env loader now catches the parse
  failure, warns, and skips the value. (#1468, #1519)

- **Numeric-looking string config values are no longer coerced to numbers.**
  `COCO_SERVICE_MODEL=123` previously became number `123`, failing
  downstream schema validation. Numeric coercion is now restricted to the
  two fields that are genuinely numeric (`timeout`, `maxRetries`); all
  other values stay as strings. (#1468, #1519)

- **`coco commit --split` no longer claims "Plan saved" when nothing is
  persisted.** Declining the apply prompt previously printed misleading copy
  suggesting `--apply` would reuse the plan. In reality `--apply` re-rolls
  the LLM from scratch. The message now says "Split cancelled" with honest
  re-run guidance. Bare `--apply` without `--split` also no longer silently
  triggers split mode. (#1443, #1520)

- **`TaskList` open-file test no longer leaks the host's `$EDITOR` value.**
  The test that verifies pressing `o` opens the editor was
  environment-dependent, failing when `EDITOR` contained flags (e.g.
  `code -w`). Now pinned for the test's duration. (#1517)

## Workstation

- **Inspector panel degrades by omission at rest.** When unfocused (20-32
  cells), the history inspector now shows a condensed 4-line summary
  (subject, hash/date, stats, hint) instead of truncating every detail line
  into unreadable fragments. Refs, file list, and actions defer to when the
  panel is focused and has room. `truncateCells` also switches to a 1-cell
  unicode ellipsis by default, with an `{ ascii: true }` opt-out for ASCII
  themes. (#1366, #1518)

## Internal

- **Extracted `useHistoryRefetch` hook from `app.ts`.** The merged
  history-refetch effect (filter submit, graph toggle, repo-frame switch)
  moved verbatim into a dedicated hook as part of the ongoing `app.ts`
  decomposition (OSS-463). Behavior-preserving, no user-visible change.
  (#1418, #1482)
