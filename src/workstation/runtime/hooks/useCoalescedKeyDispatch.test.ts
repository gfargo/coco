import { COALESCED_KEY_FALLBACK_MS, useCoalescedKeyDispatch } from './useCoalescedKeyDispatch'

// Ink can't be loaded under jest (yoga uses top-level await), so this drives
// the hook with a minimal fake React: `commit()` re-runs the "component" and
// then its effects, which is the moment the real hook releases the next key.
function mount(initialHandler: (input: string, key: Record<string, unknown>) => void) {
  let handleKey = initialHandler
  const refs: Array<{ current: unknown }> = []
  let effects: Array<{ run: () => unknown; deps?: unknown[] }> = []
  const cleanups: Array<() => void> = []
  let refIndex = 0
  const React = {
    useRef: (initial: unknown) => {
      if (!refs[refIndex]) refs[refIndex] = { current: initial }
      return refs[refIndex++]
    },
    useEffect: (run: () => unknown, deps?: unknown[]) => { effects.push({ run, deps }) },
  }
  let inputHandler: (input: string, key: Record<string, unknown>) => void = () => undefined
  let pasteHandler: (text: string) => void = () => undefined
  const mounted = { first: true }

  const FakeComponent = () => {
    refIndex = 0
    effects = []
    useCoalescedKeyDispatch(
      ((fn: typeof inputHandler) => { inputHandler = fn }) as never,
      handleKey,
      { React: React as never, usePaste: (fn) => { pasteHandler = fn } },
    )
  }
  const commit = () => {
    FakeComponent()
    effects.forEach(({ run, deps }) => {
      // `[]`-deps effects (the unmount cleanup) run once.
      if (deps && deps.length === 0 && !mounted.first) return
      const cleanup = run()
      if (typeof cleanup === 'function') cleanups.push(cleanup as () => void)
    })
    mounted.first = false
  }
  commit()
  return {
    commit,
    // Simulates the next render closing over fresh state.
    setHandler: (next: typeof initialHandler) => { handleKey = next },
    type: (input: string, key: Record<string, unknown> = {}) => inputHandler(input, key),
    paste: (text: string) => pasteHandler(text),
    unmount: () => cleanups.forEach((fn) => fn()),
  }
}

describe('useCoalescedKeyDispatch', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('runs the first key of a chunk now and holds the rest until a render commits', () => {
    const seen: string[] = []
    const tui = mount((input) => { seen.push(input) })

    tui.type('gz')
    expect(seen).toEqual(['g'])

    tui.commit()
    expect(seen).toEqual(['g', 'z'])
  })

  it('releases one queued key per committed render', () => {
    const seen: string[] = []
    const tui = mount((input) => { seen.push(input) })

    tui.type('abc')
    expect(seen).toEqual(['a'])
    tui.commit()
    expect(seen).toEqual(['a', 'b'])
    tui.commit()
    expect(seen).toEqual(['a', 'b', 'c'])
  })

  it('releases queued keys on a timer when no render follows', () => {
    const seen: string[] = []
    const tui = mount((input) => { seen.push(input) })

    tui.type('abc')
    jest.advanceTimersByTime(COALESCED_KEY_FALLBACK_MS)
    expect(seen).toEqual(['a', 'b'])
    jest.advanceTimersByTime(COALESCED_KEY_FALLBACK_MS)
    expect(seen).toEqual(['a', 'b', 'c'])
  })

  it('queues a later chunk behind keys that are still pending', () => {
    const seen: string[] = []
    const tui = mount((input) => { seen.push(input) })

    tui.type('ab')
    tui.type('c')
    tui.type('de')
    jest.advanceTimersByTime(COALESCED_KEY_FALLBACK_MS * 6)
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('passes Ctrl+C straight through and drops what was queued', () => {
    const seen: string[] = []
    const tui = mount((input, key) => { seen.push(key.ctrl ? `ctrl+${input}` : input) })

    tui.type('abc')
    tui.type('c', { ctrl: true })
    jest.advanceTimersByTime(COALESCED_KEY_FALLBACK_MS * 6)
    expect(seen).toEqual(['a', 'ctrl+c'])
  })

  it('does not split a single special key or an escape sequence', () => {
    const seen: string[] = []
    const tui = mount((input) => { seen.push(input) })

    tui.type('[<0;12;5M')
    tui.type('ab', { ctrl: true })
    jest.advanceTimersByTime(COALESCED_KEY_FALLBACK_MS * 4)
    expect(seen).toEqual(['[<0;12;5M', 'ab'])
  })

  it('hands a bracketed paste to the handler whole', () => {
    const seen: string[] = []
    const tui = mount((input) => { seen.push(input) })

    tui.paste('gzgz')
    expect(seen).toEqual(['gzgz'])
  })

  it('uses the handler from the latest render for queued keys', () => {
    const seen: string[] = []
    const tui = mount((input) => { seen.push(`${input}:old`) })

    tui.type('ab')
    tui.setHandler((input) => { seen.push(`${input}:new`) })
    tui.commit()
    expect(seen).toEqual(['a:old', 'b:new'])
  })

  it('stops the fallback timer on unmount', () => {
    const seen: string[] = []
    const tui = mount((input) => { seen.push(input) })

    tui.type('abc')
    tui.unmount()
    jest.advanceTimersByTime(COALESCED_KEY_FALLBACK_MS * 6)
    expect(seen).toEqual(['a'])
  })

  it('installs the handler unchanged when no runtime is supplied', () => {
    let installed: ((input: string, key: Record<string, unknown>) => void) | undefined
    const handle = jest.fn()
    useCoalescedKeyDispatch(((fn: typeof installed) => { installed = fn }) as never, handle)
    installed?.('gz', {})
    expect(handle).toHaveBeenCalledTimes(1)
    expect(handle).toHaveBeenCalledWith('gz', {})
  })
})
