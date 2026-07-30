import { LINT_LOG_FORMAT, parseLintLogOutput, resolveLintRange } from './rangeReader'

const SEP = '\x1f'
const REC = '\x1e'

function record(fields: string[]): string {
  return `${fields.join(SEP)}${REC}\n`
}

describe('parseLintLogOutput', () => {
  it('parses a single commit record', () => {
    const output = record(['abc123', 'abc123', '', 'Jane Doe', '2026-01-01', 'fix: a bug', ''])
    const commits = parseLintLogOutput(output)
    expect(commits).toEqual([
      {
        sha: 'abc123',
        shortSha: 'abc123',
        parents: [],
        author: 'Jane Doe',
        date: '2026-01-01',
        subject: 'fix: a bug',
        body: '',
      },
    ])
  })

  it('parses multiple commits oldest-first, preserving multi-line bodies', () => {
    const output =
      record(['sha1', 'sha1', 'parent0', 'Jane', '2026-01-01', 'feat: one', 'line one\nline two']) +
      record(['sha2', 'sha2', 'sha1', 'Jane', '2026-01-02', 'fix: two', ''])

    const commits = parseLintLogOutput(output)
    expect(commits).toHaveLength(2)
    expect(commits[0].sha).toBe('sha1')
    expect(commits[0].body).toBe('line one\nline two')
    expect(commits[1].sha).toBe('sha2')
    expect(commits[1].parents).toEqual(['sha1'])
  })

  it('flags merge commits via multiple parents', () => {
    const output = record(['m1', 'm1', 'p1 p2', 'Jane', '2026-01-01', "Merge branch 'foo'", ''])
    const commits = parseLintLogOutput(output)
    expect(commits[0].parents).toEqual(['p1', 'p2'])
  })

  it('returns an empty array for empty output', () => {
    expect(parseLintLogOutput('')).toEqual([])
    expect(parseLintLogOutput('\n')).toEqual([])
  })

  it('uses a distinct field separator between subject and body', () => {
    expect(LINT_LOG_FORMAT).toContain(`%s${SEP}%b`)
  })
})

describe('resolveLintRange', () => {
  it('defaults to <defaultBranch>..HEAD when neither --since nor --range is passed', () => {
    expect(resolveLintRange({}, 'main')).toBe('main..HEAD')
  })

  it('uses --range verbatim', () => {
    expect(resolveLintRange({ range: 'abc..def' }, 'main')).toBe('abc..def')
  })

  it('builds <since>..HEAD from --since', () => {
    expect(resolveLintRange({ since: 'origin/main' }, 'main')).toBe('origin/main..HEAD')
  })

  it('prefers --range over --since when both happen to be set', () => {
    expect(resolveLintRange({ since: 'origin/main', range: 'abc..def' }, 'main')).toBe('abc..def')
  })
})
