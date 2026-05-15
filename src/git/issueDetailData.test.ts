import { getIssueDetail, ISSUE_DETAIL_JSON_FIELDS } from './issueDetailData'

describe('getIssueDetail', () => {
  it('invokes `gh issue view <#> --json body,comments,...` with the centralized field list', async () => {
    const runner = jest.fn().mockResolvedValue(JSON.stringify({
      number: 882,
      body: 'A pair of new top-level commands…',
      comments: [],
    }))

    const result = await getIssueDetail(882, runner)

    expect(runner).toHaveBeenCalledWith([
      'issue',
      'view',
      '882',
      '--json',
      ISSUE_DETAIL_JSON_FIELDS,
    ])
    expect(result).toEqual({
      ok: true,
      detail: {
        number: 882,
        body: 'A pair of new top-level commands…',
        comments: [],
      },
    })
  })

  it('parses comment entries with author + body + createdAt', async () => {
    const runner = jest.fn().mockResolvedValue(JSON.stringify({
      number: 7,
      body: 'help wanted',
      comments: [
        {
          author: { login: 'reviewer-a' },
          body: 'taking a look',
          createdAt: '2026-05-15T01:00:00Z',
        },
        {
          author: { login: 'reviewer-b' },
          body: 'lgtm',
          createdAt: '2026-05-15T02:00:00Z',
        },
      ],
    }))

    const result = await getIssueDetail(7, runner)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.detail.comments).toEqual([
      { author: 'reviewer-a', body: 'taking a look', createdAt: '2026-05-15T01:00:00Z' },
      { author: 'reviewer-b', body: 'lgtm', createdAt: '2026-05-15T02:00:00Z' },
    ])
  })

  it('defaults missing fields to empty rather than crashing', async () => {
    const runner = jest.fn().mockResolvedValue(JSON.stringify({ number: 1 }))
    const result = await getIssueDetail(1, runner)

    expect(result).toEqual({
      ok: true,
      detail: { number: 1, body: '', comments: [] },
    })
  })

  it('returns ok: false with a descriptive message on empty gh output', async () => {
    const runner = jest.fn().mockResolvedValue('')
    const result = await getIssueDetail(1, runner)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('Empty response')
  })

  it('surfaces runner errors as ok: false', async () => {
    const runner = jest.fn().mockRejectedValue(new Error('rate limited'))
    const result = await getIssueDetail(1, runner)

    expect(result).toEqual({ ok: false, message: 'rate limited' })
  })

  it('returns ok: false when the payload lacks a numeric `number` field', async () => {
    // Defensive against a future gh shape change — if `number` ever
    // becomes a string we want to fail loudly here rather than
    // poisoning the cache with a junk entry.
    const runner = jest.fn().mockResolvedValue(JSON.stringify({ number: 'one' }))
    const result = await getIssueDetail(1, runner)

    expect(result.ok).toBe(false)
  })
})
