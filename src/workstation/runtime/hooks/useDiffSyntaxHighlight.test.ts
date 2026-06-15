import { highlightDiffCode } from '../../../lib/syntax/highlightEngine'
import {
  useDiffSyntaxHighlight,
  useDiffSyntaxState,
} from './useDiffSyntaxHighlight'

/**
 * Behavioral tests for the diff syntax-highlight cluster (app.ts decomposition
 * item 2 / #1237). The two hooks are a verbatim lift of the inline
 * `diffSyntaxSpans` `useState` + highlight effect; these tests drive them
 * through a minimal fake-React harness and a mocked highlight engine to prove
 * the contract carried over byte-for-byte:
 *   - gate off (flag/noColor/not-diff) → clear spans, never tokenize;
 *   - commit source → highlight the file preview's hunks and store the spans;
 *   - cancellation via the `active` flag suppresses a stale write.
 */

jest.mock('../../../lib/syntax/highlightEngine', () => ({
  highlightDiffCode: jest.fn(),
}))

const highlightDiffCodeMock = highlightDiffCode as jest.MockedFunction<
  typeof highlightDiffCode
>

/** Flush pending microtasks so the effect's `.then` settles. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

type EffectFn = () => void | (() => void)

function makeReact(): {
  React: typeof import('react')
  runEffect: () => void | (() => void)
} {
  const effects: EffectFn[] = []
  const React = {
    useEffect: (fn: EffectFn) => {
      effects.push(fn)
    },
  } as unknown as typeof import('react')
  return {
    React,
    runEffect: () => {
      if (effects.length !== 1) {
        throw new Error(`expected exactly one effect, got ${effects.length}`)
      }
      return effects[0]()
    },
  }
}

type Deps = Parameters<typeof useDiffSyntaxHighlight>[1]

/** Baseline deps for the "commit source, everything on" happy path. */
const baseDeps = (over: Partial<Deps> = {}): Deps => ({
  syntaxHighlightEnabled: true,
  noColor: false,
  activeView: 'diff' as Deps['activeView'],
  diffSource: 'commit' as Deps['diffSource'],
  selectedDetailFile: { path: 'src/app.ts' } as unknown as Deps['selectedDetailFile'],
  filePreview: { hunks: ['@@ -1 +1 @@', '-a', '+b'] } as unknown as Deps['filePreview'],
  worktreeDiff: undefined,
  setDiffSyntaxSpans: jest.fn(),
  ...over,
})

beforeEach(() => {
  highlightDiffCodeMock.mockReset()
})

describe('useDiffSyntaxState', () => {
  it('seeds diffSyntaxSpans undefined and exposes the setter', () => {
    const React = {
      useState: (init: unknown) => {
        const value = typeof init === 'function' ? (init as () => unknown)() : init
        return [value, jest.fn()]
      },
    } as unknown as typeof import('react')

    const result = useDiffSyntaxState(React)

    expect(result.diffSyntaxSpans).toBeUndefined()
    expect(typeof result.setDiffSyntaxSpans).toBe('function')
  })
})

describe('useDiffSyntaxHighlight', () => {
  it.each([
    ['the flag is off', { syntaxHighlightEnabled: false }],
    ['the terminal is no-color', { noColor: true }],
    ['the active view is not diff', { activeView: 'history' as Deps['activeView'] }],
  ])('clears spans and never tokenizes when %s', async (_label, over) => {
    const setDiffSyntaxSpans = jest.fn()
    const { React, runEffect } = makeReact()

    useDiffSyntaxHighlight(React, baseDeps({ ...over, setDiffSyntaxSpans }))
    runEffect()
    await flush()

    expect(setDiffSyntaxSpans).toHaveBeenCalledWith(undefined)
    expect(highlightDiffCodeMock).not.toHaveBeenCalled()
  })

  it('clears spans when the commit source has no file / lines', async () => {
    const setDiffSyntaxSpans = jest.fn()
    const { React, runEffect } = makeReact()

    useDiffSyntaxHighlight(
      React,
      baseDeps({ filePreview: { hunks: [] } as unknown as Deps['filePreview'], setDiffSyntaxSpans }),
    )
    runEffect()
    await flush()

    expect(setDiffSyntaxSpans).toHaveBeenCalledWith(undefined)
    expect(highlightDiffCodeMock).not.toHaveBeenCalled()
  })

  it('highlights the commit file preview and stores the spans', async () => {
    const spans = new Map([['+b', [{ start: 0 }]]])
    highlightDiffCodeMock.mockResolvedValue(spans as never)
    const setDiffSyntaxSpans = jest.fn()
    const { React, runEffect } = makeReact()

    useDiffSyntaxHighlight(React, baseDeps({ setDiffSyntaxSpans }))
    runEffect()
    await flush()

    expect(highlightDiffCodeMock).toHaveBeenCalledWith('src/app.ts', [
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ])
    expect(setDiffSyntaxSpans).toHaveBeenLastCalledWith(spans)
  })

  it('stores undefined when highlighting yields an empty map', async () => {
    highlightDiffCodeMock.mockResolvedValue(new Map() as never)
    const setDiffSyntaxSpans = jest.fn()
    const { React, runEffect } = makeReact()

    useDiffSyntaxHighlight(React, baseDeps({ setDiffSyntaxSpans }))
    runEffect()
    await flush()

    expect(setDiffSyntaxSpans).toHaveBeenLastCalledWith(undefined)
  })

  it('suppresses a stale write when cleaned up before highlighting resolves', async () => {
    let resolveSpans: (value: unknown) => void = () => {}
    highlightDiffCodeMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSpans = resolve
      }) as never,
    )
    const setDiffSyntaxSpans = jest.fn()
    const { React, runEffect } = makeReact()

    useDiffSyntaxHighlight(React, baseDeps({ setDiffSyntaxSpans }))
    const cleanup = runEffect() as () => void
    cleanup()
    resolveSpans(new Map([['+b', []]]))
    await flush()

    // active === false → the resolved spans are dropped.
    expect(setDiffSyntaxSpans).not.toHaveBeenCalled()
  })
})
