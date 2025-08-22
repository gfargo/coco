import { simpleGit, SimpleGit } from 'simple-git'
import { getCommitLogRangeDetails } from './getCommitLogRangeDetails'

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

describe('getCommitLogRangeDetails', () => {
  let git: SimpleGit

  beforeEach(() => {
    git = simpleGit()
    jest.clearAllMocks()
  })

  it('should return detailed commit log objects with inclusive range', async () => {
    const commits = await getCommitLogRangeDetails('abc123', 'def456', { git, noMerges: true })
    
    expect(git.log).toHaveBeenCalledWith({
      from: 'abc123^',
      to: 'def456',
      '--no-merges': true
    })
    
    expect(commits).toEqual([
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
    ])
  })
})
