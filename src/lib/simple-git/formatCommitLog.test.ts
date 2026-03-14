import { DefaultLogFields, LogResult } from 'simple-git'
import { formatCommitLog } from './formatCommitLog'

const makeLog = (overrides: Partial<DefaultLogFields> = {}): LogResult<DefaultLogFields> => {
  const entry: DefaultLogFields = {
    message: 'chore: update deps',
    date: '2024-06-01',
    body: '',
    author_name: 'Dev',
    hash: 'deadbeef',
    refs: '',
    author_email: 'dev@example.com',
    ...overrides,
  }
  return { all: [entry], latest: entry, total: 1 }
}

describe('formatCommitLog', () => {
  it('returns an empty array for an empty commit log', () => {
    const log: LogResult<DefaultLogFields> = { all: [], latest: null, total: 0 }
    expect(formatCommitLog(log)).toEqual([])
  })

  it('includes date, message, body, hash, author name and email', () => {
    const [result] = formatCommitLog(makeLog({ body: 'Some body text.' }))
    expect(result).toContain('[2024-06-01]')
    expect(result).toContain('chore: update deps')
    expect(result).toContain('Some body text.')
    expect(result).toContain('(deadbeef)')
    expect(result).toContain('Dev<dev@example.com>')
  })

  it('handles an empty body without breaking format', () => {
    const [result] = formatCommitLog(makeLog({ body: '' }))
    // body line should be present but empty
    expect(result).toMatch(/\n\n/)
  })

  it('preserves order of multiple commits', () => {
    const first: DefaultLogFields = { ...makeLog().all[0], message: 'first', date: '2024-01-01', hash: 'aaa' }
    const second: DefaultLogFields = { ...makeLog().all[0], message: 'second', date: '2024-01-02', hash: 'bbb' }
    const log: LogResult<DefaultLogFields> = { all: [first, second], latest: second, total: 2 }
    const results = formatCommitLog(log)
    expect(results[0]).toContain('first')
    expect(results[1]).toContain('second')
  })

  it('handles special characters in message and author fields', () => {
    const [result] = formatCommitLog(
      makeLog({ message: 'fix: handle <null> & "quotes"', author_name: "O'Brien" })
    )
    expect(result).toContain('fix: handle <null> & "quotes"')
    expect(result).toContain("O'Brien")
  })

  it('should format a single commit log correctly', () => {
    const commitLog: LogResult<DefaultLogFields> = {
      all: [
        {
          message: 'Initial commit',
          date: '2023-10-01',
          body: 'This is the initial commit.',
          author_name: 'John Doe',
          hash: 'abc123',
          refs: '1',
          author_email: 'john.doe@example.com',
        },
      ],
      latest: {
        message: 'Initial commit',
        date: '2023-10-01',
        body: 'This is the initial commit.',
        author_name: 'John Doe',
        hash: 'abc123',
        refs: '1',
        author_email: 'john.doe@example.com',
      },
      total: 1,
    }

    const result = formatCommitLog(commitLog)
    expect(result).toEqual([
      `[2023-10-01] Initial commit
This is the initial commit.
(abc123) - John Doe<john.doe@example.com>`,
    ])
  })

  it('should format multiple commit logs correctly', () => {
    const commitLog: LogResult<DefaultLogFields> = {
      all: [
        {
          message: 'Initial commit',
          date: '2023-10-01',
          body: 'This is the initial commit.',
          author_name: 'John Doe',
          hash: 'abc123',
          refs: '1',
          author_email: 'john.doe@example.com',
        },
        {
          message: 'Added new feature',
          date: '2023-10-02',
          body: 'Implemented a new feature.',
          author_name: 'Jane Smith',
          hash: 'def456',
          refs: '2',
          author_email: 'jane.smith@example.com',
        },
      ],
      latest: {
        message: 'Added new feature',
        date: '2023-10-02',
        body: 'Implemented a new feature.',
        author_name: 'Jane Smith',
        hash: 'def456',
        refs: '2',
        author_email: 'jane.smith@example.com',
      },
      total: 2,
    }
    const result = formatCommitLog(commitLog)
    expect(result).toEqual([
      `[2023-10-01] Initial commit
This is the initial commit.
(abc123) - John Doe<john.doe@example.com>`,
`[2023-10-02] Added new feature
Implemented a new feature.
(def456) - Jane Smith<jane.smith@example.com>`,
    ])
  })
})
