import { applyRefreshKind } from './useRefreshWatcher'

/**
 * Unit tests for `applyRefreshKind` — the pure dispatch helper extracted
 * from `useRefreshWatcher`'s `onChange` callback.
 *
 * These tests are free of `fs.watch` and React hook machinery: they just
 * verify that the right refreshers are called (or not) for each kind.
 */
describe('applyRefreshKind', () => {
  const makeActions = () => ({
    refreshContext: jest.fn().mockResolvedValue(undefined),
    refreshWorktreeContext: jest.fn().mockResolvedValue(undefined),
    refreshHistoryRows: jest.fn().mockResolvedValue(undefined),
  })

  it('full: calls refreshContext and refreshHistoryRows', () => {
    const actions = makeActions()
    applyRefreshKind('full', actions)
    expect(actions.refreshContext).toHaveBeenCalledWith({ silent: true })
    expect(actions.refreshHistoryRows).toHaveBeenCalledTimes(1)
    expect(actions.refreshWorktreeContext).not.toHaveBeenCalled()
  })

  it('worktree: calls only refreshWorktreeContext', () => {
    const actions = makeActions()
    applyRefreshKind('worktree', actions)
    expect(actions.refreshWorktreeContext).toHaveBeenCalledWith({ silent: true })
    expect(actions.refreshContext).not.toHaveBeenCalled()
    expect(actions.refreshHistoryRows).not.toHaveBeenCalled()
  })

  it('full: does not call refreshWorktreeContext', () => {
    const actions = makeActions()
    applyRefreshKind('full', actions)
    expect(actions.refreshWorktreeContext).not.toHaveBeenCalled()
  })

  it('worktree: does not call refreshHistoryRows', () => {
    const actions = makeActions()
    applyRefreshKind('worktree', actions)
    expect(actions.refreshHistoryRows).not.toHaveBeenCalled()
  })

  it('full: passes silent:true to refreshContext', () => {
    const actions = makeActions()
    applyRefreshKind('full', actions)
    expect(actions.refreshContext).toHaveBeenCalledWith({ silent: true })
  })

  it('worktree: passes silent:true to refreshWorktreeContext', () => {
    const actions = makeActions()
    applyRefreshKind('worktree', actions)
    expect(actions.refreshWorktreeContext).toHaveBeenCalledWith({ silent: true })
  })
})
