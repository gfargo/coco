import { useResumeTick } from './useResumeTick'

/**
 * Tests for `useResumeTick` (app.ts decomposition item 5 / #1237). Driven
 * through a fake-React harness to prove the verbatim contract:
 *   - with a `resumeRef`, the effect installs a callback that bumps the tick
 *     and nulls the ref on cleanup;
 *   - the installed callback bumps the throwaway counter via the updater form;
 *   - with no `resumeRef`, the hook is a no-op.
 */

type EffectFn = () => void | (() => void)

function makeReact(): {
  React: typeof import('react')
  setResumeTick: jest.Mock
  runEffect: () => void | (() => void)
} {
  const setResumeTick = jest.fn()
  const effects: EffectFn[] = []
  const React = {
    useState: (init: unknown) => [init, setResumeTick],
    useEffect: (fn: EffectFn) => {
      effects.push(fn)
    },
  } as unknown as typeof import('react')
  return {
    React,
    setResumeTick,
    runEffect: () => {
      if (effects.length !== 1) {
        throw new Error(`expected exactly one effect, got ${effects.length}`)
      }
      return effects[0]()
    },
  }
}

describe('useResumeTick', () => {
  it('installs a tick-bump into resumeRef and nulls it on cleanup', () => {
    const resumeRef: { current: (() => void) | null } = { current: null }
    const { React, runEffect } = makeReact()

    useResumeTick(React, { resumeRef })
    const cleanup = runEffect() as () => void

    expect(typeof resumeRef.current).toBe('function')
    cleanup()
    expect(resumeRef.current).toBeNull()
  })

  it('the installed callback bumps the throwaway counter via the updater form', () => {
    const resumeRef: { current: (() => void) | null } = { current: null }
    const { React, setResumeTick, runEffect } = makeReact()

    useResumeTick(React, { resumeRef })
    runEffect()
    resumeRef.current?.()

    expect(setResumeTick).toHaveBeenCalledTimes(1)
    const updater = setResumeTick.mock.calls[0][0] as (tick: number) => number
    expect(updater(41)).toBe(42)
  })

  it('is a no-op when there is no resumeRef', () => {
    const { React, setResumeTick, runEffect } = makeReact()

    useResumeTick(React, { resumeRef: undefined })
    const cleanup = runEffect()

    expect(cleanup).toBeUndefined()
    expect(setResumeTick).not.toHaveBeenCalled()
  })
})
