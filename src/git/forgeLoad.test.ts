import { loadForgeList, loadForgeOverview, paginate } from './forgeLoad'

// #2222. The shared availability ladder behind every forge list and overview
// loader (GitHub, GitLab, Bitbucket): detect, probe auth, fetch. The envelope
// each surface renders is assembled here once, so what it says in each state
// (not detected, not authenticated, fetch failed, ok) is pinned here.
describe('loadForgeList (#2222)', () => {
  type Status = { kind: string; reason?: string }
  const make = (over: Record<string, unknown> = {}) => {
    const detect = jest.fn(async () => ({ slug: 'o/r' }) as { slug: string } | undefined)
    const probe = jest.fn(async (): Promise<Status> => ({ kind: 'ok' }))
    const fetch = jest.fn(async () => ({ items: [1, 2, 3] }))
    const params = {
      detect,
      notDetectedMessage: 'No forge remote found.',
      probe,
      describeStatus: (status: Status) => `Not signed in (${status.reason})`,
      repository: (project: { slug: string }) => project.slug,
      filter: { state: 'open' },
      fetch,
      fetchErrorMessage: 'Could not load the list.',
      ...over,
    }
    return { params: params as never, detect, probe, fetch }
  }

  it('says it is unavailable, and probes nothing, when no forge is detected', async () => {
    const { params, probe, fetch } = make({ detect: jest.fn(async () => undefined) })
    expect(await loadForgeList(params)).toEqual({
      available: false,
      authenticated: false,
      filter: { state: 'open' },
      message: 'No forge remote found.',
    })
    expect(probe).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('says it is available but not signed in, with the reason, and fetches nothing', async () => {
    const { params, fetch } = make({ probe: jest.fn(async () => ({ kind: 'unauthenticated', reason: 'run gh auth login' })) })
    expect(await loadForgeList(params)).toEqual({
      available: true,
      authenticated: false,
      repository: 'o/r',
      filter: { state: 'open' },
      message: 'Not signed in (run gh auth login)',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('treats any probe result that is not "ok" as not signed in', async () => {
    for (const kind of ['missing-cli', 'unauthenticated', 'error', 'unknown']) {
      const { params } = make({ probe: jest.fn(async () => ({ kind, reason: kind })) })
      expect(await loadForgeList(params)).toMatchObject({ available: true, authenticated: false, message: `Not signed in (${kind})` })
    }
  })

  it('merges what the fetch returned into the envelope when everything is fine', async () => {
    const { params, fetch } = make()
    expect(await loadForgeList(params)).toEqual({
      available: true,
      authenticated: true,
      repository: 'o/r',
      filter: { state: 'open' },
      items: [1, 2, 3],
    })
    expect(fetch).toHaveBeenCalledWith({ slug: 'o/r' })
  })

  it('reports a failed fetch as available and signed in, with the error message', async () => {
    const { params } = make({ fetch: jest.fn(async () => { throw new Error('HTTP 502: bad gateway') }) })
    expect(await loadForgeList(params)).toEqual({
      available: true,
      authenticated: true,
      repository: 'o/r',
      filter: { state: 'open' },
      message: 'HTTP 502: bad gateway',
    })
  })

  it('falls back to the caller\'s message when something that is not an Error was thrown', async () => {
    const { params } = make({ fetch: jest.fn(async () => { throw 'plain string' }) })
    expect((await loadForgeList(params)).message).toBe('Could not load the list.')
  })

  it('detects once and probes once', async () => {
    const { params, detect, probe } = make()
    await loadForgeList(params)
    expect(detect).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledTimes(1)
  })
})

describe('paginate (#2222)', () => {
  const pages = (...sizes: Array<{ items: number[]; hasMore: boolean }>) => {
    const fetchPage = jest.fn(async (page: number) => JSON.stringify(sizes[page - 1]))
    return { fetchPage, parsePage: (output: string) => JSON.parse(output) as { items: number[]; hasMore: boolean } }
  }

  it('reads pages in order from 1, until one says there is no more', async () => {
    const { fetchPage, parsePage } = pages({ items: [1, 2], hasMore: true }, { items: [3, 4], hasMore: true }, { items: [5], hasMore: false })
    expect(await paginate({ fetchPage, parsePage, want: 100, maxPages: 10 })).toEqual({ items: [1, 2, 3, 4, 5], truncated: false })
    expect(fetchPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3])
  })

  it('stops asking once it has as many as were wanted, and returns exactly that many', async () => {
    const { fetchPage, parsePage } = pages({ items: [1, 2, 3], hasMore: true }, { items: [4, 5, 6], hasMore: true }, { items: [7, 8, 9], hasMore: true })
    const result = await paginate({ fetchPage, parsePage, want: 4, maxPages: 10 })
    expect(result).toEqual({ items: [1, 2, 3, 4], truncated: false })
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('asks for nothing when nothing is wanted', async () => {
    const { fetchPage, parsePage } = pages({ items: [1], hasMore: true })
    expect(await paginate({ fetchPage, parsePage, want: 0, maxPages: 10 })).toEqual({ items: [], truncated: false })
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('flags the result truncated when the page ceiling is hit while the server still has more', async () => {
    const { fetchPage, parsePage } = pages({ items: [1], hasMore: true }, { items: [2], hasMore: true }, { items: [3], hasMore: true })
    expect(await paginate({ fetchPage, parsePage, want: 100, maxPages: 2 })).toEqual({ items: [1, 2], truncated: true })
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('does not flag truncation when the last allowed page was also the last page', async () => {
    const { fetchPage, parsePage } = pages({ items: [1], hasMore: true }, { items: [2], hasMore: false })
    expect(await paginate({ fetchPage, parsePage, want: 100, maxPages: 2 })).toEqual({ items: [1, 2], truncated: false })
  })

  describe('errors', () => {
    const failing = (okPages: number) => {
      const fetchPage = jest.fn(async (page: number) => {
        if (page > okPages) throw new Error(`page ${page} failed`)
        return JSON.stringify({ items: [page], hasMore: true })
      })
      return { fetchPage, parsePage: (output: string) => JSON.parse(output) as { items: number[]; hasMore: boolean } }
    }

    it('propagates a fetch error by default', async () => {
      await expect(paginate({ ...failing(1), want: 10, maxPages: 5 })).rejects.toThrow('page 2 failed')
    })

    it('propagates a parse error by default', async () => {
      const { fetchPage } = failing(5)
      await expect(paginate({ fetchPage, parsePage: () => { throw new Error('bad json') }, want: 10, maxPages: 5 })).rejects.toThrow('bad json')
    })

    it('with onError "stop", keeps what it had and flags the result truncated', async () => {
      expect(await paginate({ ...failing(2), want: 10, maxPages: 5, onError: 'stop' })).toEqual({ items: [1, 2], truncated: true })
    })

    it('with onError "stop", an error on the first page gives an empty, truncated result', async () => {
      expect(await paginate({ ...failing(0), want: 10, maxPages: 5, onError: 'stop' })).toEqual({ items: [], truncated: true })
    })

    it('with onError "stop", a parse error is swallowed the same way', async () => {
      const { fetchPage } = failing(5)
      expect(await paginate({ fetchPage, parsePage: () => { throw new Error('bad json') }, want: 10, maxPages: 5, onError: 'stop' })).toEqual({ items: [], truncated: true })
    })
  })

  it('stops, flagged truncated, when a page cannot be parsed and the caller says so by returning undefined', async () => {
    const fetchPage = jest.fn(async (page: number) => String(page))
    const parsePage = (output: string) => (output === '3' ? undefined : { items: [Number(output)], hasMore: true })
    expect(await paginate({ fetchPage, parsePage, want: 100, maxPages: 10 })).toEqual({ items: [1, 2], truncated: true })
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })
})

describe('loadForgeOverview (#2222)', () => {
  type Status = { kind: string; reason?: string }
  const make = (over: Record<string, unknown> = {}, branch = 'feat/x\n') => {
    const raw = jest.fn(async () => branch)
    const detect = jest.fn(async () => ({ slug: 'o/r' }) as { slug: string } | undefined)
    const probe = jest.fn(async (): Promise<Status> => ({ kind: 'ok' }))
    const fetch = jest.fn(async (_project: unknown, current: string | undefined) => ({ pr: { number: 7, head: current } }))
    const params = {
      git: { raw },
      detect,
      notDetectedMessage: 'No forge remote found.',
      probe,
      describeStatus: (status: Status) => `Not signed in (${status.reason})`,
      repository: (project: { slug: string }) => project.slug,
      requireCurrentBranch: true,
      fetch,
      fetchErrorMessage: (current: string | undefined) => `No pull request for ${current ?? 'HEAD'}.`,
      ...over,
    }
    return { params: params as never, raw, detect, probe, fetch }
  }

  it('reads the current branch with git and trims it', async () => {
    const { params, raw } = make()
    const result = await loadForgeOverview(params)
    expect(raw).toHaveBeenCalledWith(['branch', '--show-current'])
    expect(result.currentBranch).toBe('feat/x')
  })

  it('reports not detected with the branch it found', async () => {
    const { params, probe } = make({ detect: jest.fn(async () => undefined) })
    expect(await loadForgeOverview(params)).toEqual({
      available: false,
      authenticated: false,
      currentBranch: 'feat/x',
      message: 'No forge remote found.',
    })
    expect(probe).not.toHaveBeenCalled()
  })

  it('reports not signed in with the reason, the repository and the branch', async () => {
    const { params, fetch } = make({ probe: jest.fn(async () => ({ kind: 'unauthenticated', reason: 'run glab auth login' })) })
    expect(await loadForgeOverview(params)).toEqual({
      available: true,
      authenticated: false,
      repository: 'o/r',
      currentBranch: 'feat/x',
      message: 'Not signed in (run glab auth login)',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  describe('no current branch (a detached HEAD)', () => {
    it('stops with "No current branch." when the forge needs one, without fetching', async () => {
      const { params, fetch } = make({ requireCurrentBranch: true }, '\n')
      expect(await loadForgeOverview(params)).toEqual({
        available: true,
        authenticated: true,
        repository: 'o/r',
        message: 'No current branch.',
      })
      expect(fetch).not.toHaveBeenCalled()
    })

    it('still fetches, with an undefined branch, when the forge handles that itself (GitHub)', async () => {
      const { params, fetch } = make({ requireCurrentBranch: false }, '')
      const result = await loadForgeOverview(params)
      expect(fetch).toHaveBeenCalledWith({ slug: 'o/r' }, undefined)
      expect(result).toMatchObject({ available: true, authenticated: true, currentBranch: undefined })
    })
  })

  it('merges what the fetch returned when everything is fine', async () => {
    const { params, fetch } = make()
    expect(await loadForgeOverview(params)).toEqual({
      available: true,
      authenticated: true,
      repository: 'o/r',
      currentBranch: 'feat/x',
      pr: { number: 7, head: 'feat/x' },
    })
    expect(fetch).toHaveBeenCalledWith({ slug: 'o/r' }, 'feat/x')
  })

  it('reports a failed fetch with the error message, and the branch', async () => {
    const { params } = make({ fetch: jest.fn(async () => { throw new Error('HTTP 404') }) })
    expect(await loadForgeOverview(params)).toEqual({
      available: true,
      authenticated: true,
      repository: 'o/r',
      currentBranch: 'feat/x',
      message: 'HTTP 404',
    })
  })

  it('falls back to a message built from the branch when something that is not an Error was thrown', async () => {
    const { params } = make({ fetch: jest.fn(async () => { throw 'nope' }) })
    expect((await loadForgeOverview(params)).message).toBe('No pull request for feat/x.')
  })

  it('looks up the forge and the branch together, not one after the other', async () => {
    const order: string[] = []
    const { params } = make({
      detect: jest.fn(async () => { order.push('detect:start'); await Promise.resolve(); order.push('detect:end'); return { slug: 'o/r' } }),
      git: { raw: jest.fn(async () => { order.push('branch'); return 'main' }) },
    })
    await loadForgeOverview(params)
    // The branch read starts before detect finishes.
    expect(order.indexOf('branch')).toBeLessThan(order.indexOf('detect:end'))
  })
})
