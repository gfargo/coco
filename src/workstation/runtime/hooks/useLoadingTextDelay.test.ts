import { LOADING_TEXT_DELAY_MS, setLoadingDelayEnabled, shouldShowLoadingText } from '../../chrome/loadingDelay'
import { useLoadingTextDelay } from './useLoadingTextDelay'

/**
 * A just-enough React: effects are queued and run on demand, `useState` hands
 * back a setter that counts re-renders. The real behavior (against real React
 * and Ink commits) is covered by the end-to-end check in the PR.
 */
function fakeReact() {
  const effects: Array<{ run: () => void | (() => void); deps?: unknown[] }> = []
  let rerenders = 0
  const React = {
    useState: () => [0, () => { rerenders++ }],
    useRef: (initial: unknown) => ({ current: initial }),
    useEffect: (run: () => void | (() => void), deps?: unknown[]) => { effects.push({ run, deps }) },
  }
  return { React: React as never, effects, rerenders: () => rerenders }
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  jest.useRealTimers()
  setLoadingDelayEnabled(false)
})

describe('useLoadingTextDelay (#2166)', () => {
  it('enables the delay during the first render, before any effect runs', () => {
    const { React } = fakeReact()
    useLoadingTextDelay(React) // render phase only; no effect has run yet
    expect(shouldShowLoadingText()).toBe(false) // the very first frame already hides loading text
  })

  it('disables the delay again on unmount', () => {
    const { React, effects } = fakeReact()
    useLoadingTextDelay(React)
    const cleanup = effects[0].run() as () => void
    cleanup()
    expect(shouldShowLoadingText()).toBe(true)
  })

  it('runs its settling effect after every commit (no dependency array)', () => {
    const { React, effects } = fakeReact()
    useLoadingTextDelay(React)
    expect(effects[1].deps).toBeUndefined()
  })

  it('schedules exactly one re-render for when the text may appear, and clears it on the next commit', () => {
    const { React, effects, rerenders } = fakeReact()
    useLoadingTextDelay(React)
    shouldShowLoadingText() // a surface asks for loading text during this render
    const cleanup = effects[1].run() as () => void

    expect(rerenders()).toBe(0)
    jest.advanceTimersByTime(LOADING_TEXT_DELAY_MS - 1)
    expect(rerenders()).toBe(0)
    jest.advanceTimersByTime(1)
    expect(rerenders()).toBe(1)

    // A commit before the timer fires cancels it (the next effect run re-arms from the episode's own clock).
    shouldShowLoadingText()
    const second = fakeReact()
    useLoadingTextDelay(second.React)
    const again = second.effects[1].run() as (() => void) | undefined
    cleanup()
    again?.()
    jest.advanceTimersByTime(1000)
    expect(rerenders()).toBe(1)
  })

  it('schedules nothing when no loading text was requested', () => {
    const { React, effects, rerenders } = fakeReact()
    useLoadingTextDelay(React)
    expect(effects[1].run()).toBeUndefined()
    jest.advanceTimersByTime(1000)
    expect(rerenders()).toBe(0)
  })
})
