import { applyRebasePlanAction } from './rebasePlanState'

/**
 * Coverage for the rebase-plan slice extracted out of `inkViewModel.ts`
 * (#1723). Pure to `rebasePlan`'s rows/cursor; the composition root
 * only wires `pendingKey` clearing, pushing the `rebase` view on open
 * (`openRebasePlan` couples to the view stack and stays a root case),
 * and dropping a stale plan on navigation away — all covered in
 * `inkViewModel.test.ts`.
 */
describe('rebase plan slice', () => {
  const planRows = [
    { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'feat: one', author: 'Coco', date: '2026-05-01', action: 'pick' as const },
    { sha: 'b'.repeat(40), shortSha: 'bbbbbbb', subject: 'fix: two', author: 'Coco', date: '2026-05-02', action: 'pick' as const },
    { sha: 'c'.repeat(40), shortSha: 'ccccccc', subject: 'wip', author: 'Coco', date: '2026-05-03', action: 'pick' as const },
  ]
  const withPlan = () => ({ rebasePlan: { rows: planRows, selectedIndex: 0 } })

  it('moveRebaseCursor clamps to the row bounds', () => {
    let state = applyRebasePlanAction(withPlan(), { type: 'moveRebaseCursor', delta: 5 })
    expect(state.rebasePlan?.selectedIndex).toBe(2)

    state = applyRebasePlanAction(state, { type: 'moveRebaseCursor', delta: -5 })
    expect(state.rebasePlan?.selectedIndex).toBe(0)
  })

  it('moveRebaseCursor is a no-op with no plan or an empty plan', () => {
    const noPlan = {}
    expect(applyRebasePlanAction(noPlan, { type: 'moveRebaseCursor', delta: 1 })).toBe(noPlan)

    const emptyPlan = { rebasePlan: { rows: [], selectedIndex: 0 } }
    expect(applyRebasePlanAction(emptyPlan, { type: 'moveRebaseCursor', delta: 1 })).toBe(emptyPlan)
  })

  it('setRebaseAction retags the cursored row and drops a stale reword message', () => {
    let state = applyRebasePlanAction(withPlan(), { type: 'moveRebaseCursor', delta: 2 })
    state = applyRebasePlanAction(state, { type: 'setRebaseAction', action: 'fixup' })
    expect(state.rebasePlan?.rows[2].action).toBe('fixup')

    state = applyRebasePlanAction(state, { type: 'setRebaseRewordMessage', message: 'chore: reworded' })
    expect(state.rebasePlan?.rows[2]).toMatchObject({ action: 'reword', newMessage: 'chore: reworded' })

    // Retagging away from reword drops the stale message.
    state = applyRebasePlanAction(state, { type: 'setRebaseAction', action: 'pick' })
    expect(state.rebasePlan?.rows[2].newMessage).toBeUndefined()
  })

  it('setRebaseAction is a no-op with no plan', () => {
    const noPlan = {}
    expect(applyRebasePlanAction(noPlan, { type: 'setRebaseAction', action: 'drop' })).toBe(noPlan)
  })

  it('setRebaseRewordMessage trims and is a no-op (state unchanged) for a blank message', () => {
    const state = withPlan()
    const after = applyRebasePlanAction(state, { type: 'setRebaseRewordMessage', message: '   ' })
    expect(after).toBe(state)
  })

  it('moveRebaseRow reorders and moves the cursor with the row', () => {
    let state = applyRebasePlanAction(withPlan(), { type: 'moveRebaseCursor', delta: 2 })
    state = applyRebasePlanAction(state, { type: 'moveRebaseRow', delta: -1 })
    expect(state.rebasePlan?.rows.map((r) => r.shortSha)).toEqual(['aaaaaaa', 'ccccccc', 'bbbbbbb'])
    expect(state.rebasePlan?.selectedIndex).toBe(1)
  })

  it('moveRebaseRow off either edge is a no-op', () => {
    const state = withPlan()
    const after = applyRebasePlanAction(state, { type: 'moveRebaseRow', delta: -1 })
    expect(after).toBe(state)

    const atEnd = applyRebasePlanAction(state, { type: 'moveRebaseCursor', delta: 5 })
    const afterEnd = applyRebasePlanAction(atEnd, { type: 'moveRebaseRow', delta: 1 })
    expect(afterEnd).toBe(atEnd)
  })

  it('clearRebasePlan drops the plan unconditionally', () => {
    const state = applyRebasePlanAction(withPlan(), { type: 'clearRebasePlan' })
    expect(state.rebasePlan).toBeUndefined()
  })
})
