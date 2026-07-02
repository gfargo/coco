import {
  LOG_INTERACTIVE_DEFAULT_LIMIT,
  getCommitRows,
} from '../../../commands/log/data'
import type { LogArgv } from '../../../commands/log/config'
import { computeHasMoreCommits, useHistoryPaginationState } from './useLoadMoreHistory'

/**
 * Tests for the `useHistoryPaginationState` seed (app.ts decomposition item 3
 * / #1237). The loader (`useLoadMoreHistory`) is a verbatim lift validated by
 * the green build + render snapshots; the only logic this hook adds is the
 * lazy `hasMoreCommits` seed, exercised here through a fake-React harness with
 * `getCommitRows` mocked to control the loaded-window size.
 */

jest.mock('../../../commands/log/data', () => {
  const actual = jest.requireActual('../../../commands/log/data')
  return { ...actual, getCommitRows: jest.fn() }
})

const getCommitRowsMock = getCommitRows as jest.MockedFunction<
  typeof getCommitRows
>

/** Fake React whose `useState` runs the lazy initializer, as React would. */
const React = {
  useState: (init: unknown) => {
    const value = typeof init === 'function' ? (init as () => unknown)() : init
    return [value, jest.fn()]
  },
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
