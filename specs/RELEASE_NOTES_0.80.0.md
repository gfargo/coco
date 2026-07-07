# Release Notes — v0.80.0

> 15 PRs merged to `main` since v0.79.1. Visual polish, performance,
> and internal refactoring. No new user-facing commands or flags.
> Full test suite green (332 suites, 4622 tests, 68 snapshots).

## What's Changed

`0.80.0` is a quality release focused on three themes: the workstation
looks better on narrow terminals, responds faster to keystrokes, and the
internal architecture is cleaner. Every change is backwards-compatible;
users see improved visuals and responsiveness with no migration.

## Visual Design — "Say Everything Once" (#1367)

The workstation talked too much. Information that was painted twice on
the same screen now appears once, in the right place, with the right
weight.

- Remove the sidebar "Current: main" and "Worktree: clean" rows — they
  duplicated the header chip bar. The freed rows go to the branch list.
- Dim the "✓ clean" header chip — it reports the default state and
  shouldn't compete with the warning-level "● dirty" chip.
- Unify all panel meta separators from `|` to `·` (matching header/
  footer). Drop always-on defaults: "loaded", "full graph", "0 staged |
  0 unstaged | 0 untracked" → only show exceptions and non-zero counts.
- Unify loading vocabulary: all 14 surfaces now say "Loading
  \<resource\>…" in both the header-right slot and the body placeholder.
- Filter remote-tracking twin (`origin/main`) from the trailing ref
  list when the branch chip already shows `[main]`. Tags and
  `origin/HEAD` are preserved.
- Suppress the per-row relative date in stacked mode when date-bucket
  headers ("── Today ──") are already visible above the commits.

## Color Discipline + Narrow-Terminal Grace (#1368)

- Remote-tracking branch chips use `theme.colors.muted` instead of
  warning-yellow. They're a fact, not an alert.
- Graph lane palette reduced from 8 bold saturated colors (including
  red/green/yellow) to 5 non-semantic hues without bold. Lanes no
  longer compete with diff additions, commit status, or warnings.
- Status surface drops position-based dimming — rows below the cursor
  no longer appear disabled.
- Stacked-mode line budget fixed: `*2/3` instead of `/2` fills the
  panel on 80×24 terminals (was leaving ~25% blank).
- Header chip priority system: when the chip row overflows on narrow
  terminals, low-value chips (loading, clean state, app name) drop
  first. Mode and search state always survive.

## Performance

- Branch divergence: N serial `git rev-list` subprocesses per branch →
  1 `for-each-ref` with `%(upstream:track)`. A repo with 100 branches
  now boots with 3 subprocesses instead of 103.
- Commit detail hydration: 120ms debounce + 100-entry hash cache. Rapid
  j/k navigation no longer spawns 4 git subprocesses per cursor move.
  Previously-viewed commits render instantly from cache.
- `isEmptyRepo` probe removed from every `getLogRows` call — catches
  the error instead. One fewer subprocess per history fetch.
- useFilteredLists: collapsed from 9 memos (each computing all 9 lists)
  to 1 memo computing the bundle once. 81× → 1× work per filter
  keystroke.
- Syntax span cache bounded at 5,000 entries (was unlimited, grew for
  the lifetime of the process).
- Worktree diff output capped at 8,000 lines with a truncation message.
  Prevents OOM and highlight stalls on huge generated files.

## Internal — app.ts Decomposition (#1418)

Continued the ongoing `app.ts` decomposition (now ~1,729 LOC, down from
~1,888 at the start of the 0.72 cycle):

- Extract `useTriageListHydration` — issue + PR triage list lazy-loader
  and filter-cycle invalidation effects.
- Extract `useDeferredBootLoad` — the one-shot mount-time commit log
  loader with frame-tagging and stale-frame guards.

The remaining inline effects (3 lines, 5 lines, 4 lines) are below the
extraction threshold. The next phase (component conversion for per-
surface memoization) is tracked as a separate workstream.
