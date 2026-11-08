import { createBitbucketServerReviewComments } from './bitbucketServerReviewComments'
import type { ReviewCommentInput } from './pullRequestReviewComments'

type RunnerCall = { endpoint: string; method?: string; body?: string }

/** Sequenced fake Bitbucket Server runner: each call consumes the next entry in `script`. */
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
  return Object.assign(new Error('Bitbucket Server API error 409: {"errors":[{"message":"the anchor is outdated"}]}'), {
    status: 409,
  })
}

describe('createBitbucketServerReviewComments (OSS-2407)', () => {
  it('returns ok:false for an empty comment list without calling the runner', async () => {
    const { calls, runner } = scriptedRunner([])
    const result = await createBitbucketServerReviewComments('PROJ/repo', 9, [], {}, runner)
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('fails gracefully for an unparseable project path, without calling the runner', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 10, body: 'finding' }]
    const { calls, runner } = scriptedRunner([])
    const result = await createBitbucketServerReviewComments('', 9, comments, {}, runner)
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('posts a comment with the anchor object for a RIGHT-side finding', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 10, body: 'finding' }]
    const { calls, runner } = scriptedRunner(['{}'])
    const result = await createBitbucketServerReviewComments('PROJ/repo', 9, comments, {}, runner)

    expect(result.ok).toBe(true)
    expect(calls[0].endpoint).toBe('projects/PROJ/repos/repo/pull-requests/9/comments')
    const parsed = JSON.parse(calls[0].body ?? '{}')
    expect(parsed.text).toBe('finding')
    expect(parsed.anchor).toEqual({ path: 'a.ts', line: 10, lineType: 'ADDED', fileType: 'TO', diffType: 'EFFECTIVE' })
  })

  it('maps side: LEFT to REMOVED/FROM', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 6, side: 'LEFT', body: 'finding' }]
    const { calls, runner } = scriptedRunner(['{}'])
    await createBitbucketServerReviewComments('PROJ/repo', 9, comments, {}, runner)

    const parsed = JSON.parse(calls[0].body ?? '{}')
    expect(parsed.anchor).toEqual({ path: 'a.ts', line: 6, lineType: 'REMOVED', fileType: 'FROM', diffType: 'EFFECTIVE' })
  })

  it('falls back to a plain comment (no anchor) when the anchor is rejected', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 10, body: 'finding' }]
    const { calls, runner } = scriptedRunner([anchorRejection(), '{}'])
    const result = await createBitbucketServerReviewComments('PROJ/repo', 9, comments, {}, runner)

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    const fallbackBody = JSON.parse(calls[1].body ?? '{}')
    expect(fallbackBody.anchor).toBeUndefined()
    expect(fallbackBody.text).toContain('a.ts:10')
  })

  it('reports ok:false when every comment fails and the fallback also fails', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 10, body: 'finding' }]
    const { runner } = scriptedRunner([anchorRejection(), anchorRejection()])
    const result = await createBitbucketServerReviewComments('PROJ/repo', 9, comments, {}, runner)

    expect(result.ok).toBe(false)
  })
})
