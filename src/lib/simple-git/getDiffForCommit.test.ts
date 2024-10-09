import { simpleGit, SimpleGit } from 'simple-git'
import { getDiffForCommit } from './getDiffForCommit'

jest.mock('simple-git', () => ({
  simpleGit: jest.fn().mockImplementation(() => ({
    diff: jest
      .fn()
      .mockResolvedValue(
        'diff --git a/file1.txt b/file1.txt\nindex 83db48f..f735c3b 100644\n--- a/file1.txt\n+++ b/file1.txt\n@@ -1 +1 @@\n-Hello World\n+Hello OpenAI'
      ),
  })),
}))

describe('getDiffForCommit', () => {
  let git: SimpleGit

  beforeEach(() => {
    git = simpleGit()
  })

  it('should return the diff for a given commit', async () => {
    const diff = await getDiffForCommit('abc123', { git })
    expect(diff).toContain('diff --git a/file1.txt b/file1.txt')
    expect(diff).toContain('-Hello World')
    expect(diff).toContain('+Hello OpenAI')
  })

  it('should handle errors gracefully', async () => {
    git.diff = jest.fn().mockRejectedValue(new Error('Git error'))
    await expect(getDiffForCommit('abc123', { git })).rejects.toThrow('Git error')
  })
})
