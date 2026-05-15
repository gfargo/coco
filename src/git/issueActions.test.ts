import { addIssueAssignee, addIssueLabel, commentIssue } from './issueActions'

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
      expect(runner).toHaveBeenCalledWith(['issue', 'comment', '882', '--body', 'lgtm'])
    })

    it('falls back to a synthesized message when gh output is empty', async () => {
      const runner = jest.fn().mockResolvedValue('')
      await expect(commentIssue(7, 'thanks!', runner)).resolves.toEqual({
        ok: true,
        message: 'Commented on issue #7',
      })
    })

    it('surfaces runner errors as ok: false', async () => {
      const runner = jest.fn().mockRejectedValue(new Error('rate limited'))
      await expect(commentIssue(1, 'hello', runner)).resolves.toEqual({
        ok: false,
        message: 'rate limited',
      })
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
      expect(runner).toHaveBeenCalledWith(['issue', 'edit', '882', '--add-label', 'enhancement'])
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
      expect(runner).toHaveBeenCalledWith(['issue', 'edit', '882', '--add-assignee', '@me'])
    })
  })
})
