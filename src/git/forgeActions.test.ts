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
  'getPullRequestChecks',
  'rerunFailedChecks',
  'enableAutoMerge',
  'markPullRequestReadyByNumber',
  'reopenPullRequestByNumber',
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
  'createIssue',
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
    expect((await forge.getPullRequestDiffByNumber(1)).ok).toBe(false)
    expect((await forge.createIssue({ title: 't', body: 'b' })).ok).toBe(false)
  })

  it('Gitea detail loaders fail gracefully without a resolved project path', async () => {
    const forge = getForgeActions('gitea', {})
    expect((await forge.getPullRequestDetail(1)).ok).toBe(false)
    expect((await forge.getIssueDetail(1)).ok).toBe(false)
    expect((await forge.getPullRequestDiffByNumber(1)).ok).toBe(false)
    expect((await forge.createIssue({ title: 't', body: 'b' })).ok).toBe(false)
  })

  it('Gitea checkout is a graceful unsupported stub', async () => {
    const forge = getForgeActions('gitea', { giteaPath: 'o/r', giteaHost: 'codeberg.org' })
    const result = await forge.checkoutPullRequestByNumber(1)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('not supported for Gitea')
  })

  describe('CI-checks facade (OSS-1615)', () => {
    it('GitLab checks/rerun/auto-merge fail gracefully without a resolved project path', async () => {
      const forge = getForgeActions('gitlab', {})
      expect((await forge.getPullRequestChecks(1)).ok).toBe(false)
      expect((await forge.rerunFailedChecks(1)).ok).toBe(false)
      expect((await forge.enableAutoMerge(1, 'merge')).ok).toBe(false)
    })

    it('Gitea checks/auto-merge fail gracefully without a resolved project path', async () => {
      const forge = getForgeActions('gitea', {})
      expect((await forge.getPullRequestChecks(1)).ok).toBe(false)
      expect((await forge.enableAutoMerge(1, 'merge')).ok).toBe(false)
    })

    it('Gitea rerun is an explicit unsupported stub regardless of project path', async () => {
      const forge = getForgeActions('gitea', { giteaPath: 'o/r', giteaHost: 'codeberg.org' })
      const result = await forge.rerunFailedChecks(1)
      expect(result.ok).toBe(false)
      expect(result.message).toContain('not supported for Gitea')
    })

    it('Bitbucket rerun and auto-merge are explicit unsupported stubs', async () => {
      const forge = getForgeActions('bitbucket', { bitbucketPath: 'ws/repo' })
      const rerun = await forge.rerunFailedChecks(1)
      expect(rerun.ok).toBe(false)
      expect(rerun.message).toContain('not supported for Bitbucket')
      const autoMerge = await forge.enableAutoMerge(1, 'merge')
      expect(autoMerge.ok).toBe(false)
      expect(autoMerge.message).toContain('not supported for Bitbucket')
    })

    it('Bitbucket getPullRequestChecks fails gracefully without a resolved project path', async () => {
      const forge = getForgeActions('bitbucket', {})
      expect((await forge.getPullRequestChecks(1)).ok).toBe(false)
    })
  })

  it('Bitbucket reopen is a graceful unsupported stub (#1933)', async () => {
    const forge = getForgeActions('bitbucket', { bitbucketPath: 'ws/repo' })
    const result = await forge.reopenPullRequestByNumber(1)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('not supported')
  })

  it('GitLab markPullRequestReadyByNumber fails gracefully without a resolved project path (#1933)', async () => {
    const forge = getForgeActions('gitlab', {})
    expect((await forge.markPullRequestReadyByNumber(1)).ok).toBe(false)
  })

  it('Bitbucket by-number and issue mutations fail gracefully without a resolved project path', async () => {
    const forge = getForgeActions('bitbucket', {})
    const results = await Promise.all([
      forge.commentPullRequestByNumber(1, 'x'),
      forge.addPullRequestAssignee(1, 'u'),
      forge.mergePullRequestByNumber(1, 'merge'),
      forge.closePullRequestByNumber(1),
      forge.approvePullRequestByNumber(1),
      forge.requestChangesPullRequestByNumber(1, 'x'),
      forge.commentIssue(1, 'x'),
      forge.addIssueAssignee(1, 'u'),
      forge.closeIssue(1),
      forge.reopenIssue(1),
    ])
    for (const result of results) {
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/No Bitbucket project resolved/)
    }
  })

  it('Gitea by-number and issue mutations fail gracefully without a resolved project path', async () => {
    const forge = getForgeActions('gitea', {})
    const results = await Promise.all([
      forge.commentPullRequestByNumber(1, 'x'),
      forge.addPullRequestLabel(1, 'l'),
      forge.addPullRequestAssignee(1, 'u'),
      forge.mergePullRequestByNumber(1, 'merge'),
      forge.closePullRequestByNumber(1),
      forge.approvePullRequestByNumber(1),
      forge.requestChangesPullRequestByNumber(1, 'x'),
      forge.commentIssue(1, 'x'),
      forge.addIssueLabel(1, 'l'),
      forge.addIssueAssignee(1, 'u'),
      forge.closeIssue(1),
      forge.reopenIssue(1),
    ])
    for (const result of results) {
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/No Gitea project resolved/)
    }
  })

  it('Gitea mutations fail gracefully with a path but no resolved host, without throwing', async () => {
    const forge = getForgeActions('gitea', { giteaPath: 'o/r' })
    await expect(forge.mergePullRequestByNumber(1, 'merge')).resolves.toMatchObject({ ok: false })
    await expect(forge.getPullRequestDetail(1)).resolves.toMatchObject({ ok: false })
  })
})
