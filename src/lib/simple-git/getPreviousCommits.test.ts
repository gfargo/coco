import { SimpleGit } from 'simple-git'
import { getPreviousCommits } from './getPreviousCommits'
import { formatSingleCommit } from './formatSingleCommit'

// Mock the formatSingleCommit function
jest.mock('./formatSingleCommit', () => ({
  formatSingleCommit: jest.fn((commit) => `Formatted: ${commit.hash} - ${commit.message}`),
}))

describe('getPreviousCommits', () => {
  // Create a mock for SimpleGit with the log method
  const mockLog = jest.fn();
  const mockGit = { log: mockLog } as unknown as SimpleGit;

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return empty string when count is 0', async () => {
    const result = await getPreviousCommits({ git: mockGit, count: 0 })
    expect(result).toBe('')
    expect(mockLog).not.toHaveBeenCalled()
  })

  it('should return empty string when count is negative', async () => {
    const result = await getPreviousCommits({ git: mockGit, count: -1 })
    expect(result).toBe('')
    expect(mockLog).not.toHaveBeenCalled()
  })

  it('should return empty string when no commits are found', async () => {
    mockLog.mockResolvedValue({ total: 0, all: [] })
    const result = await getPreviousCommits({ git: mockGit, count: 1 })
    expect(result).toBe('')
    expect(mockLog).toHaveBeenCalledWith({ maxCount: 1 })
  })

  it('should return formatted commits when commits are found', async () => {
    const mockCommits = {
      total: 2,
      all: [
        { hash: 'abc123', message: 'First commit' },
        { hash: 'def456', message: 'Second commit' },
      ],
    }
    mockLog.mockResolvedValue(mockCommits)
    
    const result = await getPreviousCommits({ git: mockGit, count: 2 })
    
    expect(mockLog).toHaveBeenCalledWith({ maxCount: 2 })
    expect(formatSingleCommit).toHaveBeenCalledTimes(2)
    expect(result).toBe('Formatted: abc123 - First commit\n\nFormatted: def456 - Second commit')
  })

  it('should handle errors gracefully', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    mockLog.mockRejectedValue(new Error('Git error'))
    
    const result = await getPreviousCommits({ git: mockGit, count: 1 })
    
    expect(result).toBe('')
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error getting previous commits: Git error')
    consoleErrorSpy.mockRestore()
  })

  it('should use default count of 1 when not specified', async () => {
    mockLog.mockResolvedValue({
      total: 1,
      all: [{ hash: 'abc123', message: 'First commit' }],
    })
    
    await getPreviousCommits({ git: mockGit })
    
    expect(mockLog).toHaveBeenCalledWith({ maxCount: 1 })
  })
})