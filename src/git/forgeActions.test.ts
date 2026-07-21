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
  it('returns a complete facade for github, gitlab, bitbucket, and gitea', () => {
    for (const provider of ['github', 'gitlab', 'bitbucket', 'gitea', 'unsupported', undefined] as const) {
      const forge = getForgeActions(provider, { gitlabPath: 'g/p', bitbucketPath: 'ws/repo', giteaPath: 'o/r', giteaHost: 'codeberg.org' })
      for (const key of METHOD_KEYS) {
        expect(typeof forge[key]).toBe('function')
      }
    }
  })

  it('defaults non-gitlab/bitbucket/gitea providers to the same (GitHub) facade', () => {
    // github / GHE / unsupported all keep the gh implementations.
    expect(getForgeActions('github')).toBe(getForgeActions('unsupported'))
    expect(getForgeActions('github')).not.toBe(getForgeActions('gitlab', { gitlabPath: 'g/p' }))
  })

  it('GitLab detail loaders fail gracefully without a resolved project path', async () => {
    const forge = getForgeActions('gitlab', {})
    expect((await forge.getPullRequestDetail(1)).ok).toBe(false)
    expect((await forge.getIssueDetail(1)).ok).toBe(false)
  })

  it('Bitbucket detail loaders fail gracefully without a resolved project path', async () => {
    const forge = getForgeActions('bitbucket', {})
    expect((await forge.getPullRequestDetail(1)).ok).toBe(false)
    expect((await forge.getIssueDetail(1)).ok).toBe(false)
  })

  it('Gitea detail loaders fail gracefully without a resolved project path', async () => {
    const forge = getForgeActions('gitea', {})
    expect((await forge.getPullRequestDetail(1)).ok).toBe(false)
    expect((await forge.getIssueDetail(1)).ok).toBe(false)
    expect((await forge.getPullRequestDiffByNumber(1)).ok).toBe(false)
  })

  it('Gitea checkout is a graceful unsupported stub', async () => {
    const forge = getForgeActions('gitea', { giteaPath: 'o/r', giteaHost: 'codeberg.org' })
    const result = await forge.checkoutPullRequestByNumber(1)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('not supported for Gitea')
  })
})
