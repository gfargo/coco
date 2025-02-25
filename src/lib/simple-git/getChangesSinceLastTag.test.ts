import { getChangesSinceLastTag } from './getChangesSinceLastTag'
import { SimpleGit } from 'simple-git'

describe('getChangesSinceLastTag', () => {
  it('should return formatted commit logs since the last tag', async () => {
    // Mock data
    const mockCommitLog = {
      all: [
        {
          hash: 'abc123',
          date: '2023-01-01',
          message: 'feat: add new feature',
          body: 'This is a detailed description',
          author_name: 'Test User',
          author_email: 'test@example.com'
        }
      ]
    }

    // Mock git instance
    const mockGit = {
      tags: jest.fn().mockResolvedValue({
        all: ['v1.0.0', 'v1.1.0'],
        latest: 'v1.1.0'
      }),
      log: jest.fn().mockResolvedValue(mockCommitLog)
    } as unknown as SimpleGit

    // Call the function
    const result = await getChangesSinceLastTag({ git: mockGit })

    // Assertions
    expect(mockGit.tags).toHaveBeenCalled()
    expect(mockGit.log).toHaveBeenCalledWith({ from: 'v1.1.0' })
    expect(result).toEqual([
      '[2023-01-01] feat: add new feature\nThis is a detailed description\n(abc123) - Test User<test@example.com>'
    ])
  })

  it('should return a message when no tags are found', async () => {
    // Mock git instance with no tags
    const mockGit = {
      tags: jest.fn().mockResolvedValue({
        all: [],
        latest: undefined
      })
    } as unknown as SimpleGit

    // Call the function
    const result = await getChangesSinceLastTag({ git: mockGit })

    // Assertions
    expect(mockGit.tags).toHaveBeenCalled()
    expect(result).toEqual(['No tags found in the repository.'])
  })
})