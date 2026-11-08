import { createGiteaReviewComments } from './giteaReviewComments'
import type { ReviewCommentInput } from './pullRequestReviewComments'

type RunnerCall = { endpoint: string; method?: string; body?: string }

/** Sequenced fake Gitea runner: each call consumes the next entry in `script`. */
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
  return Object.assign(new Error('Gitea API error 422: {"message":"the position is not part of the diff"}'), {
    status: 422,
  })
}

describe('createGiteaReviewComments (OSS-2407)', () => {
  it('returns ok:false for an empty comment list without calling the runner', async () => {
    const { calls, runner } = scriptedRunner([])
    const result = await createGiteaReviewComments('o/r', 7, [], {}, runner)
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('posts the whole batch as a single review', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 10, body: 'finding' }]
    const { calls, runner } = scriptedRunner(['{}'])
    const result = await createGiteaReviewComments('o/r', 7, comments, {}, runner)

    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('repos/o/r/pulls/7/reviews')
    expect(calls[0].method).toBe('POST')
    const parsed = JSON.parse(calls[0].body ?? '{}')
    expect(parsed.event).toBe('COMMENT')
    expect(parsed.comments).toEqual([{ path: 'a.ts', body: 'finding', new_position: 10 }])
  })

  it('maps side: LEFT to old_position', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 4, side: 'LEFT', body: 'finding' }]
    const { calls, runner } = scriptedRunner(['{}'])
    await createGiteaReviewComments('o/r', 7, comments, {}, runner)

    const parsed = JSON.parse(calls[0].body ?? '{}')
    expect(parsed.comments[0]).toEqual({ path: 'a.ts', body: 'finding', old_position: 4 })
  })

  it('retries per-comment and falls back to a plain note when the batch anchor is rejected', async () => {
    const comments: ReviewCommentInput[] = [
      { path: 'a.ts', line: 10, body: 'finding A' },
      { path: 'b.ts', line: 20, body: 'finding B' },
    ]
    const { calls, runner } = scriptedRunner([
      anchorRejection(), // batch POST
      '{}', // per-comment retry for A succeeds
      anchorRejection(), // per-comment retry for B fails
      '{}', // fallback note for B succeeds
    ])
    const result = await createGiteaReviewComments('o/r', 7, comments, {}, runner)

    expect(result.ok).toBe(true)
    expect(result.details?.some((line) => line.includes('b.ts:20') && line.includes('fallback'))).toBe(true)
    expect(calls).toHaveLength(4)
    expect(calls[3].endpoint).toBe('repos/o/r/issues/7/comments')
    expect(JSON.parse(calls[3].body ?? '{}').body).toContain('b.ts:20')
  })

  it('reports ok:false when the batch fails for a non-anchor reason', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 10, body: 'finding' }]
    const { calls, runner } = scriptedRunner([Object.assign(new Error('network down'), { status: 503 })])
    const result = await createGiteaReviewComments('o/r', 7, comments, {}, runner)

    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(1)
  })
})
