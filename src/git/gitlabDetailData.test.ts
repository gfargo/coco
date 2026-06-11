import { getGitLabIssueDetail, getMergeRequestDetail, __test } from './gitlabDetailData'

const { parseNotes, parseApprovalsAsReviews, parsePipelineAsChecks } = __test

describe('GitLab detail parsing (#0.70)', () => {
  it('keeps real comments and drops system notes', () => {
    const notes = JSON.stringify([
      { body: 'looks good', created_at: 't1', system: false, author: { username: 'alice' } },
      { body: 'changed milestone', created_at: 't2', system: true, author: { username: 'bot' } },
      { body: '  ', created_at: 't3', system: false, author: { username: 'x' } },
    ])
    expect(parseNotes(notes)).toEqual([{ author: 'alice', body: 'looks good', createdAt: 't1' }])
  })

  it('maps approvals to APPROVED reviews', () => {
    const approvals = { approved_by: [{ user: { username: 'bob' } }, { user: { username: 'carol' } }] }
    expect(parseApprovalsAsReviews(approvals)).toEqual([
      { author: 'bob', state: 'APPROVED', body: '', submittedAt: '' },
      { author: 'carol', state: 'APPROVED', body: '', submittedAt: '' },
    ])
  })

  it('maps a head pipeline to a status check and normalizes GitLab status to the renderer vocabulary', () => {
    expect(parsePipelineAsChecks({ status: 'success' })).toEqual([
      { name: 'pipeline', status: 'success', conclusion: 'success' },
    ])
    // GitLab vocabulary -> the GitHub conclusion words the inspector buckets on.
    expect(parsePipelineAsChecks({ status: 'failed' })[0].conclusion).toBe('failure')
    expect(parsePipelineAsChecks({ status: 'running' })[0].conclusion).toBe('in_progress')
    expect(parsePipelineAsChecks({ status: 'canceled' })[0].conclusion).toBe('cancelled')
    expect(parsePipelineAsChecks({ status: 'pending' })[0].conclusion).toBe('pending')
    // Raw status is preserved for reference.
    expect(parsePipelineAsChecks({ status: 'failed' })[0].status).toBe('failed')
    expect(parsePipelineAsChecks(null)).toEqual([])
  })

  it('treats a non-array notes body as no comments (no cryptic throw)', () => {
    expect(parseNotes(JSON.stringify({ message: '404 Not Found' }))).toEqual([])
    expect(parseNotes('')).toEqual([])
  })
})

describe('getMergeRequestDetail / getGitLabIssueDetail (#0.70)', () => {
  it('assembles MR detail from the fan-out endpoints', async () => {
    const runner = async (args: string[]): Promise<string> => {
      const endpoint = args[1]
      if (endpoint.includes('/notes')) {
        return JSON.stringify([{ body: 'c1', created_at: 't', system: false, author: { username: 'a' } }])
      }
      if (endpoint.endsWith('/approvals')) {
        return JSON.stringify({ approved_by: [{ user: { username: 'b' } }] })
      }
      // the MR itself
      return JSON.stringify({ description: 'body text', head_pipeline: { status: 'failed' } })
    }
    const result = await getMergeRequestDetail('group/proj', 42, runner)
    expect(result).toEqual({
      ok: true,
      detail: {
        number: 42,
        body: 'body text',
        comments: [{ author: 'a', body: 'c1', createdAt: 't' }],
        reviews: [{ author: 'b', state: 'APPROVED', body: '', submittedAt: '' }],
        statusCheckRollup: [{ name: 'pipeline', status: 'failed', conclusion: 'failure' }],
      },
    })
  })

  it('paginates notes beyond one page (long discussion threads not truncated)', async () => {
    const mkNotes = (start: number, count: number) =>
      JSON.stringify(
        Array.from({ length: count }, (_, i) => ({
          body: `c${start + i}`,
          created_at: 't',
          system: false,
          author: { username: 'a' },
        }))
      )
    let notesPage = 0
    const runner = async (args: string[]): Promise<string> => {
      const endpoint = args[1]
      if (endpoint.includes('/notes')) {
        notesPage += 1
        // 100 on page 1 (full → keep paging), 5 on page 2 (short → stop).
        return notesPage === 1 ? mkNotes(1, 100) : mkNotes(101, 5)
      }
      if (endpoint.endsWith('/approvals')) return JSON.stringify({ approved_by: [] })
      return JSON.stringify({ description: 'b', head_pipeline: { status: 'success' } })
    }
    const result = await getMergeRequestDetail('group/proj', 1, runner)
    expect(result.ok).toBe(true)
    expect(result.ok && result.detail.comments).toHaveLength(105)
    expect(notesPage).toBe(2)
  })

  it('assembles issue detail from issue + notes', async () => {
    const runner = async (args: string[]): Promise<string> => {
      const endpoint = args[1]
      if (endpoint.includes('/notes')) {
        return JSON.stringify([{ body: 'hi', created_at: 't', system: false, author: { username: 'a' } }])
      }
      return JSON.stringify({ description: 'issue body' })
    }
    const result = await getGitLabIssueDetail('group/proj', 7, runner)
    expect(result).toEqual({
      ok: true,
      detail: { number: 7, body: 'issue body', comments: [{ author: 'a', body: 'hi', createdAt: 't' }] },
    })
  })
})
