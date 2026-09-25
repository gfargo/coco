import { GitLogRow } from '../../git/logData'
import { resolveForcedPane } from './forcedPane'
import { applyLogInkAction, createLogInkState } from './inkViewModel'

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*',
    shortHash: 'abc1234',
    hash: 'abc123456789',
    parents: [],
    date: '2026-04-29',
    author: 'Coco Test',
    refs: ['HEAD -> main'],
    message: 'feat: add forced-pane guard',
  },
]

function withApplyingSplitPlan() {
  let state = applyLogInkAction(createLogInkState(rows), {
    type: 'setSplitPlanReady',
    plan: { groups: [{ title: 'feat: foo', files: ['src/foo.ts'], hunks: [] }] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    planContext: { changes: { staged: [], unstaged: [], untracked: [] }, hunkInventory: { hunks: [], byId: new Map(), byFile: new Map() } } as any,
  })
  state = applyLogInkAction(state, { type: 'setSplitPlanApplying' })
  return state
}

describe('resolveForcedPane (OSS-2795)', () => {
  it('is undefined on a clean state', () => {
    expect(resolveForcedPane(createLogInkState(rows))).toBeUndefined()
  })

  it('forces the main pane while a split plan is active', () => {
    const state = applyLogInkAction(createLogInkState(rows), {
      type: 'setSplitPlanReady',
      plan: { groups: [{ title: 'feat: foo', files: ['src/foo.ts'], hunks: [] }] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      planContext: { changes: { staged: [], unstaged: [], untracked: [] }, hunkInventory: { hunks: [], byId: new Map(), byFile: new Map() } } as any,
    })
    expect(resolveForcedPane(state)).toBe('main')
  })

  it('forces the inspector pane for a pending confirmation', () => {
    const state = { ...createLogInkState(rows), pendingConfirmationId: 'discard-draft' }
    expect(resolveForcedPane(state)).toBe('inspector')
  })

  it('a pending confirmation during a split apply still forces the inspector, not main', () => {
    const state = { ...withApplyingSplitPlan(), pendingConfirmationId: 'quit-during-split-apply' }
    expect(resolveForcedPane(state)).toBe('inspector')
  })
})
