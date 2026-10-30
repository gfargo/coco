import { needsConfirmation } from './confirmationGate'
import { createLogInkState, type LogInkState } from './inkViewModel'
import { getLogInkWorkflowActionById } from './inkWorkflows'

const destructive = { requiresConfirmation: true }

function withChoice(workflowIds: Array<string | undefined>): LogInkState {
  return {
    ...createLogInkState([]),
    pendingChoice: {
      id: 'recovery',
      title: 'Recovery',
      options: workflowIds.map((workflowId, i) => ({ key: String(i), label: `opt ${i}`, workflowId })),
    },
  }
}

describe('needsConfirmation (#1867)', () => {
  it('lets a workflow that needs no confirmation through', () => {
    expect(needsConfirmation({ requiresConfirmation: false }, { id: 'stage-all' }, createLogInkState([]))).toBe(false)
    expect(needsConfirmation(undefined, { id: 'unknown' }, createLogInkState([]))).toBe(false)
  })

  it('holds an unconfirmed destructive workflow behind the overlay', () => {
    expect(needsConfirmation(destructive, { id: 'delete-branch' }, createLogInkState([]))).toBe(true)
  })

  it('accepts an explicit confirmed flag and the overlay for the same id', () => {
    expect(needsConfirmation(destructive, { id: 'delete-branch', confirmed: true }, createLogInkState([]))).toBe(false)
    const open = { ...createLogInkState([]), pendingConfirmationId: 'delete-branch' }
    expect(needsConfirmation(destructive, { id: 'delete-branch' }, open)).toBe(false)
  })

  it('does not let the overlay for a DIFFERENT workflow confirm this one', () => {
    const open = { ...createLogInkState([]), pendingConfirmationId: 'drop-stash' }
    expect(needsConfirmation(destructive, { id: 'delete-branch' }, open)).toBe(true)
  })

  it('treats picking an option of the open choice as that workflow\'s consent', () => {
    const state = withChoice(['force-push-current-branch', undefined])
    expect(needsConfirmation(destructive, { id: 'force-push-current-branch' }, state)).toBe(false)
  })

  it('does NOT treat an open choice as consent for an unrelated destructive workflow', () => {
    // Before #1867 the bare presence of a pending choice was enough.
    const state = withChoice(['force-push-current-branch'])
    expect(needsConfirmation(destructive, { id: 'reset-to-commit' }, state)).toBe(true)
    expect(needsConfirmation(destructive, { id: 'drop-stash' }, state)).toBe(true)
  })

  it('still gates a real destructive registry entry while a recovery prompt is open', () => {
    const state = withChoice(['stash-and-checkout-branch'])
    const workflow = getLogInkWorkflowActionById('drop-stash')
    expect(workflow?.requiresConfirmation).toBe(true)
    expect(needsConfirmation(workflow, { id: 'drop-stash' }, state)).toBe(true)
  })
})
