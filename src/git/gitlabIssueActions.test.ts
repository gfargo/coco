import {
  addGitLabIssueAssignee,
  addGitLabIssueLabel,
  closeGitLabIssue,
  commentGitLabIssue,
  reopenGitLabIssue,
} from './gitlabIssueActions'

function capturingRunner(): { calls: string[][]; runner: (a: string[]) => Promise<string> } {
  const calls: string[][] = []
  return { calls, runner: async (a: string[]) => { calls.push(a); return '' } }
}

describe('GitLab issue action arg contracts (#0.70)', () => {
  it('builds glab issue verbs', async () => {
    const { calls, runner } = capturingRunner()
    await commentGitLabIssue(7, 'hi', runner)
    await addGitLabIssueLabel(7, 'bug', runner)
    await addGitLabIssueAssignee(7, 'bob', runner)
    await closeGitLabIssue(7, runner)
    await reopenGitLabIssue(7, runner)
    expect(calls).toEqual([
      ['issue', 'note', '7', '--message', 'hi'],
      ['issue', 'update', '7', '--label', 'bug'],
      ['issue', 'update', '7', '--assignee', 'bob'],
      ['issue', 'close', '7'],
      ['issue', 'reopen', '7'],
    ])
  })

  it('rejects empty inputs without shelling out', async () => {
    const { calls } = capturingRunner()
    expect((await commentGitLabIssue(7, '   ')).ok).toBe(false)
    expect((await addGitLabIssueLabel(7, '')).ok).toBe(false)
    expect((await addGitLabIssueAssignee(7, '')).ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('surfaces a recovery hint when glab is missing', async () => {
    const runner = async () => {
      throw Object.assign(new Error('x'), { code: 'ENOENT' })
    }
    const result = await closeGitLabIssue(7, runner)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('glab')
  })
})
