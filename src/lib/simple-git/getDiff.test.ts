import { SimpleGit } from 'simple-git'
import { FileChange, FileChangeStatus } from '../types' // update this according to your directory structure
import { createTwoFilesPatch } from 'diff'
import { Logger } from '../utils/logger'
import { getDiff } from './getDiff' // update this according to your directory structure

jest.mock('simple-git')
jest.mock('diff')

describe('getDiff', () => {
  const logger = { verbose: jest.fn() } as unknown as Logger
  const git: SimpleGit = {
    diff: jest.fn(),
    show: jest.fn(),
  } as unknown as SimpleGit
  const nodeFile: FileChange = {
    summary: 'test',
    filePath: 'test.txt',
    status: 'modified' as FileChangeStatus,
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should return deleted message for deleted files', async () => {
    nodeFile.status = 'deleted'
    const result = await getDiff(nodeFile, { git, logger })
    expect(result).toBe('This file has been deleted.')
  })

  it('should return diff for renamed files when contents are different', async () => {
    (git.show as jest.MockedFunction<typeof git.show>).mockResolvedValueOnce('old content');
    (git.show as jest.MockedFunction<typeof git.show>).mockResolvedValueOnce('new content');
    (createTwoFilesPatch as jest.MockedFunction<typeof createTwoFilesPatch>).mockReturnValue(`
--- old.txt
+++ new.txt
@@ -1,3 +1,3 @@
-old content
+new content
`);
    nodeFile.status = 'renamed';
    nodeFile.oldFilePath = 'old.txt';
    const result = await getDiff(nodeFile, { git, logger });
    expect(result).toBe('-old content\n+new content\n'); // Expecting the '\n' character as createTwoFilesPatch returns with a '\n' in the end
});

it('should return message for renamed files when contents are same', async () => {
    (git.show as jest.MockedFunction<typeof git.show>).mockResolvedValueOnce('same content');
    (git.show as jest.MockedFunction<typeof git.show>).mockResolvedValueOnce('same content');
    nodeFile.status = 'renamed';
    nodeFile.oldFilePath = 'old.txt';
    const result = await getDiff(nodeFile, { git, logger });
    expect(result).toBe('File contents are unchanged.');
});

  it('should return diff for other files', async () => {
    (git.diff as jest.MockedFunction<typeof git.diff>).mockResolvedValueOnce('diff')
    nodeFile.status = 'modified'
    const result = await getDiff(nodeFile, { git, logger })
    expect(result).toBe('diff')
  })

  it('should handle errors while comparing file contents for renamed files', async () => {
    nodeFile.status = 'renamed';
    nodeFile.oldFilePath = 'old.txt';
    (git.show as jest.MockedFunction<typeof git.show>).mockRejectedValueOnce(new Error('error'))
    const result = await getDiff(nodeFile, { git, logger })
    expect(result).toBe('Error comparing file contents.')
    expect(logger.verbose).toHaveBeenCalled()
  })
})
