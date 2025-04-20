import { SimpleGit } from 'simple-git'
import { getChanges } from './getChanges' // Assuming the path to the function

jest.mock('simple-git')

// Mock the functions that getChanges uses
jest.mock('./getStatus', () => ({
  getStatus: jest.fn().mockReturnValue('mockedStatus'),
}))
jest.mock('./getSummaryText', () => ({
  getSummaryText: jest.fn().mockReturnValue('mockedSummary'),
}))

describe('getChanges', () => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const git: jest.Mocked<SimpleGit> = {
    status: jest.fn().mockResolvedValue({
      files: [
        { path: 'file1.txt', working_dir: 'M', index: 'M' },
        { path: 'file2.js', working_dir: 'M', index: ' ' },
        { path: 'file3.txt', working_dir: '?', index: '?' },
        { path: 'dir/file4.txt', working_dir: ' ', index: 'M' },
        { path: 'dir/file5.js', working_dir: ' ', index: 'M' },
      ],
      renamed: [{ from: 'oldFile.txt', to: 'file1.txt' }],
    }),
  }

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should return file changes correctly', async () => {
    const result = await getChanges({ git })

    expect(result).toEqual({
      staged: [
        {
          filePath: 'file1.txt',
          oldFilePath: 'oldFile.txt',
          status: 'mockedStatus',
          summary: 'mockedSummary',
        },
        {
          filePath: 'dir/file4.txt',
          oldFilePath: undefined,
          status: 'mockedStatus',
          summary: 'mockedSummary',
        },
        {
          filePath: 'dir/file5.js',
          oldFilePath: undefined,
          status: 'mockedStatus',
          summary: 'mockedSummary',
        },
      ],
      unstaged: [
        {
          filePath: 'file1.txt',
          oldFilePath: 'oldFile.txt',
          status: 'mockedStatus',
          summary: 'mockedSummary',
        },
        {
          filePath: 'file2.js',
          oldFilePath: undefined,
          status: 'mockedStatus',
          summary: 'mockedSummary',
        },
      ],
      untracked: [
        {
          filePath: 'file3.txt',
          oldFilePath: undefined,
          status: 'added',
          summary: 'mockedSummary',
        },
      ],
    })
  })

  it('should filter ignored files and extensions', async () => {
    const result = await getChanges({git, options: {
      ignoredFiles: [
        '**/file4.txt', 
        'file3.txt'
      ],
      ignoredExtensions: ['.js'],
    }})

    expect(result).toEqual({
      staged: [
        {
          filePath: 'file1.txt',
          oldFilePath: 'oldFile.txt',
          status: 'mockedStatus',
          summary: 'mockedSummary',
        },
      ],
      unstaged: [
        {
          filePath: 'file1.txt',
          oldFilePath: 'oldFile.txt',
          status: 'mockedStatus',
          summary: 'mockedSummary',
        },
      ],
      untracked: [],
    })
  })
  
  it('should filter files by wildcard ignoredFiles pattern', async () => {
    // Ignore all .txt files via wildcard
    const result = await getChanges({ git, options: {
      ignoredFiles: ['**/*.txt'],
      ignoredExtensions: [],
    } })
    // Only .js files should remain
    expect(result.staged.map(f => f.filePath)).toEqual(['dir/file5.js'])
    expect(result.unstaged.map(f => f.filePath)).toEqual(['file2.js'])
    expect(result.untracked).toEqual([])
  })

  it('should ignore nested directories via pattern', async () => {
    // Ignore entire 'dir' folder
    const result = await getChanges({ git, options: {
      ignoredFiles: ['dir/**'],
      ignoredExtensions: [],
    } })
    // Only top-level files remain
    expect(result.staged.map(f => f.filePath)).toEqual(['file1.txt'])
    expect(result.unstaged.map(f => f.filePath)).toEqual(['file1.txt', 'file2.js'])
    expect(result.untracked.map(f => f.filePath)).toEqual(['file3.txt'])
  })
})
