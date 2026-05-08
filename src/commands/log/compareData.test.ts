import { SimpleGit } from 'simple-git'
import { getCompareDiff } from './compareData'

describe('getCompareDiff', () => {
  it('invokes `git diff base..head` and splits the result on newlines', async () => {
    const raw = jest.fn().mockResolvedValue(
      [
        'diff --git a/foo.ts b/foo.ts',
        'index aaa..bbb 100644',
        '--- a/foo.ts',
        '+++ b/foo.ts',
        '@@ -1,3 +1,4 @@',
        ' const a = 1',
        '+const b = 2',
      ].join('\n')
    )
    const git = { raw } as unknown as SimpleGit

    const lines = await getCompareDiff(git, 'main', 'feature')

    expect(raw).toHaveBeenCalledWith(['diff', 'main..feature'])
    expect(lines).toEqual([
      'diff --git a/foo.ts b/foo.ts',
      'index aaa..bbb 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1',
      '+const b = 2',
    ])
  })

  it('passes refs through verbatim — caller owns the git-resolvable form', async () => {
    const raw = jest.fn().mockResolvedValue('')
    const git = { raw } as unknown as SimpleGit

    await getCompareDiff(git, 'v1.0.0', 'abc1234')

    expect(raw).toHaveBeenCalledWith(['diff', 'v1.0.0..abc1234'])
  })

  it('strips trailing CR characters from each line (CRLF tolerance)', async () => {
    const raw = jest.fn().mockResolvedValue('first line\r\nsecond line\r')
    const git = { raw } as unknown as SimpleGit

    expect(await getCompareDiff(git, 'a', 'b')).toEqual(['first line', 'second line'])
  })

  it('returns an empty-line array for an empty diff (trailing newline only)', async () => {
    const raw = jest.fn().mockResolvedValue('')
    const git = { raw } as unknown as SimpleGit

    // Empty `git diff` output: a single empty string from .split('\n')
    // — surfaces detect this as "no diff to display".
    expect(await getCompareDiff(git, 'a', 'b')).toEqual([''])
  })
})
