/**
 * #2209 — `refreshHistoryRows` (run after coco's own mutations and on every
 * fs-watcher `'full'` event) refetched only the first 1000 commits and
 * replaced the rows with them. Pages the user had loaded vanished, and a
 * cursor past row 1000 jumped to the top because its commit was no longer
 * in the list. It now refetches at least as deep as what is loaded.
 */
import type { SimpleGit } from 'simple-git'
import type { LogArgv } from '../../../commands/log/config'
import { getLogRows, LOG_INTERACTIVE_DEFAULT_LIMIT, type GitLogRow } from '../../../git/logData'
import { getStashCommitHashes } from '../../../git/stashData'
import { makeHookHarness } from '../../../test/builders/makeHookHarness'
import { useHistoryRefresh, type UseHistoryRefreshDeps } from './useHistoryRefresh'

jest.mock('../../../git/logData', () => {
  const actual = jest.requireActual('../../../git/logData')
  return { ...actual, getLogRows: jest.fn() }
})
jest.mock('../../../git/stashData', () => ({
  getStashCommitHashes: jest.fn(),
}))

const getLogRowsMock = getLogRows as jest.MockedFunction<typeof getLogRows>
const getStashCommitHashesMock = getStashCommitHashes as jest.MockedFunction<typeof getStashCommitHashes>

function commitRows(count: number): GitLogRow[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'commit' as const,
    graph: '*',
    hash: `h${i}`.padEnd(40, '0'),
    shortHash: `h${i}`,
    parents: [],
    date: '2026-01-01',
    author: 'a',
    refs: [],
    message: `m${i}`,
  }))
}

describe('useHistoryRefresh (#2209)', () => {
  // Stable across renders, as in the app.
  const dispatch = jest.fn()
  const setHasMoreCommits = jest.fn()
  const git = {} as SimpleGit
  const logArgv = { interactive: true } as LogArgv
  const mountedRef = { current: true }
  const repoFrameDepthRef = { current: 0 }
  const historyRefetchGenerationRef = { current: 0 }
  const deps = (overrides: Partial<UseHistoryRefreshDeps> = {}): UseHistoryRefreshDeps => ({
    git,
    logArgv,
    dispatch,
    mountedRef,
    repoFrameDepthRef,
    setHasMoreCommits,
    fullGraph: true,
    historyFetchArgs: undefined,
    historyRefetchGenerationRef,
    loadedCommitCount: LOG_INTERACTIVE_DEFAULT_LIMIT,
    ...overrides,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    getStashCommitHashesMock.mockResolvedValue([])
  })

  it('refetches as deep as the pages the user loaded', async () => {
    getLogRowsMock.mockResolvedValue(commitRows(3))
    const { refreshHistoryRows } = makeHookHarness().render((React) =>
      useHistoryRefresh(React, deps({ loadedCommitCount: 20_000 }))
    )
    await refreshHistoryRows()

    expect(getLogRowsMock.mock.calls[0][2]).toMatchObject({ limit: 20_000 })
  })

  it('still refetches a full page when fewer commits are loaded', async () => {
    getLogRowsMock.mockResolvedValue(commitRows(3))
    const { refreshHistoryRows } = makeHookHarness().render((React) =>
      useHistoryRefresh(React, deps({ loadedCommitCount: 120 }))
    )
    await refreshHistoryRows()

    expect(getLogRowsMock.mock.calls[0][2]).toMatchObject({ limit: LOG_INTERACTIVE_DEFAULT_LIMIT })
  })

  it('reads the latest loaded count without changing the callback identity', async () => {
    getLogRowsMock.mockResolvedValue(commitRows(3))
    const harness = makeHookHarness()
    const first = harness.render((React) => useHistoryRefresh(React, deps({ loadedCommitCount: 1000 })))
    const second = harness.render((React) => useHistoryRefresh(React, deps({ loadedCommitCount: 5000 })))

    expect(second.refreshHistoryRows).toBe(first.refreshHistoryRows)
    await first.refreshHistoryRows()
    expect(getLogRowsMock.mock.calls[0][2]).toMatchObject({ limit: 5000 })
  })

  it('reports more history only when the deep window came back full', async () => {
    const { refreshHistoryRows } = makeHookHarness().render((React) =>
      useHistoryRefresh(React, deps({ loadedCommitCount: 2000 }))
    )

    getLogRowsMock.mockResolvedValueOnce(commitRows(2000))
    await refreshHistoryRows()
    getLogRowsMock.mockResolvedValueOnce(commitRows(1500))
    await refreshHistoryRows()

    expect(setHasMoreCommits.mock.calls).toEqual([[true], [false]])
  })
})
