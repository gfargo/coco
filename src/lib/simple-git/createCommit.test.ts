import { SimpleGit, CommitResult } from 'simple-git'
import { createCommit } from './createCommit'

describe('createCommit', () => {
  const git: SimpleGit = {
    commit: jest.fn().mockResolvedValue({
      author: null,
      branch: 'main',
      commit: '123abc',
    } as CommitResult),
  } as unknown as SimpleGit

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should call git commit with the provided message', async () => {
    const commitMessage = 'test commit message'
    await createCommit(commitMessage, git)

    expect(git.commit).toHaveBeenCalledWith(commitMessage)
  })

  it('should return CommitResult', async () => {
    const commitMessage = 'another test commit message'
    const result: CommitResult = await createCommit(commitMessage, git)

    expect(result).toEqual({
      author: null,
      branch: 'main',
      commit: '123abc',
    })
  })
})
