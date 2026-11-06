/**
 * Feeds the keyboard handler one key at a time when the terminal delivers
 * several keys in a single stdin chunk (`gz` in one write).
 *
 * The handler reads `state` from its render closure, so two keys processed in
 * the same tick would both see the state from before the first one ran. Keys
 * after the first are therefore queued and released one per committed render,
 * with a short timer as the fallback for a key that changes no state (and so
 * never triggers a render). A key that arrives while others are still queued
 * joins the back of the queue, so order is always preserved.
 *
 * `React` and `usePaste` are optional: without them (unit tests that call the
 * hook outside a component) the handler is installed unchanged.
 */
/* eslint-disable react-hooks/rules-of-hooks -- `runtime` is supplied (or not) once per
   mount and never changes, so the hook order is stable for a component's lifetime. */
import type * as ReactTypes from 'react'
import { splitCoalescedKeys } from '../coalescedKeys'
import type { LogInkInputKey } from '../inkInput'

/**
 * How long a queued key waits for a render before it is released anyway. This
 * only matters for a key that changes no state (so no render follows), and it
 * must outlast a full-screen render on a busy machine: releasing early hands
 * the next key the state from before the previous one ran.
 */
export const COALESCED_KEY_FALLBACK_MS = 120

export type UseInputHandlerRuntime = {
  React: typeof ReactTypes
  /** Ink's `usePaste`. Registering it turns on bracketed paste, so a real
   * paste reaches the handler whole instead of being split like typing. */
  usePaste?: (handler: (text: string) => void) => void
}

type QueuedKey = { input: string; key: LogInkInputKey }

const NO_KEY: LogInkInputKey = {}

export function useCoalescedKeyDispatch(
  useInput: (handler: (inputValue: string, key: LogInkInputKey) => void) => void,
  handleKey: (inputValue: string, key: LogInkInputKey) => void,
  runtime?: UseInputHandlerRuntime,
): void {
  if (!runtime) {
    useInput(handleKey)
    return
  }

  const { React, usePaste } = runtime
  const handleRef = React.useRef(handleKey)
  handleRef.current = handleKey
  const queueRef = React.useRef<QueuedKey[]>([])
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const clearTimer = (): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }

  const drainOne = (): void => {
    clearTimer()
    const next = queueRef.current.shift()
    if (!next) return
    if (queueRef.current.length > 0) {
      timerRef.current = setTimeout(drainOne, COALESCED_KEY_FALLBACK_MS)
    }
    handleRef.current(next.input, next.key)
  }

  // Runs after every committed render: the previous key's state change has
  // landed, so the next queued key sees it.
  React.useEffect(() => {
    if (queueRef.current.length > 0) drainOne()
  })
  React.useEffect(() => clearTimer, [])

  useInput((inputValue, key) => {
    // Ctrl+C must never wait behind queued keys.
    if (key.ctrl && inputValue === 'c') {
      queueRef.current = []
      clearTimer()
      handleRef.current(inputValue, key)
      return
    }

    const keys = splitCoalescedKeys(inputValue, key)
    const items: QueuedKey[] = keys
      ? keys.map((input) => ({ input, key }))
      : [{ input: inputValue, key }]
    const idle = queueRef.current.length === 0
    queueRef.current.push(...items)
    if (idle) drainOne()
  })

  usePaste?.((text) => {
    const idle = queueRef.current.length === 0
    queueRef.current.push({ input: text, key: NO_KEY })
    if (idle) drainOne()
  })
}
