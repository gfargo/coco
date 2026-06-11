import { getForgeActions, type ForgeActions } from './forgeActions'

const METHOD_KEYS: (keyof ForgeActions)[] = [
  'getPullRequestList',
  'getIssueList',
  'getPullRequestDetail',
  'getIssueDetail',
  'commentPullRequestByNumber',
  'addPullRequestLabel',
  'addPullRequestAssignee',
  'mergePullRequestByNumber',
  'closePullRequestByNumber',
  'approvePullRequestByNumber',
  'requestChangesPullRequestByNumber',
  'mergePullRequest',
  'closePullRequest',
  'approvePullRequest',
  'commentPullRequest',
  'requestChangesPullRequest',
  'createPullRequest',
  'openPullRequest',
  'commentIssue',
  'addIssueLabel',
  'addIssueAssignee',
  'closeIssue',
  'reopenIssue',
]

describe('getForgeActions (#0.70)', () => {
  it('returns a complete facade for github and gitlab', () => {
    for (const provider of ['github', 'gitlab', 'unsupported', undefined] as const) {
      const forge = getForgeActions(provider, { gitlabPath: 'g/p' })
      for (const key of METHOD_KEYS) {
        expect(typeof forge[key]).toBe('function')
      }
    }
  })

  it('defaults non-gitlab providers to the same (GitHub) facade', () => {
    // github / GHE / unsupported all keep the gh implementations.
    expect(getForgeActions('github')).toBe(getForgeActions('unsupported'))
    expect(getForgeActions('github')).not.toBe(getForgeActions('gitlab', { gitlabPath: 'g/p' }))
  })

  it('GitLab detail loaders fail gracefully without a resolved project path', async () => {
    const forge = getForgeActions('gitlab', {})
    expect((await forge.getPullRequestDetail(1)).ok).toBe(false)
    expect((await forge.getIssueDetail(1)).ok).toBe(false)
  })
})
