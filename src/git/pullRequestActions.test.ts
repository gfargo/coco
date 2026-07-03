import {
  addPullRequestAssignee,
  addPullRequestLabel,
  approvePullRequest,
  approvePullRequestByNumber,
  buildCreatePullRequestArgs,
  buildMergePullRequestArgs,
  closePullRequest,
  closePullRequestByNumber,
  commentPullRequest,
  commentPullRequestByNumber,
  createPullRequest,
  isPullRequestMergeStrategy,
  mergePullRequest,
  mergePullRequestByNumber,
  openPullRequest,
  requestChangesPullRequest,
  requestChangesPullRequestByNumber,
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
      '--base=main',
      '--head=feature/pr',
      '--title=Add PR workflow',
      '--body=Generated body',
    ])

    // With a body file the body itself must stay out of argv — generated
    // bodies run long and get echoed back through failure messages.
    expect(buildCreatePullRequestArgs({
      base: 'main',
      head: 'feature/pr',
      title: 'Add PR workflow',
      body: 'Generated body',
    }, '/tmp/coco-pr-x/body.md')).toEqual([
      'pr',
      'create',
      '--base=main',
      '--head=feature/pr',
      '--title=Add PR workflow',
      '--body-file=/tmp/coco-pr-x/body.md',
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

    // The create call passes the body via --body-file, never inline.
    const createArgs = runner.mock.calls[0][0] as string[]
    expect(createArgs.some((arg) => arg.startsWith('--body-file='))).toBe(true)
    expect(createArgs.some((arg) => arg.startsWith('--body='))).toBe(false)
    await expect(openPullRequest('https://github.com/gfargo/coco/pull/123', runner)).resolves.toEqual({
      ok: true,
      message: 'Opened pull request: https://github.com/gfargo/coco/pull/123',
      url: 'https://github.com/gfargo/coco/pull/123',
    })
    expect(runner).toHaveBeenLastCalledWith(['pr', 'view', '--web'])
  })

  it('rejects flag-like branch names on create without invoking gh', async () => {
    const runner = jest.fn()
    expect((await createPullRequest({ base: 'main', head: '--foo', title: 'T', body: 'B' }, runner)).ok).toBe(false)
    expect((await createPullRequest({ base: '-x', head: 'feature/pr', title: 'T', body: 'B' }, runner)).ok).toBe(false)
    expect(runner).not.toHaveBeenCalled()
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
        'pr', 'review', '--request-changes', '--body=please address X',
      ])

      await expect(commentPullRequest('lgtm', runner)).resolves.toEqual({
        ok: true,
        message: 'Comment added',
      })
      expect(runner).toHaveBeenLastCalledWith(['pr', 'comment', '--body=lgtm'])
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

    it('surfaces a de-auth as the curated recovery hint, not raw stderr', async () => {
      // Runner rejects both the action and the getGhStatus probe with a
      // recognizable "not logged in" message → routed to the curated hint.
      const runner = jest
        .fn()
        .mockRejectedValue(new Error('You are not logged into any GitHub hosts.'))

      const result = await mergePullRequest('merge', runner)
      expect(result.ok).toBe(false)
      expect(result.message).toContain('gh auth login')
    })

    it('compacts a raw gh error when gh itself is still healthy', async () => {
      // Action fails for a non-auth reason; the status probe succeeds, so we
      // surface the compacted underlying error rather than an auth hint.
      const runner = jest.fn((args: string[]) =>
        args[0] === 'auth'
          ? Promise.resolve('Logged in to github.com')
          : Promise.reject(new Error('Pull request is not mergeable\nresolve conflicts first'))
      )

      const result = await mergePullRequest('merge', runner)
      expect(result.ok).toBe(false)
      expect(result.message).toBe('Pull request is not mergeable')
      expect(result.details).toEqual(['resolve conflicts first'])
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
      expect(runner).toHaveBeenCalledWith(['pr', 'comment', '962', '--body=lgtm'])
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
      expect(runner).toHaveBeenCalledWith(['pr', 'edit', '962', '--add-label=enhancement'])
    })

    it('rejects flag-like labels without invoking gh', async () => {
      const runner = jest.fn()
      expect((await addPullRequestLabel(962, '--delete', runner)).ok).toBe(false)
      expect(runner).not.toHaveBeenCalled()
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
      expect(runner).toHaveBeenCalledWith(['pr', 'edit', '962', '--add-assignee=@me'])
    })

    it('rejects flag-like / comma-bearing logins without invoking gh', async () => {
      const runner = jest.fn()
      expect((await addPullRequestAssignee(962, '-rf', runner)).ok).toBe(false)
      expect((await addPullRequestAssignee(962, 'bob,carol', runner)).ok).toBe(false)
      expect(runner).not.toHaveBeenCalled()
    })

    it('surfaces gh errors as ok: false', async () => {
      const runner = jest.fn((args: string[]) =>
        args[0] === 'auth'
          ? Promise.resolve('Logged in to github.com')
          : Promise.reject(new Error('no such user'))
      )
      await expect(addPullRequestAssignee(1, 'ghost', runner)).resolves.toEqual({
        ok: false,
        message: 'no such user',
      })
    })
  })
})

describe('destructive PR by-number actions (#882 phase 5)', () => {
  describe('mergePullRequestByNumber', () => {
    it('builds `gh pr merge <#> --<strategy>` for each strategy', async () => {
      const runner = jest.fn().mockResolvedValue('')

      await expect(mergePullRequestByNumber(962, 'merge', runner)).resolves.toEqual({
        ok: true,
        message: 'Merged pull request #962 with merge',
      })
      expect(runner).toHaveBeenLastCalledWith(['pr', 'merge', '962', '--merge'])

      await mergePullRequestByNumber(962, 'squash', runner)
      expect(runner).toHaveBeenLastCalledWith(['pr', 'merge', '962', '--squash'])

      await mergePullRequestByNumber(962, 'rebase', runner)
      expect(runner).toHaveBeenLastCalledWith(['pr', 'merge', '962', '--rebase'])
    })

    it('preserves trimmed gh stdout as the success message', async () => {
      const runner = jest.fn().mockResolvedValue('Merged pull request #962 (squash)\n')
      await expect(mergePullRequestByNumber(962, 'squash', runner)).resolves.toEqual({
        ok: true,
        message: 'Merged pull request #962 (squash)',
      })
    })
  })

  describe('closePullRequestByNumber', () => {
    it('invokes `gh pr close <#>`', async () => {
      const runner = jest.fn().mockResolvedValue('')
      await expect(closePullRequestByNumber(962, runner)).resolves.toEqual({
        ok: true,
        message: 'Closed pull request #962',
      })
      expect(runner).toHaveBeenCalledWith(['pr', 'close', '962'])
    })
  })

  describe('approvePullRequestByNumber', () => {
    it('invokes `gh pr review <#> --approve`', async () => {
      const runner = jest.fn().mockResolvedValue('')
      await expect(approvePullRequestByNumber(962, runner)).resolves.toEqual({
        ok: true,
        message: 'Approved pull request #962',
      })
      expect(runner).toHaveBeenCalledWith(['pr', 'review', '962', '--approve'])
    })
  })

  describe('requestChangesPullRequestByNumber', () => {
    it('rejects empty bodies without invoking gh', async () => {
      const runner = jest.fn()
      await expect(requestChangesPullRequestByNumber(962, '   ', runner)).resolves.toEqual({
        ok: false,
        message: 'Review body required for change-request',
      })
      expect(runner).not.toHaveBeenCalled()
    })

    it('invokes `gh pr review <#> --request-changes --body <body>`', async () => {
      const runner = jest.fn().mockResolvedValue('')
      const result = await requestChangesPullRequestByNumber(962, 'please address X', runner)
      expect(result).toEqual({
        ok: true,
        message: 'Requested changes on pull request #962',
      })
      expect(runner).toHaveBeenCalledWith([
        'pr', 'review', '962', '--request-changes', '--body=please address X',
      ])
    })
  })
})
