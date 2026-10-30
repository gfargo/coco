import { applyRefreshKind, isSelfRefreshEcho, SELF_REFRESH_MUTE_MS } from './useRefreshWatcher'

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
    expect(actions.refreshContext).toHaveBeenCalledWith({ silent: true, fromWatcher: true })
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
    expect(actions.refreshContext).toHaveBeenCalledWith({ silent: true, fromWatcher: true })
  })

  it('worktree: passes silent:true to refreshWorktreeContext', () => {
    const actions = makeActions()
    applyRefreshKind('worktree', actions)
    expect(actions.refreshWorktreeContext).toHaveBeenCalledWith({ silent: true })
  })
})

// #2209 — a TUI mutation refreshes everything itself, then ~750 ms later the
// watcher saw the same change and refreshed all of it again.
describe('isSelfRefreshEcho', () => {
  const t = 1_000_000

  it('drops a full event shortly after coco refreshed for its own change', () => {
    expect(isSelfRefreshEcho('full', t + 800, t)).toBe(true)
  })

  it('keeps a full event once the window has passed', () => {
    expect(isSelfRefreshEcho('full', t + SELF_REFRESH_MUTE_MS, t)).toBe(false)
  })

  it('keeps worktree-only events, which are cheap', () => {
    expect(isSelfRefreshEcho('worktree', t + 100, t)).toBe(false)
  })

  it('keeps everything before coco has refreshed at all', () => {
    expect(isSelfRefreshEcho('full', 500, 0)).toBe(false)
  })
})

// Review follow-up to #2209: many workflows (branch/tag create and delete,
// stash create and drop) refresh only the context. The watcher's history
// refresh is then what updates the graph's refs, so the echo mute must
// skip only the half coco already did.
describe('applyRefreshKind skips only the halves coco already refreshed', () => {
  const actions = () => ({
    refreshContext: jest.fn(async () => undefined),
    refreshWorktreeContext: jest.fn(async () => undefined),
    refreshHistoryRows: jest.fn(async () => undefined),
  })

  it('still refreshes history after a context-only self refresh', () => {
    const a = actions()
    applyRefreshKind('full', a, { context: true, history: false })
    expect(a.refreshContext).not.toHaveBeenCalled()
    expect(a.refreshHistoryRows).toHaveBeenCalledWith({ fromWatcher: true })
  })

  it('skips both when coco refreshed both', () => {
    const a = actions()
    applyRefreshKind('full', a, { context: true, history: true })
    expect(a.refreshContext).not.toHaveBeenCalled()
    expect(a.refreshHistoryRows).not.toHaveBeenCalled()
  })

  it('tags its own history refresh so it does not count as coco\'s', () => {
    const a = actions()
    applyRefreshKind('full', a)
    expect(a.refreshHistoryRows).toHaveBeenCalledWith({ fromWatcher: true })
  })
})
