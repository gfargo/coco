import {
  addPullRequestAssignee,
  addPullRequestLabel,
  approvePullRequest,
  buildCreatePullRequestArgs,
  buildMergePullRequestArgs,
  closePullRequest,
  commentPullRequest,
  commentPullRequestByNumber,
  createPullRequest,
  isPullRequestMergeStrategy,
  mergePullRequest,
  openPullRequest,
  requestChangesPullRequest,
} from './pullRequestActions'

describe('log pull request actions', () => {
  it('builds ready and draft PR create commands', () => {
    expect(buildCreatePullRequestArgs({
      base: 'main',
      head: 'feature/pr',
      title: 'Add PR workflow',
      body: 'Generated body',
    })).toEqual([
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      'feature/pr',
      '--title',
      'Add PR workflow',
      '--body',
      'Generated body',
    ])

    expect(buildCreatePullRequestArgs({
      base: 'main',
      head: 'feature/pr',
      title: 'Add PR workflow',
      body: 'Generated body',
      draft: true,
    })).toContain('--draft')
  })

  it('creates and opens pull requests through gh', async () => {
    const runner = jest
      .fn()
      .mockResolvedValueOnce('https://github.com/gfargo/coco/pull/123\n')
      .mockResolvedValueOnce('')

    await expect(createPullRequest({
      base: 'main',
      head: 'feature/pr',
      title: 'Add PR workflow',
      body: 'Generated body',
    }, runner)).resolves.toEqual({
      ok: true,
      message: 'Created pull request: https://github.com/gfargo/coco/pull/123',
      url: 'https://github.com/gfargo/coco/pull/123',
    })
    await expect(openPullRequest('https://github.com/gfargo/coco/pull/123', runner)).resolves.toEqual({
      ok: true,
      message: 'Opened pull request: https://github.com/gfargo/coco/pull/123',
      url: 'https://github.com/gfargo/coco/pull/123',
    })
    expect(runner).toHaveBeenLastCalledWith(['pr', 'view', '--web'])
  })

  // #783 — full PR action panel. Each action wraps a single
  // `gh pr <verb>` invocation; failure surfaces via the standard
  // runner error path which `runGhAction` already covers.
  describe('PR action panel verbs (#783)', () => {
    it('builds merge args for each strategy', () => {
      expect(buildMergePullRequestArgs('merge')).toEqual(['pr', 'merge', '--merge'])
      expect(buildMergePullRequestArgs('squash')).toEqual(['pr', 'merge', '--squash'])
      expect(buildMergePullRequestArgs('rebase')).toEqual(['pr', 'merge', '--rebase'])
    })

    it('validates the merge strategy union', () => {
      expect(isPullRequestMergeStrategy('merge')).toBe(true)
      expect(isPullRequestMergeStrategy('squash')).toBe(true)
      expect(isPullRequestMergeStrategy('rebase')).toBe(true)
      expect(isPullRequestMergeStrategy('fastforward')).toBe(false)
      expect(isPullRequestMergeStrategy('')).toBe(false)
    })

    it('runs merge / close / approve through gh', async () => {
      const runner = jest.fn().mockResolvedValue('')

      await expect(mergePullRequest('squash', runner)).resolves.toEqual({
        ok: true,
        message: 'Merged pull request with squash',
      })
      expect(runner).toHaveBeenLastCalledWith(['pr', 'merge', '--squash'])

      await expect(closePullRequest(runner)).resolves.toEqual({
        ok: true,
        message: 'Closed pull request',
      })
      expect(runner).toHaveBeenLastCalledWith(['pr', 'close'])

      await expect(approvePullRequest(runner)).resolves.toEqual({
        ok: true,
        message: 'Approved pull request',
      })
      expect(runner).toHaveBeenLastCalledWith(['pr', 'review', '--approve'])
    })

    it('passes the body through for request-changes and comment', async () => {
      const runner = jest.fn().mockResolvedValue('')

      await expect(requestChangesPullRequest('please address X', runner)).resolves.toEqual({
        ok: true,
        message: 'Requested changes',
      })
      expect(runner).toHaveBeenLastCalledWith([
        'pr', 'review', '--request-changes', '--body', 'please address X',
      ])

      await expect(commentPullRequest('lgtm', runner)).resolves.toEqual({
        ok: true,
        message: 'Comment added',
      })
      expect(runner).toHaveBeenLastCalledWith(['pr', 'comment', '--body', 'lgtm'])
    })

    it('rejects empty bodies for request-changes and comment without invoking gh', async () => {
      const runner = jest.fn()

      await expect(requestChangesPullRequest('   ', runner)).resolves.toEqual({
        ok: false,
        message: 'Review body required for change-request',
      })
      await expect(commentPullRequest('', runner)).resolves.toEqual({
        ok: false,
        message: 'Comment body required',
      })
      expect(runner).not.toHaveBeenCalled()
    })

    it('surfaces gh runner errors as failed action results', async () => {
      const runner = jest.fn().mockRejectedValue(new Error('gh: not authenticated'))

      await expect(mergePullRequest('merge', runner)).resolves.toEqual({
        ok: false,
        message: 'gh: not authenticated',
      })
    })

    it('preserves trimmed gh stdout as the success message when present', async () => {
      const runner = jest.fn().mockResolvedValue('Merged pull request #42 (squash)\n')

      await expect(mergePullRequest('squash', runner)).resolves.toEqual({
        ok: true,
        message: 'Merged pull request #42 (squash)',
      })
    })
  })
})

describe('triage-by-number PR actions (#882 phase 4)', () => {
  describe('commentPullRequestByNumber', () => {
    it('rejects empty bodies without invoking gh', async () => {
      const runner = jest.fn()
      await expect(commentPullRequestByNumber(962, '   ', runner)).resolves.toEqual({
        ok: false,
        message: 'Comment body required',
      })
      expect(runner).not.toHaveBeenCalled()
    })

    it('targets a specific PR number, distinct from the current-branch variant', async () => {
      const runner = jest.fn().mockResolvedValue('')
      await expect(commentPullRequestByNumber(962, 'lgtm', runner)).resolves.toEqual({
        ok: true,
        message: 'Commented on pull request #962',
      })
      expect(runner).toHaveBeenCalledWith(['pr', 'comment', '962', '--body', 'lgtm'])
    })
  })

  describe('addPullRequestLabel', () => {
    it('rejects empty labels', async () => {
      const runner = jest.fn()
      await expect(addPullRequestLabel(1, '', runner)).resolves.toEqual({
        ok: false,
        message: 'Label name required',
      })
    })

    it('invokes `gh pr edit <#> --add-label <label>`', async () => {
      const runner = jest.fn().mockResolvedValue('')
      const result = await addPullRequestLabel(962, 'enhancement', runner)
      expect(result).toEqual({
        ok: true,
        message: "Added label 'enhancement' to pull request #962",
      })
      expect(runner).toHaveBeenCalledWith(['pr', 'edit', '962', '--add-label', 'enhancement'])
    })
  })

  describe('addPullRequestAssignee', () => {
    it('rejects empty assignees', async () => {
      const runner = jest.fn()
      await expect(addPullRequestAssignee(1, '   ', runner)).resolves.toEqual({
        ok: false,
        message: 'Assignee login required',
      })
    })

    it('invokes `gh pr edit <#> --add-assignee <login>`', async () => {
      const runner = jest.fn().mockResolvedValue('')
      await expect(addPullRequestAssignee(962, '@me', runner)).resolves.toEqual({
        ok: true,
        message: 'Assigned @me to pull request #962',
      })
      expect(runner).toHaveBeenCalledWith(['pr', 'edit', '962', '--add-assignee', '@me'])
    })

    it('surfaces gh errors as ok: false', async () => {
      const runner = jest.fn().mockRejectedValue(new Error('no such user'))
      await expect(addPullRequestAssignee(1, 'ghost', runner)).resolves.toEqual({
        ok: false,
        message: 'no such user',
      })
    })
  })
})
