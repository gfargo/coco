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
    // Reset mocks
    jest.clearAllMocks()
  })

  it('should return formatted commit log messages with inclusive range', async () => {
    const commits = await getCommitLogRange('abc123', 'def456', { git, noMerges: true })
    
    // Verify that git.log was called with from^ to include the 'from' commit
    expect(git.log).toHaveBeenCalledWith({
      from: 'abc123^',
      to: 'def456',
      '--no-merges': true
    })
    
    expect(commits).toEqual([
      `[2023-10-01] Initial commit

(abc123) - John Doe<john.doe@example.com>`,
      `[2023-10-02] Add new feature
Implemented new feature
(def456) - Jane Smith<jane.smith@example.com>`,
    ])
  })

  it('should handle the case when from^ fails (first commit edge case)', async () => {
    // Mock git.log to fail on the first call (from^) and succeed on subsequent calls
    const mockGit = git as jest.Mocked<SimpleGit>
    mockGit.log
      .mockRejectedValueOnce(new Error('fatal: ambiguous argument \'abc123^\': unknown revision'))
      .mockResolvedValueOnce({
        latest: {
          message: 'Initial commit',
          date: '2023-10-01',
          body: '',
          author_name: 'John Doe',
          hash: 'abc123',
          author_email: 'john.doe@example.com',
        },
        all: [],
        total: 1
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .mockResolvedValueOnce({
        all: [
          {
            message: 'Add new feature',
            date: '2023-10-02',
            body: 'Implemented new feature',
            author_name: 'Jane Smith',
            hash: 'def456',
            author_email: 'jane.smith@example.com',
          },
        ],
        total: 1
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

    const commits = await getCommitLogRange('abc123', 'def456', { git, noMerges: true })
    
    // Should have called git.log three times:
    // 1. Failed call with abc123^
    // 2. Successful call to get the 'from' commit separately
    // 3. Successful call to get the range abc123..def456
    expect(mockGit.log).toHaveBeenCalledTimes(3)
    
    // Verify the fallback calls
    expect(mockGit.log).toHaveBeenNthCalledWith(2, { from: 'abc123', maxCount: 1 })
    expect(mockGit.log).toHaveBeenNthCalledWith(3, { from: 'abc123', to: 'def456', '--no-merges': true })
    
    expect(commits).toEqual([
      `[2023-10-01] Initial commit

(abc123) - John Doe<john.doe@example.com>`,
      `[2023-10-02] Add new feature
Implemented new feature
(def456) - Jane Smith<jane.smith@example.com>`,
    ])
  })

  it('should handle errors gracefully when both attempts fail', async () => {
    const mockGit = git as jest.Mocked<SimpleGit>
    mockGit.log.mockRejectedValue(new Error('Git error'))
    
    await expect(getCommitLogRange('abc123', 'def456', { git, noMerges: true })).rejects.toThrow(
      'Git error'
    )
  })

  it('should pass noMerges option correctly', async () => {
    await getCommitLogRange('abc123', 'def456', { git, noMerges: false })
    
    expect(git.log).toHaveBeenCalledWith({
      from: 'abc123^',
      to: 'def456',
      '--no-merges': false
    })
  })

  it('should work with branch names and other git references', async () => {
    await getCommitLogRange('feature-branch', 'main', { git, noMerges: true })
    
    expect(git.log).toHaveBeenCalledWith({
      from: 'feature-branch^',
      to: 'main',
      '--no-merges': true
    })
  })
})
