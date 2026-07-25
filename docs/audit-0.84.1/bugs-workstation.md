# `coco ui` workstation runtime — bug audit (v0.84.1)

Scope: `src/workstation/**` (runtime, hooks, chrome, surfaces). No code was changed.
Every claim below was verified against the code at the cited line; three of them were
additionally reproduced numerically by executing the real exported functions.

Already-filed items (rail history divisor / line-aware budgeting, rail ref-metadata
wrapping, `getLogInkInputEvents` router extraction, custom commands / edit-hunk /
patch building, AI pre-commit review, AI rebase plan, explain-commit, triage copilot)
are excluded.

---

## CRITICAL

### [SEVERITY: critical] fix(workstation): pane widths can exceed terminal columns when the help overlay opens on a focused sidebar
**File:** `src/workstation/chrome/layout.ts:236-268` (call site `src/workstation/runtime/app.ts:1201-1206`)

**What's wrong:** `detailWidth`, `sidebarWidth` and `mainPanelWidth` are each computed with an
independent floor, and only `mainPanelWidth` is derived by subtraction — but it is then clamped
up with `Math.max(20, …)`. When the help overlay forces `detailWidth >= 60` and the sidebar is
focused (`>= 32`), the subtraction goes negative, the `Math.max(20, …)` floor kicks in, and the
three widths sum to more than `columns`. The module's own docstring promises "the three panels
always tile flush".

**Evidence:**
```ts
const detailWidth = input.helpOverlayActive
  ? Math.max(60, Math.min(100, Math.floor(columns * 0.50)))
  : /* … */
const sidebarWidth = input.sidebarFocused
  ? Math.max(32, Math.min(50, Math.floor(columns * 0.36)))
  : calcSidebarAtRestWidth(columns, density)
mainPanelWidth: Math.max(20, columns - sidebarWidth - detailWidth),
```
Reproduced by calling `getLogInkLayout` directly:
```
cols=100 help+sidebar: side=36 main=20 detail=60 SUM=116 OVERFLOW=16
cols=110 help+sidebar: side=39 main=20 detail=60 SUM=119 OVERFLOW=9
cols=119 help+sidebar: side=42 main=20 detail=60 SUM=122 OVERFLOW=3
cols=130 help+sidebar: side=46 main=20 detail=65 SUM=131 OVERFLOW=1
cols=100 help only   : side=24 main=20 detail=60 SUM=104 OVERFLOW=4
```
`app.ts` feeds both flags from live state, so the combination is reachable:
```ts
sidebarFocused: state.focus === 'sidebar',
inspectorFocused: state.focus === 'detail',
helpOverlayActive: state.showHelp,
```

**Impact:** In a terminal 100–130 columns wide (a very common laptop/tmux-split size), pressing
`Tab` to focus the sidebar and then `?` makes the horizontal flex row wider than the terminal.
Ink wraps or clips the row: the inspector/help panel drops onto a second visual row, the borders
break, and the footer is pushed off-screen. Repro: `stty cols 100`, `coco ui`, `Tab` until focus
is on the sidebar, `?`.

**Suggested fix:** Compute the three widths as one allocation pass: budget `detailWidth` and
`sidebarWidth` against `columns` (shrink the *lower-priority* pane instead of floor-clamping the
main panel), then set `mainPanelWidth = columns - sidebarWidth - detailWidth` with no `Math.max`,
and assert `sum === columns` in `layout.test.ts` across the 80..240 column sweep and every
focus/overlay combination.

**Confidence:** high

---

## HIGH

### [SEVERITY: high] fix(workstation): filesystem watcher is torn down and rebuilt after every worktree refresh
**File:** `src/workstation/runtime/hooks/useContextRefresh.ts:267`, consumed at `src/workstation/runtime/hooks/useRefreshWatcher.ts:153`

**What's wrong:** `refreshWorktreeContext` is a `useCallback` whose dep list contains
`currentWorktree` — which `app.ts` passes as `context.worktree` (`app.ts:468`). Every worktree
refresh writes a brand-new `getWorktreeOverview()` object into context, so `refreshWorktreeContext`
gets a new identity, so `useRefreshWatcher`'s effect (which lists it as a dep) re-runs: it closes
all five `fs.watch` handles, re-runs two `git rev-parse` subprocesses, and re-registers the
watches — including the *recursive* watch on `.git/refs/heads`. Because the watcher's own
`onChange` is what calls `refreshWorktreeContext`, the loop is self-reinforcing.

**Evidence:**
```ts
// useContextRefresh.ts
    setWorktreeDiffRefreshToken((token) => token + 1)
    return worktree
  }, [git, runtimesLength, currentWorktree, setContext, setContextStatus, setWorktreeDiffRefreshToken])
```
```ts
// useRefreshWatcher.ts — the effect re-subscribes on any dep identity change
  }, [git, refreshContext, refreshWorktreeContext, refreshHistoryRows])
```
The hook's own docstring even flags the hazard it then reintroduces: *"A leaked watcher is a real
regression, so the teardown return is preserved exactly."*

**Impact:** Any editor save inside the repo causes: 750 ms debounce → worktree refresh → watcher
teardown/rebuild (2 child processes + 5 `fs.watch` registrations). On a large repo the recursive
re-watch is measurably expensive, and any filesystem event that lands in the gap between
`watcher.close()` and the new `createRefreshWatcher()` is silently lost — which is the reported
"the TUI stopped auto-refreshing" symptom. Repro: `coco ui`, then in another terminal
`while true; do touch README.md; sleep 1; done` and watch the process's open-FD count and
`git rev-parse` invocations churn.

**Suggested fix:** Drop `currentWorktree` from the `refreshWorktreeContext` dep array and read the
previous overview through a ref (`currentWorktreeRef.current`) inside the callback — the value is
only used for the `#1617` stale-beats-blank return. That makes the callback stable and the watcher
mount-once-per-`git`.

**Confidence:** high

---

### [SEVERITY: high] fix(workstation): in-flight AI AbortControllers are never aborted on unmount, so `q` leaves the process hanging
**File:** `src/workstation/runtime/hooks/useAiCommitDraftActions.ts:89`, `useChangelogActions.ts:123`, `useCommitSplitActions.ts:126`, `useConflictResolutionActions.ts:65`

**What's wrong:** All four hooks own an `AbortController` in a ref and abort it only from an
explicit `Esc` handler or from a superseding invocation. None of them registers an unmount
cleanup. `grep -n "useEffect" ` across the four files returns no effect at all — the controllers
have no lifecycle tie to the component.

**Evidence:**
```ts
const aiDraftAbortRef  = React.useRef<AbortController | null>(null)   // useAiCommitDraftActions.ts:89
const changelogAbortRef = React.useRef<AbortController | null>(null)  // useChangelogActions.ts:123
const planAbortRef     = React.useRef<AbortController | null>(null)   // useCommitSplitActions.ts:126
const abortRef         = React.useRef<AbortController | null>(null)   // useConflictResolutionActions.ts:65
```

**Impact:** Press `I` (AI commit draft), `L` (changelog), `S` (split plan) or the AI
conflict-resolution key, then immediately `q`. Ink unmounts and `installTerminalLifecycle`
restores the terminal, but the HTTP request to the LLM provider is still pending, so the Node
event loop does not drain — the user's shell prompt does not come back until the provider
responds (30–120 s on a slow model), with no UI and no way to interrupt other than a second
`Ctrl-C`.

**Suggested fix:** In each hook add
`React.useEffect(() => () => { ref.current?.abort(); ref.current = null }, [])`. Keep the same
ownership discipline the `finally` blocks already use.

**Confidence:** high

---

### [SEVERITY: high] fix(workstation): Esc during a PR-body draft gives no feedback and leaves the spinner running
**File:** `src/workstation/runtime/hooks/usePullRequestActions.ts:255-259`

**What's wrong:** `cancelPullRequestBodyDraft` only mutates a boolean on a handle. It dispatches
nothing — no status change, no clearing of `pendingPullRequestBodyDraft`, no abort. The status
line set before the call carries `loading: true`, and `useStatusAutoDismiss` explicitly refuses
to clear a loading line (`if (deps.statusKind === 'error' || deps.statusLoading) return false`).
So the advertised affordance produces zero observable effect until the LLM resolves. Every sibling
cancel (`cancelAiCommitDraft`, `cancelChangelog`, `cancelCommitSplit`) either aborts the controller
or dispatches immediately.

**Evidence:**
```ts
const cancelPullRequestBodyDraft = React.useCallback(() => {
  const handle = pullRequestBodyCancelRef.current
  if (!handle) return
  handle.cancelled = true
}, [])
```
The status it fails to clear:
```ts
value: `generating ${nouns.abbrev} body from changelog (vs ${defaultBranch}) — Esc to skip prompt`,
loading: true,
```

**Impact:** Press `C` to create a PR, then `Esc`. The spinner keeps spinning and the status keeps
saying "Esc to skip prompt" for the whole generation window; users press `Esc` repeatedly, then
conclude the TUI is wedged. Repro: `C` on a feature branch with a slow model, `Esc`, observe the
footer.

**Suggested fix:** In `cancelPullRequestBodyDraft`, after setting `handle.cancelled = true`, also
`dispatch({ type: 'setPendingPullRequestBodyDraft', value: false })` and
`dispatch({ type: 'setStatus', value: \`${nouns.abbrev} draft cancelled.\` })`. Longer term thread
an `AbortSignal` through `runPullRequestBodyWorkflow` so the cancel is hard like its siblings.

**Confidence:** high

---

### [SEVERITY: high] fix(workstation): cellWidth mismeasures the exact status glyphs the UI renders
**File:** `src/workstation/chrome/text.ts:10-26`

**What's wrong:** `WIDE_CHARACTER_RANGES` treats the whole Miscellaneous-Symbols + Dingbats
span `[0x2600, 0x27bf]` as double-width. That is wrong for every text-presentation glyph in
that block, and coco renders several of them. Symmetrically, `U+23F3 ⏳` / `U+231B ⌛` are
genuinely East-Asian-Wide but fall outside every range and measure as 1.

**Evidence:**
```ts
  [0x2600, 0x27bf],
  [0x2b1b, 0x2b1c],
```
Measured by calling the real `cellWidth`:
```
"✓" U+2713 => 2   (terminals render 1)   footer.ts:161, headerChips.ts:206, bisect/index.ts:119
"✗" U+2717 => 2   (renders 1)            footer.ts:159, conflicts/index.ts:62
"⚠" U+26A0 => 2   (renders 1)            footer.ts:160, headerChips.ts:226, overlays.ts:829
"✚" U+271A => 2   (renders 1)            diff/index.ts:524
"❯" U+276F => 2   (renders 1)            conflicts/index.ts:64, rebase/index.ts:83
"⏳" U+23F3 => 1   (renders 2)            detail/index.ts:736, detail/index.ts:1001
```
`chrome/text.test.ts:35-50` covers `✨`, `🫡`, `⭐`, `⬛`, `⭕` — all genuinely wide — and never
exercises the text-presentation dingbats, so the suite passes.

**Impact:** Every truncation budget computed over a line that starts with a status glyph is off
by one. Concretely: the `❯` selection cursor in the conflicts and rebase surfaces makes the
*selected* row's content budget 1 cell shorter than the unselected rows, so the highlighted row
truncates earlier than its neighbours (visible ragged edge that moves with the cursor). The
`⏳ AI draft in progress` line in the inspector is 1 cell *wider* than measured and overflows its
panel. Repro: `gx` on a conflicted repo and move the cursor down the region list at any width;
the selected row's tail shifts.

**Suggested fix:** Replace the hand-rolled range table with a lookup driven by Unicode
`East_Asian_Width=W/F` plus `Emoji_Presentation=Yes` (or vendor `get-east-asian-width`). At
minimum, narrow `[0x2600, 0x27bf]` to the emoji-presentation subranges and add
`[0x231a, 0x231b]`, `[0x23e9, 0x23f3]`. Add the six glyphs above to `text.test.ts`.

**Confidence:** high

---

### [SEVERITY: high] fix(workstation): seven surfaces still pad columns with padEnd instead of padCells, breaking CJK alignment
**File:** `src/workstation/surfaces/blame/index.ts:97`, `fileHistory/index.ts:115`, `reflog/index.ts:78-80`, `submodules/index.ts:92-93`, `remotes/index.ts:68`, `issuesTriage/index.ts:136`, `pullRequestTriage/index.ts:224-225`

**What's wrong:** `padCells` was added specifically because "`String.padEnd` counts UTF-16 code
units, so padding a wide-glyph name … overshoots by one fill character per wide character"
(`chrome/text.ts:139-146`). It was adopted in `branches`, `tags`, `worktrees`, `interactive` and
`splitDiff`, but seven surfaces still compose `truncateCells(value, W).padEnd(W)` — measuring the
value in cells and then padding in code units.

**Evidence:**
```ts
// surfaces/blame/index.ts:97
const author = truncateCells(line.author, AUTHOR_COL_CAP).padEnd(AUTHOR_COL_CAP)
// surfaces/pullRequestTriage/index.ts:224-225
const authorStr = truncateCells(pr.author || '', authorColWidth).padEnd(authorColWidth)
const branchStr = truncateCells(pr.headRefName, branchColWidth).padEnd(branchColWidth)
```
Reproduced with `AUTHOR_COL_CAP = 18`:
```
"Alice Smith"  padEnd cells=18   padCells cells=18
"山田太郎"      padEnd cells=22   padCells cells=18   ← 4 cells of overflow
"张伟"          padEnd cells=20   padCells cells=18
```

**Impact:** On any repo with CJK author names, the blame gutter, file-history list, reflog table,
and issue/PR triage tables lose column alignment — every row with a wide-glyph author shifts the
following columns right by 1 cell per wide character, and rows overrun the panel width so the
right border shows ragged. Repro: `coco ui` on a repo with a CJK-named committer, `gb` (blame) or
`gP` (PR triage).

**Suggested fix:** Replace each `truncateCells(x, W).padEnd(W)` with
`padCells(truncateCells(x, W), W)` and add a lint rule (or a `text.test.ts`-adjacent grep test)
banning `.padEnd(` in `src/workstation/surfaces/**`.

**Confidence:** high

---

### [SEVERITY: high] fix(workstation): command palette and theme picker hardcode 14 list rows and never clamp the window start
**File:** `src/workstation/runtime/overlays.ts:543-545` and `:628-630`

**What's wrong:** Two problems in the same three lines. (a) `listRows` is a literal `14`, not
derived from the panel's `bodyRows`, so the overlay can be taller than the pane it renders into.
(b) `startIndex` has a lower clamp but no upper clamp, so once the cursor passes the middle of a
list the window runs off the end and renders fewer than 14 rows. The shared helper that fixes
exactly this — `clampListWindowStart` in `chrome/layout.ts:291`, added for #1340 — is used by the
list surfaces but was never applied here.

**Evidence:**
```ts
  const listRows = 14
  const startIndex = Math.max(0, selectedIndex - Math.floor(listRows / 2))
  const visible = filtered.slice(startIndex, startIndex + listRows)
```
versus the shared helper it should call:
```ts
export function clampListWindowStart(selected: number, count: number, listRows: number): number {
  return Math.max(0, Math.min(Math.max(0, count - listRows), selected - Math.floor(listRows / 2)))
}
```

**Impact:** (a) At the documented 80×24 floor the inspector body is
`bodyRows = Math.max(8, 24 - 5) = 19` rows, while the palette renders up to
title + input + hint + blank + recent-hint + more-above + 14 items + more-below = 21 rows inside a
2-row border — 23 rows in a 19-row hole. The bottom of the palette and the app footer are pushed
off-screen. (b) With a filter that matches ~20 commands, arrowing to the last entry gives
`startIndex = 19 - 7 = 12`, `slice(12, 26)` → only 8 rows render even though 14 fit: the palette
visibly shrinks as you scroll down and the "↓ N more below" hint disappears. Repro: `stty rows 24`,
`coco ui`, `:` and hold `↓`.

**Suggested fix:** Pass the panel's `bodyRows` into `renderCommandPaletteOverlay` /
`renderThemePickerOverlay` and compute `listRows = Math.max(4, bodyRows - chromeRows)`; replace the
`startIndex` expression with `clampListWindowStart(selectedIndex, filtered.length, listRows)`.

**Confidence:** high

---

## MEDIUM

### [SEVERITY: medium] fix(workstation): split-plan `r` retry is unreachable from the error state the overlay advertises it for
**File:** `src/workstation/runtime/inkInput.ts:1671-1674` (advertised at `src/workstation/runtime/overlays.ts:907`)

**What's wrong:** The overlay intercept only accepts `r` when `status === 'ready'`. In the error
state the keystroke falls through to the block's catch-all `return []`, which consumes it silently.
The overlay renders the opposite instruction.

**Evidence:**
```ts
// inkInput.ts — "`r` retries from the error state (or regenerates from ready…)"
if (inputValue === 'r' && state.splitPlan.status === 'ready') {
  return [{ type: 'startCommitSplit' }]
}
```
```ts
// overlays.ts:907 — only rendered when overlay.error is set
? [h(Text, { key: 'split-plan-error-hint', dimColor: true }, '   Press `r` to retry, `Esc` to cancel.')]
```
**The co-located test encodes the intent but not the behaviour** — `inkInput.test.ts:5570-5584`
is titled *"r retries (re-runs the plan workflow) from the ready state"* and its comment says
*"After an error, the overlay surfaces 'Press `r` to retry' — this keystroke should re-fire
startCommitSplit"*, yet it only builds a `setSplitPlanReady` state. No test covers
`setSplitPlanError` + `r`.

**Impact:** When the split-plan LLM call fails, the overlay tells the user to press `r`; pressing
it does nothing (the key is swallowed, so there is not even a "not wired" status). The only exit is
`Esc` and re-running `S` from scratch. Repro: `S` with the provider unreachable, then `r`.

**Suggested fix:** Change the guard to
`state.splitPlan.status === 'ready' || state.splitPlan.status === 'error'` and add the missing
`setSplitPlanError` case to `inkInput.test.ts`.

**Confidence:** high

---

### [SEVERITY: medium] fix(workstation): failed issue/PR detail fetches are dropped with no message and no retry
**File:** `src/workstation/runtime/hooks/useDetailHydration.ts:196` and `:243`

**What's wrong:** Both debounced forge-detail loaders discard a failed result without writing
anything to context and without surfacing the `message` the forge layer went to the trouble of
producing. Because nothing is written, the effect's `context.*DetailByNumber` dep never changes, so
there is no re-attempt either.

**Evidence:**
```ts
const result = await forge.getIssueDetail(cursored.number)
if (!active || !result.ok) return
```
Contrast the sibling list loaders, which were explicitly fixed for this in `#1633`
(`useTriageListHydration.ts:31-52`): *"The old blanket `safe()` swallowed that into bare
`undefined`, which reads through the render layer as 'still loading' forever — indistinguishable
from a real empty queue."* The detail loaders never got the same treatment.

**Impact:** With `gh` unauthenticated, rate-limited, or the issue deleted, the triage preview pane
stays permanently blank with no explanation, and re-cursoring the row does not retry. Repro:
`GH_TOKEN=bogus coco ui`, `gi`, cursor a row.

**Suggested fix:** Store the failure in the cache as a renderable error shape (mirroring
`triageListFailure`) so the preview pane can print the message, and/or dispatch a `setStatus` with
`kind: 'warning'`.

**Confidence:** high

---

### [SEVERITY: medium] fix(workstation): failed blame / file-history results are cached, permanently disabling retry
**File:** `src/workstation/runtime/hooks/useDetailHydration.ts:285-300` and `:325-340`

**What's wrong:** `getBlame` / `getFileHistory` return `{ ok: false, path, message }` on any git
failure. The effects write the result into `blameByPath` / `fileHistoryByPath` unconditionally, and
the cache-skip guard at the top of the effect (`if (context.blameByPath?.has(path)) return`) then
treats the failure as a satisfied entry forever.

**Evidence:**
```ts
const result = await getBlame(git, path)
if (!active) return
setContext(
  (current) => ({
    ...current,
    blameByPath: new Map(current.blameByPath || []).set(result.path, result),
  }),
  issuedAtDepth,
)
```
`git/blameData.ts:136-141` shows the failure shape being cached:
```ts
} catch (error) {
  const message = error instanceof Error ? error.message : 'git blame failed'
  return { ok: false, path, message }
}
```

**Impact:** A transient `index.lock` contention (very likely, since the watcher fires blame
re-hydration right after external git commands) poisons the cache for that path for the rest of the
session. `useInputHandler` also reads `blameLineCount` as `blame.ok ? blame.lines.length : 0`, so
`j`/`k` become permanently dead on that file. Only a worktree refresh (which clears
`blameByPath`) recovers it. Repro: `gb` on a file while `git gc` holds the lock, then retry `gb`.

**Suggested fix:** Only cache `result.ok === true`; on failure dispatch a warning status and leave
the cache empty so a re-entry retries.

**Confidence:** high

---

### [SEVERITY: medium] fix(workstation): the 5s just-landed-commit timer is never cleared on unmount, so `q` lingers
**File:** `src/workstation/runtime/hooks/useCommitSplitActions.ts:413-418`

**What's wrong:** `recentCommitsTimerRef` is correctly cancelled by the *next* apply (#1627), and
the callback is `mountedRef`-guarded so it will not dispatch into a dead tree — but nothing clears
it on unmount, so the pending `setTimeout` keeps the event loop alive.

**Evidence:**
```ts
recentCommitsTimerRef.current = setTimeout(() => {
  recentCommitsTimerRef.current = null
  if (mountedRef.current) {
    dispatch({ type: 'clearRecentCommits' })
  }
}, 5000)
```
There is no `React.useEffect` anywhere in the file (verified by grep), so no cleanup exists.

**Impact:** Apply a split, then press `q` within 5 s: the terminal is restored but the process does
not exit for the remainder of the 5 s window, so the shell prompt is delayed and the user sees a
hung terminal. Repro: `S`, `y`, `q` immediately.

**Suggested fix:** Add
`React.useEffect(() => () => { if (recentCommitsTimerRef.current) clearTimeout(recentCommitsTimerRef.current) }, [])`.

**Confidence:** high

---

### [SEVERITY: medium] fix(workstation): loadCommitContext can leave a permanent loading status when the append is fully deduplicated
**File:** `src/workstation/runtime/hooks/useLoadMoreHistory.ts:399-418`

**What's wrong:** `loadCommitContext` dispatches a `loading: true` status and then, on the success
path, deliberately dispatches nothing — relying on the cursor-sync effect to re-fire and replace the
status. But that re-fire is triggered by a `state.filteredCommits` identity change; `appendRows`
deduplicates by hash, so an anchored fetch that returns only rows already in the window can leave
`filteredCommits` unchanged, in which case nothing re-fires and nothing clears the status.

**Evidence:**
```ts
dispatch({ type: 'setStatus', value: `Loading commits around ${target.label}…`, loading: true })
…
if (rows.length > 0) {
  dispatch({ type: 'appendRows', rows })
  // Don't dispatch a setStatus here — the cursor-sync effect
  // will re-fire on the appendRows-driven filteredCommits change …
}
```
`useStatusAutoDismiss` cannot rescue it (`if (deps.statusKind === 'error' || deps.statusLoading) return false`).

**Impact:** Cursor a branch/tag/stash whose target is present in the loaded rows only under a
short-hash form the resolver's `Set` lookup misses: the "Loading commits around X…" spinner sticks
until the next status-producing keystroke.

**Suggested fix:** Dispatch a terminal status on the append path as well (or clear
`loading` explicitly) rather than relying on a downstream effect to fire. Repro requires an anchored
fetch whose rows are all duplicates — **needs verification** that `appendRows` can return a
reference-identical `filteredCommits`; check the `appendRows` reducer case in `inkViewModel.ts` for
an early `return state` when no new hashes are added.

**Confidence:** needs-verification

---

### [SEVERITY: medium] fix(workstation): any open choice prompt bypasses the central confirmation gate for every workflow
**File:** `src/workstation/runtime/hooks/useInputHandler.ts:600-612`

**What's wrong:** The `#1445` centralized confirmation gate treats "a choice prompt is open" as
blanket consent for *any* workflow id, not just the one the choice offered.

**Evidence:**
```ts
const alreadyConfirmed =
  event.confirmed ||
  state.pendingConfirmationId === event.id ||
  Boolean(state.pendingChoice)
if (workflow?.requiresConfirmation && !alreadyConfirmed) {
  dispatch({ type: 'setPendingConfirmation', value: event.id, payload: event.payload })
} else {
  void runWorkflowAction(event.id, event.payload)
}
```

**Impact:** If any keystroke path can emit a `runWorkflowAction` event while `state.pendingChoice`
is set, a destructive workflow (`delete-branch`, `reset-to-commit`, `drop-stash`) runs with no
y/n gate. The recovery prompts raised by `useWorkflowAction` (`worktree-checkout-conflict`,
`diverged-pull-recovery`, `operation-conflict-recovery`, `fixup-autosquash-offer`) all leave
`pendingChoice` set while the user reads them.

**Suggested fix:** Narrow the third clause to
`state.pendingChoice?.options.some((o) => o.workflowId === event.id)`.
**Needs verification:** confirm whether the choice overlay in `overlayInput.ts` /
`getLogInkInputEvents` claims *every* keystroke while `pendingChoice` is set. If it does, this is
latent rather than live — but the gate should still be narrowed, because the comment claims
per-choice consent that the code does not implement.

**Confidence:** needs-verification

---

### [SEVERITY: medium] fix(workstation): `truncateCells` silently drops the ellipsis at narrow budgets
**File:** `src/workstation/chrome/text.ts:159-160`

**What's wrong:** The suffix is only attached when `width > cellWidth(ellipsis)` — a strict `>`.
With the default unicode `…` (1 cell) a budget of exactly 1 yields no marker; with
`theme.ascii` (`...`, 3 cells) any budget of 1–3 yields no marker. The function then returns a
truncated string that is visually indistinguishable from a complete one.

**Evidence:**
```ts
const ellipsis = options.ascii ? '...' : '…'
const suffix = width > cellWidth(ellipsis) ? ellipsis : ''
const available = width - cellWidth(suffix)
```

**Impact:** In ASCII/no-color mode at the 80-column floor, narrow columns (the reflog `hashColWidth`,
the triage `numberColWidth`, single-pane sidebar labels) render silently-clipped values — a branch
name `feature/a` shown as `fea` reads as a real ref. Repro: `COCO_ASCII=1 coco ui` at 80 columns on
a repo with long ref names.

**Suggested fix:** Use `>=` and, when the budget cannot hold the ellipsis plus at least one content
cell, fall back to the 1-cell `…` even in ascii mode (or return the marker alone).

**Confidence:** high

---

### [SEVERITY: medium] fix(workstation): `wrapCells` returns unwrapped text when the budget is non-positive
**File:** `src/workstation/chrome/text.ts:60-62`

**What's wrong:** The `width < 1` guard returns `[value]` — the caller asked for a wrapped result
and gets an arbitrarily long single line instead.

**Evidence:**
```ts
export function wrapCells(value: string, width: number): string[] {
  if (width < 1) {
    return [value]
  }
```
The compose surface's budget is floored (`Math.max(8, width - 6)`), but the layout can hand
`width: 0` to a hidden pane — `getLogInkLayout`'s single-pane branch sets the two non-visible
panes to `sidebarWidth: 0` / `mainPanelWidth: 0` / `detailWidth: 0` (`layout.ts:249-253`).

**Impact:** Any surface that wraps against a pane width without its own floor will emit a single
unbounded line into a zero-width Box, which Ink renders as an overflowing row that corrupts the
frame. **Needs verification:** confirm whether any `wrapCells` call site can receive a
layout-derived width of `0` without an intervening `Math.max` — grep the `wrapCells(` call sites in
`surfaces/**` and check each width expression.

**Suggested fix:** Return `[]` (or `['']`) for `width < 1`, and floor every pane-derived width at
the call sites.

**Confidence:** needs-verification

---

### [SEVERITY: medium] fix(workstation): `useHistoryRefetch` re-runs on every `logArgv` identity change
**File:** `src/workstation/runtime/hooks/useHistoryRefetch.ts:172`

**What's wrong:** The dep array lists `logArgv`, an object. If any caller of `LogInkApp` recreates
the argv object per render (rather than passing a stable prop), every render fires a fresh
`git log` — bumping `historyRefetchGenerationRef`, which is also the counter
`useDeferredBootLoad` and `useHistoryRefresh` use for their stale-resolve guards. That would make
those guards fire spuriously and drop legitimate results.

**Evidence:**
```ts
  }, [dispatch, git, logArgv, historyFetchArgs, fullGraph])
```
```ts
historyRefetchGenerationRef.current += 1
const issuedRefetchGeneration = historyRefetchGenerationRef.current
```

**Impact:** Repeated `git log` subprocesses and dropped boot/refresh results. **Needs
verification:** confirm `deps.logArgv` reaching `LogInkApp` is referentially stable (check the
`coco ui` / `coco log --interactive` entry points in `src/commands/log/`). If it is stable, this
is a latent fragility rather than a live bug and should be documented with a `useMemo`/ref guard.

**Confidence:** needs-verification

---

## LOW

### [SEVERITY: low] fix(workstation): `openInEditor` does not pause Ink's stdin before spawning the editor
**File:** `src/workstation/runtime/hooks/useEditorActions.ts:97-100`

**What's wrong:** The handler drops raw mode and writes the alt-screen exit, but leaves Ink's
`stdin` `data` listener attached and the stream flowing while `spawnSync` runs with
`stdio: 'inherit'`. Ink's own `useStdin().setRawMode` refcount is bypassed entirely, so Ink still
believes raw mode is on.

**Evidence:**
```ts
stdin.setRawMode?.(false)
out.write(`${SHOW_CURSOR}${EXIT_ALT}`)
const result = spawnSync(editor, [...editorPrefixArgs, path], { stdio: 'inherit' })
```

**Impact:** Parent and child share the TTY fd with the parent's read stream still in flowing mode.
`spawnSync` blocks the loop so the practical exposure is limited to bytes buffered at the moment of
the call, but any such bytes are delivered to Ink's handler after the editor exits — a stray
keystroke firing a workstation action. `useChangelogActions.openChangelogInEditor` has the
identical shape. **Needs verification:** reproduce by typing ahead into `$EDITOR` and checking
whether a workstation action fires on return.

**Suggested fix:** `stdin.pause()` / `stdin.resume()` around the spawn (or route through Ink's
`useStdin().setRawMode` so the refcount and listener state stay coherent).

**Confidence:** needs-verification

---

### [SEVERITY: low] fix(workstation): `reword-head` rewrites HEAD without the confirmation its sibling `amend-head` requires
**File:** `src/workstation/runtime/inkWorkflows.ts` (registry entry for `reword-head`)

**What's wrong:** Enumerating the registry against `HISTORY_REWRITE_WORKFLOW_IDS`
(`useWorkflowAction.ts:157-168`) shows exactly one history-rewriting workflow with no
`requiresConfirmation`:
```
--- history-rewriting workflows WITHOUT requiresConfirmation ---
  reword-head {"kind":"normal","label":"Reword HEAD commit message"}
```
All 9 siblings (`amend-head`, `reset-to-commit`, `cherry-pick-commit`, `revert-commit`,
`fixup-into-commit`, `autosquash-rebase`, `interactive-rebase`, `execute-rebase-plan`,
`rebase-onto-branch`) gate on a y-confirm.

**Impact:** `reword-head` rewrites the HEAD commit (invalidating any push) with no confirmation
step. Consent is arguably implicit because the flow opens an input prompt for the new message, but
the asymmetry with `amend-head` — which also prompts *and* confirms — means the same class of
rewrite has two different safety levels.

**Suggested fix:** Either add `requiresConfirmation: true` for parity, or document the
"prompt implies consent" rule and drop it from `amend-head` too. Add a registry-invariant test
asserting every id in `HISTORY_REWRITE_WORKFLOW_IDS` follows the chosen rule.

**Confidence:** high (the asymmetry is verified; whether it is *wrong* is a product call)

---

### [SEVERITY: low] fix(workstation): workspace debug mode installs a SIGINT handler that suppresses default Ctrl-C termination
**File:** `src/workstation/surfaces/workspace/runtime.ts:382-383`

**What's wrong:** Installing a `SIGINT` listener replaces Node's default hard-exit. The handler only
logs and flushes; it never exits. Unlike `terminalLifecycle.ts`, which pairs every `process.on` with
a `process.off` in `dispose()`, these are never removed.

**Evidence:**
```ts
process.on('SIGINT', () => { workspaceDebug('SIGINT'); flushWorkspaceTrace() })
process.on('SIGTERM', () => { workspaceDebug('SIGTERM'); flushWorkspaceTrace() })
```

**Impact:** With the workspace debug env var set, `Ctrl-C` no longer terminates the process in any
window where the TTY is in cooked mode (notably during a `$EDITOR` spawn, which explicitly calls
`setRawMode(false)`) — the app becomes un-interruptible and needs `kill`. Guarded behind
`workspaceDebugEnabled()`, so end users are not normally exposed. **Needs verification:** confirm
the env-var name and that raw mode is genuinely off during the editor window.

**Suggested fix:** Re-raise after flushing (`process.exit(130)`) or install the handler with
`{ once: true }` and a manual default-behaviour replay; expose a `dispose()` like
`terminalLifecycle` does.

**Confidence:** needs-verification

---

## Notes on the 42 `react-hooks/exhaustive-deps` warnings

I enumerated all 42 (`npx eslint 'src/workstation/**/*.ts' --rule '{"react-hooks/exhaustive-deps":"warn"}'`).
Classification:

**Benign (34).** Omitted `useState` setters (`setStashDiffLines`, `setWorktreeDiff`,
`setBlameLoading`, `setFilePreview`, `setPrDiffLines`, `setHasMoreCommits`, …) and omitted refs
(`mountedRef`, `loadMoreRequestRef`, `loadingMoreCommitsRef`, `repoFrameDepthRef`,
`historyRefetchGenerationRef`, `contextStatusRef`, `loadCommitContextRef`, `repoRootRef`). React
guarantees setter identity and ref-object identity across renders, so these cannot go stale.

**Benign-by-design (5).** The four warnings that name `selected` / `selectedWorktreeFile` /
`selectedDetailFile` while the array lists their scalar sub-fields (`useCommitDetailHydration.ts:155`,
`useDiffHydration.ts:402/507/634`) — the effects only read the enumerated scalars from those objects,
so keying on the scalars is *narrower* and correct (it is what prevents a refetch on every context
refresh). `useDeferredBootLoad.ts:117` is an intentional `[]` one-shot with a documented rationale.

**Real, but latent rather than live (2).**
- `useDetailHydration.ts:212` / `:258` and `useTriageListHydration.ts:123` / `:215` omit `forge`.
  `forge` is a `useMemo` keyed on the provider; in practice `git` (which *is* a dep) changes on the
  same repo-frame transition that changes `forge`, so the effects do re-fire. This is a correctness
  coupling that is not stated anywhere — if `git` ever becomes stable across a provider change
  (e.g. a host/provider override applied in place), the loaders will silently keep the old adapter.
  Worth documenting or fixing.
- `useYankActions.ts:300` enumerates `state.selected*Index` for every view but omits the
  `state.selected*Id` fields that the `#1452` selectors now read
  (`selection.ts:107-113`, `:190-196`, `:216-222`, and the `selectedWorktreeListId` /
  `selectedSubmoduleId` / `selectedRemoteId` / `selectedIssueId` /
  `selectedPullRequestTriageId` arms). Today the move actions dual-write id **and** index, so the
  index dep changes whenever the id does and the callback regenerates. This is exactly the drift
  `useWorkflowAction.ts:319-327` was rewritten (to a `depsRef` snapshot) to eliminate after it
  *"shipped wrong-target destructive actions"*. `useYankActions` is the last enumerated-array
  holdout and should adopt the same `depsRef` pattern before phase 3 of the #1452 migration removes
  the `selected*Index` fields — at which point the array silently stops tracking the cursor.
  **Needs verification** that no reducer case writes `selected*Id` without also writing
  `selected*Index`.

**One real memo mismatch, benign.** `buildFilteredLists.ts:210` names `context` and `sorts`; the
array lists every consumed `context.*` slice plus `sorts.branchSort` / `sorts.tagSort`, which is the
complete read set. `app.ts:1068` (`Box`/`Text`/`h`/`React`) is injected-module identity — stable.

---

## Areas I checked and found clean

- **`useDiffHydration`** — all five loaders correctly flip `active` in cleanup, wrap the fetch in
  `safe()`, and clear the `*Loading` flag on the guard-fail bail (the exact class of stuck-spinner
  bug the audit was looking for, and it is handled in every arm). The `#OSS-595` debounce+cache in
  `useCommitFilePreviewHydration` clears its timer in cleanup.
- **`useLoadMoreHistory` / `useHistoryRefetch` / `useDeferredBootLoad`** — the generation/request-id
  and `issuedAtDepth` frame-tag guards are checked *after* every await, and the `#1612` fix correctly
  captures *and* re-checks the shared `historyRefetchGenerationRef` (not just the hook-local
  request id). The `state.repoStack.length` rescope effect correctly resets the in-flight flags that
  a dropped completion would otherwise strand.
- **`useAiCommitDraftActions` / `useChangelogActions` / `useCommitSplitActions` /
  `useConflictResolutionActions`** — the controller-ownership discipline (`ref.current !== controller`
  checked after the await, `finally` clearing only its own controller) is correct in all four, and
  `onStreamChunk` is both `mountedRef`- and ownership-guarded. The only gap is unmount (reported
  above).
- **`useWorkflowAction`** — the `depsRef` snapshot removes the whole stale-closure class; the
  `remoteOpClaimRef` / `pendingItemActionClaimRef` tokens correctly prevent an earlier overlapping
  remote op from clearing a later one's loader; the `frameChanged` re-read of `depsRef.current`
  after the await correctly drops recovery prompts across a repo-frame transition.
- **`chrome/refreshWatcher.ts`** — `close()` disposes the debouncer and every `FSWatcher`; the
  `safeWatchFileViaParent` indirection correctly survives git's write-lock-then-rename (a direct
  file watch would sit on the orphaned inode). `useRefreshWatcher`'s `cancelled` check sits between
  the awaits and the assignment with no gap, so no watcher can leak on a fast unmount.
- **`chrome/terminalLifecycle.ts`** — every `process.on` has a matching `process.off` in `dispose()`;
  the SIGTSTP/SIGCONT/SIGTERM/SIGHUP restore sequences are complete and idempotent.
- **`useSpinnerFrame` / `useIdleTip` / `useStatusAutoDismiss`** — all three clear every timer in
  cleanup, including `useIdleTip`'s nested `setInterval` created inside the grace `setTimeout`.
- **`useRepoPersistence`** — the `#1598` `restoredGitRef` gate does close the
  restore-vs-save ordering race for both plain mount and the git-swap case; the save effects'
  deliberate inline `revparse` (rather than reading the lagging `repoRootRef`) is correct.
- **Destructive-workflow confirmation coverage** — 45 of 110 registry entries declare
  `requiresConfirmation`, and every delete/drop/reset/revert/discard/remove/force/abort/prune id has
  it (only `reword-head` is the reported gap). `inkKeymap.collisions.test.ts` correctly guards the
  declarative binding table against same-context duplicates with an empty allow-list.
- **`wrapCells` hard-split loop** — the `chunk === ''` fallback genuinely prevents the documented
  infinite loop when the budget is narrower than one wide glyph, and `remaining.slice(chunk.length)`
  is code-unit-correct because `chunk` is built as a code-unit prefix.
- **List-window clamping in the surfaces** — `blame`, `fileHistory`, `rebase`, `reflog`, `remotes`,
  `submodules`, `stash`, `tags`, `worktrees`, `branches`, `status`, `issuesTriage`,
  `pullRequestTriage` all clamp both ends (`Math.max(0, Math.min(count - listRows, …))`) or route
  through `clampListWindowStart`; no negative or inverted `slice` ranges. Only the two overlay lists
  in `overlays.ts` are unclamped (reported above).
- **`getLogInkLayout` at the 80×24 floor** — `tooSmall` is correctly `false` at exactly 80×24,
  `singlePane` engages below 100 columns, and the single-pane width assignment does tile exactly
  (`columns` to the visible pane, `0` to the other two).
