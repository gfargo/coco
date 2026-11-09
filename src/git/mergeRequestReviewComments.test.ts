import { createMergeRequestReviewComments } from './mergeRequestReviewComments'
import type { ReviewCommentInput } from './pullRequestReviewComments'

const DIFF_REFS = JSON.stringify({
  diff_refs: { base_sha: 'base123', start_sha: 'start123', head_sha: 'head123' },
})

/** Sequenced fake glab runner: each call consumes the next entry in `script`. */
function scriptedRunner(script: Array<string | Error>): { calls: string[][]; runner: (args: string[]) => Promise<string> } {
  const calls: string[][] = []
  let i = 0
  const runner = async (args: string[]) => {
    calls.push(args)
    const next = script[i++]
    if (next instanceof Error) throw next
    return next ?? ''
  }
  return { calls, runner }
}

function anchorRejection(): Error {
  return Object.assign(new Error('Command failed: glab api ...'), {
    stderr: '422 Unprocessable Entity: Note position is invalid',
  })
}

describe('createMergeRequestReviewComments (OSS-2407)', () => {
  it('returns ok:false for an empty comment list without calling the runner', async () => {
    const { calls, runner } = scriptedRunner([])
    const result = await createMergeRequestReviewComments('g/p', 3, [], {}, runner)
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('posts a discussion per comment with the full position object', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 10, body: 'finding' }]
    const { calls, runner } = scriptedRunner([DIFF_REFS, '{}'])
    const result = await createMergeRequestReviewComments('g/p', 3, comments, {}, runner)

    expect(result.ok).toBe(true)
    expect(calls[0]).toEqual(['api', `projects/${encodeURIComponent('g/p')}/merge_requests/3`])
    const discussionArgs = calls[1]
    expect(discussionArgs[3]).toBe(`projects/${encodeURIComponent('g/p')}/merge_requests/3/discussions`)
    expect(discussionArgs).toContain('-f')
    expect(discussionArgs).toContain('body=finding')
    expect(discussionArgs).toContain('position[position_type]=text')
    expect(discussionArgs).toContain('position[base_sha]=base123')
    expect(discussionArgs).toContain('position[start_sha]=start123')
    expect(discussionArgs).toContain('position[head_sha]=head123')
    expect(discussionArgs).toContain('position[new_path]=a.ts')
    expect(discussionArgs).toContain('position[new_line]=10')
  })

  it('maps side: LEFT to old_path/old_line', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 5, side: 'LEFT', body: 'finding' }]
    const { calls, runner } = scriptedRunner([DIFF_REFS, '{}'])
    await createMergeRequestReviewComments('g/p', 3, comments, {}, runner)

    expect(calls[1]).toContain('position[old_path]=a.ts')
    expect(calls[1]).toContain('position[old_line]=5')
    expect(calls[1]).not.toContain('position[new_path]=a.ts')
  })

  it('fails without posting any discussion when diff_refs cannot be resolved', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 10, body: 'finding' }]
    const { calls, runner } = scriptedRunner([JSON.stringify({})])
    const result = await createMergeRequestReviewComments('g/p', 3, comments, {}, runner)

    expect(result.ok).toBe(false)
    expect(result.message).toContain('diff refs')
    expect(calls).toHaveLength(1)
  })

  it('falls back to a plain note when the anchor is rejected, and still reports ok:true', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 10, body: 'finding' }]
    const { calls, runner } = scriptedRunner([DIFF_REFS, anchorRejection(), 'noted'])
    const result = await createMergeRequestReviewComments('g/p', 3, comments, {}, runner)

    expect(result.ok).toBe(true)
    expect(result.details?.some((line) => line.includes('fallback'))).toBe(true)
    const noteArgs = calls[2]
    expect(noteArgs[0]).toBe('mr')
    expect(noteArgs[1]).toBe('note')
    expect(noteArgs.join(' ')).toContain('a.ts:10')
  })

  it('reports ok:false when every comment fails and the fallback also fails', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 10, body: 'finding' }]
    const { runner } = scriptedRunner([DIFF_REFS, anchorRejection(), anchorRejection()])
    const result = await createMergeRequestReviewComments('g/p', 3, comments, {}, runner)

    expect(result.ok).toBe(false)
  })

  it('posts a trailing "Requested changes" note for REQUEST_CHANGES', async () => {
    const comments: ReviewCommentInput[] = [{ path: 'a.ts', line: 10, body: 'finding' }]
    const { calls, runner } = scriptedRunner([DIFF_REFS, '{}', 'noted'])
    await createMergeRequestReviewComments('g/p', 3, comments, { event: 'REQUEST_CHANGES', body: 'please fix' }, runner)

    const trailing = calls[2]
    expect(trailing.join(' ')).toContain('Requested changes: please fix')
  })
})
