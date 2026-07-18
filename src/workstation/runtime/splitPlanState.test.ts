import { applySplitPlanAction } from './splitPlanState'

/**
 * Coverage for the split-plan slice extracted out of `inkViewModel.ts`
 * (#1723 / originally #907). Pure to the `splitPlan` field; the
 * composition root only wires `pendingKey` clearing.
 */
describe('split-plan slice', () => {
  const empty = { splitPlan: undefined }
  const mockPlan = {
    groups: [
      { title: 'feat: foo', files: ['src/foo.ts'], hunks: [] },
      { title: 'feat: bar', files: ['src/bar.ts'], hunks: [] },
    ],
  }
  const mockPlanContext = {
    changes: { staged: [], unstaged: [], untracked: [] },
    hunkInventory: { hunks: [], byId: new Map(), byFile: new Map() },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  it('startSplitPlanLoad opens the overlay in loading state', () => {
    expect(empty.splitPlan).toBeUndefined()

    const state = applySplitPlanAction(empty, { type: 'startSplitPlanLoad' })
    expect(state.splitPlan).toEqual({ status: 'loading', scrollOffset: 0 })
  })

  it('setSplitPlanReady populates the plan and resets scroll', () => {
    let state = applySplitPlanAction(empty, { type: 'startSplitPlanLoad' })
    state = applySplitPlanAction(state, {
      type: 'setSplitPlanReady',
      plan: mockPlan,
      planContext: mockPlanContext,
    })

    expect(state.splitPlan).toEqual({
      status: 'ready',
      plan: mockPlan,
      planContext: mockPlanContext,
      scrollOffset: 0,
    })
  })

  it('setSplitPlanReady carries dedupeWarnings onto splitPlan state (#1462)', () => {
    const dedupeWarnings = [
      {
        kind: 'file' as const,
        id: 'docs/page.tsx',
        keptGroupIndex: 0,
        keptGroupTitle: 'feat: docs',
        droppedGroupIndices: [1],
        droppedGroupTitles: ['chore: misc'],
      },
    ]
    const state = applySplitPlanAction(empty, {
      type: 'setSplitPlanReady',
      plan: mockPlan,
      planContext: mockPlanContext,
      dedupeWarnings,
    })

    expect(state.splitPlan?.dedupeWarnings).toEqual(dedupeWarnings)
  })

  it('setSplitPlanApplying preserves plan + context, transitions status', () => {
    let state = applySplitPlanAction(empty, {
      type: 'setSplitPlanReady',
      plan: mockPlan,
      planContext: mockPlanContext,
    })
    state = applySplitPlanAction(state, { type: 'setSplitPlanApplying' })

    expect(state.splitPlan?.status).toBe('applying')
    // Plan + context preserved so the overlay can keep rendering
    // the same content during the apply phase.
    expect(state.splitPlan?.plan).toEqual(mockPlan)
    expect(state.splitPlan?.planContext).toEqual(mockPlanContext)
  })

  it('setSplitPlanError keeps the overlay open when a plan exists', () => {
    // Apply failed mid-flight — we keep the overlay open so the user
    // can retry or back out. Status flips back to 'ready' (no longer
    // applying), with the error annotated for the renderer.
    let state = applySplitPlanAction(empty, {
      type: 'setSplitPlanReady',
      plan: mockPlan,
      planContext: mockPlanContext,
    })
    state = applySplitPlanAction(state, { type: 'setSplitPlanApplying' })
    state = applySplitPlanAction(state, { type: 'setSplitPlanError', error: 'patch conflict' })

    expect(state.splitPlan?.status).toBe('ready')
    expect(state.splitPlan?.error).toBe('patch conflict')
    expect(state.splitPlan?.plan).toEqual(mockPlan)
  })

  it('setSplitPlanError closes the overlay when no plan exists', () => {
    // Initial generation failed — nothing to retry from, close out.
    let state = applySplitPlanAction(empty, { type: 'startSplitPlanLoad' })
    state = applySplitPlanAction(state, { type: 'setSplitPlanError', error: 'LLM unreachable' })

    expect(state.splitPlan).toBeUndefined()
  })

  it('pageSplitPlan scrolls within the line-count bounds', () => {
    let state = applySplitPlanAction(empty, {
      type: 'setSplitPlanReady',
      plan: mockPlan,
      planContext: mockPlanContext,
    })

    state = applySplitPlanAction(state, { type: 'pageSplitPlan', delta: 5, lineCount: 20 })
    expect(state.splitPlan?.scrollOffset).toBe(5)

    // Clamps to 0 on overshoot the other way.
    state = applySplitPlanAction(state, { type: 'pageSplitPlan', delta: -100, lineCount: 20 })
    expect(state.splitPlan?.scrollOffset).toBe(0)

    // Clamps to lineCount-1 on overshoot upward.
    state = applySplitPlanAction(state, { type: 'pageSplitPlan', delta: 999, lineCount: 20 })
    expect(state.splitPlan?.scrollOffset).toBe(19)
  })

  it('pageSplitPlan is a no-op when no plan is loaded', () => {
    const state = applySplitPlanAction(empty, { type: 'pageSplitPlan', delta: 5, lineCount: 20 })
    expect(state).toBe(empty)
  })

  it('clearSplitPlan closes the overlay regardless of phase', () => {
    let state = applySplitPlanAction(empty, { type: 'startSplitPlanLoad' })
    state = applySplitPlanAction(state, { type: 'clearSplitPlan' })
    expect(state.splitPlan).toBeUndefined()

    state = applySplitPlanAction(state, {
      type: 'setSplitPlanReady',
      plan: mockPlan,
      planContext: mockPlanContext,
    })
    state = applySplitPlanAction(state, { type: 'clearSplitPlan' })
    expect(state.splitPlan).toBeUndefined()
  })
})
