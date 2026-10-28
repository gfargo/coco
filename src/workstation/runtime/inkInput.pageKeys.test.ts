import { applyLogInkAction, createLogInkState, type LogInkState } from './inkViewModel'
import { getLogInkInputEvents, type LogInkInputContext, type LogInkInputEvent } from './inkInput'

// #2203 — PgUp / PgDn had no branch for the list views, so they fell through
// to the generic `{ type: 'page' }`, which moves the HISTORY cursor: invisible
// everywhere but History. Each list now pages its own cursor.
const rows = Array.from({ length: 30 }, (_, i) => ({
  type: 'commit', graph: '*', shortHash: `h${i}`, hash: `hash${i}`, parents: [], date: '2026-01-01',
  author: 'a', refs: [], message: `commit ${i}`,
})) as never

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`)
const view = (activeView: string, extra: Partial<LogInkState> = {}) =>
  ({ ...createLogInkState(rows), activeView, focus: 'commits', viewStack: [activeView], ...extra }) as LogInkState

type Case = {
  name: string
  action: string
  state: LogInkState
  context: LogInkInputContext
  index: keyof LogInkState
}
const CASES: Case[] = [
  { name: 'branches', action: 'moveBranch', state: view('branches'), context: { branchCount: 25, branchIds: ids(25) }, index: 'selectedBranchIndex' },
  { name: 'tags', action: 'moveTag', state: view('tags'), context: { tagCount: 25, tagIds: ids(25) }, index: 'selectedTagIndex' },
  { name: 'stash', action: 'moveStash', state: view('stash'), context: { stashCount: 25, stashIds: ids(25) }, index: 'selectedStashIndex' },
  { name: 'reflog', action: 'moveReflog', state: view('reflog'), context: { reflogCount: 25 }, index: 'selectedReflogIndex' },
  { name: 'remotes', action: 'moveRemote', state: view('remotes'), context: { remoteCount: 25, remoteListIds: ids(25) }, index: 'selectedRemoteIndex' },
  { name: 'submodules', action: 'moveSubmodule', state: view('submodules'), context: { submoduleCount: 25, submoduleListIds: ids(25) }, index: 'selectedSubmoduleIndex' },
  { name: 'issues', action: 'moveIssue', state: view('issues'), context: { issueCount: 25, issueListIds: ids(25) }, index: 'selectedIssueIndex' },
  { name: 'pull-request-triage', action: 'movePullRequestTriage', state: view('pull-request-triage'), context: { pullRequestTriageCount: 25, pullRequestTriageListIds: ids(25) }, index: 'selectedPullRequestTriageIndex' },
  { name: 'worktrees', action: 'moveWorktreeListEntry', state: view('worktrees'), context: { worktreeListCount: 25, worktreeListIds: ids(25) }, index: 'selectedWorktreeListIndex' },
  { name: 'status files', action: 'moveWorktreeFile', state: view('status'), context: { worktreeFileCount: 25 }, index: 'selectedWorktreeFileIndex' },
  { name: 'conflicts', action: 'moveConflictFile', state: view('conflicts'), context: { conflictFileCount: 25 }, index: 'selectedConflictFileIndex' },
]

const apply = (state: LogInkState, events: LogInkInputEvent[]) =>
  events.reduce((s, event) => (event.type === 'action' ? applyLogInkAction(s, event.action) : s), state)

describe('PgUp / PgDn on list views (#2203)', () => {
  it.each(CASES)('$name: PgDn / PgUp emit the list\'s own move, not the history `page`', ({ action, state, context }) => {
    const down = getLogInkInputEvents(state, '', { pageDown: true }, context)
    const up = getLogInkInputEvents(state, '', { pageUp: true }, context)
    expect(down).toEqual([expect.objectContaining({ type: 'action', action: expect.objectContaining({ type: action, delta: 10 }) })])
    expect(up).toEqual([expect.objectContaining({ type: 'action', action: expect.objectContaining({ type: action, delta: -10 }) })])
    expect(JSON.stringify([down, up])).not.toContain('"type":"page"')
  })

  it.each(CASES)('$name: through the reducer the LIST cursor moves and the hidden history cursor does not', ({ state, context, index }) => {
    const events = getLogInkInputEvents(state, '', { pageDown: true }, context)
    const next = apply(state, events)
    expect(next[index] as number).toBe(10)
    expect(next.selectedIndex).toBe(state.selectedIndex)
  })

  it.each(CASES)('$name: paging past the end clamps to the last row', ({ state, context, index }) => {
    let next = state
    for (let i = 0; i < 5; i += 1) next = apply(next, getLogInkInputEvents(next, '', { pageDown: true }, context))
    expect(next[index] as number).toBe(24)
    // ...and back up to the first.
    for (let i = 0; i < 5; i += 1) next = apply(next, getLogInkInputEvents(next, '', { pageUp: true }, context))
    expect(next[index] as number).toBe(0)
  })

  it('carries the id of the target row for the id-mirrored lists', () => {
    const events = getLogInkInputEvents(view('branches'), '', { pageDown: true }, { branchCount: 25, branchIds: ids(25) })
    expect(events[0]).toMatchObject({ action: { type: 'moveBranch', delta: 10, id: 'id10' } })
  })

  it('pages a sidebar tab list the same way as its dedicated view', () => {
    const sidebar = { ...createLogInkState(rows), activeView: 'history', focus: 'sidebar', sidebarTab: 'tags' } as LogInkState
    const events = getLogInkInputEvents(sidebar, '', { pageDown: true }, { tagCount: 25, tagIds: ids(25) })
    expect(events[0]).toMatchObject({ action: { type: 'moveTag', delta: 10 } })
  })

  describe('sidebar header focus', () => {
    const header = { ...createLogInkState(rows), activeView: 'history', focus: 'sidebar', sidebarTab: 'tags', sidebarHeaderFocused: true } as LogInkState
    const ctx: LogInkInputContext = { tagCount: 25, tagIds: ids(25) }

    it('PgUp is a no-op on the header, like ↑', () => {
      expect(getLogInkInputEvents(header, '', { pageUp: true }, ctx)).toEqual([])
    })

    it('PgDn drops the header focus first, then pages', () => {
      const events = getLogInkInputEvents(header, '', { pageDown: true }, ctx)
      expect(events[0]).toEqual({ type: 'action', action: { type: 'setSidebarHeaderFocused', value: false } })
      expect(events[1]).toMatchObject({ action: { type: 'moveTag', delta: 10 } })
    })
  })

  describe('swallowing and fallbacks', () => {
    it('conflicts with no files swallows the key instead of moving the history cursor', () => {
      expect(getLogInkInputEvents(view('conflicts'), '', { pageDown: true }, { conflictFileCount: 0 })).toEqual([])
    })

    it('History still pages the history cursor (the one view where it is visible)', () => {
      const history = view('history')
      expect(getLogInkInputEvents(history, '', { pageDown: true }, {})).toEqual([
        { type: 'action', action: { type: 'page', delta: 10 } },
      ])
      expect(getLogInkInputEvents(history, '', { pageUp: true }, {})).toEqual([
        { type: 'action', action: { type: 'page', delta: -10 } },
      ])
    })

    it('a list view with no rows falls back like before', () => {
      const events = getLogInkInputEvents(view('branches'), '', { pageDown: true }, { branchCount: 0 })
      expect(events).toEqual([{ type: 'action', action: { type: 'page', delta: 10 } }])
    })

    it('blame keeps its own paging', () => {
      const events = getLogInkInputEvents(view('blame'), '', { pageDown: true }, { blameLineCount: 40 })
      expect(events).toEqual([{ type: 'action', action: { type: 'moveBlame', delta: 10, count: 40 } }])
    })
  })
})
