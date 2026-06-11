import {
  addIssueAssignee,
  addIssueLabel,
  closeIssue,
  commentIssue,
  reopenIssue,
} from './issueActions'

describe('issueActions', () => {
  describe('commentIssue', () => {
    it('rejects empty bodies without invoking gh', async () => {
      const runner = jest.fn()
      await expect(commentIssue(882, '   ', runner)).resolves.toEqual({
        ok: false,
        message: 'Comment body required',
      })
      expect(runner).not.toHaveBeenCalled()
    })

    it('invokes `gh issue comment <#> --body <body>` and surfaces success', async () => {
      const runner = jest.fn().mockResolvedValue('https://github.com/gfargo/coco/issues/882#comment-1')
      await expect(commentIssue(882, 'lgtm', runner)).resolves.toEqual({
        ok: true,
        message: 'https://github.com/gfargo/coco/issues/882#comment-1',
      })
      expect(runner).toHaveBeenCalledWith(['issue', 'comment', '882', '--body=lgtm'])
    })

    it('falls back to a synthesized message when gh output is empty', async () => {
      const runner = jest.fn().mockResolvedValue('')
      await expect(commentIssue(7, 'thanks!', runner)).resolves.toEqual({
        ok: true,
        message: 'Commented on issue #7',
      })
    })

    it('surfaces runner errors as ok: false (compacted when gh is healthy)', async () => {
      // gh itself is fine (auth probe succeeds); the action failed for an
      // unrelated reason, so the compacted raw error is surfaced.
      const runner = jest.fn((args: string[]) =>
        args[0] === 'auth'
          ? Promise.resolve('Logged in to github.com')
          : Promise.reject(new Error('rate limited'))
      )
      await expect(commentIssue(1, 'hello', runner)).resolves.toEqual({
        ok: false,
        message: 'rate limited',
      })
    })

    it('surfaces a de-auth as the curated recovery hint', async () => {
      const runner = jest
        .fn()
        .mockRejectedValue(new Error('You are not logged into any GitHub hosts.'))
      const result = await commentIssue(1, 'hello', runner)
      expect(result.ok).toBe(false)
      expect(result.message).toContain('gh auth login')
    })
  })

  describe('addIssueLabel', () => {
    it('rejects empty label names', async () => {
      const runner = jest.fn()
      await expect(addIssueLabel(1, '', runner)).resolves.toEqual({
        ok: false,
        message: 'Label name required',
      })
      expect(runner).not.toHaveBeenCalled()
    })

    it('invokes `gh issue edit <#> --add-label <label>`', async () => {
      const runner = jest.fn().mockResolvedValue('')
      const result = await addIssueLabel(882, 'enhancement', runner)
      expect(result).toEqual({
        ok: true,
        message: "Added label 'enhancement' to issue #882",
      })
      expect(runner).toHaveBeenCalledWith(['issue', 'edit', '882', '--add-label=enhancement'])
    })
  })

  describe('addIssueAssignee', () => {
    it('rejects empty assignee values', async () => {
      const runner = jest.fn()
      await expect(addIssueAssignee(1, '   ', runner)).resolves.toEqual({
        ok: false,
        message: 'Assignee login required',
      })
      expect(runner).not.toHaveBeenCalled()
    })

    it('invokes `gh issue edit <#> --add-assignee <login>`', async () => {
      const runner = jest.fn().mockResolvedValue('')
      await expect(addIssueAssignee(882, '@me', runner)).resolves.toEqual({
        ok: true,
        message: 'Assigned @me to issue #882',
      })
      expect(runner).toHaveBeenCalledWith(['issue', 'edit', '882', '--add-assignee=@me'])
    })

    it('rejects flag-like / comma-bearing logins without invoking gh', async () => {
      const runner = jest.fn()
      expect((await addIssueAssignee(882, '-rf', runner)).ok).toBe(false)
      expect((await addIssueAssignee(882, 'bob,carol', runner)).ok).toBe(false)
      expect(runner).not.toHaveBeenCalled()
    })
  })

  describe('addIssueLabel guards', () => {
    it('rejects flag-like labels without invoking gh', async () => {
      const runner = jest.fn()
      expect((await addIssueLabel(882, '--delete', runner)).ok).toBe(false)
      expect(runner).not.toHaveBeenCalled()
    })
  })
})

describe('destructive issue actions (#882 phase 5)', () => {
  describe('closeIssue', () => {
    it('invokes `gh issue close <#>`', async () => {
      const runner = jest.fn().mockResolvedValue('')
      await expect(closeIssue(882, runner)).resolves.toEqual({
        ok: true,
        message: 'Closed issue #882',
      })
      expect(runner).toHaveBeenCalledWith(['issue', 'close', '882'])
    })

    it('preserves trimmed gh stdout as the success message', async () => {
      const runner = jest.fn().mockResolvedValue('Closed via TUI\n')
      await expect(closeIssue(1, runner)).resolves.toEqual({
        ok: true,
        message: 'Closed via TUI',
      })
    })

    it('surfaces gh errors as ok: false', async () => {
      const runner = jest.fn((args: string[]) =>
        args[0] === 'auth'
          ? Promise.resolve('Logged in to github.com')
          : Promise.reject(new Error('already closed'))
      )
      await expect(closeIssue(1, runner)).resolves.toEqual({
        ok: false,
        message: 'already closed',
      })
    })
  })

  describe('reopenIssue', () => {
    it('invokes `gh issue reopen <#>`', async () => {
      const runner = jest.fn().mockResolvedValue('')
      await expect(reopenIssue(882, runner)).resolves.toEqual({
        ok: true,
        message: 'Reopened issue #882',
      })
      expect(runner).toHaveBeenCalledWith(['issue', 'reopen', '882'])
    })
  })
})
