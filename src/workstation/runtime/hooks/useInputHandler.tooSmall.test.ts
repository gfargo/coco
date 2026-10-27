import { createLogInkState } from '../inkViewModel'
import { useInputHandler } from './useInputHandler'

// #2204 — while the "Terminal too small" screen hides every prompt, keys
// must not reach the workflow handlers (a `y` could confirm a revert the
// user can't see). Ctrl+C stays live so they can still quit.
function install(tooSmall: boolean, state = createLogInkState([])) {
  let handler: (input: string, key: Record<string, unknown>) => void = () => undefined
  const dispatch = jest.fn()
  const exit = jest.fn()
  const runWorkflowAction = jest.fn()
  const revertSelectedFile = jest.fn()
  const deps = new Proxy(
    { state, dispatch, exit, runWorkflowAction, revertSelectedFile, showOnboarding: false, layout: { tooSmall, columns: 10, rows: 5 } } as Record<string, unknown>,
    { get: (target, prop: string) => (prop in target ? target[prop] : jest.fn()) }
  )
  useInputHandler(((fn: typeof handler) => { handler = fn }) as never, deps as never)
  return { revertSelectedFile, press: (input: string, key: Record<string, unknown> = {}) => handler(input, key), dispatch, exit, runWorkflowAction }
}

describe('useInputHandler while the terminal is too small (#2204)', () => {
  it('drops a y-confirm answer for a prompt the user cannot see', () => {
    const state = { ...createLogInkState([]), pendingConfirmationId: 'revert-file' }
    const { press, dispatch, revertSelectedFile } = install(true, state)

    press('y')

    expect(revertSelectedFile).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('still lets Ctrl+C quit', () => {
    const { press, exit } = install(true)
    press('c', { ctrl: true })
    expect(exit).toHaveBeenCalled()
  })
})
