# Workstation

The Ink-based TUI that ships behind `coco ui` and `coco log -i`. Twelve top-level views, chord-driven (`g<key>`) navigation, keyboard-only by design.

For user-facing docs:
- [Interactive Log TUI](https://github.com/gfargo/coco/wiki/Interactive-Log-TUI) — keymap, configuration, screenshots.

This README is for contributors. It explains where things live, how a keypress becomes a screen update, and the smallest set of changes to add a view or key binding.

## Layout

```
src/
├── commands/log/             ← Orchestration + log command (transitional home; see "Migration" below)
│   ├── handler.ts            ← `coco log` command entrypoint
│   ├── data.ts               ← `getLogRows` + `getCommitDetail` + GitLogRow / GitCommitDetail types
│   ├── render.ts             ← stdout formatter for the non-interactive path
│   ├── interactive.ts        ← non-TTY (CI / pipe) snapshot fallback
│   ├── inkRuntime.ts         ← `LogInkApp` React component + render*Surface helpers
│   ├── inkInput.ts           ← Global onKey switch — routes keypresses to view-specific handlers
│   ├── inkViewModel.ts       ← `LogInkState`, `LogInkAction`, `applyLogInkAction` reducer
│   ├── inkKeymap.ts          ← Chord prefix model, key bindings, footer hint generation
│   ├── inkWorkflows.ts       ← Workflow registry — id + kind + handler for every confirmable action
│   └── commitCompose.ts      ← Compose-surface state slice
│
├── git/                      ← Shared data layer (overview loaders + workstation-shaped actions)
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
    └── chrome/               ← Cross-cutting visual + state + lifecycle utilities (this directory's reason for existing)
        ├── theme.ts          ← `LogInkTheme` resolver, color preset registry, `NO_COLOR` honoring
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
inkRuntime.ts      ← LogInkApp re-renders with new state
     │             ← renderHeader, renderSidebar, render<View>Surface, renderFooter
     ▼
Ink                ← reconciles to terminal
```

A few invariants worth knowing before changing any of those modules:

- **The reducer is pure.** `applyLogInkAction(state, action)` never throws, never reads the file system, never calls git. Side effects belong in workflows.
- **Workflows return actions.** A workflow that succeeds dispatches a `LogInkAction` via the runtime; failures dispatch a status-message action. The reducer is the only place state changes.
- **Confirmation gating is data, not control flow.** Workflows declare `requiresConfirmation: 'y' | 'enter'` in `inkWorkflows.ts`; the runtime intercepts and routes through the y-confirm overlay.
- **Re-renders are cheap.** Ink reconciles the React tree on every state change; render helpers are pure functions of `(state, theme, layout)`.

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
3. **State slice** (`src/commands/log/inkViewModel.ts`) — add the view ID to `LogInkView`, add fields to `LogInkState`, add the load / clear actions to the `LogInkAction` union, handle them in `applyLogInkAction`.
4. **Keymap** (`src/commands/log/inkKeymap.ts`) — add the chord binding (`g <letter>`) and the per-view footer hint.
5. **Workflows** (`src/commands/log/inkWorkflows.ts`) — register any palette-reachable workflows (mutations, multi-step flows). Inline keypress handlers don't need a registration.
6. **Input dispatch** (`src/commands/log/inkInput.ts`) — add the per-view branch in the `onKey` switch.
7. **Render** (`src/commands/log/inkRuntime.ts`) — write `renderXxxSurface(state, theme, layout, ...)` and wire it into `renderMainPanel`. Use `chrome/surfaceStates.ts` for empty / loading copy.
8. **Tests** — at minimum: data parser fixtures, reducer state transitions, a render snapshot of empty / populated / error states.

Once phases 5–7 of [#890](https://github.com/gfargo/coco/issues/890) land, steps 3 / 6 / 7 will move into per-surface modules under `workstation/state/`, `workstation/state/input/`, and `workstation/surfaces/<view>/`.

## Adding a new key binding

For an inline keypress on an existing view, you only need:

1. The handler in the per-view branch of `inkInput.ts`.
2. The footer hint in `inkKeymap.ts`.
3. (If the action needs y-confirm) a workflow registration in `inkWorkflows.ts` with `requiresConfirmation`.

For a global chord (e.g. a new `g <letter>` view selector), the chord goes in `inkKeymap.ts` plus the route into the action / view-switch in the reducer.

## Calling existing CLI commands from a workstation flow

When a workstation flow needs the full behavior of a `coco <command>` (commit message generation, changelog body for PR creation, etc.), invoke the command's `handler` directly with a synthetic `argv` rather than spawning a subprocess. The pattern lives in `src/git/commitWorkflowActions.ts` and `src/git/aiActions.ts`:

```ts
// Synthetic argv shape: mode 'stdout', interactive false, silent logger
const argv = createChangelogArgv({ branch: 'main' })

// Capture stdout via process.stdout.write override
const captured = await captureStdout(() => changelogHandler(argv, new Logger({ silent: true })))

// Parse / return a typed *WorkflowResult shape
return { ok: true, message: firstLine(captured), text: captured }
```

Worked examples:

- `runCommitDraftWorkflow` → drives `coco commit` AI-draft generation from the compose surface's `I` keystroke (`src/git/commitWorkflowActions.ts`)
- `runCommitWorkflow({ action: 'commit' | 'split-plan' | 'split-apply' })` → drives `coco commit` and its `--split` modes (`src/git/commitWorkflowActions.ts`)
- `runChangelogTextWorkflow({ branch | sinceLastTag | tag | range })` → drives `coco changelog` and returns raw stdout (`src/git/aiActions.ts`)
- `runPullRequestBodyWorkflow({ baseBranch })` → uses `coco changelog --branch <base>` to seed a PR title + body (`src/git/aiActions.ts`)

The recipe scales — any CLI command with a `handler(argv, logger)` signature can be wrapped this way. Two rules:

1. **Pass `mode: 'stdout'` and `interactive: false` in the synthetic argv** so the handler emits structured output instead of opening an Inquirer prompt.
2. **Use the raw-capture variant** (not the chrome-stripping one) if your UI surface wants blank lines / section structure preserved. `runChangelogAction` strips blank lines via `compactOutputLines`; `runChangelogTextWorkflow` keeps them.

## Testing changes

The scenario library (in-monorepo package at `packages/git-scenarios/`, imported as `@gfargo/git-scenarios`) is the recommended way to validate workstation changes — both manually and in automated tests.

```bash
# Manual testing — spin up a known state and launch the workstation
npm run scenario list
npm run scenario create feature-pr-ready -- --run-ui

# Automated testing — replace inline writeFile / commitAll setup
import { spinUpScenario } from '@gfargo/git-scenarios'
const repo = await spinUpScenario('feature-pr-ready')
```

Scenarios match common workstation states: feature branch ready to PR, dirty worktree with many files, in-progress bisect, in-progress merge conflict, stashed changes, etc. Adding a new view? Add a scenario alongside it that reproduces the state the view renders against. See `packages/git-scenarios/README.md` for the full list + the contract for adding new scenarios.

## Conventions

- **Chord prefix.** `g` is the global view-selector prefix. Inside a view, the prefix is bypassed for view-local single-key bindings (`g`, `b`, `s`, `x` on the bisect view fire bisect actions, not chord entry). Path back out is always `<` or `Esc`, never a chord.
- **Theme.** Don't hardcode colors. Resolve through `chrome/theme.ts` so `NO_COLOR`, the configured preset, and 8-color fallbacks all work. `focusBorderColor` returns undefined under `NO_COLOR` so layout doesn't shift.
- **Layout.** Width budgets come from `chrome/layout.ts`. Don't compute terminal columns at the leaf — receive a width and respect it. Use `chrome/text.ts` for truncation.
- **Hyperlinks.** Wrap with `chrome/hyperlinks.ts` — it gates on terminal capability and falls back to plain text. Never emit raw OSC-8.
- **Empty / loading copy.** `chrome/surfaceStates.ts` — every surface has a tailored empty-state hint pointing at the next sensible action.
- **Persistence.** Anything user-facing that survives between runs (sidebar tab, diff view mode, onboarding marker) goes through a `chrome/*Persistence.ts` module. Best-effort, XDG-friendly, no PII in cache filenames.
- **Refresh.** Don't poll. The runtime owns a `chrome/refreshWatcher.ts` that debounces `.git/` mtime changes and dispatches refresh actions; views just react.
- **No mouse input.** Every action is reachable from the keymap and the command palette (`:`).

## Boundaries

- **`src/workstation/`** depends on **`src/git/`** and **`src/lib/`**. Never the other way.
- **`src/git/`** depends on **`src/lib/`** and other `src/commands/<x>/` modules it integrates with (`commit`, `changelog`, `ui`). It does not depend on `src/workstation/`.
- **`src/commands/log/`** is the log command. The orchestration files (`inkRuntime`, `inkInput`, `inkViewModel`, `inkKeymap`, `inkWorkflows`) live here today as a **transitional home** until phases 5–7 of [#890](https://github.com/gfargo/coco/issues/890) move them into `src/workstation/`.

If you find yourself wanting `src/git/` to import from `src/workstation/`, the right move is almost always to push the workstation-specific shaping back into the workstation. The data layer should expose neutral overview types; the workstation decides how to render them.

## Migration in progress

The current layout reflects an in-flight refactor tracked in [#890](https://github.com/gfargo/coco/issues/890):

- ✅ **Phase 2** (#891) — pruned dead Inquirer-era branch from `interactive.ts`.
- ✅ **Phase 3** (#894) — promoted shared git-data layer from `commands/log/` to `src/git/`.
- ✅ **Phase 4** (#893) — promoted workstation chrome to `src/workstation/chrome/` (this directory). Dropped the `ink*` prefix.
- ⏳ **Phase 5** — split `inkRuntime.ts` (6,039 LOC) into `workstation/runtime/app.tsx` + per-surface modules under `workstation/surfaces/<view>/`.
- ⏳ **Phase 6** — split `inkInput.ts` (2,259 LOC) into per-surface key handlers under `workstation/state/input/`.
- ⏳ **Phase 7** — split `inkViewModel.ts` (1,526 LOC) into per-surface state slices under `workstation/state/`.

When you see an `ink*.ts` file in `src/commands/log/`, treat it as a transitional resident. The 5 that remain (`inkRuntime`, `inkInput`, `inkViewModel`, `inkKeymap`, `inkWorkflows`) are exactly the targets of phases 5–7.
