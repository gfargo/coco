import {
  GitLogRow,
  LOG_INTERACTIVE_DEFAULT_LIMIT,
  getCommitRows,
  getLogRowsAnchoredOn,
} from '../../../git/logData'
import type { LogArgv } from '../../../commands/log/config'
import {
  computeHasMoreCommits,
  useHistoryPaginationState,
  useLoadMoreHistory,
} from './useLoadMoreHistory'

/**
 * Tests for the `useHistoryPaginationState` seed (app.ts decomposition item 3
 * / #1237). The loader (`useLoadMoreHistory`) is a verbatim lift validated by
 * the green build + render snapshots; the only logic this hook adds is the
 * lazy `hasMoreCommits` seed, exercised here through a fake-React harness with
 * `getCommitRows` mocked to control the loaded-window size.
 */

jest.mock('../../../git/logData', () => {
  const actual = jest.requireActual('../../../git/logData')
  return {
    ...actual,
    getCommitRows: jest.fn(),
    getLogRowsAnchoredOn: jest.fn(),
  }
})

const getCommitRowsMock = getCommitRows as jest.MockedFunction<
  typeof getCommitRows
>
const getLogRowsAnchoredOnMock = getLogRowsAnchoredOn as jest.MockedFunction<
  typeof getLogRowsAnchoredOn
>

/** Fake React whose `useState` runs the lazy initializer, as React would. */
const React = {
  useState: (init: unknown) => {
    const value = typeof init === 'function' ? (init as () => unknown)() : init
    return [value, jest.fn()]
  },
} as unknown as typeof import('react')

/**
 * Fake React harness for `useLoadMoreHistory` itself: `useRef` returns a
 * plain mutable box, `useCallback` hands back the function unchanged
 * (identity doesn't matter for these tests), and `useEffect` runs its body
 * synchronously — enough to exercise the assignment effect that wires
 * `loadCommitContext` into the forward-reference ref.
 */
const loaderReact = {
  useState: (init: unknown) => {
    const value = typeof init === 'function' ? (init as () => unknown)() : init
    return [value, jest.fn()]
  },
  useRef: (init: unknown) => ({ current: init }),
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void) => fn(),
} as unknown as typeof import('react')

/** A loaded window of `count` commit rows (only `.length` is read by the seed). */
const rowsOfLength = (count: number) =>
  getCommitRowsMock.mockReturnValue(
    new Array(count).fill({}) as ReturnType<typeof getCommitRows>,
  )

const argv = (over: Partial<LogArgv>): LogArgv => over as LogArgv

beforeEach(() => {
  getCommitRowsMock.mockReset()
})

describe('useHistoryPaginationState seed', () => {
  it('seeds hasMoreCommits true in interactive mode with a full default window and no --limit', () => {
    rowsOfLength(LOG_INTERACTIVE_DEFAULT_LIMIT)
    const { hasMoreCommits, loadingMoreCommits } = useHistoryPaginationState(React, {
      logArgv: argv({ interactive: true }),
      rows: [],
    })
    expect(hasMoreCommits).toBe(true)
    expect(loadingMoreCommits).toBe(false)
  })

  it('seeds false when the loaded window is below the default page size', () => {
    rowsOfLength(LOG_INTERACTIVE_DEFAULT_LIMIT - 1)
    const { hasMoreCommits } = useHistoryPaginationState(React, {
      logArgv: argv({ interactive: true }),
      rows: [],
    })
    expect(hasMoreCommits).toBe(false)
  })

  it('seeds false (and never counts rows) when an explicit --limit is set', () => {
    const { hasMoreCommits } = useHistoryPaginationState(React, {
      logArgv: argv({ interactive: true, limit: 10 }),
      rows: [],
    })
    expect(hasMoreCommits).toBe(false)
    expect(getCommitRowsMock).not.toHaveBeenCalled()
  })

  it('seeds false when not in interactive mode', () => {
    const { hasMoreCommits } = useHistoryPaginationState(React, {
      logArgv: argv({ interactive: false }),
      rows: [],
    })
    expect(hasMoreCommits).toBe(false)
    expect(getCommitRowsMock).not.toHaveBeenCalled()
  })

  it('seeds false when there is no log argv at all', () => {
    const { hasMoreCommits } = useHistoryPaginationState(React, {
      logArgv: undefined,
      rows: [],
    })
    expect(hasMoreCommits).toBe(false)
  })
})

describe('computeHasMoreCommits (boot-loader correction)', () => {
  // Regression: `coco ui` mounts with cached rows (or none on a cold
  // cache) and fetches the real window async. The mount-time seed alone
  // evaluated false and nothing corrected it, so pagination stayed dead
  // for the whole session. The boot loader now recomputes from the
  // fetched window with this helper.
  it('reports more history when the fetched window fills the default page', () => {
    rowsOfLength(LOG_INTERACTIVE_DEFAULT_LIMIT)
    expect(computeHasMoreCommits(argv({ interactive: true }), [])).toBe(true)
  })

  it('reports no more history for a short window or an explicit --limit', () => {
    rowsOfLength(LOG_INTERACTIVE_DEFAULT_LIMIT - 1)
    expect(computeHasMoreCommits(argv({ interactive: true }), [])).toBe(false)
    expect(computeHasMoreCommits(argv({ interactive: true, limit: 10 }), [])).toBe(false)
    expect(computeHasMoreCommits(undefined, [])).toBe(false)
  })
})

describe('loadCommitContext status', () => {
  // Regression: the append path used to dispatch `appendRows` and rely
  // entirely on the cursor-sync effect's re-fire to clear the `loading`
  // status. If that re-fire early-returns (e.g. the user tabbed away
  // mid-fetch), `useStatusAutoDismiss` refuses to reap a `loading`
  // status and the "Loading commits around X…" spinner sticks forever.
  // `loadCommitContext` now clears its own status on the append path so
  // the spinner can never get permanently stuck on this loader alone.

  const baseState = {
    mainHistoryCommitCount: 0,
    filteredCommits: [],
    historyFetchArgs: undefined,
    selectedIndex: 0,
    repoStack: [{ label: 'root', workdir: '/repo' }],
  }

  /** Builds the deps `useLoadMoreHistory` needs, with sane defaults. */
  const buildDeps = (overrides: Record<string, unknown> = {}) => ({
    git: {} as never,
    dispatch: jest.fn(),
    state: baseState,
    logArgv: argv({ interactive: true }),
    hasMoreCommits: false,
    setHasMoreCommits: jest.fn(),
    loadingMoreCommits: false,
    setLoadingMoreCommits: jest.fn(),
    mountedRef: { current: true },
    loadingMoreCommitsRef: { current: false },
    loadMoreRequestRef: { current: 0 },
    loadCommitContextRef: { current: null },
    ...overrides,
  })

  beforeEach(() => {
    getLogRowsAnchoredOnMock.mockReset()
  })

  const anchoredRow = { hash: 'abc123', subject: 'test commit' } as unknown as GitLogRow

  it('clears the loading status on the append (success) path', async () => {
    getLogRowsAnchoredOnMock.mockResolvedValue([anchoredRow])
    const deps = buildDeps()

    useLoadMoreHistory(loaderReact, deps as never)
    expect(deps.loadCommitContextRef.current).toBeTruthy()

    await (deps.loadCommitContextRef.current as unknown as (
      target: { hash: string; label: string }
    ) => Promise<void>)({ hash: 'abc123', label: 'main' })

    expect(deps.dispatch).toHaveBeenCalledWith({
      type: 'setStatus',
      value: 'Loading commits around main…',
      loading: true,
    })
    expect(deps.dispatch).toHaveBeenCalledWith({
      type: 'appendRows',
      rows: [anchoredRow],
    })
    // The explicit clear must land AFTER the append so `loading` never
    // remains true once `loadCommitContext` resolves.
    expect(deps.dispatch).toHaveBeenLastCalledWith({
      type: 'setStatus',
      value: undefined,
    })
  })

  it('leaves the existing warning status on the no-rows path unchanged', async () => {
    getLogRowsAnchoredOnMock.mockResolvedValue([])
    const deps = buildDeps()

    useLoadMoreHistory(loaderReact, deps as never)
    await (deps.loadCommitContextRef.current as unknown as (
      target: { hash: string; label: string }
    ) => Promise<void>)({ hash: 'def456', label: 'orphan-branch' })

    expect(deps.dispatch).toHaveBeenLastCalledWith({
      type: 'setStatus',
      value: 'orphan-branch target commit returned no rows — orphan ref?',
      kind: 'warning',
    })
  })
})
