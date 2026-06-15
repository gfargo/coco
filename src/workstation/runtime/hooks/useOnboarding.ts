/**
 * First-run onboarding overlay (extracted in the post-0.72 app.ts
 * decomposition, item 4 / #1237; the feature itself is P1.3).
 *
 * This module bundles the first-launch overlay's show / dismiss / persistence
 * into one unit, lifting it out of `app.ts`:
 *   - `showOnboarding` — seeded once from `!hasSeenOnboarding()` (true on the
 *     very first launch, before the seen-marker is written);
 *   - `dismissOnboarding` — clears the overlay *and* writes the seen-marker via
 *     `markOnboardingSeen()`, so the overlay never returns on later launches.
 *
 * The dismiss is wired into the input handler: the first keystroke after launch
 * calls `dismissOnboarding()` (and swallows the key). Previously `app.ts` held
 * the `useState` and passed `setShowOnboarding` + `markOnboardingSeen`
 * separately into `useInputHandler`, which called both inline; folding them
 * into `dismissOnboarding` keeps the two operations — `setShowOnboarding(false)`
 * then `markOnboardingSeen()` — in the same order, so behavior is unchanged.
 *
 * `dismissOnboarding` is a stable `useCallback` (empty deps: the state setter
 * and the module-level `markOnboardingSeen` are both stable), so the input
 * handler sees a constant identity across renders.
 *
 * `React` is injected (per the runtime's `getLogInkRuntimeContext(React)`
 * convention) because the workstation never statically imports React.
 */

import type * as ReactTypes from 'react'
import { hasSeenOnboarding, markOnboardingSeen } from '../../chrome/onboarding'

/**
 * Owns the first-run overlay state. Returns whether to render the overlay and
 * a single `dismissOnboarding` that clears it and persists the seen-marker.
 */
export function useOnboarding(React: typeof ReactTypes): {
  showOnboarding: boolean
  dismissOnboarding: () => void
} {
  const [showOnboarding, setShowOnboarding] = React.useState<boolean>(
    () => !hasSeenOnboarding(),
  )
  const dismissOnboarding = React.useCallback(() => {
    setShowOnboarding(false)
    markOnboardingSeen()
  }, [])
  return { showOnboarding, dismissOnboarding }
}
