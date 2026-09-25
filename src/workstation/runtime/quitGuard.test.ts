import { GitLogRow } from '../../git/logData'
import { hasUnsavedComposeDraft, resolveQuitEvents } from './quitGuard'
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
    message: 'feat: add quit guard',
  },
]

function withComposeDraft() {
  return applyLogInkAction(createLogInkState(rows), {
    type: 'commitCompose',
    action: { type: 'append', value: 'feat: in-flight summary' },
  })
}

describe('hasUnsavedComposeDraft', () => {
  it('is false on a clean compose surface', () => {
    expect(hasUnsavedComposeDraft(createLogInkState(rows))).toBe(false)
  })

  it('is true once the summary or body holds text', () => {
    expect(hasUnsavedComposeDraft(withComposeDraft())).toBe(true)
  })

  it('is false while an AI draft is loading, even with prior text', () => {
    let state = withComposeDraft()
    state = applyLogInkAction(state, {
      type: 'commitCompose',
      action: { type: 'setLoading', value: true },
    })
    expect(hasUnsavedComposeDraft(state)).toBe(false)
  })
})

describe('resolveQuitEvents (OSS-2795)', () => {
  it('exits immediately on a clean state', () => {
    expect(resolveQuitEvents(createLogInkState(rows))).toEqual([{ type: 'exit' }])
  })

  it('raises the discard-draft confirm when the compose draft is dirty', () => {
    expect(resolveQuitEvents(withComposeDraft())).toEqual([
      {
        type: 'action',
        action: { type: 'setPendingConfirmation', value: 'discard-draft' },
      },
    ])
  })

  it('raises the discard-rebase-plan confirm (payload quit) when a rebase plan is active', () => {
    const state = {
      ...createLogInkState(rows),
      rebasePlan: {
        rows: [
          {
            sha: 'abc123456789',
            shortSha: 'abc1234',
            subject: 'feat: add quit guard',
            author: 'Coco Test',
            date: '2026-04-29',
            action: 'pick' as const,
          },
        ],
        selectedIndex: 0,
      },
    }
    expect(resolveQuitEvents(state)).toEqual([
      {
        type: 'action',
        action: { type: 'setPendingConfirmation', value: 'discard-rebase-plan', payload: 'quit' },
      },
    ])
  })

  it('raises the quit-during-split-apply confirm while a split is applying', () => {
    let state = applyLogInkAction(createLogInkState(rows), {
      type: 'setSplitPlanReady',
      plan: { groups: [{ title: 'feat: foo', files: ['src/foo.ts'], hunks: [] }] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      planContext: { changes: { staged: [], unstaged: [], untracked: [] }, hunkInventory: { hunks: [], byId: new Map(), byFile: new Map() } } as any,
    })
    state = applyLogInkAction(state, { type: 'setSplitPlanApplying' })

    expect(resolveQuitEvents(state)).toEqual([
      {
        type: 'action',
        action: { type: 'setPendingConfirmation', value: 'quit-during-split-apply' },
      },
    ])
  })

  it('exits unconditionally when a confirmation is already pending — the hard escape hatch', () => {
    const state = {
      ...withComposeDraft(),
      pendingConfirmationId: 'discard-draft',
    }
    expect(resolveQuitEvents(state)).toEqual([{ type: 'exit' }])
  })

  it('precedence: an in-flight split apply outranks a dirty compose draft', () => {
    let state = applyLogInkAction(createLogInkState(rows), {
      type: 'commitCompose',
      action: { type: 'append', value: 'feat: in-flight summary' },
    })
    state = applyLogInkAction(state, {
      type: 'setSplitPlanReady',
      plan: { groups: [{ title: 'feat: foo', files: ['src/foo.ts'], hunks: [] }] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      planContext: { changes: { staged: [], unstaged: [], untracked: [] }, hunkInventory: { hunks: [], byId: new Map(), byFile: new Map() } } as any,
    })
    state = applyLogInkAction(state, { type: 'setSplitPlanApplying' })

    expect(resolveQuitEvents(state)).toEqual([
      {
        type: 'action',
        action: { type: 'setPendingConfirmation', value: 'quit-during-split-apply' },
      },
    ])
  })
})
