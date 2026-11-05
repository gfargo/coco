import type * as ReactTypes from 'react'
import { setLoadingDelayEnabled, settleLoadingEpisode } from '../../chrome/loadingDelay'

/**
 * Wire the delayed loading text (#2166) into the root: enable the delay for
 * the lifetime of the TUI (from the first render), and after every commit settle the loading episode.
 * While loading text is requested but still hidden, schedule exactly one
 * re-render for the moment it may appear.
 *
 * Effects run after the whole tree has rendered, so by then every surface that
 * wanted loading text for this frame has already asked for it.
 */
export function useLoadingTextDelay(React: typeof ReactTypes): void {
  const [, rerender] = React.useState(0)

  // Enable during the first render, not in a mount effect: effects run after
  // the first commit, so the very first frame (boot, the moment "Loading…"
  // matters most) would have shown the text with no delay. The surfaces are
  // built after this hook runs, so they see it on. Idempotent.
  const enabled = React.useRef(false)
  if (!enabled.current) {
    enabled.current = true
    setLoadingDelayEnabled(true)
  }

  React.useEffect(() => () => setLoadingDelayEnabled(false), [])

  // No dependency array on purpose: this must run after every commit.
  React.useEffect(() => {
    const { requested, remainingMs } = settleLoadingEpisode()
    if (!requested || remainingMs <= 0) return undefined
    // DevSkim: ignore DS172411 — callback is a function literal, delay is our own constant.
    const id = setTimeout(() => rerender((tick) => tick + 1), remainingMs)
    return () => clearTimeout(id)
  })
}
