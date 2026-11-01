import { LAYOUT_SINGLE_PANE_BELOW } from '../../chrome/layout'
import { getLogInkInputEvents } from '../inkInput'
import { createLogInkState, type LogInkState } from '../inkViewModel'
import { useInputHandler } from './useInputHandler'

// #2222. The handler builds a ~60-field input context for every keypress, from
// deps that arrive as separate props. Each field is derived by hand (a visible
// count, the selected id, an id list in render order) and the list-navigation
// bugs this cycle fixed were all of one shape: a field read from the wrong
// list, or left stale. So the tests capture the context the hook hands to
// `getLogInkInputEvents` and pin what each field is derived from.
jest.mock('../inkInput', () => ({
  ...jest.requireActual('../inkInput'),
  getLogInkInputEvents: jest.fn(() => []),
}))

const getEvents = getLogInkInputEvents as unknown as jest.Mock

type Ctx = Record<string, unknown>

function useInstalled(overrides: Record<string, unknown> = {}) {
  let handler: (input: string, key: Record<string, unknown>) => void = () => undefined
  const dispatch = jest.fn()
  const exit = jest.fn()
  const dismissOnboarding = jest.fn()
  const base: Record<string, unknown> = {
    state: createLogInkState([]),
    context: {},
    dispatch,
    exit,
    dismissOnboarding,
    showOnboarding: false,
    filteredBranchList: [],
    filteredTagList: [],
    filteredStashList: [],
    filteredWorktreeList: [],
    filteredReflogList: [],
    filteredSubmoduleList: [],
    filteredRemoteList: [],
    filteredIssueList: [],
    filteredPullRequestTriageList: [],
    visibleWorktreeGroups: [],
    visibleWorktreeFilesGrouped: [],
    stashDiffParsedFiles: [],
    prDiffParsedFiles: [],
    windowSize: { columns: 140, rows: 40 },
    layout: { tooSmall: false },
    mouseEnabled: false,
    overlayActive: false,
    // Data deps default to absent, not to a spy.
    filePreview: undefined,
    detail: undefined,
    selectedDetailFile: undefined,
    selected: undefined,
    worktreeDiff: undefined,
    stashDiffLines: undefined,
    prDiffLines: undefined,
    commitDiffHunkOffsets: undefined,
    selectedWorktreeFile: undefined,
    activeRepoRoot: undefined,
    worktreeDirty: undefined,
    ...overrides,
  }
  // Anything not named (the many action callbacks) is a spy.
  const deps = new Proxy(base, { get: (target, prop: string) => (prop in target ? target[prop] : jest.fn()) })
  useInputHandler(((fn: typeof handler) => { handler = fn }) as never, deps as never)
  return {
    dispatch,
    exit,
    dismissOnboarding,
    /** Press a key and return the context the hook built for it. */
    context: (input = 'j', key: Record<string, unknown> = {}): Ctx => {
      getEvents.mockClear()
      handler(input, key)
      return getEvents.mock.calls[0]?.[3] as Ctx
    },
    press: (input: string, key: Record<string, unknown> = {}) => handler(input, key),
  }
}

const withState = (overrides: Partial<LogInkState>): LogInkState => ({ ...createLogInkState([]), ...overrides })

beforeEach(() => getEvents.mockClear())

describe('useInputHandler input context: list views (#2222)', () => {
  // [view, filtered-list dep, state index key, row factory, context fields]
  type Case = {
    name: string
    dep: string
    indexKey: keyof LogInkState
    row: (n: number) => Record<string, unknown>
    count: string
    selected?: { field: string; of: (row: Record<string, unknown>) => unknown }
    ids?: { field: string; of: (row: Record<string, unknown>) => unknown }
  }

  const cases: Case[] = [
    { name: 'branches', dep: 'filteredBranchList', indexKey: 'selectedBranchIndex', row: (n) => ({ shortName: `br${n}` }), count: 'branchCount', selected: { field: 'branchSelectedShortName', of: (r) => r.shortName }, ids: { field: 'branchIds', of: (r) => r.shortName } },
    { name: 'tags', dep: 'filteredTagList', indexKey: 'selectedTagIndex', row: (n) => ({ name: `v${n}` }), count: 'tagCount', selected: { field: 'tagSelectedName', of: (r) => r.name }, ids: { field: 'tagIds', of: (r) => r.name } },
    { name: 'stashes', dep: 'filteredStashList', indexKey: 'selectedStashIndex', row: (n) => ({ ref: `stash@{${n}}` }), count: 'stashCount', selected: { field: 'stashSelectedRef', of: (r) => r.ref }, ids: { field: 'stashIds', of: (r) => r.ref } },
    { name: 'reflog', dep: 'filteredReflogList', indexKey: 'selectedReflogIndex', row: (n) => ({ hash: `h${n}` }), count: 'reflogCount', selected: { field: 'reflogSelectedHash', of: (r) => r.hash } },
    { name: 'submodules', dep: 'filteredSubmoduleList', indexKey: 'selectedSubmoduleIndex', row: (n) => ({ path: `vendor/${n}` }), count: 'submoduleCount', selected: { field: 'submoduleSelectedPath', of: (r) => r.path }, ids: { field: 'submoduleListIds', of: (r) => r.path } },
    { name: 'remotes', dep: 'filteredRemoteList', indexKey: 'selectedRemoteIndex', row: (n) => ({ name: `remote${n}` }), count: 'remoteCount', selected: { field: 'remoteSelectedName', of: (r) => r.name }, ids: { field: 'remoteListIds', of: (r) => r.name } },
    { name: 'issues', dep: 'filteredIssueList', indexKey: 'selectedIssueIndex', row: (n) => ({ number: 100 + n, url: `https://example.test/issues/${100 + n}` }), count: 'issueCount', selected: { field: 'issueSelectedUrl', of: (r) => r.url }, ids: { field: 'issueListIds', of: (r) => String(r.number) } },
    { name: 'pull requests', dep: 'filteredPullRequestTriageList', indexKey: 'selectedPullRequestTriageIndex', row: (n) => ({ number: 200 + n, url: `https://example.test/pull/${200 + n}` }), count: 'pullRequestTriageCount', selected: { field: 'pullRequestTriageSelectedUrl', of: (r) => r.url }, ids: { field: 'pullRequestTriageListIds', of: (r) => String(r.number) } },
    { name: 'worktrees', dep: 'filteredWorktreeList', indexKey: 'selectedWorktreeFileIndex', row: (n) => ({ path: `/work/wt${n}` }), count: 'worktreeListCount', ids: { field: 'worktreeListIds', of: (r) => r.path } },
  ]

  describe.each(cases)('$name', (c) => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => c.row(i))

    it('counts the filtered list, not the full one behind it', () => {
      // A filter is active: three rows survive of whatever the context holds.
      const ctx = useInstalled({ [c.dep]: rows(3), context: { branches: { localBranches: rows(40), remoteBranches: [] } } }).context()
      expect(ctx[c.count]).toBe(3)
    })

    if (c.ids) {
      it('lists the ids in render order', () => {
        const filtered = rows(4)
        const ctx = useInstalled({ [c.dep]: filtered }).context()
        expect(ctx[c.ids!.field]).toEqual(filtered.map(c.ids!.of))
      })
    }

    if (c.selected) {
      it('selects the row under the cursor', () => {
        const filtered = rows(5)
        const ctx = useInstalled({ [c.dep]: filtered, state: withState({ [c.indexKey]: 3 } as Partial<LogInkState>) }).context()
        expect(ctx[c.selected!.field]).toBe(c.selected!.of(filtered[3]))
      })

      it('clamps a cursor past the end to the last row, instead of selecting nothing', () => {
        // The list shrank (a filter, a refresh) while the index stayed put.
        const filtered = rows(2)
        const ctx = useInstalled({ [c.dep]: filtered, state: withState({ [c.indexKey]: 9 } as Partial<LogInkState>) }).context()
        expect(ctx[c.selected!.field]).toBe(c.selected!.of(filtered[1]))
      })

      it('selects nothing for an empty list', () => {
        const ctx = useInstalled({ [c.dep]: [], state: withState({ [c.indexKey]: 4 } as Partial<LogInkState>) }).context()
        expect(ctx[c.selected!.field]).toBeUndefined()
        expect(ctx[c.count]).toBe(0)
      })
    }
  })

  it('reads the selected pull request number from the same row as its url', () => {
    const rows = [{ number: 7, url: 'u7' }, { number: 8, url: 'u8' }]
    const ctx = useInstalled({ filteredPullRequestTriageList: rows, state: withState({ selectedPullRequestTriageIndex: 1 }) }).context()
    expect(ctx).toMatchObject({ pullRequestTriageSelectedNumber: 8, pullRequestTriageSelectedUrl: 'u8' })
  })

  it('takes the current branch for the rebase-onto guard from the context, undefined on a detached HEAD', () => {
    expect(useInstalled({ context: { branches: { currentBranch: 'main' } } }).context().currentBranch).toBe('main')
    expect(useInstalled({ context: {} }).context().currentBranch).toBeUndefined()
  })
})

describe('useInputHandler input context: status view (#2222)', () => {
  it('selects the file under the cursor and clamps a stale index', () => {
    const files = [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }]
    const useAt = (index: number) => useInstalled({ visibleWorktreeFilesGrouped: files, state: withState({ selectedWorktreeFileIndex: index }) }).context()
    expect(useAt(1).worktreeSelectedPath).toBe('b.ts')
    expect(useAt(8).worktreeSelectedPath).toBe('c.ts')
    expect(useInstalled({ visibleWorktreeFilesGrouped: [] }).context().worktreeSelectedPath).toBeUndefined()
  })

  it('counts the grouped files and passes the group boundaries through', () => {
    const ctx = useInstalled({
      visibleWorktreeFilesGrouped: [{ path: 'a' }, { path: 'b' }, { path: 'c' }],
      visibleWorktreeGroups: [
        { state: 'staged', files: [{}], startIndex: 0 },
        { state: 'unstaged', files: [{}, {}], startIndex: 1 },
      ],
    }).context()
    expect(ctx.worktreeFileCount).toBe(3)
    expect(ctx.statusGroups).toEqual([
      { state: 'staged', count: 1, startIndex: 0 },
      { state: 'unstaged', count: 2, startIndex: 1 },
    ])
  })
})

describe('useInputHandler input context: history sub-views (#2222)', () => {
  const okBlame = { ok: true, lines: [{}, {}, {}, {}] }
  const okHistory = { ok: true, commits: [{ hash: 'c0' }, { hash: 'c1' }, { hash: 'c2' }] }

  it('counts blame lines for the active path only, and 0 while hydrating or after a failure', () => {
    const context = { blameByPath: new Map<string, unknown>([['a.ts', okBlame], ['bad.ts', { ok: false }]]) }
    expect(useInstalled({ context, state: withState({ blamePath: 'a.ts' }) }).context().blameLineCount).toBe(4)
    expect(useInstalled({ context, state: withState({ blamePath: 'bad.ts' }) }).context().blameLineCount).toBe(0)
    expect(useInstalled({ context, state: withState({ blamePath: 'pending.ts' }) }).context().blameLineCount).toBe(0)
    expect(useInstalled({ context, state: withState({}) }).context().blameLineCount).toBe(0)
  })

  it('carries the cursored file-history commit, clamping the index', () => {
    const context = { fileHistoryByPath: new Map<string, unknown>([['a.ts', okHistory]]) }
    const useAt = (index: number) => useInstalled({ context, state: withState({ fileHistoryPath: 'a.ts', selectedFileHistoryIndex: index }) }).context()
    expect(useAt(1)).toMatchObject({ fileHistoryCommitCount: 3, fileHistorySelectedHash: 'c1' })
    expect(useAt(10).fileHistorySelectedHash).toBe('c2')
    expect(useAt(-4).fileHistorySelectedHash).toBe('c0')
  })

  it('has no selected file-history commit when the history is empty or failed', () => {
    const context = { fileHistoryByPath: new Map<string, unknown>([['empty.ts', { ok: true, commits: [] }], ['bad.ts', { ok: false }]]) }
    // Unrolled, not a loop: react-hooks/rules-of-hooks sees `useInstalled` as a hook.
    const expected = { fileHistoryCommitCount: 0, fileHistorySelectedHash: undefined }
    expect(useInstalled({ context, state: withState({ fileHistoryPath: 'empty.ts' }) }).context()).toMatchObject(expected)
    expect(useInstalled({ context, state: withState({ fileHistoryPath: 'bad.ts' }) }).context()).toMatchObject(expected)
  })
})

describe('useInputHandler input context: diff sources (#2222)', () => {
  it('names the commit diff target only while the diff is a commit diff', () => {
    const selectedDetailFile = { path: 'src/a.ts' }
    const selected = { hash: 'abc123' }
    const commitDiff = useInstalled({ selectedDetailFile, selected, state: withState({ diffSource: 'commit' }) }).context()
    expect(commitDiff).toMatchObject({ commitDiffSelectedPath: 'src/a.ts', commitDiffSelectedSha: 'abc123' })

    const worktreeDiff = useInstalled({ selectedDetailFile, selected, state: withState({ diffSource: 'worktree' }) }).context()
    expect(worktreeDiff.commitDiffSelectedPath).toBeUndefined()
    expect(worktreeDiff.commitDiffSelectedSha).toBeUndefined()
  })

  it('uses the stash patch length as the preview length for a stash diff, the PR patch for a PR diff', () => {
    expect(useInstalled({ stashDiffLines: ['a', 'b', 'c'], prDiffLines: ['x'], state: withState({ diffSource: 'stash' }) }).context().previewLineCount).toBe(3)
    expect(useInstalled({ stashDiffLines: ['a', 'b', 'c'], prDiffLines: ['x'], state: withState({ diffSource: 'pr' }) }).context().previewLineCount).toBe(1)
    expect(useInstalled({ filePreview: { hunks: [1, 2] }, state: withState({ diffSource: 'commit' }) }).context().previewLineCount).toBe(2)
  })

  it('offers stash file offsets only for a stash diff, and none when there are no files', () => {
    const parsed = [{ startLine: 0, path: 'a.ts' }, { startLine: 12, path: 'b.ts' }]
    expect(useInstalled({ stashDiffParsedFiles: parsed, state: withState({ diffSource: 'stash', diffPreviewOffset: 13 }) }).context())
      .toMatchObject({ stashDiffFileOffsets: [0, 12], stashDiffSelectedPath: 'b.ts' })

    const other = useInstalled({ stashDiffParsedFiles: parsed, state: withState({ diffSource: 'commit' }) }).context()
    expect(other.stashDiffFileOffsets).toBeUndefined()
    expect(other.stashDiffSelectedPath).toBeUndefined()

    expect(useInstalled({ stashDiffParsedFiles: [], state: withState({ diffSource: 'stash' }) }).context().stashDiffFileOffsets).toBeUndefined()
  })

  it('keeps the PR diff file offsets apart from the stash ones', () => {
    const ctx = useInstalled({ prDiffParsedFiles: [{ startLine: 3 }, { startLine: 9 }], stashDiffParsedFiles: [{ startLine: 1, path: 's' }], state: withState({ diffSource: 'pr' }) }).context()
    expect(ctx.prDiffFileOffsets).toEqual([3, 9])
    expect(ctx.stashDiffFileOffsets).toBeUndefined()
  })
})

describe('useInputHandler input context: layout (#2222)', () => {
  it('is single pane below the layout breakpoint and not at it', () => {
    expect(useInstalled({ windowSize: { columns: LAYOUT_SINGLE_PANE_BELOW - 1 } }).context().singlePane).toBe(true)
    expect(useInstalled({ windowSize: { columns: LAYOUT_SINGLE_PANE_BELOW } }).context().singlePane).toBe(false)
  })
})

describe('useInputHandler key gates (#2222)', () => {
  it('quits on Ctrl-C before anything else looks at the key, even over the onboarding overlay', () => {
    const { press, exit, dismissOnboarding } = useInstalled({ showOnboarding: true })
    press('c', { ctrl: true })
    expect(exit).toHaveBeenCalled()
    expect(dismissOnboarding).not.toHaveBeenCalled()
    expect(getEvents).not.toHaveBeenCalled()
  })

  it('lets the first keystroke dismiss the onboarding overlay and swallows it', () => {
    const { press, dismissOnboarding } = useInstalled({ showOnboarding: true })
    press('j')
    expect(dismissOnboarding).toHaveBeenCalledTimes(1)
    expect(getEvents).not.toHaveBeenCalled()
  })

  it('hands an ordinary key to the input router with the state it was given', () => {
    const state = withState({ activeView: 'branches' })
    const { press } = useInstalled({ state })
    press('j', { downArrow: false })
    expect(getEvents).toHaveBeenCalledTimes(1)
    expect(getEvents.mock.calls[0].slice(0, 3)).toEqual([state, 'j', { downArrow: false }])
  })
})
