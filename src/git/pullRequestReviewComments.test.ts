import { readFileSync, existsSync } from 'fs'
import { createPullRequestReviewComments, type ReviewCommentInput } from './pullRequestReviewComments'

// The payload file lives in a temp dir that's removed in a `finally` right
// after the runner resolves, so it must be read from inside the runner mock
// — reading it after `createPullRequestReviewComments` returns is too late.
function makeCapturingRunner(): { runner: jest.Mock; getPayload: () => unknown } {
  let payload: unknown
  const runner = jest.fn((args: string[]) => {
    const file = args[args.indexOf('--input') + 1]
    payload = JSON.parse(readFileSync(file, 'utf8'))
    return Promise.resolve('{}')
  })
  return { runner, getPayload: () => payload }
}

describe('createPullRequestReviewComments (OSS-2406)', () => {
  const comments: ReviewCommentInput[] = [
    { path: 'src/file.ts', line: 42, body: 'Finding body' },
  ]

  it('builds a gh api call posting to repos/{owner}/{repo}/pulls/{n}/reviews', async () => {
    const runner = jest.fn().mockResolvedValue('{}')

    await createPullRequestReviewComments(7, comments, undefined, runner)

    const args = runner.mock.calls[0][0] as string[]
    expect(args[0]).toBe('api')
    expect(args[1]).toBe('repos/{owner}/{repo}/pulls/7/reviews')
    expect(args).toContain('--method')
    expect(args[args.indexOf('--method') + 1]).toBe('POST')
    expect(args).toContain('--input')
  })

  it('defaults event to COMMENT and supplies a non-empty body', async () => {
    const { runner, getPayload } = makeCapturingRunner()

    await createPullRequestReviewComments(7, comments, undefined, runner)

    const payload = getPayload() as { event: string; body: string; comments: unknown[] }
    expect(payload.event).toBe('COMMENT')
    expect(payload.body.length).toBeGreaterThan(0)
    expect(payload.comments).toEqual([
      { path: 'src/file.ts', line: 42, side: 'RIGHT', body: 'Finding body' },
    ])
  })

  it('honors an explicit REQUEST_CHANGES event and body', async () => {
    const { runner, getPayload } = makeCapturingRunner()

    await createPullRequestReviewComments(
      7,
      comments,
      { event: 'REQUEST_CHANGES', body: 'Blocking findings' },
      runner
    )

    const payload = getPayload() as { event: string; body: string }
    expect(payload.event).toBe('REQUEST_CHANGES')
    expect(payload.body).toBe('Blocking findings')
  })

  it('defaults a comment with no side to RIGHT', async () => {
    const { runner, getPayload } = makeCapturingRunner()

    await createPullRequestReviewComments(7, [{ path: 'a.ts', line: 1, body: 'b' }], undefined, runner)

    const payload = getPayload() as { comments: { side: string }[] }
    expect(payload.comments[0].side).toBe('RIGHT')
  })

  it('preserves an explicit LEFT side', async () => {
    const { runner, getPayload } = makeCapturingRunner()

    await createPullRequestReviewComments(
      7,
      [{ path: 'a.ts', line: 1, side: 'LEFT', body: 'b' }],
      undefined,
      runner
    )

    const payload = getPayload() as { comments: { side: string }[] }
    expect(payload.comments[0].side).toBe('LEFT')
  })

  it('returns ok: false without calling the runner when comments is empty', async () => {
    const runner = jest.fn()

    const result = await createPullRequestReviewComments(7, [], undefined, runner)

    expect(result).toEqual({ ok: false, message: 'No inline review comments to post' })
    expect(runner).not.toHaveBeenCalled()
  })

  it('surfaces a runner rejection as ok: false instead of throwing', async () => {
    const runner = jest.fn((args: string[]) =>
      args[0] === 'auth'
        ? Promise.resolve('Logged in to github.com')
        : Promise.reject(new Error('Validation failed\nline must be part of the diff'))
    )

    const result = await createPullRequestReviewComments(7, comments, undefined, runner)

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Validation failed')
    expect(result.details).toEqual(['line must be part of the diff'])
  })

  it('removes the temp directory holding the payload on success', async () => {
    let capturedFile: string | undefined
    const runner = jest.fn((args: string[]) => {
      capturedFile = args[args.indexOf('--input') + 1]
      return Promise.resolve('{}')
    })

    await createPullRequestReviewComments(7, comments, undefined, runner)

    expect(capturedFile).toBeDefined()
    expect(existsSync(capturedFile as string)).toBe(false)
  })

  it('removes the temp directory holding the payload on failure', async () => {
    let capturedFile: string | undefined
    const runner = jest.fn((args: string[]) => {
      if (args[0] === 'auth') return Promise.resolve('Logged in to github.com')
      capturedFile = args[args.indexOf('--input') + 1]
      return Promise.reject(new Error('boom'))
    })

    await createPullRequestReviewComments(7, comments, undefined, runner)

    expect(capturedFile).toBeDefined()
    expect(existsSync(capturedFile as string)).toBe(false)
  })
})
