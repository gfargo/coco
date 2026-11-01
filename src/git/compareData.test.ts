import { SimpleGit } from 'simple-git'
import { getCompareDiff, getCompareSummary } from './compareData'
import { MACHINE_DIFF_ARGS } from './machineDiff'

describe('getCompareDiff', () => {
  it('invokes `git diff base...head` and splits the result on newlines', async () => {
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

    expect(raw).toHaveBeenCalledWith(['diff', ...MACHINE_DIFF_ARGS, 'main...feature'])
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

    expect(raw).toHaveBeenCalledWith(['diff', ...MACHINE_DIFF_ARGS, 'v1.0.0...abc1234'])
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

describe('getCompareSummary', () => {
  it('reads behind/ahead from the left-right count and lists head-only commits', async () => {
    const raw = jest.fn(async (args: string[]) => {
      if (args[0] === 'rev-list') return '3\t2\n'
      if (args[0] === 'log') return 'abc1234\x1ffeat: add thing\ndef5678\x1ffix: other\n'
      if (args[0] === 'merge-base') return '0123456789abcdef\n'
      return ''
    })
    const git = { raw } as unknown as SimpleGit

    const summary = await getCompareSummary(git, 'main', 'feature')

    expect(raw).toHaveBeenCalledWith(['rev-list', '--left-right', '--count', 'main...feature'])
    expect(raw).toHaveBeenCalledWith(['log', '--max-count=50', '--format=%h%x1f%s', 'main..feature'])
    expect(summary).toEqual({
      behind: 3,
      ahead: 2,
      mergeBase: '0123456',
      commits: [
        { hash: 'abc1234', subject: 'feat: add thing' },
        { hash: 'def5678', subject: 'fix: other' },
      ],
    })
  })

  it('tolerates unrelated histories (no merge base)', async () => {
    const raw = jest.fn(async (args: string[]) => {
      if (args[0] === 'merge-base') throw new Error('exit 1')
      return args[0] === 'rev-list' ? '0 1' : ''
    })
    const summary = await getCompareSummary({ raw } as unknown as SimpleGit, 'a', 'b')
    expect(summary.mergeBase).toBeUndefined()
    expect(summary.ahead).toBe(1)
    expect(summary.commits).toEqual([])
  })
})
