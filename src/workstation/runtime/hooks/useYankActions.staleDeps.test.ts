import { makeHookHarness } from '../../../test/builders/makeHookHarness'
import { createLogInkState, type LogInkState } from '../inkViewModel'
import { useYankActions, type UseYankActionsDeps } from './useYankActions'

// #2203 — `yankFromActiveView` resolves its target through the id-first
// selectors, but its useCallback dependency list named only `selected*Index`.
// A change of id at an unchanged index therefore kept a stale callback and
// copied the previously cursored row.
const branch = (shortName: string) => ({
  type: 'local', name: shortName, shortName, hash: `${shortName}-hash`, current: false,
  date: '', subject: '', ahead: 0, behind: 0,
})

// One shared context object: a real re-render that only changes the cursor
// keeps the same loaded lists, and a fresh object per render would change
// the `context.branches` dependency and hide the missing-id bug.
const sharedContext = {
  branches: { localBranches: [branch('alpha'), branch('bravo')], remoteBranches: [], dirty: false },
} as never

// A real re-render keeps the same dispatch.
const sharedDispatch = jest.fn()

// Stable empty arrays (a literal `[]` per render would change those dependencies).
const noFiles: UseYankActionsDeps['stashDiffParsedFiles'] = []
const noWorktreeFiles: UseYankActionsDeps['visibleWorktreeFilesGrouped'] = []

function depsFor(state: LogInkState, over: Partial<UseYankActionsDeps> = {}): UseYankActionsDeps {
  return {
    clipboardRunner: jest.fn().mockResolvedValue(undefined),
    dispatch: sharedDispatch,
    context: sharedContext,
    state,
    selected: undefined,
    selectedDetailFile: undefined,
    stashDiffLines: undefined,
    stashDiffParsedFiles: noFiles,
    visibleWorktreeFilesGrouped: noWorktreeFiles,
    ...over,
  }
}

// Shared for the same reason as the context: `createLogInkState` allocates a
// fresh `filteredCommits` array, which is itself a dependency.
const baseState = createLogInkState([])
const branchesView = (extra: Partial<LogInkState>): LogInkState =>
  ({ ...baseState, activeView: 'branches', focus: 'commits', branchSort: 'name', ...extra }) as LogInkState

describe('useYankActions reads the live selection, not a stale snapshot (#2203)', () => {
  it('copies the row the id-first selector resolves NOW when only the id changed (same index)', async () => {
    const harness = makeHookHarness()
    const clipboardRunner = jest.fn().mockResolvedValue(undefined)

    // Render 1: cursor index 0 but the id points at "bravo" (id wins).
    const first = harness.render((React) =>
      useYankActions(React, depsFor(branchesView({ selectedBranchIndex: 0, selectedBranchId: 'bravo' }), { clipboardRunner })))
    await first.yankFromActiveView()
    expect(clipboardRunner).toHaveBeenLastCalledWith('bravo')

    // Render 2: same index 0, id cleared -> the selector now resolves "alpha".
    const second = harness.render((React) =>
      useYankActions(React, depsFor(branchesView({ selectedBranchIndex: 0, selectedBranchId: undefined }), { clipboardRunner })))
    await second.yankFromActiveView()
    expect(clipboardRunner).toHaveBeenLastCalledWith('alpha')
  })

  it('a callback captured on an earlier render also sees the latest selection', async () => {
    const harness = makeHookHarness()
    const clipboardRunner = jest.fn().mockResolvedValue(undefined)
    const early = harness.render((React) =>
      useYankActions(React, depsFor(branchesView({ selectedBranchIndex: 0, selectedBranchId: 'bravo' }), { clipboardRunner })))
    harness.render((React) =>
      useYankActions(React, depsFor(branchesView({ selectedBranchIndex: 0, selectedBranchId: undefined }), { clipboardRunner })))

    // Held across the re-render (as a keystroke handler would hold it).
    await early.yankFromActiveView()
    expect(clipboardRunner).toHaveBeenLastCalledWith('alpha')
  })

  it('keeps one stable identity across renders', () => {
    const harness = makeHookHarness()
    const a = harness.render((React) => useYankActions(React, depsFor(branchesView({ selectedBranchIndex: 0 }))))
    const b = harness.render((React) => useYankActions(React, depsFor(branchesView({ selectedBranchIndex: 1 }))))
    expect(b.yankFromActiveView).toBe(a.yankFromActiveView)
  })

  it('uses the latest clipboard runner and dispatch too', async () => {
    const harness = makeHookHarness()
    const oldRunner = jest.fn().mockResolvedValue(undefined)
    const newRunner = jest.fn().mockResolvedValue(undefined)
    const early = harness.render((React) => useYankActions(React, depsFor(branchesView({ selectedBranchIndex: 0 }), { clipboardRunner: oldRunner })))
    harness.render((React) => useYankActions(React, depsFor(branchesView({ selectedBranchIndex: 0 }), { clipboardRunner: newRunner })))
    await early.yankFromActiveView()
    expect(newRunner).toHaveBeenCalledTimes(1)
    expect(oldRunner).not.toHaveBeenCalled()
  })
})
