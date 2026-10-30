import { makeHookHarness } from '../../../test/builders/makeHookHarness'
import { createLogInkState, type LogInkState } from '../inkViewModel'
import { CURSOR_SYNC_LOAD_DEBOUNCE_MS, useHistoryCursorSync } from './useHistoryCursorSync'

// #2203 — the cursor-sync effect resolves the cursored branch / tag / stash
// through the id-first selectors, but its dependency list named only the
// `selected*Index` half of each pair. An id change at an unchanged index
// resolved a different row without the sync re-running, so the history
// cursor stayed on the previous ref's commit.
const ref = (shortName: string, hash: string) => ({
  type: 'local', name: shortName, shortName, hash, current: false, date: '', subject: '', ahead: 0, behind: 0,
})
const commit = (hash: string) => ({ hash, shortHash: hash.slice(0, 7), message: hash })

const ALPHA = 'aaaaaaa1111111111111111111111111111111aa'
const BRAVO = 'bbbbbbb2222222222222222222222222222222bb'

// Everything that is not the cursor is held constant across renders, as in a
// real re-render where only the selection changed.
const dispatch = jest.fn()
const context = {
  branches: { localBranches: [ref('alpha', ALPHA), ref('bravo', BRAVO)], remoteBranches: [], dirty: false },
  tags: { tags: [] },
  stashes: { stashes: [] },
} as never
const baseState = { ...createLogInkState([]), filteredCommits: [commit(ALPHA), commit(BRAVO)] } as unknown as LogInkState
const branches = (extra: Partial<LogInkState>): LogInkState =>
  ({ ...baseState, activeView: 'branches', focus: 'commits', branchSort: 'name', ...extra }) as LogInkState

const jumps = () =>
  dispatch.mock.calls.filter(([action]) => action.type === 'selectCommitByHash').map(([action]) => action.hash)

describe('useHistoryCursorSync re-syncs when only the selection id changes (#2203)', () => {
  beforeEach(() => dispatch.mockClear())

  it('jumps to the newly resolved branch when the id changes at the same index', () => {
    const harness = makeHookHarness()

    // Cursor index 0, but the id points at "bravo": the selector prefers the id.
    harness.render((React) => useHistoryCursorSync(React, { dispatch, context, state: branches({ selectedBranchIndex: 0, selectedBranchId: 'bravo' }) }))
    expect(jumps()).toEqual([BRAVO])

    // Same index 0, id cleared: the selector now resolves "alpha".
    harness.render((React) => useHistoryCursorSync(React, { dispatch, context, state: branches({ selectedBranchIndex: 0, selectedBranchId: undefined }) }))
    expect(jumps()).toEqual([BRAVO, ALPHA])
  })

  it('does not re-run (or re-jump) when nothing the selectors read has changed', () => {
    const harness = makeHookHarness()
    const state = branches({ selectedBranchIndex: 0, selectedBranchId: 'bravo' })
    harness.render((React) => useHistoryCursorSync(React, { dispatch, context, state }))
    harness.render((React) => useHistoryCursorSync(React, { dispatch, context, state: { ...state } }))
    expect(jumps()).toEqual([BRAVO])
  })
})

// #2209 — cursoring onto a ref whose commit is not loaded starts an anchored
// `git log`. Holding `j` through old tags used to start one per row passed.
// The fetch now waits for the cursor to rest.
describe('useHistoryCursorSync debounces the anchored context load (#2209)', () => {
  const FAR_A = 'ccccccc3333333333333333333333333333333cc'
  const FAR_B = 'ddddddd4444444444444444444444444444444dd'
  const farContext = {
    branches: { localBranches: [ref('far-a', FAR_A), ref('far-b', FAR_B)], remoteBranches: [], dirty: false },
    tags: { tags: [] },
    stashes: { stashes: [] },
  } as never
  const loadCalls: string[] = []
  const load = async (target: { hash: string }) => { loadCalls.push(target.hash) }

  beforeEach(() => {
    jest.useFakeTimers()
    dispatch.mockClear()
    loadCalls.length = 0
  })
  afterEach(() => jest.useRealTimers())

  function renderAt(harness: ReturnType<typeof makeHookHarness>, index: number) {
    const result = harness.render((React) =>
      useHistoryCursorSync(React, { dispatch, context: farContext, state: branches({ selectedBranchIndex: index, selectedBranchId: undefined }) })
    )
    result.current = load as never
    return result
  }

  it('fires one fetch, for the ref the cursor rests on', () => {
    const harness = makeHookHarness()
    renderAt(harness, 0)
    jest.advanceTimersByTime(CURSOR_SYNC_LOAD_DEBOUNCE_MS - 10)
    renderAt(harness, 1)
    jest.advanceTimersByTime(CURSOR_SYNC_LOAD_DEBOUNCE_MS - 10)
    expect(loadCalls).toEqual([])

    jest.advanceTimersByTime(20)
    expect(loadCalls).toEqual([FAR_B])
  })

  it('retries a ref whose fetch was cancelled when the cursor comes back', () => {
    const harness = makeHookHarness()
    renderAt(harness, 0)
    renderAt(harness, 1)
    renderAt(harness, 0)
    jest.advanceTimersByTime(CURSOR_SYNC_LOAD_DEBOUNCE_MS)
    expect(loadCalls).toEqual([FAR_A])
  })

  it('does not fire after the hook unmounts', () => {
    const harness = makeHookHarness()
    renderAt(harness, 0)
    harness.unmount()
    jest.advanceTimersByTime(CURSOR_SYNC_LOAD_DEBOUNCE_MS * 2)
    expect(loadCalls).toEqual([])
  })
})

// Review follow-up to #2209: a fetch superseded by a newer one has its rows
// dropped, so its hash must not stay "attempted", or coming back to that ref
// reports it unreachable instead of fetching it.
describe('useHistoryCursorSync retries a ref whose fetch was superseded', () => {
  const FAR = 'eeeeeee5555555555555555555555555555555ee'
  const farContext = {
    branches: { localBranches: [ref('far', FAR)], remoteBranches: [], dirty: false },
    tags: { tags: [] },
    stashes: { stashes: [] },
  } as never

  beforeEach(() => { jest.useFakeTimers(); dispatch.mockClear() })
  afterEach(() => jest.useRealTimers())

  it('fetches again on return instead of reporting unreachable', async () => {
    const harness = makeHookHarness()
    const calls: string[] = []
    const load = async (target: { hash: string }) => { calls.push(target.hash); return { superseded: true } }
    const renderOnFar = () => {
      const r = harness.render((React) =>
        useHistoryCursorSync(React, { dispatch, context: farContext, state: branches({ selectedBranchIndex: 0, selectedBranchId: undefined }) })
      )
      r.current = load as never
    }
    renderOnFar()
    jest.advanceTimersByTime(CURSOR_SYNC_LOAD_DEBOUNCE_MS)
    await Promise.resolve(); await Promise.resolve()

    // Leave and come back (a re-render with a new commit list re-runs the sync).
    harness.render((React) =>
      useHistoryCursorSync(React, { dispatch, context: farContext, state: { ...branches({ selectedBranchIndex: 0 }), filteredCommits: [] } as never })
    ).current = load as never
    jest.advanceTimersByTime(CURSOR_SYNC_LOAD_DEBOUNCE_MS)

    expect(calls).toEqual([FAR, FAR])
    const statuses = dispatch.mock.calls.map(([action]) => action.value).filter(Boolean)
    expect(statuses.some((value: string) => /unreachable/.test(value))).toBe(false)
  })
})
