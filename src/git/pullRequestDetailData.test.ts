import {
  getPullRequestChecks,
  getPullRequestDetail,
  PULL_REQUEST_DETAIL_JSON_FIELDS,
} from './pullRequestDetailData'

describe('getPullRequestDetail', () => {
  it('invokes `gh pr view <#> --json …` with the centralized field list', async () => {
    const runner = jest.fn().mockResolvedValue(JSON.stringify({
      number: 962,
      body: 'fixed it',
      comments: [],
      reviews: [],
      statusCheckRollup: [],
    }))

    const result = await getPullRequestDetail(962, runner)

    expect(runner).toHaveBeenCalledWith([
      'pr',
      'view',
      '962',
      '--json',
      PULL_REQUEST_DETAIL_JSON_FIELDS,
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.detail).toEqual({
      number: 962,
      body: 'fixed it',
      comments: [],
      reviews: [],
      statusCheckRollup: [],
    })
  })

  it('parses reviews + status checks', async () => {
    const runner = jest.fn().mockResolvedValue(JSON.stringify({
      number: 1,
      body: '',
      comments: [],
      reviews: [
        { author: { login: 'a' }, state: 'APPROVED', body: 'lgtm', submittedAt: '2026-05-15T00:00:00Z' },
        { author: { login: 'b' }, state: 'CHANGES_REQUESTED', body: 'needs work', submittedAt: '2026-05-15T01:00:00Z' },
      ],
      statusCheckRollup: [
        { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
        { name: 'build', status: 'IN_PROGRESS' },
      ],
    }))

    const result = await getPullRequestDetail(1, runner)

    if (!result.ok) throw new Error('expected ok')
    expect(result.detail.reviews).toEqual([
      { author: 'a', state: 'APPROVED', body: 'lgtm', submittedAt: '2026-05-15T00:00:00Z' },
      { author: 'b', state: 'CHANGES_REQUESTED', body: 'needs work', submittedAt: '2026-05-15T01:00:00Z' },
    ])
    expect(result.detail.statusCheckRollup).toEqual([
      { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'build', status: 'IN_PROGRESS', conclusion: undefined },
    ])
  })

  it('derives runId from an Actions check\'s detailsUrl (OSS-1615)', async () => {
    const runner = jest.fn().mockResolvedValue(JSON.stringify({
      number: 1,
      body: '',
      comments: [],
      reviews: [],
      statusCheckRollup: [
        {
          name: 'test',
          conclusion: 'FAILURE',
          detailsUrl: 'https://github.com/acme/widgets/actions/runs/4242/job/1000',
        },
        // A legacy commit status has no backing workflow run — no runId.
        { name: 'ci/circleci', state: 'FAILURE', detailsUrl: 'https://circleci.com/gh/acme/widgets/1' },
      ],
    }))

    const result = await getPullRequestDetail(1, runner)

    if (!result.ok) throw new Error('expected ok')
    expect(result.detail.statusCheckRollup[0].runId).toBe('4242')
    expect(result.detail.statusCheckRollup[1].runId).toBeUndefined()
  })

  it('strips reviews whose author is missing AND whose body is empty', async () => {
    // Deleted-account reviews come back without an author. If the body
    // is also empty there's nothing to render, so filtering them out
    // keeps the inspector from showing anonymous "@anonymous ()" rows.
    const runner = jest.fn().mockResolvedValue(JSON.stringify({
      number: 1,
      body: '',
      comments: [],
      reviews: [
        { author: null, state: 'COMMENTED', body: '', submittedAt: '' },
        { author: null, state: 'COMMENTED', body: 'still useful', submittedAt: '' },
      ],
      statusCheckRollup: [],
    }))

    const result = await getPullRequestDetail(1, runner)
    if (!result.ok) throw new Error('expected ok')
    expect(result.detail.reviews).toHaveLength(1)
    expect(result.detail.reviews[0].body).toBe('still useful')
  })

  it('defaults missing optional fields gracefully', async () => {
    const runner = jest.fn().mockResolvedValue(JSON.stringify({ number: 1 }))
    const result = await getPullRequestDetail(1, runner)

    if (!result.ok) throw new Error('expected ok')
    expect(result.detail).toEqual({
      number: 1,
      body: '',
      comments: [],
      reviews: [],
      statusCheckRollup: [],
    })
  })

  it('surfaces runner errors as ok: false', async () => {
    const runner = jest.fn().mockRejectedValue(new Error('not authenticated'))
    await expect(getPullRequestDetail(1, runner)).resolves.toEqual({
      ok: false,
      message: 'not authenticated',
    })
  })
})

describe('getPullRequestChecks (OSS-1615)', () => {
  it('fetches only the statusCheckRollup field', async () => {
    const runner = jest.fn().mockResolvedValue(JSON.stringify({
      statusCheckRollup: [{ name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    }))

    const result = await getPullRequestChecks(962, runner)

    expect(runner).toHaveBeenCalledWith(['pr', 'view', '962', '--json', 'statusCheckRollup'])
    expect(result).toEqual({
      ok: true,
      checks: [{ name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    })
  })

  it('returns an empty list for a blank response', async () => {
    const runner = jest.fn().mockResolvedValue('')
    await expect(getPullRequestChecks(1, runner)).resolves.toEqual({ ok: true, checks: [] })
  })

  it('surfaces runner errors as ok: false', async () => {
    const runner = jest.fn().mockRejectedValue(new Error('not authenticated'))
    await expect(getPullRequestChecks(1, runner)).resolves.toEqual({
      ok: false,
      message: 'not authenticated',
    })
  })
})
