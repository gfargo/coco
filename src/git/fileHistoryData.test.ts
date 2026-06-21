import { getFileHistory, parseFileHistoryOutput } from './fileHistoryData'

const SEP = '\x1f'
const REC = '\x1e'

// Three-commit fixture for a file that was renamed once.
const FIXTURE = [
  `a1b2c3d4e5f60718293a4b5c6d7e8f9012345678${SEP}a1b2c3d4${SEP}Ada Lovelace${SEP}1700000000${SEP}feat: add example file${REC}`,
  `9988776655443322110099887766554433221100${SEP}99887766${SEP}Grace Hopper${SEP}1710000000${SEP}fix: correct calculation${REC}`,
  `1234567890abcdef1234567890abcdef12345678${SEP}12345678${SEP}Alan Turing${SEP}1720000000${SEP}chore: rename to new path${REC}`,
  '',
].join('')

describe('parseFileHistoryOutput', () => {
  it('parses hash, shortHash, author, authorTime, and subject', () => {
    const commits = parseFileHistoryOutput(FIXTURE)
    expect(commits).toHaveLength(3)
    expect(commits[0]).toEqual({
      hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      shortHash: 'a1b2c3d4',
      author: 'Ada Lovelace',
      authorTime: 1700000000,
      subject: 'feat: add example file',
    })
    expect(commits[1]).toEqual({
      hash: '9988776655443322110099887766554433221100',
      shortHash: '99887766',
      author: 'Grace Hopper',
      authorTime: 1710000000,
      subject: 'fix: correct calculation',
    })
    expect(commits[2]).toEqual({
      hash: '1234567890abcdef1234567890abcdef12345678',
      shortHash: '12345678',
      author: 'Alan Turing',
      authorTime: 1720000000,
      subject: 'chore: rename to new path',
    })
  })

  it('returns an empty array for empty output', () => {
    expect(parseFileHistoryOutput('')).toEqual([])
  })

  it('skips malformed records', () => {
    const malformed = `only-hash-no-separators${REC}`
    expect(parseFileHistoryOutput(malformed)).toEqual([])
  })

  it('handles an empty commit subject gracefully', () => {
    const withEmptySubject = `aaaa${SEP}aaaa${SEP}Author${SEP}1700000000${SEP}${REC}`
    const commits = parseFileHistoryOutput(withEmptySubject)
    expect(commits).toHaveLength(1)
    expect(commits[0].subject).toBe('')
  })
})

describe('getFileHistory', () => {
  it('calls git log with --follow and returns parsed commits', async () => {
    const git = { raw: jest.fn().mockResolvedValue(FIXTURE) }
    const result = await getFileHistory(git as never, 'src/example.ts')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path).toBe('src/example.ts')
      expect(result.commits).toHaveLength(3)
      expect(result.commits[0].author).toBe('Ada Lovelace')
    }
    expect(git.raw).toHaveBeenCalledWith(
      expect.arrayContaining(['log', '--follow', '--', 'src/example.ts'])
    )
  })

  it('returns a best-effort failure result when git log throws', async () => {
    const git = { raw: jest.fn().mockRejectedValue(new Error('not a git repo')) }
    const result = await getFileHistory(git as never, 'missing.ts')
    expect(result).toEqual({ ok: false, path: 'missing.ts', message: 'not a git repo' })
  })

  it('returns ok:true with empty commits for a file with no history', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }
    const result = await getFileHistory(git as never, 'new.ts')
    expect(result).toEqual({ ok: true, path: 'new.ts', commits: [] })
  })
})
