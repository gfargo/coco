/**
 * Tests for the id-based selection selectors (#1452).
 *
 * These verify that the selectors produce the correct id from the
 * legacy index-based state — proving the bridge is correct before
 * consumers start migrating to read through it.
 */
import { applyLogInkAction, createLogInkState } from './inkViewModel'
import type { LogInkContext } from './types'
import { getSelectedBranchBatch, getSelectedBranchId, getSelectedTagId, getSelectedStashId, getSelectedStashBatch, getSelectedWorktree, getSelectedSubmodule, getSelectedRemote, getSelectedIssue, getSelectedPullRequestTriage, getSelectedCommitTarget, getSelectedCommitRange, isContiguousHistoryRange } from './selection'

function makeCommitRow(hash: string, parents: string[] = []) {
  return {
    type: 'commit' as const, graph: '*', shortHash: hash, hash,
    parents, date: '2026-05-01', author: 'Coco', refs: [], message: `commit ${hash}`,
  }
}

function makeBranch(shortName: string, date = '2026-01-01') {
  return {
    shortName,
    name: `refs/heads/${shortName}`,
    hash: `abc${shortName}`,
    date,
    subject: `commit on ${shortName}`,
    upstream: undefined,
    gone: false,
    ahead: 0,
    behind: 0,
  }
}

function makeTag(name: string) {
  return { name, hash: `tag${name}`, subject: `tag ${name}`, date: '2026-01-01', tagger: '' }
}

function makeStash(index: number) {
  return { ref: `stash@{${index}}`, message: `stash ${index}`, hash: `s${index}`, date: '2026-01-01' }
}

function makeWorktree(path: string, branch?: string) {
  return { path, branch, head: `h-${path}`, detached: !branch, bare: false, current: false, dirty: false }
}

function makeSubmodule(path: string, name = path) {
  return { name, path, pinnedSha: `sha-${path}`, flag: 'clean' as const, trackingBranch: undefined, url: undefined }
}

function makeRemote(name: string) {
  return { name, fetchUrl: `git@example.com:${name}.git`, pushUrl: `git@example.com:${name}.git` }
}

function makeIssue(number: number) {
  return {
    number,
    title: `issue ${number}`,
    url: `https://github.com/example/repo/issues/${number}`,
    state: 'OPEN',
    author: 'coco',
    assignees: [],
    labels: [],
  }
}

function makePR(number: number) {
  return {
    number,
    title: `pr ${number}`,
    url: `https://github.com/example/repo/pull/${number}`,
    state: 'OPEN',
    isDraft: false,
    headRefName: `feature/${number}`,
    baseRefName: 'main',
    author: 'coco',
    assignees: [],
    labels: [],
  }
}

describe('selection selectors (#1452)', () => {
  const context = {
    branches: {
      localBranches: [makeBranch('main'), makeBranch('feature'), makeBranch('hotfix')],
      remoteBranches: [],
      currentBranch: 'main',
      dirty: false,
    },
    tags: { tags: [makeTag('v1.0'), makeTag('v2.0'), makeTag('v3.0')] },
    stashes: { stashes: [makeStash(0), makeStash(1), makeStash(2)] },
  } as unknown as LogInkContext

  describe('getSelectedBranchId', () => {
    it('returns the branch shortName at the selected index', () => {
      // Default sort is 'name' (alphabetical): feature, hotfix, main
      const state = { ...createLogInkState([]), selectedBranchIndex: 1 }
      expect(getSelectedBranchId(state, context)).toBe('hotfix')
    })

    it('clamps out-of-range index to last item', () => {
      const state = { ...createLogInkState([]), selectedBranchIndex: 99 }
      // Sorted: feature, hotfix, main — last is 'main'
      expect(getSelectedBranchId(state, context)).toBe('main')
    })

    it('returns undefined for empty branch list', () => {
      const state = { ...createLogInkState([]), selectedBranchIndex: 0 }
      const emptyCtx = { branches: { localBranches: [], remoteBranches: [], currentBranch: undefined, dirty: false } } as unknown as LogInkContext
      expect(getSelectedBranchId(state, emptyCtx)).toBeUndefined()
    })

    it('respects the active filter', () => {
      const state = { ...createLogInkState([]), selectedBranchIndex: 0, filter: 'hot' }
      // Only 'hotfix' matches 'hot'
      expect(getSelectedBranchId(state, context)).toBe('hotfix')
    })
  })

  describe('getSelectedTagId', () => {
    it('returns the tag name at the selected index', () => {
      const state = { ...createLogInkState([]), selectedTagIndex: 2 }
      expect(getSelectedTagId(state, context)).toBe('v3.0')
    })

    it('returns undefined for empty tags', () => {
      const state = { ...createLogInkState([]), selectedTagIndex: 0 }
      expect(getSelectedTagId(state, { tags: { tags: [] } })).toBeUndefined()
    })
  })

  describe('getSelectedStashId', () => {
    it('returns the stash ref at the selected index', () => {
      const state = { ...createLogInkState([]), selectedStashIndex: 1 }
      expect(getSelectedStashId(state, context)).toBe('stash@{1}')
    })
  })

  // #1452 flip — the id mirror wins over the index when both are set and
  // the id still resolves, so the cursor follows the same logical item
  // across a context refresh that reorders the sorted+filtered list
  // (rendering, which still reads the raw index, is untouched by this —
  // only action-target resolution through these selectors changes).
  describe('id-first resolution (#1452 flip)', () => {
    it('prefers selectedBranchId over selectedBranchIndex when both are set', () => {
      // Sorted: feature, hotfix, main — index 0 is 'feature', but the id
      // mirror points at 'main'.
      const state = { ...createLogInkState([]), selectedBranchIndex: 0, selectedBranchId: 'main' }
      expect(getSelectedBranchId(state, context)).toBe('main')
    })

    it('falls back to the index when selectedBranchId is undefined', () => {
      const state = { ...createLogInkState([]), selectedBranchIndex: 0, selectedBranchId: undefined }
      expect(getSelectedBranchId(state, context)).toBe('feature')
    })

    it('falls back to the index when selectedBranchId no longer resolves (deleted / filtered out)', () => {
      const state = { ...createLogInkState([]), selectedBranchIndex: 1, selectedBranchId: 'gone' }
      expect(getSelectedBranchId(state, context)).toBe('hotfix')
    })

    it('prefers selectedTagId over selectedTagIndex when both are set', () => {
      const state = { ...createLogInkState([]), selectedTagIndex: 0, selectedTagId: 'v3.0' }
      expect(getSelectedTagId(state, context)).toBe('v3.0')
    })

    it('prefers selectedStashId over selectedStashIndex when both are set', () => {
      const state = { ...createLogInkState([]), selectedStashIndex: 0, selectedStashId: 'stash@{2}' }
      expect(getSelectedStashId(state, context)).toBe('stash@{2}')
    })

    // The actual scenario the flip exists to fix: a background context
    // refresh (fetch completing, ahead/behind counts changing, a new
    // branch appearing) can reorder the sorted+filtered list WITHOUT any
    // reducer action touching the index. Before the flip, the selector
    // blindly re-indexed into the new order and silently resolved to a
    // different branch than the one the user had cursored — a stale
    // index pointing at the wrong logical item. After the flip, the id
    // mirror (written once when the user last moved the cursor) keeps
    // resolving to the SAME branch even though its position moved.
    it('keeps resolving to the same branch after a context refresh reorders the list', () => {
      const before = {
        branches: {
          localBranches: [makeBranch('delta'), makeBranch('echo'), makeBranch('foxtrot')],
          remoteBranches: [],
          currentBranch: 'delta',
          dirty: false,
        },
      } as unknown as LogInkContext
      // User moved the cursor to 'echo' (index 1) — moveBranch's dual-write
      // sets both fields together.
      const state = { ...createLogInkState([]), selectedBranchIndex: 1, selectedBranchId: 'echo' }
      expect(getSelectedBranchId(state, before)).toBe('echo')

      // Background refresh: a new branch sorts alphabetically ahead of
      // 'echo', shifting it from index 1 to index 2. No reducer action
      // fired — `state` (index + id) is byte-identical to before.
      const after = {
        branches: {
          localBranches: [makeBranch('alpha'), makeBranch('delta'), makeBranch('echo'), makeBranch('foxtrot')],
          remoteBranches: [],
          currentBranch: 'delta',
          dirty: false,
        },
      } as unknown as LogInkContext
      // Sorted: alpha, delta, echo, foxtrot — index 1 is now 'delta', NOT
      // 'echo'. An index-only lookup would silently return the wrong
      // branch here; the id-first selector still returns 'echo'.
      expect(getSelectedBranchId(state, after)).toBe('echo')
    })
  })

  describe('getSelectedWorktree', () => {
    const worktreeContext = {
      worktreeList: {
        worktrees: [
          makeWorktree('/repo', 'main'),
          makeWorktree('/repo-feature', 'feature'),
        ],
      },
    } as unknown as LogInkContext

    it('returns the worktree at the selected index', () => {
      const state = { ...createLogInkState([]), selectedWorktreeListIndex: 1 }
      expect(getSelectedWorktree(state, worktreeContext)?.path).toBe('/repo-feature')
    })

    // A worktree action reachable from the palette (rather than the
    // worktrees view) can fire with a stale filter still applied — the
    // cursor should still resolve against the unfiltered list rather
    // than going target-less.
    it('falls back to the unfiltered list when the filter hides every worktree', () => {
      const state = {
        ...createLogInkState([]),
        selectedWorktreeListIndex: 1,
        filter: 'does-not-match-anything',
      }
      expect(getSelectedWorktree(state, worktreeContext)?.path).toBe('/repo-feature')
    })

    it('returns undefined when there are no worktrees at all', () => {
      const state = { ...createLogInkState([]), selectedWorktreeListIndex: 0 }
      const emptyCtx = { worktreeList: { worktrees: [] } } as unknown as LogInkContext
      expect(getSelectedWorktree(state, emptyCtx)).toBeUndefined()
    })

    // #1452 flip — same id-first, index-fallback resolution as branch/tag/
    // stash, so a context refresh that reorders the worktree list can't
    // silently resolve to the wrong logical worktree.
    it('prefers selectedWorktreeListId over selectedWorktreeListIndex when both are set', () => {
      const state = {
        ...createLogInkState([]),
        selectedWorktreeListIndex: 0,
        selectedWorktreeListId: '/repo-feature',
      }
      expect(getSelectedWorktree(state, worktreeContext)?.path).toBe('/repo-feature')
    })

    it('falls back to the index when selectedWorktreeListId is undefined', () => {
      const state = {
        ...createLogInkState([]),
        selectedWorktreeListIndex: 0,
        selectedWorktreeListId: undefined,
      }
      expect(getSelectedWorktree(state, worktreeContext)?.path).toBe('/repo')
    })

    it('falls back to the index when selectedWorktreeListId no longer resolves', () => {
      const state = {
        ...createLogInkState([]),
        selectedWorktreeListIndex: 1,
        selectedWorktreeListId: '/gone',
      }
      expect(getSelectedWorktree(state, worktreeContext)?.path).toBe('/repo-feature')
    })

    it('keeps resolving to the same worktree after a context refresh reorders the list', () => {
      const before = {
        worktreeList: { worktrees: [makeWorktree('/repo', 'main'), makeWorktree('/repo-b', 'b')] },
      } as unknown as LogInkContext
      const state = {
        ...createLogInkState([]),
        selectedWorktreeListIndex: 1,
        selectedWorktreeListId: '/repo-b',
      }
      expect(getSelectedWorktree(state, before)?.path).toBe('/repo-b')

      // A new worktree sorts ahead of '/repo-b', shifting it from index 1
      // to index 2. No reducer action fired — state is unchanged.
      const after = {
        worktreeList: {
          worktrees: [makeWorktree('/repo-a', 'a'), makeWorktree('/repo', 'main'), makeWorktree('/repo-b', 'b')],
        },
      } as unknown as LogInkContext
      // Index 1 is now '/repo' — an index-only lookup would resolve
      // there; the id-first selector still returns '/repo-b'.
      expect(getSelectedWorktree(state, after)?.path).toBe('/repo-b')
    })

    it('id-first resolution also applies to the unfiltered fallback path', () => {
      const state = {
        ...createLogInkState([]),
        selectedWorktreeListIndex: 0,
        selectedWorktreeListId: '/repo-feature',
        filter: 'does-not-match-anything',
      }
      expect(getSelectedWorktree(state, worktreeContext)?.path).toBe('/repo-feature')
    })
  })

  describe('getSelectedSubmodule', () => {
    const submoduleContext = {
      submodules: {
        entries: [makeSubmodule('/vendor/a'), makeSubmodule('/vendor/b')],
      },
    } as unknown as LogInkContext

    it('returns the submodule at the selected index', () => {
      const state = { ...createLogInkState([]), selectedSubmoduleIndex: 1 }
      expect(getSelectedSubmodule(state, submoduleContext)?.path).toBe('/vendor/b')
    })

    it('falls back to the unfiltered list when the filter hides every submodule', () => {
      const state = {
        ...createLogInkState([]),
        selectedSubmoduleIndex: 1,
        filter: 'does-not-match-anything',
      }
      expect(getSelectedSubmodule(state, submoduleContext)?.path).toBe('/vendor/b')
    })

    it('returns undefined when there are no submodules at all', () => {
      const state = { ...createLogInkState([]), selectedSubmoduleIndex: 0 }
      const emptyCtx = { submodules: { entries: [] } } as unknown as LogInkContext
      expect(getSelectedSubmodule(state, emptyCtx)).toBeUndefined()
    })

    it('prefers selectedSubmoduleId over selectedSubmoduleIndex when both are set', () => {
      const state = {
        ...createLogInkState([]),
        selectedSubmoduleIndex: 0,
        selectedSubmoduleId: '/vendor/b',
      }
      expect(getSelectedSubmodule(state, submoduleContext)?.path).toBe('/vendor/b')
    })

    it('falls back to the index when selectedSubmoduleId is undefined', () => {
      const state = {
        ...createLogInkState([]),
        selectedSubmoduleIndex: 0,
        selectedSubmoduleId: undefined,
      }
      expect(getSelectedSubmodule(state, submoduleContext)?.path).toBe('/vendor/a')
    })

    it('falls back to the index when selectedSubmoduleId no longer resolves', () => {
      const state = {
        ...createLogInkState([]),
        selectedSubmoduleIndex: 1,
        selectedSubmoduleId: '/gone',
      }
      expect(getSelectedSubmodule(state, submoduleContext)?.path).toBe('/vendor/b')
    })
  })

  describe('getSelectedRemote', () => {
    const remoteContext = {
      remotes: {
        entries: [makeRemote('origin'), makeRemote('upstream')],
      },
    } as unknown as LogInkContext

    it('returns the remote at the selected index', () => {
      const state = { ...createLogInkState([]), selectedRemoteIndex: 1 }
      expect(getSelectedRemote(state, remoteContext)?.name).toBe('upstream')
    })

    it('falls back to the unfiltered list when the filter hides every remote', () => {
      const state = {
        ...createLogInkState([]),
        selectedRemoteIndex: 1,
        filter: 'does-not-match-anything',
      }
      expect(getSelectedRemote(state, remoteContext)?.name).toBe('upstream')
    })

    it('returns undefined when there are no remotes at all', () => {
      const state = { ...createLogInkState([]), selectedRemoteIndex: 0 }
      const emptyCtx = { remotes: { entries: [] } } as unknown as LogInkContext
      expect(getSelectedRemote(state, emptyCtx)).toBeUndefined()
    })

    it('prefers selectedRemoteId over selectedRemoteIndex when both are set', () => {
      const state = {
        ...createLogInkState([]),
        selectedRemoteIndex: 0,
        selectedRemoteId: 'upstream',
      }
      expect(getSelectedRemote(state, remoteContext)?.name).toBe('upstream')
    })

    it('falls back to the index when selectedRemoteId is undefined', () => {
      const state = {
        ...createLogInkState([]),
        selectedRemoteIndex: 0,
        selectedRemoteId: undefined,
      }
      expect(getSelectedRemote(state, remoteContext)?.name).toBe('origin')
    })

    it('falls back to the index when selectedRemoteId no longer resolves', () => {
      const state = {
        ...createLogInkState([]),
        selectedRemoteIndex: 1,
        selectedRemoteId: 'gone',
      }
      expect(getSelectedRemote(state, remoteContext)?.name).toBe('upstream')
    })
  })

  describe('getSelectedIssue', () => {
    const issueContext = {
      issueList: {
        issues: [makeIssue(1), makeIssue(7)],
      },
    } as unknown as LogInkContext

    it('returns the issue at the selected index', () => {
      const state = { ...createLogInkState([]), selectedIssueIndex: 1 }
      expect(getSelectedIssue(state, issueContext)?.number).toBe(7)
    })

    it('falls back to the unfiltered list when the filter hides every issue', () => {
      const state = {
        ...createLogInkState([]),
        selectedIssueIndex: 1,
        filter: 'does-not-match-anything',
      }
      expect(getSelectedIssue(state, issueContext)?.number).toBe(7)
    })

    it('returns undefined when there are no issues at all', () => {
      const state = { ...createLogInkState([]), selectedIssueIndex: 0 }
      const emptyCtx = { issueList: { issues: [] } } as unknown as LogInkContext
      expect(getSelectedIssue(state, emptyCtx)).toBeUndefined()
    })

    it('prefers selectedIssueId over selectedIssueIndex when both are set', () => {
      const state = {
        ...createLogInkState([]),
        selectedIssueIndex: 0,
        selectedIssueId: '7',
      }
      expect(getSelectedIssue(state, issueContext)?.number).toBe(7)
    })

    it('falls back to the index when selectedIssueId is undefined', () => {
      const state = {
        ...createLogInkState([]),
        selectedIssueIndex: 0,
        selectedIssueId: undefined,
      }
      expect(getSelectedIssue(state, issueContext)?.number).toBe(1)
    })

    it('falls back to the index when selectedIssueId no longer resolves', () => {
      const state = {
        ...createLogInkState([]),
        selectedIssueIndex: 1,
        selectedIssueId: '999',
      }
      expect(getSelectedIssue(state, issueContext)?.number).toBe(7)
    })
  })

  describe('getSelectedPullRequestTriage', () => {
    const prContext = {
      pullRequestList: {
        pullRequests: [makePR(3), makePR(9)],
      },
    } as unknown as LogInkContext

    it('returns the PR at the selected index', () => {
      const state = { ...createLogInkState([]), selectedPullRequestTriageIndex: 1 }
      expect(getSelectedPullRequestTriage(state, prContext)?.number).toBe(9)
    })

    it('falls back to the unfiltered list when the filter hides every PR', () => {
      const state = {
        ...createLogInkState([]),
        selectedPullRequestTriageIndex: 1,
        filter: 'does-not-match-anything',
      }
      expect(getSelectedPullRequestTriage(state, prContext)?.number).toBe(9)
    })

    it('returns undefined when there are no PRs at all', () => {
      const state = { ...createLogInkState([]), selectedPullRequestTriageIndex: 0 }
      const emptyCtx = { pullRequestList: { pullRequests: [] } } as unknown as LogInkContext
      expect(getSelectedPullRequestTriage(state, emptyCtx)).toBeUndefined()
    })

    it('prefers selectedPullRequestTriageId over selectedPullRequestTriageIndex when both are set', () => {
      const state = {
        ...createLogInkState([]),
        selectedPullRequestTriageIndex: 0,
        selectedPullRequestTriageId: '9',
      }
      expect(getSelectedPullRequestTriage(state, prContext)?.number).toBe(9)
    })

    it('falls back to the index when selectedPullRequestTriageId is undefined', () => {
      const state = {
        ...createLogInkState([]),
        selectedPullRequestTriageIndex: 0,
        selectedPullRequestTriageId: undefined,
      }
      expect(getSelectedPullRequestTriage(state, prContext)?.number).toBe(3)
    })

    it('falls back to the index when selectedPullRequestTriageId no longer resolves', () => {
      const state = {
        ...createLogInkState([]),
        selectedPullRequestTriageIndex: 1,
        selectedPullRequestTriageId: '999',
      }
      expect(getSelectedPullRequestTriage(state, prContext)?.number).toBe(9)
    })
  })

  describe('getSelectedCommitTarget', () => {
    const rows = [{
      type: 'commit' as const, graph: '*', shortHash: 'abc1234', hash: 'abc1234'.padEnd(12, '0'),
      parents: [], date: '2026-05-01', author: 'Coco', refs: [], message: 'fix: the thing',
    }]

    it('returns the cursored commit for a commit-target confirmation id', () => {
      const state = createLogInkState(rows)
      expect(getSelectedCommitTarget('cherry-pick-commit', state)?.shortHash).toBe('abc1234')
    })

    it('returns undefined for a non-commit-target confirmation id', () => {
      const state = createLogInkState(rows)
      expect(getSelectedCommitTarget('delete-branch', state)).toBeUndefined()
    })

    it('returns undefined when id is undefined', () => {
      const state = createLogInkState(rows)
      expect(getSelectedCommitTarget(undefined, state)).toBeUndefined()
    })
  })

  // #1361 — batch target resolution: range → marks → cursored single.
  // Sorted branch order in this fixture: feature, hotfix, main.
  describe('getSelectedBranchBatch', () => {
    it('falls back to the single cursored branch with no selection', () => {
      const state = { ...createLogInkState([]), selectedBranchIndex: 1 }
      expect(getSelectedBranchBatch(state, context).map((b) => b.shortName)).toEqual(['hotfix'])
    })

    it('resolves the marked set in list order regardless of marking order', () => {
      let state = createLogInkState([])
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'main' })
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'feature' })
      expect(getSelectedBranchBatch(state, context).map((b) => b.shortName)).toEqual(['feature', 'main'])
    })

    it('marked ids that no longer resolve drop out silently', () => {
      let state = createLogInkState([])
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'feature' })
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'deleted-elsewhere' })
      expect(getSelectedBranchBatch(state, context).map((b) => b.shortName)).toEqual(['feature'])
    })

    it('marks survive an active filter — every marked branch resolves, not just visible ones', () => {
      let state = createLogInkState([])
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'feature' })
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'main' })
      const filtered = { ...state, filter: 'feat' }
      expect(getSelectedBranchBatch(filtered, context).map((b) => b.shortName)).toEqual(['feature', 'main'])
    })

    // #1361 — the reducer keeps marks and an anchor mutually exclusive
    // (setRangeAnchor clears marks, toggleMark clears the anchor), so
    // this exact combination isn't reachable through normal dispatch.
    // Constructing the state directly still exercises the selector's
    // own priority contract defensively — anything that ever hands it
    // a selection with both set must not silently act on the marks.
    it('an active range anchor wins over marks and resolves anchor..cursor positionally', () => {
      const state = {
        ...createLogInkState([]),
        selectedBranchIndex: 1,
        selection: { view: 'branches' as const, anchorId: 'feature', ids: new Set(['main']) },
      }
      // Anchor on 'feature' (index 0), cursor on index 1 ('hotfix').
      expect(getSelectedBranchBatch(state, context).map((b) => b.shortName)).toEqual(['feature', 'hotfix'])
    })

    it('a backwards range (cursor above the anchor) resolves the same span', () => {
      let state = createLogInkState([])
      state = applyLogInkAction(state, { type: 'setRangeAnchor', view: 'branches', id: 'main' })
      // Anchor on 'main' (index 2), cursor up at index 0 ('feature').
      const ranged = { ...state, selectedBranchIndex: 0 }
      expect(getSelectedBranchBatch(ranged, context).map((b) => b.shortName))
        .toEqual(['feature', 'hotfix', 'main'])
    })

    it('skips the range rung when the anchor no longer resolves in the visible list', () => {
      // Same defensive-construction note as above — directly building
      // the state exercises the selector's fallback-to-marks rung.
      const state = {
        ...createLogInkState([]),
        filter: 'hot',
        selectedBranchIndex: 0,
        selection: { view: 'branches' as const, anchorId: 'main', ids: new Set(['hotfix']) },
      }
      // Filter hides 'main' — the positional range is meaningless, so
      // resolution falls through to the marked set.
      expect(getSelectedBranchBatch(state, context).map((b) => b.shortName)).toEqual(['hotfix'])
    })

    it('ignores a selection owned by a different view', () => {
      let state = createLogInkState([])
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'stash', id: 'stash@{0}' })
      const cursored = { ...state, selectedBranchIndex: 0 }
      expect(getSelectedBranchBatch(cursored, context).map((b) => b.shortName)).toEqual(['feature'])
    })
  })

  // #1361 — same ladder as getSelectedBranchBatch; stashes have no sort
  // mode so context order IS list order (stash@{0}, stash@{1}, stash@{2}).
  describe('getSelectedStashBatch', () => {
    it('falls back to the single cursored stash with no selection', () => {
      const state = { ...createLogInkState([]), selectedStashIndex: 1 }
      expect(getSelectedStashBatch(state, context).map((s) => s.ref)).toEqual(['stash@{1}'])
    })

    it('resolves the marked set in list order', () => {
      let state = createLogInkState([])
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'stash', id: 'stash@{2}' })
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'stash', id: 'stash@{0}' })
      expect(getSelectedStashBatch(state, context).map((s) => s.ref)).toEqual(['stash@{0}', 'stash@{2}'])
    })

    it('marked ids that no longer resolve drop out silently', () => {
      let state = createLogInkState([])
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'stash', id: 'stash@{1}' })
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'stash', id: 'stash@{9}' })
      expect(getSelectedStashBatch(state, context).map((s) => s.ref)).toEqual(['stash@{1}'])
    })

    // #1361 — the reducer keeps marks and an anchor mutually exclusive
    // (setRangeAnchor clears marks), so this exact combination isn't
    // reachable through normal dispatch; constructing the state
    // directly still exercises the selector's own priority contract.
    it('an active range anchor wins over marks and resolves anchor..cursor positionally', () => {
      const state = {
        ...createLogInkState([]),
        selectedStashIndex: 1,
        selection: { view: 'stash' as const, anchorId: 'stash@{0}', ids: new Set(['stash@{2}']) },
      }
      expect(getSelectedStashBatch(state, context).map((s) => s.ref)).toEqual(['stash@{0}', 'stash@{1}'])
    })

    it('ignores a selection owned by a different view', () => {
      let state = createLogInkState([])
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'main' })
      const cursored = { ...state, selectedStashIndex: 0 }
      expect(getSelectedStashBatch(cursored, context).map((s) => s.ref)).toEqual(['stash@{0}'])
    })
  })

  // #1361 — history is v-range only (no x-marks). Rows: c0 (newest) ..
  // c4 (oldest), matching git log's own newest-first display order.
  describe('getSelectedCommitRange', () => {
    const rows = ['c0', 'c1', 'c2', 'c3', 'c4'].map((hash) => makeCommitRow(hash))

    it('returns undefined with no active range', () => {
      const state = createLogInkState(rows)
      expect(getSelectedCommitRange(state)).toBeUndefined()
    })

    it('resolves a forward range (anchor above cursor) in display order', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setRangeAnchor', view: 'history', id: 'c1' })
      const ranged = { ...state, selectedIndex: 3 }
      expect(getSelectedCommitRange(ranged)?.map((c) => c.hash)).toEqual(['c1', 'c2', 'c3'])
    })

    it('resolves a backward range (cursor above anchor) — same span, same display order', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setRangeAnchor', view: 'history', id: 'c3' })
      const ranged = { ...state, selectedIndex: 1 }
      expect(getSelectedCommitRange(ranged)?.map((c) => c.hash)).toEqual(['c1', 'c2', 'c3'])
    })

    it('a single-row range (anchor === cursor) resolves to one commit', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setRangeAnchor', view: 'history', id: 'c2' })
      const ranged = { ...state, selectedIndex: 2 }
      expect(getSelectedCommitRange(ranged)?.map((c) => c.hash)).toEqual(['c2'])
    })

    it('returns undefined when the anchor no longer resolves', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setRangeAnchor', view: 'history', id: 'gone' })
      expect(getSelectedCommitRange(state)).toBeUndefined()
    })

    it('returns undefined while the cursor is on the synthetic new-commit row', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setRangeAnchor', view: 'history', id: 'c1' })
      const pending = { ...state, selectedIndex: 3, pendingCommitFocused: true }
      expect(getSelectedCommitRange(pending)).toBeUndefined()
    })

    it('ignores a selection owned by a different view', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'toggleMark', view: 'branches', id: 'main' })
      expect(getSelectedCommitRange({ ...state, selectedIndex: 2 })).toBeUndefined()
    })

    it('returns undefined when a filter is active (#1670 — filtered display is score-ordered, not chronological)', () => {
      let state = createLogInkState(rows)
      state = applyLogInkAction(state, { type: 'setRangeAnchor', view: 'history', id: 'c1' })
      const filtered = { ...state, selectedIndex: 3, filter: 'fix' }
      expect(getSelectedCommitRange(filtered)).toBeUndefined()
    })
  })

  // #1670 — the default history view is `git log --all`, which interleaves
  // commits from every branch by date; a visible run of rows isn't
  // guaranteed to be a single ancestor chain even without a text filter.
  describe('isContiguousHistoryRange', () => {
    it('returns true for a contiguous chain (display order newest-first)', () => {
      const range = [
        makeCommitRow('c1', ['c2']),
        makeCommitRow('c2', ['c3']),
        makeCommitRow('c3', ['c4']),
      ]
      expect(isContiguousHistoryRange(range)).toBe(true)
    })

    it('returns false when a row is interleaved from another branch', () => {
      const range = [
        makeCommitRow('c1', ['other']),
        makeCommitRow('c2', ['c3']),
        makeCommitRow('c3', ['c4']),
      ]
      expect(isContiguousHistoryRange(range)).toBe(false)
    })

    it('returns true for a single-commit range', () => {
      expect(isContiguousHistoryRange([makeCommitRow('c1', ['c2'])])).toBe(true)
    })
  })
})
