import type ReactTypes from 'react'
import { createLogInkState } from '../inkViewModel'
import { checkoutReflogEntry } from '../../../git/reflogActions'
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
}))

const checkoutReflogEntryMock = checkoutReflogEntry as jest.MockedFunction<
  typeof checkoutReflogEntry
>

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
