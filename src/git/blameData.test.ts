import { getBlame, parseBlamePorcelain } from './blameData'

// A minimal `git blame --porcelain` fixture: two commits, three lines.
// The second line reuses the first commit (so it carries only the sha
// header + content, no metadata) to exercise the per-commit metadata
// cache. The third line introduces a new commit with its own metadata.
const PORCELAIN_FIXTURE = [
  'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678 1 1 2',
  'author Ada Lovelace',
  'author-mail <ada@example.com>',
  'author-time 1700000000',
  'author-tz +0000',
  'committer Ada Lovelace',
  'committer-time 1700000000',
  'summary first commit',
  'filename src/example.ts',
  '\tconst answer = 42',
  'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678 2 2',
  '\tconst doubled = answer * 2',
  '9988776655443322110099887766554433221100 3 3 1',
  'author Grace Hopper',
  'author-mail <grace@example.com>',
  'author-time 1710000000',
  'author-tz +0000',
  'committer Grace Hopper',
  'committer-time 1710000000',
  'summary second commit',
  'filename src/example.ts',
  '\treturn doubled',
  '',
].join('\n')

describe('parseBlamePorcelain', () => {
  it('parses each line with hash, author, time, line number, and content', () => {
    const lines = parseBlamePorcelain(PORCELAIN_FIXTURE)
    expect(lines).toEqual([
      {
        hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
        shortHash: 'a1b2c3d4',
        author: 'Ada Lovelace',
        authorTime: 1700000000,
        lineNumber: 1,
        content: 'const answer = 42',
      },
      {
        hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
        shortHash: 'a1b2c3d4',
        author: 'Ada Lovelace',
        authorTime: 1700000000,
        lineNumber: 2,
        content: 'const doubled = answer * 2',
      },
      {
        hash: '9988776655443322110099887766554433221100',
        shortHash: '99887766',
        author: 'Grace Hopper',
        authorTime: 1710000000,
        lineNumber: 3,
        content: 'return doubled',
      },
    ])
  })

  it('reuses cached commit metadata for repeat shas', () => {
    const lines = parseBlamePorcelain(PORCELAIN_FIXTURE)
    // Line 2 reuses commit a1b2 without re-emitting author metadata.
    expect(lines[1].author).toBe('Ada Lovelace')
    expect(lines[1].authorTime).toBe(1700000000)
  })

  it('labels not-yet-committed lines with a friendly short hash', () => {
    const fixture = [
      '0000000000000000000000000000000000000000 1 1 1',
      'author Not Committed Yet',
      'author-time 0',
      'summary Version of file edited but not committed yet',
      'filename src/wip.ts',
      '\tconst wip = true',
      '',
    ].join('\n')
    const lines = parseBlamePorcelain(fixture)
    expect(lines[0].shortHash).toBe('staged  ')
    expect(lines[0].author).toBe('Not Committed Yet')
  })

  it('preserves leading whitespace in line content', () => {
    const fixture = [
      'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678 1 1 1',
      'author Ada',
      'author-time 1700000000',
      'filename a.ts',
      '\t  indented()',
      '',
    ].join('\n')
    const lines = parseBlamePorcelain(fixture)
    expect(lines[0].content).toBe('  indented()')
  })

  it('returns an empty array for empty output', () => {
    expect(parseBlamePorcelain('')).toEqual([])
  })
})

describe('getBlame', () => {
  it('parses `git blame --porcelain` output for the path', async () => {
    const git = { raw: jest.fn().mockResolvedValue(PORCELAIN_FIXTURE) }
    const result = await getBlame(git as never, 'src/example.ts')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.path).toBe('src/example.ts')
      expect(result.lines).toHaveLength(3)
      expect(result.lines[0].content).toBe('const answer = 42')
    }
    expect(git.raw).toHaveBeenCalledWith(['blame', '--porcelain', '--', 'src/example.ts'])
  })

  it('returns a best-effort failure result when git blame throws', async () => {
    const git = { raw: jest.fn().mockRejectedValue(new Error('binary file')) }
    const result = await getBlame(git as never, 'logo.png')
    expect(result).toEqual({ ok: false, path: 'logo.png', message: 'binary file' })
  })
})
