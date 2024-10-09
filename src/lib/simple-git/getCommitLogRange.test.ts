import { simpleGit, SimpleGit } from 'simple-git'

import { getCommitLogRange } from './getCommitLogRange'

jest.mock('simple-git', () => ({
  simpleGit: jest.fn().mockImplementation(() => ({
    log: jest.fn().mockResolvedValue({
      all: [
        {
          message: 'Initial commit',
          date: '2023-10-01',
          body: '',
          author_name: 'John Doe',
          hash: 'abc123',
          author_email: 'john.doe@example.com',
        },
        {
          message: 'Add new feature',
          date: '2023-10-02',
          body: 'Implemented new feature',
          author_name: 'Jane Smith',
          hash: 'def456',
          author_email: 'jane.smith@example.com',
        },
      ],
    }),
  })),
}))

describe('getCommitLogRange', () => {
  let git: SimpleGit

  beforeEach(() => {
    git = simpleGit()
  })

  it('should return formatted commit log messages', async () => {
    const commits = await getCommitLogRange('abc123', 'def456', { git, noMerges: true })
    expect(commits).toEqual([
      `[2023-10-01] Initial commit

(abc123) - John Doe<john.doe@example.com>`,
      `[2023-10-02] Add new feature
Implemented new feature
(def456) - Jane Smith<jane.smith@example.com>`,
    ])
  })

  it('should handle errors gracefully', async () => {
    git.log = jest.fn().mockRejectedValue(new Error('Git error'))
    await expect(getCommitLogRange('abc123', 'def456', { git, noMerges: true })).rejects.toThrow(
      'Git error'
    )
  })
})
