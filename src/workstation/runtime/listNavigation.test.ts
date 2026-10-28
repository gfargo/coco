import { createLogInkState, type LogInkState } from './inkViewModel'
import { LIST_NAVIGATORS, listEdgeEvents, listMoveEvents, resolveMoveTargetId } from './listNavigation'
import type { LogInkInputContext } from './inkInput'

const base = () => createLogInkState([])
const view = (activeView: string, extra: Partial<LogInkState> = {}) =>
  ({ ...base(), activeView, focus: 'commits', ...extra }) as LogInkState

// One row per list: the view that drives it, the context counts/ids, and
// the action the reducer expects. Mirrors the router's historical ladder.
const LISTS: Array<{
  name: string
  action: string
  state: LogInkState
  context: LogInkInputContext
  indexKey: keyof LogInkState
  hasId: boolean
}> = [
  { name: 'branches', action: 'moveBranch', state: view('branches', { selectedBranchIndex: 1 }), context: { branchCount: 4, branchIds: ['a', 'b', 'c', 'd'] }, indexKey: 'selectedBranchIndex', hasId: true },
  { name: 'tags', action: 'moveTag', state: view('tags', { selectedTagIndex: 1 }), context: { tagCount: 4, tagIds: ['a', 'b', 'c', 'd'] }, indexKey: 'selectedTagIndex', hasId: true },
  { name: 'stash', action: 'moveStash', state: view('stash', { selectedStashIndex: 1 }), context: { stashCount: 4, stashIds: ['a', 'b', 'c', 'd'] }, indexKey: 'selectedStashIndex', hasId: true },
  { name: 'reflog', action: 'moveReflog', state: view('reflog', { selectedReflogIndex: 1 }), context: { reflogCount: 4 }, indexKey: 'selectedReflogIndex', hasId: false },
  { name: 'remotes', action: 'moveRemote', state: view('remotes', { selectedRemoteIndex: 1 }), context: { remoteCount: 4, remoteListIds: ['a', 'b', 'c', 'd'] }, indexKey: 'selectedRemoteIndex', hasId: true },
  { name: 'submodules', action: 'moveSubmodule', state: view('submodules', { selectedSubmoduleIndex: 1 }), context: { submoduleCount: 4, submoduleListIds: ['a', 'b', 'c', 'd'] }, indexKey: 'selectedSubmoduleIndex', hasId: true },
  { name: 'issues', action: 'moveIssue', state: view('issues', { selectedIssueIndex: 1 }), context: { issueCount: 4, issueListIds: ['a', 'b', 'c', 'd'] }, indexKey: 'selectedIssueIndex', hasId: true },
  { name: 'pull-request-triage', action: 'movePullRequestTriage', state: view('pull-request-triage', { selectedPullRequestTriageIndex: 1 }), context: { pullRequestTriageCount: 4, pullRequestTriageListIds: ['a', 'b', 'c', 'd'] }, indexKey: 'selectedPullRequestTriageIndex', hasId: true },
  { name: 'worktrees', action: 'moveWorktreeListEntry', state: view('worktrees', { selectedWorktreeListIndex: 1 }), context: { worktreeListCount: 4, worktreeListIds: ['a', 'b', 'c', 'd'] }, indexKey: 'selectedWorktreeListIndex', hasId: true },
]

describe('LIST_NAVIGATORS (#2219)', () => {
  it('covers exactly the nine lists, in the router\'s historical order', () => {
    expect(LIST_NAVIGATORS.map((n) => n.action)).toEqual(LISTS.map((l) => l.action))
  })

  it.each(LISTS)('$name: ↑ / ↓ move one step and carry the id of the target row', ({ action, state, context, hasId }) => {
    expect(listMoveEvents(state, context, 1)).toEqual([
      { type: 'action', action: { type: action, delta: 1, count: 4, ...(hasId ? { id: 'c' } : {}) } },
    ])
    expect(listMoveEvents(state, context, -1)).toEqual([
      { type: 'action', action: { type: action, delta: -1, count: 4, ...(hasId ? { id: 'a' } : {}) } },
    ])
  })

  it.each(LISTS)('$name: Home / End jump by ± the list length and carry the edge id', ({ action, state, context, hasId }) => {
    expect(listEdgeEvents(state, context, 1)).toEqual([
      { type: 'action', action: { type: action, delta: 4, count: 4, ...(hasId ? { id: 'd' } : {}) } },
    ])
    expect(listEdgeEvents(state, context, -1)).toEqual([
      { type: 'action', action: { type: action, delta: -4, count: 4, ...(hasId ? { id: 'a' } : {}) } },
    ])
  })

  it.each(LISTS)('$name: an empty list produces no event', ({ state, context }) => {
    const empty = Object.fromEntries(Object.keys(context).map((key) => [key, key.endsWith('Count') ? 0 : []]))
    expect(listMoveEvents(state, empty as LogInkInputContext, 1)).toBeUndefined()
    expect(listEdgeEvents(state, empty as LogInkInputContext, 1)).toBeUndefined()
  })

  it('does not move a list that is not the active target', () => {
    expect(listMoveEvents(view('history'), { branchCount: 4, reflogCount: 4 }, 1)).toBeUndefined()
  })

  it('drives a sidebar tab the same way as its dedicated view', () => {
    const sidebar = { ...base(), activeView: 'history', focus: 'sidebar', sidebarTab: 'tags', selectedTagIndex: 0 } as LogInkState
    expect(listMoveEvents(sidebar, { tagCount: 2, tagIds: ['x', 'y'] }, 1)).toEqual([
      { type: 'action', action: { type: 'moveTag', delta: 1, count: 2, id: 'y' } },
    ])
  })

  it('clamps the id to the list bounds, like the reducer clamps the index', () => {
    expect(resolveMoveTargetId(['a', 'b', 'c'], 2, 1, 3)).toBe('c')
    expect(resolveMoveTargetId(['a', 'b', 'c'], 0, -1, 3)).toBe('a')
    expect(resolveMoveTargetId(undefined, 0, 1, 3)).toBeUndefined()
    expect(resolveMoveTargetId(['a'], 0, 1, 0)).toBeUndefined()
  })

  it('moves without an id when the context carries no id list yet', () => {
    expect(listMoveEvents(view('branches'), { branchCount: 3 }, 1)).toEqual([
      { type: 'action', action: { type: 'moveBranch', delta: 1, count: 3, id: undefined } },
    ])
  })

  describe('phases (precedence around the blame / file-history handlers)', () => {
    const sidebarWorktrees = { ...base(), activeView: 'blame', focus: 'sidebar', sidebarTab: 'worktrees' } as LogInkState
    const ctx: LogInkInputContext = { worktreeListCount: 3, worktreeListIds: ['a', 'b', 'c'] }

    it('phase 1 covers branches..remotes; phase 2 covers submodules..worktrees', () => {
      expect(LIST_NAVIGATORS.filter((n) => n.phase === 1).map((n) => n.action)).toEqual([
        'moveBranch', 'moveTag', 'moveStash', 'moveReflog', 'moveRemote',
      ])
      expect(LIST_NAVIGATORS.filter((n) => n.phase === 2).map((n) => n.action)).toEqual([
        'moveSubmodule', 'moveIssue', 'movePullRequestTriage', 'moveWorktreeListEntry',
      ])
    })

    it('a phase-2 list is invisible to a phase-1 walk (so the blame handler can win first)', () => {
      expect(listMoveEvents(sidebarWorktrees, ctx, 1, 1)).toBeUndefined()
      expect(listMoveEvents(sidebarWorktrees, ctx, 1, 2)).toEqual([
        { type: 'action', action: { type: 'moveWorktreeListEntry', delta: 1, count: 3, id: 'b' } },
      ])
    })

    it('an unphased walk (edge jumps) sees both', () => {
      expect(listEdgeEvents(sidebarWorktrees, ctx, 1)).toHaveLength(1)
    })
  })
})
