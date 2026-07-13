# Workstation

The Ink-based TUI that ships behind `coco ui` and `coco log -i`. Sixteen top-level views, chord-driven (`g<key>`) navigation, keyboard-only by design.

For user-facing docs:
- [Interactive Log TUI](https://github.com/gfargo/coco/wiki/Interactive-Log-TUI) — keymap, configuration, screenshots.

This README is for contributors. It explains where things live, how a keypress becomes a screen update, and the smallest set of changes to add a view or key binding.

## Layout

```
src/
├── commands/log/             ← `coco log` the CLI command only — the workstation promotion (#1638) is done
│   ├── handler.ts            ← `coco log` command entrypoint
│   ├── config.ts             ← `LogOptions` / yargs option definitions
│   ├── render.ts             ← stdout formatter for the non-interactive path
│   └── commitCompose.ts      ← Compose-surface state slice
│
├── git/                      ← Shared data layer (overview loaders + workstation-shaped actions)
│   ├── logData.ts            ← `getLogRows` + `getCommitDetail` + GitLogRow / GitCommitDetail types
│   ├── branchData.ts         ← `getBranchOverview`, BranchRef, BranchOverview
│   ├── branchActions.ts      ← `checkoutBranch`, `createBranch`, `deleteBranch`, …
│   ├── pullRequestData.ts    ← `getPullRequestOverview`, PR / status-check types
│   ├── tagData.ts            ← `getTagOverview`, GitTagRef, TagRangeSummary
│   ├── stashData.ts          ← `getStashOverview`, StashEntry
│   ├── statusData.ts         ← `getWorktreeOverview`, file groups, conflict detection
│   ├── statusHunks.ts        ← Hunk parsing + per-hunk staging helpers
│   ├── reflogData.ts         ← `getReflogOverview` (200-row default cap)
│   ├── bisectData.ts         ← BISECT_LOG parsing + completion detection
│   ├── bisectActions.ts      ← Thin wrappers around `git bisect <verb>`
│   ├── operationData.ts      ← In-progress merge / rebase / cherry-pick detection
│   ├── operationActions.ts   ← `continueOperation`, `abortOperation`, conflict resolution
│   ├── providerData.ts       ← Provider URL builders (GitHub, GitLab, Bitbucket)
│   ├── providerActions.ts    ← `openProviderUrl` (xdg-open / `open`)
│   ├── worktreeData.ts       ← `getWorktreeListOverview`, WorktreeEntry
│   ├── worktreeActions.ts    ← `createWorktree`, `removeWorktree`
│   ├── worktreeDiffData.ts   ← Per-worktree file diff
│   ├── compareData.ts        ← `getCompareDiff` for `m`-mark cross-view ref compare
│   ├── historyActions.ts     ← Cherry-pick, revert, reset, rebase, copy-hash
│   ├── hunkActions.ts        ← Patch application for stage / unstage / revert
│   ├── stashActions.ts       ← `applyStash`, `popStash`, `createStash`, `dropStash`
│   ├── statusActions.ts      ← `stageFile`, `unstageFile`, `revertFile`
│   ├── tagActions.ts         ← Annotated / lightweight tag create + push + delete
│   ├── pullRequestActions.ts ← `createPullRequest` (uses `gh`)
│   ├── commitWorkflowActions.ts ← Drives `coco commit` from inside the TUI
│   └── aiActions.ts          ← Drives AI-generated commit messages / changelogs
│
└── workstation/
    ├── runtime/              ← Render layer + app shell + state/input orchestration, fully promoted out of `commands/log/` (#890, #1638)
    │   ├── app.ts            ← `LogInkApp` component: state, effects, async dispatchers, top-level render tree
    │   ├── inkRuntime.ts     ← Boot shim: TTY vs non-TTY path, dynamic ESM import of ink/react, mounts `LogInkApp`, installs lifecycle handlers
    │   ├── inkInput.ts       ← Global onKey switch — routes keypresses to view-specific handlers
    │   ├── inkViewModel.ts   ← `LogInkState`, `LogInkAction`, `applyLogInkAction` reducer
    │   ├── inkKeymap.ts      ← Chord prefix model, key bindings, footer hint generation
    │   ├── inkWorkflows.ts   ← Workflow registry — id + kind + handler for every confirmable action
    │   ├── interactive.ts    ← Non-TTY (CI / pipe) snapshot fallback renderer
    │   ├── interactiveState.ts ← State slice backing the snapshot fallback
    │   ├── header.ts         ← Header / breadcrumb renderer
    │   ├── sidebar.ts        ← Repository sidebar (accordion tabs)
    │   ├── mainPanel.ts      ← Main-panel dispatcher → per-view surface (builds the `SurfaceRenderContext` bundle)
    │   ├── detailPanel.ts    ← Inspector-panel dispatcher → per-view detail / overlay (still positional args)
    │   ├── footer.ts         ← Two-row status + hint footer
    │   ├── overlays.ts       ← Help / palette / confirmation / chord / onboarding overlays
    │   ├── types.ts          ← `SurfaceRenderContext` (#1136 — the render bundle every main surface takes) + runtime types
    │   └── …                 ← repo-stack runtime, diff line render, drill-in resolvers
    │
    ├── surfaces/<view>/      ← Per-view render modules — each `render<View>Surface(ctx: SurfaceRenderContext, …extras)` (history, status, diff, branches, tags, stash, compose, conflicts, reflog, bisect, …)
    │
    └── chrome/               ← Cross-cutting visual + state + lifecycle utilities (this directory's reason for existing)
        ├── theme.ts          ← `LogInkTheme` resolver, `NO_COLOR` honoring; re-exports `THEME_PRESET_COLORS`
        ├── themePresets.ts   ← `THEME_PRESET_COLORS` data table (one source of truth for themes, #1640)
        ├── colorSupport.ts   ← Terminal color-level detection (`COLORTERM`, `TERM`)
        ├── layout.ts         ← Width / height splitter for sidebar | main | detail
        ├── iconography.ts    ← Glyphs for sidebar tabs, status, refs (theme-aware)
        ├── text.ts           ← Truncation, padding, ellipsis helpers
        ├── hyperlinks.ts     ← OSC-8 terminal hyperlink wrapper (gated by capability detection)
        ├── graphChars.ts     ← ASCII → Unicode commit-graph character substitution
        ├── graphLanes.ts     ← Pattern-junction graph rendering with lane color
        ├── splitDiff.ts      ← Side-by-side diff layout (#785)
        ├── onboarding.ts     ← First-run overlay copy + dismissal marker
        ├── idleTips.ts       ← Idle status-line tip rotation (opt-in via `logTui.idleTips`)
        ├── previewPane.ts    ← Branch / tag / stash preview panel renderers
        ├── pullRequestPanel.ts ← PR overview panel renderer
        ├── stashHeader.ts    ← Stash header row renderer
        ├── surfaceStates.ts  ← Empty / loading copy per surface
        ├── historyRows.ts    ← Commit history row formatter
        ├── hunkExtraction.ts ← Hunk slicing + line classification for the diff view
        ├── inspectorActions.ts ← Inspector panel action menu
        ├── sorting.ts        ← Stable comparators for branches / tags / stashes
        ├── context.ts        ← Per-context-key load state (`idle | loading | ready`)
        ├── overviewCache.ts  ← Per-repo disk cache of last `git log` (#808 — instant first paint)
        ├── sidebarSelection.ts ← In-sidebar j/k navigation + visible-window calculation
        ├── sidebarPersistence.ts ← Per-repo last-active sidebar tab marker
        ├── diffViewModePersistence.ts ← Per-repo unified-vs-split diff preference
        ├── selectionRectify.ts ← Promoted-view cursor rectification on filter changes
        ├── refreshWatcher.ts ← Auto-refresh on `.git/` mtime changes (worktree vs full kind)
        ├── terminal.ts       ← Terminal capability probing
        └── terminalLifecycle.ts ← SIGTSTP / panic handlers — never leave terminal in alt-screen
```

## How a keypress becomes a screen update

Single-direction flow. No two-way bindings, no observable mutation outside the reducer.

```
TTY raw bytes
     │
     ▼
inkInput.ts        ← onKey(input, modifiers, context)
     │             ← global switch: chord prefix? input prompt? per-view handler?
     ▼
inkKeymap.ts       ← chord lookup → workflow id OR direct LogInkAction
     │
     ▼
inkWorkflows.ts    ← workflow registry → handler runs (often async, hits src/git/)
     │
     ▼
inkViewModel.ts    ← applyLogInkAction(state, action) → next LogInkState
     │
     ▼
workstation/runtime/app.ts
     │             ← LogInkApp re-renders with new state
     │             ← renderHeader · renderSidebar · renderMainPanel · renderDetailPanel · renderFooter
     │               (per-view render under workstation/surfaces/<view>/)
     ▼
Ink                ← reconciles to terminal
```

A few invariants worth knowing before changing any of those modules:

- **The reducer is pure.** `applyLogInkAction(state, action)` never throws, never reads the file system, never calls git, never calls `Date.now()`. Side effects (and time, treated as a side effect) belong in workflows; timestamps arrive on action payloads.
- **Workflows return actions.** A workflow that succeeds dispatches a `LogInkAction` via the runtime; failures dispatch a status-message action. The reducer is the only place state changes.
- **Confirmation gating is data, not control flow.** Workflows declare `requiresConfirmation: 'y' | 'enter'` in `inkWorkflows.ts`; the runtime intercepts and routes through the y-confirm overlay.
- **Re-renders are cheap.** Ink reconciles the React tree on every state change; render helpers are pure functions of their inputs — main-panel surfaces take the `SurfaceRenderContext` bundle (see the *Render bundle* convention below) plus their own slices, not `(state, theme, layout)` threaded positionally (#1136).
- **A runtime Context provider is installed but not yet consumed.** `LogInkApp` wraps its tree in a `LogInkRuntimeContext` provider (`runtime/runtimeContext.ts`) carrying `{ state, dispatch, theme, layout, context }`. Surfaces today read from the `SurfaceRenderContext` bundle (an explicit param), not `useContext` — the surfaces are pure render *functions*, not components. The provider is there so a surface can later become a thin component and read ambiently with zero body changes; until then it renders transparently. The factory exists because the workstation never statically imports React (ink/react load via dynamicImport at boot), so the Context is built from the runtime React instance.

## Async LLM calls + cancellation (#881)

LLM-driven workflows have their own conventions because they live across several boundaries (workstation → `src/git/` workflow → `src/lib/langchain/` → provider API) and the user can change their mind mid-call.

- **Streaming is opt-in.** Wire calls through `executeChainStreaming` (sibling of `executeChain`) when the surface has a place to render a live preview. Gated by `service.streaming.enabled` (default `false`). The streaming function returns the final parsed value just like `executeChain`; the only difference is the `onChunk` callback that fires per text fragment.
- **Cancel via `AbortController`.** The runtime callback that owns an LLM call creates a controller per invocation and stashes it in a ref (`aiDraftAbortRef`, etc.). The input handler's cancel binding reads the ref synchronously and calls `controller.abort()`. The signal threads through the workflow to `executeChainStreaming` which forwards it into `chain.stream(input, { signal })`. The HTTP transport tears down cleanly.
- **Cancel is a structured result, not an error.** When the signal aborts mid-stream, `executeChainStreaming` throws `LangChainCancelledError` (distinct class so callers can pattern-match). The wrapping workflow (e.g. `runCommitDraftWorkflow`) catches and translates to `{ ok: false, cancelled: true, message: 'AI draft cancelled.' }`. The runtime treats `cancelled` separately from `ok: false` failures — no error styling, no retry, just clean up the spinner and preview.
- **Streaming preview is preview-only.** The final draft goes through the same parser / schema validator / commitlint retry as the non-streaming path. The `onChunk` callback feeds a chrome formatter (`chrome/streamingPreview.ts`) that produces last-N-lines view; the surface renders it below the loader. When the call settles, the preview clears and the validated final draft lands in the editable fields.
- **Stdout commands stay non-streaming.** `coco commit --mode stdout` and `coco review` (CLI) have output contracts that pipes, hooks, and CI scripts depend on. Don't add streaming there.
- **Cancel keystrokes are not view-gated.** The user might chord-navigate away during a long LLM call; Esc cancel must work from any view while the loading flag is set. This was an audit finding (#5) — keep it in mind when adding new cancel bindings.
- **`pendingAiDraft` confirmation flow.** If the user has typed content in the compose surface and then fires an AI draft, the draft stages in `commitCompose.pendingAiDraft` rather than replacing their typing. `R` accepts (typing → AI draft), `Esc` dismisses (typing preserved). This was audit finding #7; the routing happens inside the `setDraft` reducer based on whether `summary` or `body` has non-whitespace content.

## Nested-repo navigation (#931)

Drilling into a submodule is the mental equivalent of spawning another `coco ui` instance scoped to that submodule's working directory. The implementation reuses the existing reducer / surfaces / chrome — the only thing that changes when the user drills in is *which `SimpleGit` instance* the loaders run against.

Two parallel structures keep it honest:

- **View-model side** (`LogInkState.repoStack`) is pure data — an ordered list of `LogInkRepoFrame { label, workdir?, parentReturn?, entryRange? }`. The reducer's `pushRepoFrame` / `popRepoFrame` actions are the only things that mutate it.
- **Runtime side** (`runtime/repoStackRuntime.ts`) lives in `LogInkApp` state — an ordered list of `RepoFrameRuntime { git, context, contextStatus }`. The sync effect reconciles it against `state.repoStack` every time the stack changes; push appends, pop slices, factory builds a fresh `simpleGit(workdir)` for new frames.

The active frame (top of stack) projects `git` / `context` / `contextStatus` for every existing closure to read. Effects with `[git, ...]` deps re-fire automatically on push / pop. Cached context survives a drill-out cycle so popping back is instant.

**Entry points:**

- **Commit-diff** (`runtime/repoFrameDrillIn.ts::resolveCommitDiffDrillInTarget`) — Enter on a submodule file in the diff view. Captures `(oldPin, newPin)` from the file preview's `submoduleChange`.
- **Submodules view** (`::resolveSubmoduleViewDrillInTarget`) — Enter on a row in the dedicated `gM` view. No range; lands on the submodule's full history.

**Exit:** Esc / `<` / palette `navigateBack` — drains the frame's view stack first, then pops the frame. Breadcrumb in the header (`coco › vendor/lib   ← esc`) shows the user where they are.

**Adding another entry point:** write a pure resolver next to the existing two, plumb its output through the input dispatch context (`LogInkInputContext`), and dispatch `pushRepoFrame` from the matching Enter handler. The runtime side handles the rest.

## Adding a new top-level view

The bisect view (`g B`) is the most recent worked example — see PRs [#868, #885–#889]. Concrete touch list:

1. **Data layer** (`src/git/<view>Data.ts`) — write the `getXxxOverview(git)` loader. Keep it pure-shape; no rendering decisions.
2. **Actions** (`src/git/<view>Actions.ts`, optional) — wrappers around the underlying git commands the view needs to mutate.
3. **State slice** (`src/workstation/runtime/inkViewModel.ts`) — add the view ID to `LogInkView`, add fields to `LogInkState`, add the load / clear actions to the `LogInkAction` union, handle them in `applyLogInkAction`.
4. **Keymap** (`src/workstation/runtime/inkKeymap.ts`) — add the chord binding (`g <letter>`) and the per-view footer hint.
5. **Workflows** (`src/workstation/runtime/inkWorkflows.ts`) — register any palette-reachable workflows (mutations, multi-step flows). Inline keypress handlers don't need a registration.
6. **Input dispatch** (`src/workstation/runtime/inkInput.ts`) — add the per-view branch in the `onKey` switch.
7. **Render** (`src/workstation/surfaces/<view>/`) — write `renderXxxSurface(ctx: SurfaceRenderContext, …extras)`. The `SurfaceRenderContext` bundle (#1136, defined in `runtime/types.ts`) carries the universal render values — `h`, `components`, `state`, `context`, `contextStatus`, `bodyRows`, `width`, `theme` — so you destructure what you need instead of accepting eight positional props; pass any surface-specific values (diff hunks, spinner frame, loading flags) as your own explicit params after it. Add the `activeView` branch in `workstation/runtime/mainPanel.ts` that calls your surface with the `surface` bundle (the inspector half still wires through `detailPanel.ts` with positional args). Use `chrome/surfaceStates.ts` for empty / loading copy.
8. **Tests** — at minimum: data parser fixtures, reducer state transitions, a render snapshot of empty / populated / error states.

Phase 5 of [#890](https://github.com/gfargo/coco/issues/890) has landed, so step 7 already lives under `workstation/surfaces/<view>/`. Once phases 6–7 land, steps 3 and 6 will likewise move into per-surface modules under `workstation/state/` and `workstation/state/input/`.

## Adding a new key binding

**Read [`KEYMAP.md`](./KEYMAP.md) first** — it's the deliberate map of every
key, the overload table (which letters already mean different things in
different views), and the dispatch-precedence rules that keep those overloads
safe. Single keys are dense here; check the map before claiming one.

For an inline keypress on an existing view, you only need:

1. The handler in the per-view branch of `inkInput.ts`.
2. The footer hint in `inkKeymap.ts` — it must name what the handler actually
   does (a footer that lies about a key is a bug).
3. The declarative entry in `LOG_INK_KEY_BINDINGS` (so it shows in `?` help and
   the `:` palette). `inkKeymap.collisions.test.ts` fails the build if your
   `(key, context)` pair is already taken.
4. (If the action needs y-confirm) a workflow registration in `inkWorkflows.ts` with `requiresConfirmation`.
5. Update `KEYMAP.md` in the same PR.

For a global chord (e.g. a new `g <letter>` view selector), the chord goes in `inkKeymap.ts` plus the route into the action / view-switch in the reducer.

KEYMAP.md's [Design doctrine](./KEYMAP.md#design-doctrine) section states the interaction paradigms worth holding new views to — read it alongside the map itself.

## Calling existing CLI commands from a workstation flow

When a workstation flow needs the full behavior of a `coco <command>` (commit message generation, changelog body for PR creation, etc.), invoke the command's **core generation function** directly with a synthetic `argv` rather than spawning a subprocess. The pattern lives in `src/git/commitWorkflowActions.ts` and `src/git/aiActions.ts`:

```ts
// Synthetic argv shape: mode 'stdout', interactive false, silent logger
const argv = createChangelogArgv({ branch: 'main' })

// Call the pure core function — returns { text, structured } with no I/O
const { text } = await generateChangelogResult(argv, new Logger({ silent: true }))

// Parse / return a typed *WorkflowResult shape
return { ok: true, message: firstLine(text), text }
```

**Important:** Do not use `captureStdout(() => handler(...))` in TUI flows. That approach monkey-patches the global `process.stdout.write` for the duration of the LLM call (potentially 5–15s), which intercepts Ink's live render frames and corrupts the TUI display. Always call the pure core function that returns a value directly instead. (See coco#1327 for the details of what goes wrong.)

Worked examples:

- `runCommitDraftWorkflow` → drives `coco commit` AI-draft generation from the compose surface's `I` keystroke (`src/git/commitWorkflowActions.ts`)
- `runCommitWorkflow({ action: 'commit' | 'split-plan' | 'split-apply' })` → drives `coco commit` and its `--split` modes (`src/git/commitWorkflowActions.ts`)
- `runChangelogTextWorkflow({ branch | sinceLastTag | tag | range })` → drives `coco changelog` via `generateChangelogResult` and returns raw text (`src/git/aiActions.ts`)
- `runPullRequestBodyWorkflow({ baseBranch })` → uses `generateChangelogResult` to seed a PR title + body (`src/git/aiActions.ts`)

The recipe scales — any CLI command that has extracted a pure core function (returning a value, no I/O) can be called this way. Two rules:

1. **Pass `mode: 'stdout'` and `interactive: false` in the synthetic argv** so the core logic produces structured output instead of opening an Inquirer prompt.
2. **Use the raw text variant** (not the chrome-stripping one) if your UI surface wants blank lines / section structure preserved. `runChangelogAction` strips blank lines via `compactOutputLines`; `runChangelogTextWorkflow` keeps them.

## Testing changes

The scenario library in ``@gfargo/git-scenarios`` is the recommended way to validate workstation changes — both manually and in automated tests.

```bash
# Manual testing — spin up a known state and launch the workstation
npm run scenario list
npm run scenario create feature-pr-ready -- --run-ui

# Automated testing — replace inline writeFile / commitAll setup
import { spinUpScenario } from '@gfargo/git-scenarios'
const repo = await spinUpScenario('feature-pr-ready')
```

Scenarios match common workstation states: feature branch ready to PR, dirty worktree with many files, in-progress bisect, in-progress merge conflict, stashed changes, etc. Adding a new view? Add a scenario alongside it that reproduces the state the view renders against. See the [`@gfargo/git-scenarios`](https://github.com/gfargo/git-scenarios) README for the full list + the contract for adding new scenarios.

## Conventions

- **Chord prefix.** `g` is the global view-selector prefix. Inside a view, the prefix is bypassed for view-local single-key bindings (`g`, `b`, `s`, `x` on the bisect view fire bisect actions, not chord entry). Path back out is always `<` or `Esc`, never a chord.
- **Theme.** Don't hardcode colors. Resolve through `chrome/theme.ts` so `NO_COLOR`, the configured preset, and 8-color fallbacks all work. `focusBorderColor` returns undefined under `NO_COLOR` so layout doesn't shift.
- **Layout.** Width budgets come from `chrome/layout.ts`. Don't compute terminal columns at the leaf — receive a width and respect it. Use `chrome/text.ts` for truncation.
- **Narrow terminals (single-pane).** Below ~100 cols the three-pane layout folds to one full-width pane (`chrome/layout.ts` → `singlePane` / `visiblePane`); `Tab` cycles which pane is visible and `v` momentarily peeks the sidebar. The footer is trimmed to fit the 80×24 floor, so new per-view hints must stay within that budget (a test pins it) — full bindings remain discoverable via `?`. An active overlay forces its own pane visible so it's never hidden.
- **Render bundle.** Main-panel surfaces take the `SurfaceRenderContext` bundle (`runtime/types.ts`) — `h` / `components` / `state` / `context` / `contextStatus` / `bodyRows` / `width` / `theme` — not a parade of positional props (#1136). When a surface needs a new *universal* value, add it to the bundle rather than threading one more arg through `app → mainPanel → every surface`; pass surface-*specific* values as explicit params after the bundle.
- **Hyperlinks.** Wrap with `chrome/hyperlinks.ts` — it gates on terminal capability and falls back to plain text. Never emit raw OSC-8.
- **Empty / loading copy.** `chrome/surfaceStates.ts` — every surface has a tailored empty-state hint pointing at the next sensible action.
- **Persistence.** Anything user-facing that survives between runs (sidebar tab, diff view mode, onboarding marker) goes through a `chrome/*Persistence.ts` module. Best-effort, XDG-friendly, no PII in cache filenames.
- **Refresh.** Don't poll. The runtime owns a `chrome/refreshWatcher.ts` that debounces `.git/` mtime changes and dispatches refresh actions; views just react.
- **No mouse input.** Every action is reachable from the keymap and the command palette (`:`).

## Boundaries

- **`src/workstation/`** depends on **`src/git/`** and **`src/lib/`**. Never the other way.
- **`src/git/`** depends on **`src/lib/`** and other `src/commands/<x>/` modules it integrates with (`commit`, `changelog`, `ui`). It does not depend on `src/workstation/`.
- **`src/commands/log/`** is the `coco log` CLI command only. The render layer, state/orchestration files (`inkInput`, `inkViewModel`, `inkKeymap`, `inkWorkflows`, `inkRuntime`), and shared data loader (`logData.ts`) have all promoted out (phase 5, #1638) — the former two groups live in `src/workstation/runtime/`, the latter in `src/git/`. Phases 6–7 of [#890](https://github.com/gfargo/coco/issues/890) will further split `inkInput`/`inkViewModel` into per-surface modules under `src/workstation/state/`.

If you find yourself wanting `src/git/` to import from `src/workstation/`, the right move is almost always to push the workstation-specific shaping back into the workstation. The data layer should expose neutral overview types; the workstation decides how to render them.

## Migration in progress

The current layout reflects an in-flight refactor tracked in [#890](https://github.com/gfargo/coco/issues/890):

- ✅ **Phase 2** (#891) — pruned dead Inquirer-era branch from `interactive.ts`.
- ✅ **Phase 3** (#894) — promoted shared git-data layer from `commands/log/` to `src/git/`.
- ✅ **Phase 4** (#893) — promoted workstation chrome to `src/workstation/chrome/` (this directory). Dropped the `ink*` prefix.
- ✅ **Phase 5** — split the old ~6k-LOC `inkRuntime.ts` into `workstation/runtime/app.ts` + the chrome renderers (`runtime/{header,sidebar,mainPanel,detailPanel,footer,overlays}.ts`) + per-surface modules under `workstation/surfaces/<view>/`. `inkRuntime.ts` itself, along with the rest of the state/orchestration cluster (`inkInput`, `inkViewModel`, `inkKeymap`, `inkWorkflows`) and the non-TTY snapshot fallback (`interactive.ts` / `interactiveState.ts`), have since promoted into `workstation/runtime/` too — it's now a ~150-LOC boot shim there, not a `commands/log/` resident (#1638).
- ✅ **#1638** — moved the remaining `commands/log/` residents to their natural homes: `data.ts` → `src/git/logData.ts` (a git data loader, not a command), `interactive.ts` / `interactiveState.ts` → `workstation/runtime/` (they render workstation surfaces). `commands/log/` now holds only the actual CLI command (`handler.ts`, `config.ts`, `render.ts`, `commitCompose.ts`).
- ⏳ **Phase 6** — split `inkInput.ts` (~4,600 LOC) into per-surface key handlers under `workstation/state/input/`.
- ⏳ **Phase 7** — split `inkViewModel.ts` (~3,700 LOC) into per-surface state slices under `workstation/state/`.

The render layer (phase 5) and the state/orchestration + data-loader promotion (#1638) have both landed under `workstation/runtime/` / `src/git/`. What remains in `src/commands/log/` is just the CLI command itself. Phases 6–7 are the one still-open piece: splitting `inkInput`/`inkViewModel` from single monolithic modules into per-surface ones (they already live in the right directory, just not yet decomposed).
