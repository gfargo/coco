import { hasSeenOnboarding, markOnboardingSeen } from '../../chrome/onboarding'
import { useOnboarding } from './useOnboarding'

/**
 * Tests for `useOnboarding` (app.ts decomposition item 4 / #1237). Driven
 * through a fake-React harness with the onboarding persistence module mocked,
 * to prove the bundled contract:
 *   - `showOnboarding` is seeded from `!hasSeenOnboarding()`;
 *   - `dismissOnboarding` clears the overlay *and* writes the seen-marker,
 *     in that order.
 */

jest.mock('../../chrome/onboarding', () => ({
  hasSeenOnboarding: jest.fn(),
  markOnboardingSeen: jest.fn(),
}))

const hasSeenOnboardingMock = hasSeenOnboarding as jest.MockedFunction<
  typeof hasSeenOnboarding
>
const markOnboardingSeenMock = markOnboardingSeen as jest.MockedFunction<
  typeof markOnboardingSeen
>

/** Fake React whose `useState` runs the lazy seed and `useCallback` is identity. */
function makeReact(): {
  React: typeof import('react')
  setShowOnboarding: jest.Mock
} {
  const setShowOnboarding = jest.fn()
  const React = {
    useState: (init: unknown) => [
      typeof init === 'function' ? (init as () => unknown)() : init,
      setShowOnboarding,
    ],
    useCallback: (fn: unknown) => fn,
  } as unknown as typeof import('react')
  return { React, setShowOnboarding }
}

beforeEach(() => {
  hasSeenOnboardingMock.mockReset()
  markOnboardingSeenMock.mockReset()
})

describe('useOnboarding', () => {
  it('shows the overlay on first launch (seen-marker absent)', () => {
    hasSeenOnboardingMock.mockReturnValue(false)
    const { React } = makeReact()
    expect(useOnboarding(React).showOnboarding).toBe(true)
  })

  it('hides the overlay on later launches (seen-marker present)', () => {
    hasSeenOnboardingMock.mockReturnValue(true)
    const { React } = makeReact()
    expect(useOnboarding(React).showOnboarding).toBe(false)
  })

  it('dismissOnboarding clears the overlay and persists the seen-marker', () => {
    hasSeenOnboardingMock.mockReturnValue(false)
    const { React, setShowOnboarding } = makeReact()

    useOnboarding(React).dismissOnboarding()

    expect(setShowOnboarding).toHaveBeenCalledWith(false)
    expect(markOnboardingSeenMock).toHaveBeenCalledTimes(1)
  })
})
