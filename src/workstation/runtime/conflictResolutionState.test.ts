import { applyConflictResolutionAction } from './conflictResolutionState'

/**
 * Coverage for the conflict-resolution slice extracted out of
 * `inkViewModel.ts` (#1723 / originally #1369). Pure to the
 * `conflictResolution` field; `inkViewModel.test.ts` keeps the one
 * composition-root case (dropping the session on navigation away from
 * the conflicts view), which this module doesn't own.
 */
describe('conflict-resolution slice', () => {
  const empty = { conflictResolution: undefined }
  const region = (index: number) => ({
    index,
    startLine: index * 10 + 1,
    endLine: index * 10 + 5,
    oursLabel: 'HEAD',
    theirsLabel: 'feature/x',
    ours: [`ours ${index}`],
    theirs: [`theirs ${index}`],
  })
  const proposal = (index: number) => ({
    regionIndex: index,
    resolution: `resolved ${index}`,
    rationale: 'combines both',
    region: region(index),
  })

  function readyState() {
    let state = applyConflictResolutionAction(empty, { type: 'setConflictResolutionLoading', path: 'src/app.ts' })
    expect(state.conflictResolution?.status).toBe('loading')
    state = applyConflictResolutionAction(state, {
      type: 'setConflictResolutionReady',
      path: 'src/app.ts',
      proposals: [proposal(0), proposal(1), proposal(2)],
    })
    return state
  }

  it('lands proposals as pending with the cursor on the first', () => {
    const state = readyState()
    expect(state.conflictResolution).toMatchObject({
      path: 'src/app.ts',
      status: 'ready',
      selectedIndex: 0,
    })
    expect(state.conflictResolution?.proposals.map((p) => p.status))
      .toEqual(['pending', 'pending', 'pending'])
  })

  it('marking a proposal advances the cursor to the next pending one', () => {
    let state = readyState()
    state = applyConflictResolutionAction(state, {
      type: 'setConflictProposalStatus',
      regionIndex: 0,
      status: 'accepted',
    })
    expect(state.conflictResolution?.proposals[0].status).toBe('accepted')
    expect(state.conflictResolution?.selectedIndex).toBe(1)

    // Rejecting the middle one skips to the last pending.
    state = applyConflictResolutionAction(state, {
      type: 'setConflictProposalStatus',
      regionIndex: 1,
      status: 'rejected',
    })
    expect(state.conflictResolution?.selectedIndex).toBe(2)
  })

  it('an edit-accept records the replacement resolution text', () => {
    let state = readyState()
    state = applyConflictResolutionAction(state, {
      type: 'setConflictProposalStatus',
      regionIndex: 1,
      status: 'accepted',
      resolution: 'hand-edited text',
    })
    expect(state.conflictResolution?.proposals[1]).toMatchObject({
      status: 'accepted',
      resolution: 'hand-edited text',
    })
  })

  it('clamps proposal cursor movement', () => {
    let state = readyState()
    state = applyConflictResolutionAction(state, { type: 'moveConflictProposal', delta: 5 })
    expect(state.conflictResolution?.selectedIndex).toBe(2)
    state = applyConflictResolutionAction(state, { type: 'moveConflictProposal', delta: -9 })
    expect(state.conflictResolution?.selectedIndex).toBe(0)
  })

  it('moveConflictProposal is a no-op with no session or no proposals', () => {
    const state = applyConflictResolutionAction(empty, { type: 'moveConflictProposal', delta: 1 })
    expect(state).toBe(empty)
  })

  it('records the error state for the surface to render', () => {
    let state = applyConflictResolutionAction(empty, {
      type: 'setConflictResolutionError',
      path: 'src/app.ts',
      error: 'rate limited',
    })
    expect(state.conflictResolution).toMatchObject({ status: 'error', error: 'rate limited' })
    state = applyConflictResolutionAction(state, { type: 'clearConflictResolution' })
    expect(state.conflictResolution).toBeUndefined()
  })
})
