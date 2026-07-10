import type ReactTypes from 'react'
import type { GitLogRow } from '../../../commands/log/data'
import { createLogInkState } from '../inkViewModel'
import { checkoutReflogEntry, performReflogUndo, planReflogUndo } from '../../../git/reflogActions'
import { checkoutBranch, checkoutBranchByName, pullCurrentBranch, pullCurrentBranchRebase, pushBranch } from '../../../git/branchActions'
import { cherryPickCommit, autosquashRebase } from '../../../git/historyActions'
import { createStash } from '../../../git/stashActions'
import { continueOperation } from '../../../git/operationActions'
import { useWorkflowAction, type UseWorkflowActionDeps } from './useWorkflowAction'

/**
 * Regression coverage for the stale-target window: `runWorkflowAction` is
 * memoized once (`useCallback` with an empty dep array) and must read every
 * render-scoped input through the `depsRef` snapshot at CALL time. The
 * previous design enumerated state fields in the dep array and undercounted
 * (no `selectedReflogIndex`, `selectedIndex`, triage indices, `activeView`),
 * so cursor movement did not regenerate the callback and destructive actions
 * ran against the previously-cursored item.
 */

jest.mock('../../../git/reflogActions', () => ({
  checkoutReflogEntry: jest.fn().mockResolvedValue({ ok: true, message: 'checked out' }),
  planReflogUndo: jest.fn(),
  performReflogUndo: jest.fn().mockResolvedValue({ ok: true, message: 'undone' }),
}))

jest.mock('../../../git/branchActions', () => {
  const actual = jest.requireActual('../../../git/branchActions')
  return {
    ...actual,
    pushBranch: jest.fn(),
    pullCurrentBranch: jest.fn(),
    pullCurrentBranchRebase: jest.fn(),
    checkoutBranch: jest.fn(),
    checkoutBranchByName: jest.fn(),
  }
})

jest.mock('../../../git/historyActions', () => {
  const actual = jest.requireActual('../../../git/historyActions')
  return {
    ...actual,
    cherryPickCommit: jest.fn(),
    autosquashRebase: jest.fn(),
  }
})

jest.mock('../../../git/stashActions', () => {
  const actual = jest.requireActual('../../../git/stashActions')
  return {
    ...actual,
    createStash: jest.fn(),
  }
})

jest.mock('../../../git/operationActions', () => {
  const actual = jest.requireActual('../../../git/operationActions')
  return {
    ...actual,
    continueOperation: jest.fn(),
  }
})

const checkoutReflogEntryMock = checkoutReflogEntry as jest.MockedFunction<
  typeof checkoutReflogEntry
>
const planReflogUndoMock = planReflogUndo as jest.MockedFunction<typeof planReflogUndo>
const performReflogUndoMock = performReflogUndo as jest.MockedFunction<typeof performReflogUndo>

/**
 * Minimal React stand-in with real `useRef` persistence across renders and
 * `useCallback` that — like React with an unchanged dep array — keeps
 * returning the instance created on the first render.
 */
function createHookHarness() {
  const refSlots: Array<{ current: unknown }> = []
  let refCursor = 0
  let memoized: ((...args: unknown[]) => unknown) | undefined
  const React = {
    useRef: <T,>(initial: T) => {
      if (refCursor >= refSlots.length) {
        refSlots.push({ current: initial })
      }
      return refSlots[refCursor++] as { current: T }
    },
    useCallback: <T,>(fn: T): T => {
      if (!memoized) {
        memoized = fn as (...args: unknown[]) => unknown
      }
      return memoized as T
    },
  } as unknown as typeof ReactTypes
  return { React, beginRender: () => { refCursor = 0 } }
}

function createDeps(over: Partial<UseWorkflowActionDeps>): UseWorkflowActionDeps {
  return {
    git: {} as UseWorkflowActionDeps['git'],
    context: {} as UseWorkflowActionDeps['context'],
    state: createLogInkState([]),
    dispatch: jest.fn(),
    refreshContext: jest.fn().mockResolvedValue(undefined),
    refreshHistoryRows: jest.fn().mockResolvedValue(undefined),
    refreshWorktreeContext: jest.fn().mockResolvedValue(undefined),
    runtimes: [{}] as unknown as UseWorkflowActionDeps['runtimes'],
    setContext: jest.fn(),
    setContextStatus: jest.fn(),
    forge: {} as UseWorkflowActionDeps['forge'],
    forgeProvider: undefined,
    filteredRemoteList: [],
    filteredReflogList: [],
    filteredSubmoduleList: [],
    filteredIssueList: [],
    filteredPullRequestTriageList: [],
    ...over,
  }
}

const reflogEntry = (hash: string) =>
  ({
    hash,
    shortHash: hash.slice(0, 7),
    selector: `HEAD@{${hash}}`,
    message: hash,
    relativeDate: 'now',
    subject: hash,
  }) as unknown as UseWorkflowActionDeps['filteredReflogList'][number]

describe('runWorkflowAction reads the live render snapshot, not the mount-time closure', () => {
  it('targets the reflog entry cursored at call time after re-renders that only move the cursor', async () => {
    const harness = createHookHarness()
    const entries = [reflogEntry('aaaaaaaaaaaa'), reflogEntry('bbbbbbbbbbbb')]

    // First render: cursor on entry 0.
    harness.beginRender()
    const first = useWorkflowAction(harness.React, createDeps({
      filteredReflogList: entries,
      state: { ...createLogInkState([]), selectedReflogIndex: 0 },
    }))

    // Cursor moves to entry 1 — in the old design no dep changed, so the
    // memoized callback kept the first render's snapshot.
    harness.beginRender()
    const second = useWorkflowAction(harness.React, createDeps({
      filteredReflogList: entries,
      state: { ...createLogInkState([]), selectedReflogIndex: 1 },
    }))

    // Memoization holds (identity-stable callback across renders)…
    expect(second.runWorkflowAction).toBe(first.runWorkflowAction)

    // …but execution resolves the CURRENT cursor.
    await first.runWorkflowAction('checkout-reflog-entry')
    expect(checkoutReflogEntryMock).toHaveBeenCalledTimes(1)
    expect(checkoutReflogEntryMock).toHaveBeenCalledWith(expect.anything(), entries[1])
  })
})

describe('global-undo (#1361)', () => {
  beforeEach(() => {
    planReflogUndoMock.mockReset()
    performReflogUndoMock.mockReset().mockResolvedValue({ ok: true, message: 'undone' })
  })

  it('re-derives the plan from the raw reflog and performs it', async () => {
    const harness = createHookHarness()
    const entries = [reflogEntry('aaaaaaaaaaaa')]
    const plan = { description: 'x', commandPreview: 'git reset --hard HEAD@{1}', kind: 'reset' as const }
    planReflogUndoMock.mockReturnValue(plan)

    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      context: { reflog: { entries } } as UseWorkflowActionDeps['context'],
    }))

    await runWorkflowAction('global-undo')
    expect(planReflogUndoMock).toHaveBeenCalledWith(entries)
    expect(performReflogUndoMock).toHaveBeenCalledWith(expect.anything(), plan)
  })

  it('fails cleanly when there is no reflog entry to undo', async () => {
    const harness = createHookHarness()
    planReflogUndoMock.mockReturnValue(undefined)

    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      context: { reflog: { entries: [] } } as unknown as UseWorkflowActionDeps['context'],
    }))

    await runWorkflowAction('global-undo')
    expect(performReflogUndoMock).not.toHaveBeenCalled()
  })
})

const pushBranchMock = pushBranch as jest.MockedFunction<typeof pushBranch>
const pullCurrentBranchMock = pullCurrentBranch as jest.MockedFunction<typeof pullCurrentBranch>

const localBranch = {
  type: 'local',
  name: 'refs/heads/main',
  shortName: 'main',
  hash: 'abc',
  current: true,
  upstream: 'origin/main',
  remote: 'origin',
  date: '2026-05-01',
  subject: 'feat',
  ahead: 1,
  behind: 1,
} as never

describe('push/pull failure recovery (#1356)', () => {
  it('offers a with-lease force confirm when a push is rejected non-fast-forward', async () => {
    pushBranchMock.mockResolvedValue({
      ok: false,
      message: "error: failed to push some refs to 'origin'",
      details: ['! [rejected] main -> main (non-fast-forward)'],
    })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      context: { branches: { localBranches: [localBranch], currentBranch: 'main' } } as never,
    }))

    await runWorkflowAction('push-selected-branch')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'setPendingConfirmation',
      value: 'force-push-selected-branch',
    })
  })

  it('offers the rebase/merge choice when a current-branch pull diverges', async () => {
    pullCurrentBranchMock.mockResolvedValue({
      ok: false,
      message: 'fatal: Not possible to fast-forward, aborting.',
    })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({ dispatch }))

    await runWorkflowAction('pull-current-branch')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setPendingChoice',
      value: expect.objectContaining({
        id: 'diverged-pull-recovery',
        options: [
          expect.objectContaining({ key: 'r', workflowId: 'pull-rebase-current' }),
          expect.objectContaining({ key: 'm', workflowId: 'pull-merge-current' }),
        ],
      }),
    }))
  })

  it('does NOT offer the pull choice for a non-current fetch-refspec rejection', async () => {
    pushBranchMock.mockReset()
    pullCurrentBranchMock.mockReset()
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      context: { branches: { localBranches: [localBranch], currentBranch: 'other' } } as never,
    }))
    // pull-selected-branch on a NON-current branch goes through the
    // fetch refspec path (real implementation), which we let fail via
    // the unmocked fetch — instead simulate by checking the predicate
    // boundary: a rejection message without the ff-only phrasing must
    // not raise the choice. Use the mocked pullCurrentBranch for the
    // current-branch delegation with a refspec-style message.
    pullCurrentBranchMock.mockResolvedValue({
      ok: false,
      message: '! [rejected] main -> main (non-fast-forward)',
    })
    await runWorkflowAction('pull-current-branch')
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setPendingChoice' }))
  })
})

describe('overlapping invocations do not clear each other\'s loaders (#1385)', () => {
  it('an earlier-finishing remote op leaves a later op\'s loader in place', async () => {
    // A = pull (starts first, finishes first), B = push (starts while A
    // is in flight, finishes last). Before the ownership guard, A's
    // finally unconditionally dispatched `setRemoteOp undefined` and
    // killed B's loader while B's git call was still running.
    let resolvePull: (value: { ok: boolean; message: string }) => void = () => undefined
    pullCurrentBranchMock.mockReset()
    pullCurrentBranchMock.mockImplementation(
      () => new Promise((resolve) => { resolvePull = resolve })
    )
    let resolvePush: (value: { ok: boolean; message: string }) => void = () => undefined
    pushBranchMock.mockReset()
    pushBranchMock.mockImplementation(
      () => new Promise((resolve) => { resolvePush = resolve })
    )

    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      context: { branches: { localBranches: [localBranch], currentBranch: 'main' } } as never,
    }))

    const remoteOpClears = () =>
      dispatch.mock.calls.filter(
        ([action]) => action.type === 'setRemoteOp' && action.value === undefined
      )

    // A starts: pull loader installed, handler pending.
    const pullRun = runWorkflowAction('pull-current-branch')
    // B starts mid-A: push loader replaces the pull loader.
    const pushRun = runWorkflowAction('push-selected-branch')
    expect(dispatch).toHaveBeenCalledWith({
      type: 'setRemoteOp',
      value: expect.objectContaining({ kind: 'push' }),
    })

    // A finishes while B is still in flight — its finally must NOT
    // clear the loader B installed.
    resolvePull({ ok: true, message: 'Pulled main from origin' })
    await pullRun
    expect(remoteOpClears()).toHaveLength(0)

    // B finishes — as the latest claim it clears the loader exactly once.
    resolvePush({ ok: true, message: 'Pushed main to origin' })
    await pushRun
    expect(remoteOpClears()).toHaveLength(1)
  })

  it('a solo invocation still clears its own loader (no overlap)', async () => {
    pullCurrentBranchMock.mockReset()
    pullCurrentBranchMock.mockResolvedValue({ ok: true, message: 'Pulled main from origin' })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({ dispatch }))

    await runWorkflowAction('pull-current-branch')
    expect(dispatch).toHaveBeenCalledWith({ type: 'setRemoteOp', value: undefined })
  })
})

describe('result status carries the outcome kind (#1349)', () => {
  it('a failing handler dispatches statusKind error', async () => {
    pullCurrentBranchMock.mockResolvedValue({
      ok: false,
      message: 'fatal: could not read from remote repository',
    })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({ dispatch }))

    await runWorkflowAction('pull-current-branch')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setStatus',
      value: 'fatal: could not read from remote repository',
      kind: 'error',
    }))
  })

  it('a succeeding handler dispatches statusKind success', async () => {
    pullCurrentBranchMock.mockResolvedValue({ ok: true, message: 'Pulled main from origin' })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({ dispatch }))

    await runWorkflowAction('pull-current-branch')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setStatus',
      value: 'Pulled main from origin',
      kind: 'success',
    }))
  })
})

const checkoutBranchMock = checkoutBranch as jest.MockedFunction<typeof checkoutBranch>
const checkoutBranchByNameMock = checkoutBranchByName as jest.MockedFunction<typeof checkoutBranchByName>
const cherryPickCommitMock = cherryPickCommit as jest.MockedFunction<typeof cherryPickCommit>
const createStashMock = createStash as jest.MockedFunction<typeof createStash>
const pullCurrentBranchRebaseMock = pullCurrentBranchRebase as jest.MockedFunction<typeof pullCurrentBranchRebase>
const autosquashRebaseMock = autosquashRebase as jest.MockedFunction<typeof autosquashRebase>
const continueOperationMock = continueOperation as jest.MockedFunction<typeof continueOperation>

// A NON-current local branch so the checkout-branch handler actually
// calls git instead of short-circuiting on "Already on <branch>".
const otherBranch = {
  type: 'local',
  name: 'refs/heads/feature/other',
  shortName: 'feature/other',
  hash: 'def',
  current: false,
  upstream: undefined,
  remote: undefined,
  date: '2026-05-01',
  subject: 'feat',
  ahead: 0,
  behind: 0,
} as never

describe('dirty-checkout recovery (#1360)', () => {
  beforeEach(() => {
    checkoutBranchMock.mockReset()
    checkoutBranchByNameMock.mockReset()
    createStashMock.mockReset()
  })

  it('offers stash & switch when the checkout is refused for uncommitted changes', async () => {
    checkoutBranchMock.mockResolvedValue({
      ok: false,
      message: 'error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/app.ts\nPlease commit your changes or stash them before you switch branches.\nAborting',
    })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      context: { branches: { localBranches: [otherBranch], currentBranch: 'main' } } as never,
    }))

    await runWorkflowAction('checkout-branch')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setPendingChoice',
      value: expect.objectContaining({
        id: 'dirty-checkout-recovery',
        options: [
          expect.objectContaining({
            key: 's',
            workflowId: 'stash-and-checkout-branch',
            payload: 'feature/other',
          }),
        ],
      }),
    }))
  })

  it('does NOT offer it for unrelated checkout failures', async () => {
    checkoutBranchMock.mockResolvedValue({
      ok: false,
      message: "error: pathspec 'feature/other' did not match any file(s) known to git",
    })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      context: { branches: { localBranches: [otherBranch], currentBranch: 'main' } } as never,
    }))

    await runWorkflowAction('checkout-branch')
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setPendingChoice' }))
  })

  it('stash-and-checkout-branch stashes first, then switches, and hints at gz', async () => {
    createStashMock.mockResolvedValue({ ok: true, message: 'Created stash: WIP before switching to feature/other' })
    checkoutBranchByNameMock.mockResolvedValue({ ok: true, message: 'Checked out feature/other' })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({ dispatch }))

    await runWorkflowAction('stash-and-checkout-branch', 'feature/other')
    expect(createStashMock).toHaveBeenCalledWith(expect.anything(), 'WIP before switching to feature/other')
    expect(checkoutBranchByNameMock).toHaveBeenCalledWith(expect.anything(), 'feature/other')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setStatus',
      value: expect.stringContaining('(gz)'),
      kind: 'success',
    }))
    // HEAD moved — the branch cursor snaps home like every checkout path.
    expect(dispatch).toHaveBeenCalledWith({ type: 'resetBranchSelection' })
  })

  it('a failed stash aborts before the switch is attempted', async () => {
    createStashMock.mockResolvedValue({ ok: false, message: 'fatal: unable to write new index file' })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({ dispatch }))

    await runWorkflowAction('stash-and-checkout-branch', 'feature/other')
    expect(checkoutBranchByNameMock).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setStatus',
      kind: 'error',
    }))
  })
})

const commitRow: GitLogRow = {
  type: 'commit',
  graph: '*',
  shortHash: 'abc1234',
  hash: 'abc123456789',
  parents: ['def567890123'],
  date: '2026-04-29',
  author: 'Coco Test',
  refs: [],
  message: 'feat: add thing',
}

describe('operation conflict recovery (#1360)', () => {
  beforeEach(() => {
    cherryPickCommitMock.mockReset()
    pullCurrentBranchMock.mockReset()
  })

  it('a conflicted cherry-pick raises the conflicts/abort choice and keeps the error on dismissal', async () => {
    cherryPickCommitMock.mockResolvedValue({
      ok: false,
      message: 'error: could not apply abc1234... feat: add thing',
      details: ['CONFLICT (content): Merge conflict in src/app.ts'],
    })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      state: createLogInkState([commitRow]),
    }))

    await runWorkflowAction('cherry-pick-commit')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setPendingChoice',
      value: expect.objectContaining({
        id: 'operation-conflict-recovery',
        title: 'Cherry-pick stopped on conflicts',
        // Declining the recovery must leave git's raw error visible.
        keepStatusOnDismiss: true,
        options: [
          expect.objectContaining({ key: 'x', intent: 'open-conflicts' }),
          expect.objectContaining({ key: 'a', workflowId: 'abort-operation', destructive: true }),
        ],
      }),
    }))
    // The raw error still landed on the status line first.
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setStatus',
      value: 'error: could not apply abc1234... feat: add thing',
      kind: 'error',
    }))
  })

  it('detects conflicts when only the details lines carry the CONFLICT marker', async () => {
    cherryPickCommitMock.mockResolvedValue({
      ok: false,
      message: 'Auto-merging src/app.ts',
      details: ['CONFLICT (content): Merge conflict in src/app.ts'],
    })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      state: createLogInkState([commitRow]),
    }))

    await runWorkflowAction('cherry-pick-commit')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setPendingChoice',
      value: expect.objectContaining({ id: 'operation-conflict-recovery' }),
    }))
  })

  it('does NOT raise the choice for non-conflict cherry-pick failures', async () => {
    cherryPickCommitMock.mockResolvedValue({
      ok: false,
      message: "fatal: bad revision 'abc123456789'",
    })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      state: createLogInkState([commitRow]),
    }))

    await runWorkflowAction('cherry-pick-commit')
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setPendingChoice' }))
  })

  it('a conflicted pull --rebase raises the same recovery choice', async () => {
    pullCurrentBranchRebaseMock.mockResolvedValue({
      ok: false,
      message: 'CONFLICT (content): Merge conflict in src/app.ts\nerror: could not apply abc1234... feat',
    })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({ dispatch }))

    await runWorkflowAction('pull-rebase-current')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setPendingChoice',
      value: expect.objectContaining({
        id: 'operation-conflict-recovery',
        title: 'Pull stopped on conflicts',
      }),
    }))
  })
})

const pullRequestItem = (number: number) =>
  ({
    number,
    title: `PR #${number}`,
    author: 'octocat',
    headRefName: `feature/pr-${number}`,
    baseRefName: 'main',
    labels: [],
    assignees: [],
  }) as never

describe('dirty-checkout recovery — sibling paths (#1430)', () => {
  beforeEach(() => {
    checkoutBranchByNameMock.mockReset()
    createStashMock.mockReset()
  })

  it('checkout-created-branch on a dirty tree offers stash & switch keyed to the payload branch name', async () => {
    checkoutBranchByNameMock.mockResolvedValue({
      ok: false,
      message: 'error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/app.ts\nPlease commit your changes or stash them before you switch branches.\nAborting',
    })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    // No branch/PR context at all — `resolvePendingItemAction` has no case
    // for `checkout-created-branch`, so `pendingItemAction` is `undefined`
    // here. The branch name must come from `payload`, not that lookup.
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({ dispatch }))

    await runWorkflowAction('checkout-created-branch', 'feature/new-thing')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setPendingChoice',
      value: expect.objectContaining({
        id: 'dirty-checkout-recovery',
        title: "Uncommitted changes block switching to 'feature/new-thing'",
        options: [
          expect.objectContaining({
            key: 's',
            workflowId: 'stash-and-checkout-branch',
            payload: 'feature/new-thing',
          }),
        ],
      }),
    }))
  })

  it('triage-pr-checkout on a dirty tree offers stash & switch keyed to the PR number from payload', async () => {
    const forge = { checkoutPullRequestByNumber: jest.fn().mockResolvedValue({
      ok: false,
      message: 'error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/app.ts\nPlease commit your changes or stash them before you switch branches.\nAborting',
    }) } as never
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({ dispatch, forge }))

    // The PR-diff `C` path carries the viewed PR's number as payload.
    await runWorkflowAction('triage-pr-checkout', '962')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setPendingChoice',
      value: expect.objectContaining({
        id: 'dirty-checkout-recovery',
        title: 'Uncommitted changes block checking out PR #962',
        options: [
          expect.objectContaining({
            key: 's',
            workflowId: 'stash-and-checkout-pr',
            payload: '962',
          }),
        ],
      }),
    }))
  })

  it('triage-pr-checkout on a dirty tree keys off the cursored row when no payload is given', async () => {
    const forge = { checkoutPullRequestByNumber: jest.fn().mockResolvedValue({
      ok: false,
      message: 'error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/app.ts\nPlease commit your changes or stash them before you switch branches.\nAborting',
    }) } as never
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      forge,
      context: { pullRequestList: { pullRequests: [pullRequestItem(7)] } } as never,
      filteredPullRequestTriageList: [pullRequestItem(7)],
    }))

    await runWorkflowAction('triage-pr-checkout')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setPendingChoice',
      value: expect.objectContaining({
        id: 'dirty-checkout-recovery',
        title: 'Uncommitted changes block checking out PR #7',
        options: [
          expect.objectContaining({
            key: 's',
            workflowId: 'stash-and-checkout-pr',
            payload: '7',
          }),
        ],
      }),
    }))
  })

  it('stash-and-checkout-pr stashes first, then checks out the PR, and hints at gz', async () => {
    createStashMock.mockResolvedValue({ ok: true, message: 'Created stash: WIP before checking out PR #962' })
    const checkoutPullRequestByNumber = jest.fn().mockResolvedValue({ ok: true, message: 'Checked out PR #962' })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      forge: { checkoutPullRequestByNumber } as never,
    }))

    await runWorkflowAction('stash-and-checkout-pr', '962')
    expect(createStashMock).toHaveBeenCalledWith(expect.anything(), 'WIP before checking out PR #962')
    expect(checkoutPullRequestByNumber).toHaveBeenCalledWith(962)
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setStatus',
      value: expect.stringContaining('(gz)'),
      kind: 'success',
    }))
    // HEAD moved — the branch cursor snaps home like every checkout path.
    expect(dispatch).toHaveBeenCalledWith({ type: 'resetBranchSelection' })
  })

  it('stash-and-checkout-pr aborts before checking out if the stash fails', async () => {
    createStashMock.mockResolvedValue({ ok: false, message: 'fatal: unable to write new index file' })
    const checkoutPullRequestByNumber = jest.fn()
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      forge: { checkoutPullRequestByNumber } as never,
    }))

    await runWorkflowAction('stash-and-checkout-pr', '962')
    expect(checkoutPullRequestByNumber).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setStatus',
      kind: 'error',
    }))
  })
})

describe('operation conflict recovery — sibling paths (#1430)', () => {
  beforeEach(() => {
    autosquashRebaseMock.mockReset()
    continueOperationMock.mockReset()
  })

  it('autosquash-rebase stopping on conflicts raises the conflicts/abort choice', async () => {
    autosquashRebaseMock.mockResolvedValue({
      ok: false,
      message: 'error: could not apply abc1234... fixup! feat: add thing',
      details: ['CONFLICT (content): Merge conflict in src/app.ts'],
    })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      state: createLogInkState([commitRow]),
    }))

    await runWorkflowAction('autosquash-rebase')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setPendingChoice',
      value: expect.objectContaining({
        id: 'operation-conflict-recovery',
        title: 'Rebase stopped on conflicts',
        keepStatusOnDismiss: true,
      }),
    }))
  })

  it.each([
    ['rebase', 'Rebase stopped on conflicts'],
    ['cherry-pick', 'Cherry-pick stopped on conflicts'],
    ['revert', 'Revert stopped on conflicts'],
    ['merge', 'Merge stopped on conflicts'],
  ] as const)('continue-operation stopping on a further %s conflict titles it "%s"', async (operation, title) => {
    continueOperationMock.mockResolvedValue({
      ok: false,
      message: 'CONFLICT (content): Merge conflict in src/app.ts\nerror: could not apply abc1234... feat',
    })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      context: { operation: { operation, conflictedFiles: [] } } as never,
    }))

    await runWorkflowAction('continue-operation')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setPendingChoice',
      value: expect.objectContaining({
        id: 'operation-conflict-recovery',
        title,
        keepStatusOnDismiss: true,
      }),
    }))
  })
})

describe('frame-scoped recovery prompts (#1429)', () => {
  beforeEach(() => {
    pullCurrentBranchMock.mockReset()
    cherryPickCommitMock.mockReset()
  })

  it('drops the diverged-pull recovery choice if the repo frame changed while the pull was in flight', async () => {
    let resolvePull: (value: { ok: boolean; message: string }) => void = () => undefined
    pullCurrentBranchMock.mockImplementation(
      () => new Promise((resolve) => { resolvePull = resolve })
    )
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      runtimes: [{}] as unknown as UseWorkflowActionDeps['runtimes'],
    }))

    // Issue the pull at depth 0, then — before it resolves — simulate a
    // drill-in (pushRepoFrame) by re-rendering with a deeper runtime
    // stack. `runWorkflowAction`'s memoized identity is unaffected; only
    // `depsRef.current` (read fresh post-await) changes.
    const run = runWorkflowAction('pull-current-branch')
    harness.beginRender()
    useWorkflowAction(harness.React, createDeps({
      dispatch,
      runtimes: [{}, {}] as unknown as UseWorkflowActionDeps['runtimes'],
    }))

    resolvePull({ ok: false, message: 'fatal: Not possible to fast-forward, aborting.' })
    await run

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setPendingChoice' }))
    // The underlying error still reaches the status line — only the
    // choice prompt (which would act on the now-wrong frame) is dropped.
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setStatus',
      kind: 'error',
    }))
  })

  it('raises the diverged-pull recovery choice normally when the frame is unchanged', async () => {
    pullCurrentBranchMock.mockResolvedValue({
      ok: false,
      message: 'fatal: Not possible to fast-forward, aborting.',
    })
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({ dispatch }))

    await runWorkflowAction('pull-current-branch')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setPendingChoice',
      value: expect.objectContaining({ id: 'diverged-pull-recovery' }),
    }))
  })

  it('drops the operation-conflict recovery choice if the repo frame changed while the cherry-pick was in flight', async () => {
    let resolveCherryPick: (value: { ok: boolean; message: string; details?: string[] }) => void = () => undefined
    cherryPickCommitMock.mockImplementation(
      () => new Promise((resolve) => { resolveCherryPick = resolve })
    )
    const harness = createHookHarness()
    const dispatch = jest.fn()
    harness.beginRender()
    const { runWorkflowAction } = useWorkflowAction(harness.React, createDeps({
      dispatch,
      state: createLogInkState([commitRow]),
      runtimes: [{}] as unknown as UseWorkflowActionDeps['runtimes'],
    }))

    const run = runWorkflowAction('cherry-pick-commit')
    harness.beginRender()
    useWorkflowAction(harness.React, createDeps({
      dispatch,
      state: createLogInkState([commitRow]),
      runtimes: [{}, {}] as unknown as UseWorkflowActionDeps['runtimes'],
    }))

    resolveCherryPick({
      ok: false,
      message: 'error: could not apply abc1234... feat: add thing',
      details: ['CONFLICT (content): Merge conflict in src/app.ts'],
    })
    await run

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setPendingChoice' }))
    // #1429's headline destructive case: with the prompt dropped, `a`
    // can no longer reach `abort-operation` against the wrong frame —
    // but the raw conflict error (with keepStatusOnDismiss's underlying
    // status) is still visible so the user isn't left with silence.
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'setStatus',
      value: 'error: could not apply abc1234... feat: add thing',
      kind: 'error',
    }))
  })
})
