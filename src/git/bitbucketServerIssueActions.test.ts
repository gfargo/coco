import {
  addBitbucketServerIssueAssignee,
  addBitbucketServerIssueLabel,
  closeBitbucketServerIssue,
  commentBitbucketServerIssue,
  createBitbucketServerIssue,
  reopenBitbucketServerIssue,
} from './bitbucketServerIssueActions'

// #2222. Bitbucket Server has no issue tracker (Jira is a separate product), so
// every issue mutation is an explicit "unsupported" result rather than a dead
// REST call. The forge adapter relies on that result shape, and on none of them
// ever throwing or touching the network, so it is pinned for all six.
describe('Bitbucket Server issue actions (#2222)', () => {
  const actions = {
    create: createBitbucketServerIssue,
    comment: commentBitbucketServerIssue,
    'add label': addBitbucketServerIssueLabel,
    'add assignee': addBitbucketServerIssueAssignee,
    close: closeBitbucketServerIssue,
    reopen: reopenBitbucketServerIssue,
  }

  it.each(Object.entries(actions))('%s resolves to an explicit not-ok result that says why', async (_name, action) => {
    const result = await action()
    expect(result.ok).toBe(false)
    expect(result.message).toBe('Issues are not supported on Bitbucket Server (no built-in issue tracker).')
  })

  it('never reaches for the network or the shell', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockImplementation((() => { throw new Error('network used') }) as never)
    try {
      await Promise.all(Object.values(actions).map((action) => action()))
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
