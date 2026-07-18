import { applyInputPromptAction } from './inputPromptState'

/**
 * Coverage for the input-prompt slice extracted out of `inkViewModel.ts`
 * (#1723). Pure to the `inputPrompt` field. `inkViewModel.test.ts` keeps
 * the `pendingKey` clearing behavior — it's asymmetric across these
 * actions (append/backspace/clear deliberately don't clear it, unlike
 * open/close), which is composition-root wiring, not slice logic.
 */
describe('input-prompt slice', () => {
  const empty = { inputPrompt: undefined }

  it('openInputPrompt seeds the fields from the action', () => {
    const state = applyInputPromptAction(empty, {
      type: 'openInputPrompt',
      kind: 'create-branch',
      label: 'New branch name',
      initial: 'feat/',
      multiline: false,
    })
    expect(state.inputPrompt).toEqual({
      kind: 'create-branch',
      label: 'New branch name',
      value: 'feat/',
      multiline: false,
    })
  })

  it('openInputPrompt defaults value to empty when no initial is given', () => {
    const state = applyInputPromptAction(empty, {
      type: 'openInputPrompt',
      kind: 'create-tag',
      label: 'New tag name',
    })
    expect(state.inputPrompt?.value).toBe('')
  })

  it('appendInputPrompt appends to the value when a prompt is open', () => {
    let state = applyInputPromptAction(empty, {
      type: 'openInputPrompt',
      kind: 'create-branch',
      label: 'New branch name',
    })
    state = applyInputPromptAction(state, { type: 'appendInputPrompt', value: 'feat' })
    state = applyInputPromptAction(state, { type: 'appendInputPrompt', value: '/x' })
    expect(state.inputPrompt?.value).toBe('feat/x')
  })

  it('appendInputPrompt is a no-op when no prompt is open', () => {
    const state = applyInputPromptAction(empty, { type: 'appendInputPrompt', value: 'x' })
    expect(state).toBe(empty)
  })

  it('backspaceInputPrompt trims the last character when a prompt is open', () => {
    let state = applyInputPromptAction(empty, {
      type: 'openInputPrompt',
      kind: 'create-branch',
      label: 'New branch name',
      initial: 'feat/x',
    })
    state = applyInputPromptAction(state, { type: 'backspaceInputPrompt' })
    expect(state.inputPrompt?.value).toBe('feat/')
  })

  it('backspaceInputPrompt is a no-op when no prompt is open', () => {
    const state = applyInputPromptAction(empty, { type: 'backspaceInputPrompt' })
    expect(state).toBe(empty)
  })

  it('clearInputPromptText empties the value but keeps the prompt open', () => {
    let state = applyInputPromptAction(empty, {
      type: 'openInputPrompt',
      kind: 'create-branch',
      label: 'New branch name',
      initial: 'feat/x',
    })
    state = applyInputPromptAction(state, { type: 'clearInputPromptText' })
    expect(state.inputPrompt?.value).toBe('')
    expect(state.inputPrompt?.kind).toBe('create-branch')
  })

  it('clearInputPromptText is a no-op when no prompt is open', () => {
    const state = applyInputPromptAction(empty, { type: 'clearInputPromptText' })
    expect(state).toBe(empty)
  })

  it('closeInputPrompt clears the prompt', () => {
    let state = applyInputPromptAction(empty, {
      type: 'openInputPrompt',
      kind: 'create-branch',
      label: 'New branch name',
    })
    state = applyInputPromptAction(state, { type: 'closeInputPrompt' })
    expect(state.inputPrompt).toBeUndefined()
  })
})
