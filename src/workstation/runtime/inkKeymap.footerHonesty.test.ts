/**
 * Footer / help-table honesty guard.
 *
 * "A footer that lies about a key is a bug" (#1355, #1344, #1387, #1379 —
 * see the ticket for the four historical instances). Those bugs all had
 * the same shape: `getLogInkFooterHints` (or the `LOG_INK_KEY_BINDINGS`
 * table that feeds `?` help / `:` palette) advertised a key that the real
 * dispatcher (`getLogInkInputEvents`) silently swallowed — zero events,
 * nothing happens, the user thinks the app is broken.
 *
 * This test is a coarse property check, not a semantic one: for every
 * hint string / binding key the keymap can produce, it fires the actual
 * key(s) through the real dispatcher and asserts SOME event comes back.
 * It does not check that the event matches the hint's label — all four
 * historical bugs were dead keys, not mislabeled ones, so that's the bug
 * class worth guarding against here.
 *
 * Genuinely informational (non-key) footer strings — status text like
 * "generating plan…" or the dynamic pending-key prefix — are the only
 * legitimate reason to skip a string; each is listed in `ALLOWLIST` with
 * a one-line reason, mirroring the reviewed-exception pattern in
 * `inkKeymap.collisions.test.ts`.
 */
import { GitLogRow } from '../../commands/log/data'
import { getLogInkInputEvents, LogInkInputContext, LogInkInputKey } from './inkInput'
import { getLogInkFooterHints, GetLogInkFooterHintsOptions, LOG_INK_KEY_BINDINGS, LogInkCommandId } from './inkKeymap'
import {
    LogInkCompareRef,
    LogInkState,
    LogInkView,
    applyLogInkAction,
    createLogInkState,
} from './inkViewModel'

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*',
    shortHash: 'abc1234',
    hash: 'abc123456789',
    parents: ['def567890123'],
    date: '2026-04-29',
    author: 'Coco Test',
    refs: ['HEAD -> main'],
    message: 'feat: add log TUI interactions',
  },
  {
    type: 'commit',
    graph: '*',
    shortHash: 'def5678',
    hash: 'def567890123',
    parents: ['fed999900000'],
    date: '2026-04-30',
    author: 'Coco Test',
    refs: [],
    message: 'fix: polish log TUI',
  },
  {
    type: 'commit',
    graph: '*',
    shortHash: 'fed9999',
    hash: 'fed999900000',
    parents: [],
    date: '2026-05-01',
    author: 'Coco Test',
    refs: [],
    message: 'docs: update log TUI help',
  },
]

// ─────────────────────────────────────────────────────────────────────
// §1 — hint-token parser
// ─────────────────────────────────────────────────────────────────────

type Press = { value: string; key: LogInkInputKey }

/**
 * Named / symbolic key aliases used inside footer hint strings. Anything
 * not listed here is treated as a literal `inputValue` press of the
 * token text (covers bare letters and punctuation like `?`, `/`, `<`,
 * `[`, `]`, `+`, `:`).
 */
const HINT_TOKEN_ALIASES: Record<string, Press> = {
  esc: { value: '', key: { escape: true } },
  enter: { value: '', key: { return: true } },
  tab: { value: '', key: { tab: true } },
  space: { value: ' ', key: {} },
  'ctrl+u': { value: 'u', key: { ctrl: true } },
  pgup: { value: '', key: { pageUp: true } },
  pgdn: { value: '', key: { pageDown: true } },
  '↑': { value: '', key: { upArrow: true } },
  '↓': { value: '', key: { downArrow: true } },
  '←': { value: '', key: { leftArrow: true } },
  '→': { value: '', key: { rightArrow: true } },
}

/**
 * Full-piece overrides for hints whose keys-part can't be isolated by
 * "split on the first space" — `pg up/dn` (PageUp/PageDown) is written
 * with a space INSIDE the key notation, so the generic parser would read
 * the keys-part as just `pg`. Checked before the generic path.
 */
const FULL_HINT_OVERRIDES: Record<string, string[][]> = {
  'pg up/dn': [['pgup'], ['pgdn']],
}

/**
 * Convert a footer-hint string into a list of press sequences (each 1 or
 * 2 tokens — 2 for chords like `gg`, `gT`, `gH`). See the module doc for
 * the exact grammar this covers.
 */
export function parseHintTokens(hint: string): string[][] {
  const pieces = hint
    .split('·')
    .map((piece) => piece.trim())
    .filter(Boolean)

  const sequences: string[][] = []

  for (const piece of pieces) {
    const override = FULL_HINT_OVERRIDES[piece]
    if (override) {
      sequences.push(...override)
      continue
    }

    const spaceIndex = piece.indexOf(' ')
    const keysPart = spaceIndex === -1 ? piece : piece.slice(0, spaceIndex)

    // `/` alone is the literal search key, not an alternatives separator
    // — splitting it on `/` would yield two empty tokens.
    if (keysPart === '/') {
      sequences.push(['/'])
      continue
    }

    const rangeMatch = keysPart.match(/^(\d)-(\d)$/)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      for (let digit = start; digit <= end; digit += 1) {
        sequences.push([String(digit)])
      }
      continue
    }

    for (const token of keysPart.split('/')) {
      if (HINT_TOKEN_ALIASES[token]) {
        sequences.push([token])
        continue
      }
      // Two bare letters with no alias (e.g. `gg`, `gT`, `gH`) are a
      // chord: fire the prefix, apply its action(s), then fire the
      // second key against the resulting (armed) state.
      if (/^[A-Za-z]{2}$/.test(token)) {
        sequences.push([token[0], token[1]])
        continue
      }
      sequences.push([token])
    }
  }

  return sequences
}

describe('parseHintTokens', () => {
  it('splits simple alternatives', () => {
    expect(parseHintTokens('j/k scroll')).toEqual([['j'], ['k']])
  })

  it('parses a single bare key', () => {
    expect(parseHintTokens('? close')).toEqual([['?']])
  })

  it('expands a digit range', () => {
    expect(parseHintTokens('1-5 jump')).toEqual([
      ['1'], ['2'], ['3'], ['4'], ['5'],
    ])
  })

  it('splits a chord from a bare alternative', () => {
    expect(parseHintTokens('gg/G top/bottom')).toEqual([['g', 'g'], ['G']])
  })

  it('splits combined chips on the middle dot', () => {
    expect(parseHintTokens('X drop · u undo')).toEqual([['X'], ['u']])
  })

  it('does not choke on the lone search key', () => {
    expect(parseHintTokens('/ search')).toEqual([['/']])
  })

  it('resolves the irregular PageUp/PageDown notation', () => {
    expect(parseHintTokens('pg up/dn')).toEqual([['pgup'], ['pgdn']])
  })

  it('resolves named keys and arrows', () => {
    expect(parseHintTokens('esc back')).toEqual([['esc']])
    expect(parseHintTokens('↑/↓ scroll')).toEqual([['↑'], ['↓']])
    expect(parseHintTokens('v/esc → main')).toEqual([['v'], ['esc']])
  })
})

// ─────────────────────────────────────────────────────────────────────
// §2 — fire a parsed token sequence through the real dispatcher
// ─────────────────────────────────────────────────────────────────────

function tokenToPress(token: string): Press {
  return HINT_TOKEN_ALIASES[token] ?? { value: token, key: {} }
}

function applyActionsFromEvents(state: LogInkState, events: ReturnType<typeof getLogInkInputEvents>): LogInkState {
  return events
    .filter((event): event is Extract<typeof event, { type: 'action' }> => event.type === 'action')
    .reduce((current, event) => applyLogInkAction(current, event.action), state)
}

function fireSequence(
  state: LogInkState,
  context: LogInkInputContext,
  tokens: string[]
): ReturnType<typeof getLogInkInputEvents> {
  const first = tokenToPress(tokens[0])
  const firstEvents = getLogInkInputEvents(state, first.value, first.key, context)
  if (tokens.length === 1) {
    return firstEvents
  }
  // Chord: apply the prefix key's action(s) (typically `setPendingKey`)
  // to arm the dispatcher, then fire the second key against that state.
  const armed = applyActionsFromEvents(state, firstEvents)
  const second = tokenToPress(tokens[1])
  return getLogInkInputEvents(armed, second.value, second.key, context)
}

function fireHint(
  state: LogInkState,
  context: LogInkInputContext,
  hint: string
): Array<{ sequence: string[]; events: ReturnType<typeof getLogInkInputEvents> }> {
  return parseHintTokens(hint).map((sequence) => ({
    sequence,
    events: fireSequence(state, context, sequence),
  }))
}

// ─────────────────────────────────────────────────────────────────────
// §3 — the allowlist: hint strings that are informational, not keys
// ─────────────────────────────────────────────────────────────────────

const ALLOWLIST = new Set<string>([
  // Split-plan progress text — no keys are live except Esc (already a
  // separate hint) while the overlay is generating / applying.
  'generating plan…',
  'applying split…',
  // Single-pane pane switcher (#1135) — a status readout of which pane
  // is active, not a discrete key advertisement; the three bracket
  // positions are the only variants `singlePaneSwitcherHint` can emit.
  'tab: [sidebar] main inspector',
  'tab: sidebar [main] inspector',
  'tab: sidebar main [inspector]',
  // Help-filter footer (#1431) — "type to filter" is a printable-key
  // affordance ("any character narrows the list"), not a single
  // fireable key like the other hints, so it can't be parsed into a
  // press sequence the way `enter keep` / `esc clear` can.
  'type to filter',
])

/**
 * The pending-key prefix hint (`${pendingKey} …`) is dynamic — it
 * interpolates whatever chord the user armed — and is itself informational
 * ("here's what you pressed"), not a key advertisement; the actual
 * continuations are the separate hint entries that follow it.
 */
const DYNAMIC_PENDING_KEY_HINT = /^.+ …$/

function isAllowlisted(hint: string): boolean {
  return ALLOWLIST.has(hint) || DYNAMIC_PENDING_KEY_HINT.test(hint)
}

// ─────────────────────────────────────────────────────────────────────
// §4 — shared fixtures
// ─────────────────────────────────────────────────────────────────────

type Fixture = {
  state: LogInkState
  options: GetLogInkFooterHintsOptions
  context: LogInkInputContext
}

function push(state: LogInkState, view: LogInkView): LogInkState {
  return applyLogInkAction(state, { type: 'pushView', value: view })
}

function baseHistoryOptions(): GetLogInkFooterHintsOptions {
  return { activeView: 'history', focus: 'commits', filterMode: false, showHelp: false }
}

const firstCommitHash = rows.find((row) => row.type === 'commit' && 'hash' in row && row.hash)
const FIRST_HASH = firstCommitHash && 'hash' in firstCommitHash ? firstCommitHash.hash : 'abc123456789'

function historyFixture(): Fixture {
  const state = createLogInkState(rows)
  return { state, options: baseHistoryOptions(), context: {} }
}

function historyCompareFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, {
    type: 'setCompareBase',
    value: { kind: 'branch', ref: 'main', label: 'main' },
  })
  return {
    state,
    options: { ...baseHistoryOptions(), compareBaseSet: true },
    context: {},
  }
}

function filterModeFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, { type: 'toggleFilterMode' })
  return {
    state,
    options: { activeView: 'history', focus: 'commits', filterMode: true, showHelp: false },
    context: {},
  }
}

function helpFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, { type: 'toggleHelp' })
  return {
    state,
    options: { activeView: 'history', focus: 'commits', filterMode: false, showHelp: true },
    context: {},
  }
}

function helpFilterFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, { type: 'toggleHelp' })
  state = applyLogInkAction(state, { type: 'openHelpFilter' })
  return {
    state,
    options: { activeView: 'history', focus: 'commits', filterMode: false, showHelp: true, helpFilterMode: true },
    context: {},
  }
}

function commandPaletteFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, { type: 'toggleCommandPalette' })
  return {
    state,
    options: { ...baseHistoryOptions(), showCommandPalette: true },
    context: {},
  }
}

const mockSplitPlan = {
  groups: [
    { title: 'feat: foo', files: ['src/foo.ts'], hunks: [] },
    { title: 'feat: bar', files: ['src/bar.ts'], hunks: [] },
  ],
}
const mockSplitPlanContext = {
  changes: { staged: [], unstaged: [], untracked: [] },
  hunkInventory: { hunks: [], byId: new Map(), byFile: new Map() },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

function splitPlanReadyFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, {
    type: 'setSplitPlanReady',
    plan: mockSplitPlan,
    planContext: mockSplitPlanContext,
  })
  return {
    state,
    options: { ...baseHistoryOptions(), splitPlanStatus: 'ready' },
    context: { splitPlanLineCount: 50 },
  }
}

function splitPlanLoadingFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, { type: 'startSplitPlanLoad' })
  return {
    state,
    options: { ...baseHistoryOptions(), splitPlanStatus: 'loading' },
    context: {},
  }
}

function splitPlanApplyingFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, {
    type: 'setSplitPlanReady',
    plan: mockSplitPlan,
    planContext: mockSplitPlanContext,
  })
  state = applyLogInkAction(state, { type: 'setSplitPlanApplying' })
  return {
    state,
    options: { ...baseHistoryOptions(), splitPlanStatus: 'applying' },
    context: {},
  }
}

function sidebarEmptyFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, { type: 'setSidebarTab', value: 'status' })
  return {
    state,
    options: { activeView: 'history', focus: 'sidebar', filterMode: false, showHelp: false, sidebarTab: 'status', sidebarItemCount: 0 },
    context: {},
  }
}

function sidebarBranchesFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, { type: 'setSidebarTab', value: 'branches' })
  return {
    state,
    options: { activeView: 'history', focus: 'sidebar', filterMode: false, showHelp: false, sidebarTab: 'branches', sidebarItemCount: 3 },
    context: { branchCount: 3, currentBranch: 'main', branchSelectedShortName: 'feature' },
  }
}

function sidebarStashesFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, { type: 'setSidebarTab', value: 'stashes' })
  return {
    state,
    options: { activeView: 'history', focus: 'sidebar', filterMode: false, showHelp: false, sidebarTab: 'stashes', sidebarItemCount: 2 },
    context: { stashCount: 2, stashSelectedRef: 'stash@{0}' },
  }
}

function sidebarTagsFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, { type: 'setSidebarTab', value: 'tags' })
  return {
    state,
    options: { activeView: 'history', focus: 'sidebar', filterMode: false, showHelp: false, sidebarTab: 'tags', sidebarItemCount: 4 },
    context: { tagCount: 4, tagSelectedName: 'v1.0.0' },
  }
}

function sidebarWorktreesFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, { type: 'setSidebarTab', value: 'worktrees' })
  return {
    state,
    options: { activeView: 'history', focus: 'sidebar', filterMode: false, showHelp: false, sidebarTab: 'worktrees', sidebarItemCount: 2 },
    context: { worktreeListCount: 2 },
  }
}

function detailFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, { type: 'setFocus', value: 'detail' })
  return {
    state,
    options: { activeView: 'history', focus: 'detail', filterMode: false, showHelp: false },
    context: { detailFileCount: 3, previewLineCount: 80, inspectorActionCount: 2 },
  }
}

function statusFixture(): Fixture {
  const state = push(createLogInkState(rows), 'status')
  return {
    state,
    options: { activeView: 'status', focus: 'commits', filterMode: false, showHelp: false },
    context: {
      worktreeFileCount: 3,
      worktreeSelectedPath: 'src/foo.ts',
      statusGroups: [
        { state: 'staged', count: 1, startIndex: 0 },
        { state: 'unstaged', count: 2, startIndex: 1 },
      ],
    },
  }
}

const DIFF_HUNK_LINES = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1,2 +1,3 @@',
  ' const a = 1',
  '+const b = 2',
  ' const c = 3',
]

function diffWorktreeFixture(): Fixture {
  const state = applyLogInkAction(createLogInkState(rows), {
    type: 'navigateOpenDiffForWorktreeFile',
    fileIndex: 0,
  })
  return {
    state,
    options: { activeView: 'diff', diffSource: 'worktree', focus: 'commits', filterMode: false, showHelp: false },
    context: {
      worktreeHunkOffsets: [0, 4],
      worktreeDiffLineCount: 20,
      worktreeSelectedPath: 'src/foo.ts',
    },
  }
}

function diffCommitFixture(diffViewMode: 'unified' | 'split'): Fixture {
  let state = applyLogInkAction(createLogInkState(rows), {
    type: 'navigateOpenDiffForCommit',
    sha: FIRST_HASH,
    commitIndex: 0,
  })
  if (diffViewMode === 'split') {
    state = applyLogInkAction(state, { type: 'toggleDiffViewMode' })
  }
  return {
    state,
    options: {
      activeView: 'diff', diffSource: 'commit', diffViewMode,
      focus: 'commits', filterMode: false, showHelp: false,
    },
    context: {
      commitDiffHunkOffsets: [0, 3],
      previewLineCount: 40,
      commitDiffSelectedPath: 'src/foo.ts',
      commitDiffSelectedSha: 'abc1234',
      diffLinesForHunkApply: DIFF_HUNK_LINES,
    },
  }
}

function diffStashFixture(): Fixture {
  const state = applyLogInkAction(createLogInkState(rows), {
    type: 'navigateOpenDiffForStash',
    ref: 'stash@{0}',
  })
  return {
    state,
    options: { activeView: 'diff', diffSource: 'stash', diffViewMode: 'unified', focus: 'commits', filterMode: false, showHelp: false },
    context: {
      stashDiffFileOffsets: [0, 3],
      previewLineCount: 30,
      stashDiffSelectedPath: 'src/foo.ts',
      diffLinesForHunkApply: DIFF_HUNK_LINES,
    },
  }
}

function diffCompareFixture(): Fixture {
  const base: LogInkCompareRef = { kind: 'branch', ref: 'main', label: 'main' }
  const head: LogInkCompareRef = { kind: 'branch', ref: 'feature', label: 'feature' }
  const state = applyLogInkAction(createLogInkState(rows), {
    type: 'navigateOpenDiffForCompare',
    base,
    head,
  })
  return {
    state,
    options: { activeView: 'diff', diffSource: 'compare', diffViewMode: 'unified', focus: 'commits', filterMode: false, showHelp: false },
    context: { previewLineCount: 20 },
  }
}

function diffPrFixture(): Fixture {
  const state = applyLogInkAction(createLogInkState(rows), {
    type: 'navigateOpenDiffForPullRequest',
    number: 42,
  })
  return {
    state,
    options: { activeView: 'diff', diffSource: 'pr', diffViewMode: 'unified', focus: 'commits', filterMode: false, showHelp: false },
    context: { prDiffFileOffsets: [0, 5], previewLineCount: 25 },
  }
}

function composeFixture(): Fixture {
  const state = push(createLogInkState(rows), 'compose')
  return {
    state,
    options: { activeView: 'compose', focus: 'commits', filterMode: false, showHelp: false },
    context: {},
  }
}

function branchesFixture(): Fixture {
  const state = push(createLogInkState(rows), 'branches')
  return {
    state,
    options: { activeView: 'branches', focus: 'commits', filterMode: false, showHelp: false },
    context: { branchCount: 3, branchSelectedShortName: 'feature', currentBranch: 'main' },
  }
}

function branchesCompareFixture(): Fixture {
  let state = push(createLogInkState(rows), 'branches')
  state = applyLogInkAction(state, {
    type: 'setCompareBase',
    value: { kind: 'branch', ref: 'main', label: 'main' },
  })
  return {
    state,
    options: { activeView: 'branches', focus: 'commits', filterMode: false, showHelp: false, compareBaseSet: true },
    context: { branchCount: 3, branchSelectedShortName: 'feature' },
  }
}

function tagsFixture(): Fixture {
  const state = push(createLogInkState(rows), 'tags')
  return {
    state,
    options: { activeView: 'tags', focus: 'commits', filterMode: false, showHelp: false },
    context: { tagCount: 4, tagSelectedName: 'v1.0.0' },
  }
}

function tagsCompareFixture(): Fixture {
  let state = push(createLogInkState(rows), 'tags')
  state = applyLogInkAction(state, {
    type: 'setCompareBase',
    value: { kind: 'tag', ref: 'v0.9.0', label: 'v0.9.0' },
  })
  return {
    state,
    options: { activeView: 'tags', focus: 'commits', filterMode: false, showHelp: false, compareBaseSet: true },
    context: { tagCount: 4, tagSelectedName: 'v1.0.0' },
  }
}

function stashFixture(): Fixture {
  const state = push(createLogInkState(rows), 'stash')
  return {
    state,
    options: { activeView: 'stash', focus: 'commits', filterMode: false, showHelp: false },
    context: { stashCount: 2, stashSelectedRef: 'stash@{0}' },
  }
}

function worktreesFixture(): Fixture {
  const state = push(createLogInkState(rows), 'worktrees')
  return {
    state,
    options: { activeView: 'worktrees', focus: 'commits', filterMode: false, showHelp: false },
    context: { worktreeListCount: 2 },
  }
}

function pullRequestFixture(): Fixture {
  const state = push(createLogInkState(rows), 'pull-request')
  return {
    state,
    options: { activeView: 'pull-request', focus: 'commits', filterMode: false, showHelp: false },
    context: {},
  }
}

function rebaseFixture(): Fixture {
  const state = applyLogInkAction(createLogInkState(rows), {
    type: 'openRebasePlan',
    rows: [
      { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'feat: one', author: 'Coco', date: '2026-05-01', action: 'pick' as const },
      { sha: 'b'.repeat(40), shortSha: 'bbbbbbb', subject: 'fix: two', author: 'Coco', date: '2026-05-02', action: 'pick' as const },
    ],
  })
  return {
    state,
    options: { activeView: 'rebase', focus: 'commits', filterMode: false, showHelp: false },
    context: {},
  }
}

function conflictsFixture(): Fixture {
  const state = push(createLogInkState(rows), 'conflicts')
  return {
    state,
    options: { activeView: 'conflicts', focus: 'commits', filterMode: false, showHelp: false },
    context: { conflictFileCount: 2, conflictSelectedPath: 'src/conflict.ts' },
  }
}

function reflogFixture(): Fixture {
  const state = push(createLogInkState(rows), 'reflog')
  return {
    state,
    options: { activeView: 'reflog', focus: 'commits', filterMode: false, showHelp: false },
    context: { reflogCount: 3, reflogSelectedHash: FIRST_HASH },
  }
}

function issuesFixture(): Fixture {
  const state = push(createLogInkState(rows), 'issues')
  return {
    state,
    options: { activeView: 'issues', focus: 'commits', filterMode: false, showHelp: false },
    context: { issueCount: 2, issueSelectedUrl: 'https://example.com/issues/1' },
  }
}

function pullRequestTriageFixture(): Fixture {
  const state = push(createLogInkState(rows), 'pull-request-triage')
  return {
    state,
    options: { activeView: 'pull-request-triage', focus: 'commits', filterMode: false, showHelp: false },
    context: {
      pullRequestTriageCount: 2,
      pullRequestTriageSelectedUrl: 'https://example.com/pull/42',
      pullRequestTriageSelectedNumber: 42,
    },
  }
}

function submodulesFixture(): Fixture {
  const state = push(createLogInkState(rows), 'submodules')
  return {
    state,
    options: { activeView: 'submodules', focus: 'commits', filterMode: false, showHelp: false },
    context: { submoduleCount: 2, submoduleSelectedPath: 'vendor/lib' },
  }
}

function remotesFixture(): Fixture {
  const state = push(createLogInkState(rows), 'remotes')
  return {
    state,
    options: { activeView: 'remotes', focus: 'commits', filterMode: false, showHelp: false },
    context: { remoteCount: 2, remoteSelectedName: 'origin' },
  }
}

function blameFixture(): Fixture {
  const state = applyLogInkAction(createLogInkState(rows), {
    type: 'navigateOpenBlameForPath',
    path: 'src/foo.ts',
  })
  return {
    state,
    options: { activeView: 'blame', focus: 'commits', filterMode: false, showHelp: false },
    context: { blameLineCount: 50 },
  }
}

function fileHistoryFixture(): Fixture {
  const state = applyLogInkAction(createLogInkState(rows), {
    type: 'navigateOpenFileHistoryForPath',
    path: 'src/foo.ts',
  })
  return {
    state,
    options: { activeView: 'file-history', focus: 'commits', filterMode: false, showHelp: false },
    context: { fileHistoryCommitCount: 20, fileHistorySelectedHash: FIRST_HASH },
  }
}

function bisectFixture(active: boolean): Fixture {
  const state = push(createLogInkState(rows), 'bisect')
  return {
    state,
    options: { activeView: 'bisect', focus: 'commits', filterMode: false, showHelp: false, bisectActive: active },
    context: { bisectActive: active },
  }
}

function changelogFixture(): Fixture {
  const state = push(createLogInkState(rows), 'changelog')
  return {
    state,
    options: { activeView: 'changelog', focus: 'commits', filterMode: false, showHelp: false },
    context: { changelogLineCount: 80 },
  }
}

function pendingKeyGFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, { type: 'setPendingKey', value: 'g' })
  return {
    state,
    options: { ...baseHistoryOptions(), pendingKey: 'g' },
    context: {},
  }
}

function peekingFixture(): Fixture {
  const events = getLogInkInputEvents(createLogInkState(rows), 'v', {}, { singlePane: true })
  const state = applyActionsFromEvents(createLogInkState(rows), events)
  return {
    state,
    options: {
      activeView: 'history', focus: 'sidebar', filterMode: false, showHelp: false,
      peeking: true, singlePane: true, sidebarTab: 'branches', sidebarItemCount: 0,
    },
    context: { singlePane: true },
  }
}

function singlePaneMainFixture(): Fixture {
  return {
    state: createLogInkState(rows),
    options: { ...baseHistoryOptions(), singlePane: true },
    context: { singlePane: true },
  }
}

function singlePaneSidebarFixture(): Fixture {
  let state = createLogInkState(rows)
  state = applyLogInkAction(state, { type: 'setSidebarTab', value: 'branches' })
  return {
    state,
    options: { activeView: 'history', focus: 'sidebar', filterMode: false, showHelp: false, singlePane: true, sidebarTab: 'branches', sidebarItemCount: 3 },
    context: { singlePane: true, branchCount: 3 },
  }
}

function singlePaneWorktreeDiffFixture(): Fixture {
  const state = applyLogInkAction(createLogInkState(rows), {
    type: 'navigateOpenDiffForWorktreeFile',
    fileIndex: 0,
  })
  return {
    state,
    options: { activeView: 'diff', diffSource: 'worktree', focus: 'commits', filterMode: false, showHelp: false, singlePane: true },
    context: { singlePane: true, worktreeHunkOffsets: [0, 4], worktreeDiffLineCount: 20, worktreeSelectedPath: 'src/foo.ts' },
  }
}

const FOOTER_FIXTURES: Record<string, () => Fixture> = {
  history: historyFixture,
  historyCompareBase: historyCompareFixture,
  filterMode: filterModeFixture,
  help: helpFixture,
  helpFilter: helpFilterFixture,
  commandPalette: commandPaletteFixture,
  splitPlanReady: splitPlanReadyFixture,
  splitPlanLoading: splitPlanLoadingFixture,
  splitPlanApplying: splitPlanApplyingFixture,
  sidebarEmpty: sidebarEmptyFixture,
  sidebarBranches: sidebarBranchesFixture,
  sidebarStashes: sidebarStashesFixture,
  sidebarTags: sidebarTagsFixture,
  sidebarWorktrees: sidebarWorktreesFixture,
  detail: detailFixture,
  status: statusFixture,
  diffWorktree: diffWorktreeFixture,
  diffCommitUnified: () => diffCommitFixture('unified'),
  diffCommitSplit: () => diffCommitFixture('split'),
  diffStash: diffStashFixture,
  diffCompare: diffCompareFixture,
  diffPr: diffPrFixture,
  compose: composeFixture,
  branches: branchesFixture,
  branchesCompareBase: branchesCompareFixture,
  tags: tagsFixture,
  tagsCompareBase: tagsCompareFixture,
  stash: stashFixture,
  worktrees: worktreesFixture,
  pullRequest: pullRequestFixture,
  rebase: rebaseFixture,
  conflicts: conflictsFixture,
  reflog: reflogFixture,
  issues: issuesFixture,
  pullRequestTriage: pullRequestTriageFixture,
  submodules: submodulesFixture,
  remotes: remotesFixture,
  blame: blameFixture,
  fileHistory: fileHistoryFixture,
  bisectActive: () => bisectFixture(true),
  bisectInactive: () => bisectFixture(false),
  changelog: changelogFixture,
  pendingKeyG: pendingKeyGFixture,
  peeking: peekingFixture,
  singlePaneMain: singlePaneMainFixture,
  singlePaneSidebar: singlePaneSidebarFixture,
  singlePaneWorktreeDiff: singlePaneWorktreeDiffFixture,
}

// ─────────────────────────────────────────────────────────────────────
// Test 1 — every advertised footer hint fires something
// ─────────────────────────────────────────────────────────────────────

describe('footer hint honesty — every advertised key fires an event', () => {
  for (const [fixtureId, build] of Object.entries(FOOTER_FIXTURES)) {
    it(`fixture "${fixtureId}"`, () => {
      const { state, options, context } = build()
      const hints = getLogInkFooterHints(options)
      const allHints = [...hints.contextual, ...hints.global]

      const failures: string[] = []
      for (const hint of allHints) {
        if (isAllowlisted(hint)) continue
        const results = fireHint(state, context, hint)
        for (const { sequence, events } of results) {
          if (events.length === 0) {
            failures.push(`hint "${hint}" → sequence [${sequence.join(', ')}] produced zero events`)
          }
        }
      }

      expect(failures).toEqual([])
    })
  }
})

// ─────────────────────────────────────────────────────────────────────
// Test 2 — every LOG_INK_KEY_BINDINGS key fires in every declared context
// ─────────────────────────────────────────────────────────────────────

/**
 * Generic per-context fixtures. `LOG_INK_KEY_BINDINGS.contexts` mixes
 * specific views (`'history'`, `'branches'`, ...) with coarse focus
 * values (`'normal'`, `'commits'`, `'sidebar'`, `'detail'`, `'search'`)
 * that apply across many views (see `inkKeymap.collisions.test.ts`'s
 * docstring: the resolver disambiguates on finer state than `contexts`
 * can express). `'normal'`/`'commits'` resolve to the default history
 * fixture — the view where global chords and commit-list movement are
 * documented to live.
 */
const GENERIC_CONTEXT_FIXTURES: Record<string, () => Fixture> = {
  normal: historyFixture,
  commits: historyFixture,
  search: filterModeFixture,
  sidebar: sidebarBranchesFixture,
  detail: detailFixture,
  history: historyFixture,
  status: statusFixture,
  diff: diffWorktreeFixture,
  compose: composeFixture,
  branches: branchesFixture,
  blame: blameFixture,
  // #1447 registry backfill — per-view-context fixtures for the newly
  // declared bindings.
  stash: stashFixture,
  tags: tagsFixture,
  conflicts: conflictsFixture,
  bisect: () => bisectFixture(true),
  reflog: reflogFixture,
  remotes: remotesFixture,
  submodules: submodulesFixture,
  'pull-request-triage': pullRequestTriageFixture,
  issues: issuesFixture,
  worktrees: worktreesFixture,
}

/**
 * A few bindings declare a coarse `contexts: ['commits']` (focus-only)
 * even though their real dispatch gate is a specific view — e.g.
 * `toggleDiffViewMode` only does anything on the (non-worktree) diff
 * view, `cycleSort` only on branches/tags, `revertSelection` /
 * `editCommit` / `editCommitExternal` only on the status view. Testing
 * these against the generic "commits" fixture (the plain history view)
 * would report a false dead-key: the key is fully reachable, just not
 * from the view the generic fixture represents. Route them to the view
 * where they're actually documented to work — this is a fixture-
 * resolution correction, not a "the key is dead, ignore it" allowlist.
 *
 * `navigateBack` (`<` / `esc`) is the one true edge case: at the
 * absolute navigation root (no pushed view, no nested repo frame) Esc
 * legitimately has nothing to pop and returns zero events, while `<`
 * has an unconditional fallback that always fires. That's correct
 * behavior at the root, not a lie — so it's tested one level deep
 * instead of at the app's literal launch state.
 */
const BINDING_FIXTURE_OVERRIDES: Partial<Record<LogInkCommandId, () => Fixture>> = {
  toggleDiffViewMode: () => diffCommitFixture('unified'),
  cycleSort: branchesFixture,
  revertSelection: statusFixture,
  editCommit: statusFixture,
  editCommitExternal: statusFixture,
  navigateBack: statusFixture,
}

const BINDING_KEY_ALIASES: Record<string, Press> = {
  up: { value: '', key: { upArrow: true } },
  down: { value: '', key: { downArrow: true } },
  'page up': { value: '', key: { pageUp: true } },
  'page down': { value: '', key: { pageDown: true } },
  'shift+tab': { value: '', key: { tab: true, shift: true } },
  tab: { value: '', key: { tab: true } },
  enter: { value: '', key: { return: true } },
  esc: { value: '', key: { escape: true } },
  'ctrl+u': { value: 'u', key: { ctrl: true } },
  'ctrl+c': { value: 'c', key: { ctrl: true } },
}

function bindingKeyToSequence(token: string): string[] {
  if (BINDING_KEY_ALIASES[token]) return [token]
  if (token.length === 2) return [token[0], token[1]]
  return [token]
}

function bindingTokenToPress(token: string): Press {
  return BINDING_KEY_ALIASES[token] ?? { value: token, key: {} }
}

function fireBindingKey(
  state: LogInkState,
  context: LogInkInputContext,
  key: string
): ReturnType<typeof getLogInkInputEvents> {
  const sequence = bindingKeyToSequence(key)
  const first = bindingTokenToPress(sequence[0])
  const firstEvents = getLogInkInputEvents(state, first.value, first.key, context)
  if (sequence.length === 1) {
    return firstEvents
  }
  const armed = applyActionsFromEvents(state, firstEvents)
  const second = bindingTokenToPress(sequence[1])
  return getLogInkInputEvents(armed, second.value, second.key, context)
}

describe('binding-context honesty — every LOG_INK_KEY_BINDINGS key fires in its declared context', () => {
  for (const binding of LOG_INK_KEY_BINDINGS) {
    for (const context of binding.contexts) {
      it(`${binding.id} (${context}): ${binding.keys.join('/')}`, () => {
        const buildFixture = BINDING_FIXTURE_OVERRIDES[binding.id] ?? GENERIC_CONTEXT_FIXTURES[context]
        expect(buildFixture).toBeDefined()
        if (!buildFixture) return

        const { state, context: inputContext } = buildFixture()
        const failures: string[] = []
        for (const key of binding.keys) {
          const events = fireBindingKey(state, inputContext, key)
          if (events.length === 0) {
            failures.push(`key "${key}" in context "${context}" produced zero events`)
          }
        }
        expect(failures).toEqual([])
      })
    }
  }

  it('covers every context value LOG_INK_KEY_BINDINGS actually declares', () => {
    const declared = new Set<string>()
    for (const binding of LOG_INK_KEY_BINDINGS) {
      for (const context of binding.contexts) declared.add(context)
    }
    const uncovered = [...declared].filter((context) => !(context in GENERIC_CONTEXT_FIXTURES))
    expect(uncovered).toEqual([])
  })
})
