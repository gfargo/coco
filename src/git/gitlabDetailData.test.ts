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

  it('maps a head pipeline to a status check', () => {
    expect(parsePipelineAsChecks({ status: 'success' })).toEqual([
      { name: 'pipeline', status: 'success', conclusion: 'success' },
    ])
    expect(parsePipelineAsChecks(null)).toEqual([])
  })
})

describe('getMergeRequestDetail / getGitLabIssueDetail (#0.70)', () => {
  it('assembles MR detail from the fan-out endpoints', async () => {
    const runner = async (args: string[]): Promise<string> => {
      const endpoint = args[1]
      if (endpoint.endsWith('/notes')) {
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
        statusCheckRollup: [{ name: 'pipeline', status: 'failed', conclusion: 'failed' }],
      },
    })
  })

  it('assembles issue detail from issue + notes', async () => {
    const runner = async (args: string[]): Promise<string> => {
      const endpoint = args[1]
      if (endpoint.endsWith('/notes')) {
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
