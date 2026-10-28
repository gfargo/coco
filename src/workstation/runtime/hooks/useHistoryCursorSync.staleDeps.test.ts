import { makeHookHarness } from '../../../test/builders/makeHookHarness'
import { createLogInkState, type LogInkState } from '../inkViewModel'
import { useHistoryCursorSync } from './useHistoryCursorSync'

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
