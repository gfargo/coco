import { createBitbucketReviewComments } from './bitbucketReviewComments'
import type { ReviewCommentInput } from './pullRequestReviewComments'

type RunnerCall = { endpoint: string; method?: string; body?: string }

/** Sequenced fake Bitbucket runner: each call consumes the next entry in `script`. */
function scriptedRunner(script: Array<string | Error>): {
  calls: RunnerCall[]
  runner: (endpoint: string, opts?: { method?: string; body?: string }) => Promise<string>
} {
  const calls: RunnerCall[] = []
  let i = 0
  const runner = async (endpoint: string, opts?: { method?: string; body?: string }) => {
    calls.push({ endpoint, method: opts?.method, body: opts?.body })
    const next = script[i++]
    if (next instanceof Error) throw next
    return next ?? '{}'
  }
  return { calls, runner }
}

function anchorRejection(): Error {
  // Bitbucket Cloud returns 400 (not 422) for a bad inline anchor.
  return Object.assign(new Error('Bitbucket API error 400: {"error":{"message":"line is outside the diff"}}'), {
    status: 400,
  })
}

describe('createBitbucketReviewComments (OSS-2407)', () => {
  it('returns ok:false for an empty comment list without calling the runner', async () => {
    const { calls, runner } = scriptedRunner([])
    const result = await createBitbucketReviewComments('ws/repo', 5, [], {}, runner)
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('posts an inline comment for a valid single-line finding', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 10, body: 'finding' }]
    const { calls, runner } = scriptedRunner(['{}'])
    const result = await createBitbucketReviewComments('ws/repo', 5, comments, {}, runner)

    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('repositories/ws/repo/pullrequests/5/comments')
    const parsed = JSON.parse(calls[0].body ?? '{}')
    expect(parsed.content.raw).toBe('finding')
    expect(parsed.inline).toEqual({ path: 'a.ts', to: 10 })
  })

  it('maps side: LEFT to inline.from', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 3, side: 'LEFT', body: 'finding' }]
    const { calls, runner } = scriptedRunner(['{}'])
    await createBitbucketReviewComments('ws/repo', 5, comments, {}, runner)

    const parsed = JSON.parse(calls[0].body ?? '{}')
    expect(parsed.inline).toEqual({ path: 'a.ts', from: 3 })
  })

  it('skips a multi-line range with no HTTP call, and still posts the rest of the batch', async () => {
    const comments: ReviewCommentInput[] = [
      { path: 'a.ts', line: 12, startLine: 10, body: 'range finding' },
      { path: 'b.ts', line: 4, body: 'single-line finding' },
    ]
    const { calls, runner } = scriptedRunner(['{}'])
    const result = await createBitbucketReviewComments('ws/repo', 5, comments, {}, runner)

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].endpoint).toBe('repositories/ws/repo/pullrequests/5/comments')
    expect(JSON.parse(calls[0].body ?? '{}').inline).toEqual({ path: 'b.ts', to: 4 })
    expect(result.details?.some((line) => line.includes('a.ts:12') && line.includes('not supported for Bitbucket yet'))).toBe(
      true
    )
  })

  it('falls back to a plain comment when the anchor is rejected (400)', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 10, body: 'finding' }]
    const { calls, runner } = scriptedRunner([anchorRejection(), '{}'])
    const result = await createBitbucketReviewComments('ws/repo', 5, comments, {}, runner)

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    const fallbackBody = JSON.parse(calls[1].body ?? '{}')
    expect(fallbackBody.inline).toBeUndefined()
    expect(fallbackBody.content.raw).toContain('a.ts:10')
  })

  it('reports ok:false when every comment fails and the fallback also fails', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 10, body: 'finding' }]
    const { runner } = scriptedRunner([anchorRejection(), anchorRejection()])
    const result = await createBitbucketReviewComments('ws/repo', 5, comments, {}, runner)

    expect(result.ok).toBe(false)
  })
})
