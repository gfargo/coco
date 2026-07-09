/**
 * Theme state management (extracted from app.ts, #1418 decomposition).
 *
 * Owns the theme picker's live-preview / session-apply lifecycle:
 * - `themePreviewPreset` follows the picker cursor while the overlay is open
 * - `themeSessionPreset` is the applied choice that survives close
 * - The effective theme is rebuilt from the original `themeConfig` so
 *   ascii/border/noColor + truecolor-downgrade semantics are preserved
 * - When neither override is set, the static `baseTheme` is used unchanged
 *
 * The cluster — two `useState`, one derived const, one `useMemo`, and one
 * `useEffect` — is issued at the original slot (the first hooks inside
 * `LogInkApp`). Hook order is preserved: the two `useState` calls come first,
 * then the `useMemo`, then the `useEffect`. All downstream consumers read the
 * same returned names (`theme`, `setThemeSessionPreset`).
 *
 * `React` is injected per the runtime's convention (the workstation never
 * statically imports React).
 */

import type * as ReactTypes from 'react'
import { createLogInkTheme, type LogInkTheme, type LogInkThemeConfig, type LogInkThemePreset } from '../../chrome/theme'
import type { LogInkState } from '../inkViewModel'
import { getThemePickerSelection } from '../inkViewModel'

export type UseThemeStateDeps = {
  baseTheme: LogInkTheme
  themeConfig?: LogInkThemeConfig
  /** Current showThemePicker state from the reducer. */
  showThemePicker: boolean
  /** Full state to derive the picker's current selection. */
  state: LogInkState
}

export type UseThemeStateResult = {
  /** The resolved theme to use for rendering (base → session → preview). */
  theme: LogInkTheme
  /** Setter for the session preset (applied when the user confirms). */
  setThemeSessionPreset: ReactTypes.Dispatch<ReactTypes.SetStateAction<LogInkThemePreset | undefined>>
}

export function useThemeState(
  React: typeof ReactTypes,
  deps: UseThemeStateDeps,
): UseThemeStateResult {
  const { baseTheme, themeConfig, showThemePicker, state } = deps

  const [themePreviewPreset, setThemePreviewPreset] = React.useState<LogInkThemePreset | undefined>(undefined)
  const [themeSessionPreset, setThemeSessionPreset] = React.useState<LogInkThemePreset | undefined>(undefined)

  const effectiveThemePreset = themePreviewPreset ?? themeSessionPreset

  const theme = React.useMemo(
    () =>
      effectiveThemePreset
        ? createLogInkTheme({ ...themeConfig, preset: effectiveThemePreset })
        : baseTheme,
    [effectiveThemePreset, themeConfig, baseTheme]
  )

  // Theme picker live preview: keep `themePreviewPreset` in sync with the
  // preset under the picker cursor while the overlay is open; clear it when
  // the overlay closes so the theme reverts to the applied session preset
  // (or the original config theme).
  const themePickerSelection = showThemePicker
    ? getThemePickerSelection(state)
    : undefined
  React.useEffect(() => {
    setThemePreviewPreset(showThemePicker ? themePickerSelection : undefined)
  }, [showThemePicker, themePickerSelection])

  return { theme, setThemeSessionPreset }
}
