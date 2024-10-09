import { DefaultLogFields, LogResult } from 'simple-git'
import { formatCommitLog } from './formatCommitLog'

describe('formatCommitLog', () => {
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
