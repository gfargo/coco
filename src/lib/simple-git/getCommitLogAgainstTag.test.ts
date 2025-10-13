import { SimpleGit } from 'simple-git'
import { getCommitLogAgainstTag } from './getCommitLogAgainstTag'
import { getCommitLogRangeDetails } from './getCommitLogRangeDetails'
import { getCurrentBranchName } from './getCurrentBranchName'

jest.mock('./getCommitLogRangeDetails')
jest.mock('./getCurrentBranchName')

describe('getCommitLogAgainstTag', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('retrieves commit log between current branch and target tag', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue('commitLatest\ncommitOldest\n'),
    } as unknown as SimpleGit

    const expectedCommits = [{ hash: 'commitOldest' }]

    ;(getCurrentBranchName as jest.Mock).mockResolvedValue('feature/test')
    ;(getCommitLogRangeDetails as jest.Mock).mockResolvedValue(expectedCommits)

    const result = await getCommitLogAgainstTag({ git, targetTag: 'v1.2.3' })

    expect(getCurrentBranchName).toHaveBeenCalledWith({ git })
    expect(git.raw).toHaveBeenCalledWith(['rev-list', 'v1.2.3..feature/test'])
    expect(getCommitLogRangeDetails).toHaveBeenCalledWith('commitOldest', 'commitLatest', {
      git,
      noMerges: true,
    })
    expect(result).toEqual(expectedCommits)
  })

  it('returns empty array when no commits are found', async () => {
    const git = {
      raw: jest.fn().mockResolvedValue(''),
    } as unknown as SimpleGit

    ;(getCurrentBranchName as jest.Mock).mockResolvedValue('feature/test')

    const result = await getCommitLogAgainstTag({ git, targetTag: 'v1.2.3' })

    expect(result).toEqual([])
    expect(getCommitLogRangeDetails).not.toHaveBeenCalled()
  })
})
