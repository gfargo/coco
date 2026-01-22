import { FileDiff, DiffNode } from '../../../types'
import { summarizeLargeFiles, preprocessLargeFiles } from './summarizeLargeFiles'

// Mock the summarize function
jest.mock('../../../langchain/chains/summarize', () => ({
  summarize: jest.fn().mockImplementation(async (docs) => {
    // Return a shorter summary based on input
    const totalLength = docs.reduce(
      (sum: number, doc: { pageContent: string }) => sum + doc.pageContent.length,
      0
    )
    return `Summary of ${docs.length} document(s) with ${totalLength} chars`
  }),
}))

describe('summarizeLargeFiles', () => {
  const mockTokenizer = (text: string) => Math.ceil(text.length / 4) // ~4 chars per token
  const mockLogger = {
    verbose: jest.fn().mockReturnThis(),
    log: jest.fn().mockReturnThis(),
    startSpinner: jest.fn().mockReturnThis(),
    stopSpinner: jest.fn().mockReturnThis(),
    startTimer: jest.fn().mockReturnThis(),
    stopTimer: jest.fn().mockReturnThis(),
  }
  const mockChain = {} as never
  const mockTextSplitter = {} as never

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should not summarize files below maxFileTokens threshold', async () => {
    const diffs: FileDiff[] = [
      { file: 'small.ts', diff: 'small change', summary: 'small.ts', tokenCount: 100 },
      { file: 'medium.ts', diff: 'medium change', summary: 'medium.ts', tokenCount: 200 },
    ]

    const result = await summarizeLargeFiles(diffs, {
      maxFileTokens: 500,
      minTokensForSummary: 400,
      maxConcurrent: 4,
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    // Files should remain unchanged
    expect(result).toEqual(diffs)
    expect(mockLogger.verbose).not.toHaveBeenCalled()
  })

  it('should summarize files exceeding maxFileTokens threshold', async () => {
    const diffs: FileDiff[] = [
      { file: 'small.ts', diff: 'small', summary: 'small.ts', tokenCount: 100 },
      {
        file: 'large.ts',
        diff: 'a'.repeat(2000), // Large diff
        summary: 'large.ts',
        tokenCount: 600,
      },
    ]

    const result = await summarizeLargeFiles(diffs, {
      maxFileTokens: 500,
      minTokensForSummary: 400,
      maxConcurrent: 4,
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    // Small file unchanged
    expect(result[0]).toEqual(diffs[0])

    // Large file should be summarized
    expect(result[1].file).toBe('large.ts')
    expect(result[1].diff).toContain('Summary')
    expect(result[1].tokenCount).toBeLessThan(600)

    expect(mockLogger.verbose).toHaveBeenCalledWith(
      expect.stringContaining('Pre-summarizing'),
      expect.any(Object)
    )
  })

  it('should not summarize files below minTokensForSummary even if above maxFileTokens', async () => {
    const diffs: FileDiff[] = [
      {
        file: 'edge-case.ts',
        diff: 'some content',
        summary: 'edge-case.ts',
        tokenCount: 550, // Above maxFileTokens but below minTokensForSummary
      },
    ]

    const result = await summarizeLargeFiles(diffs, {
      maxFileTokens: 500,
      minTokensForSummary: 600, // Higher than the file's token count
      maxConcurrent: 4,
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    // File should remain unchanged
    expect(result).toEqual(diffs)
  })

  it('should respect maxConcurrent limit', async () => {
    const diffs: FileDiff[] = Array.from({ length: 10 }, (_, i) => ({
      file: `file${i}.ts`,
      diff: 'a'.repeat(2000),
      summary: `file${i}.ts`,
      tokenCount: 600,
    }))

    const result = await summarizeLargeFiles(diffs, {
      maxFileTokens: 500,
      minTokensForSummary: 400,
      maxConcurrent: 3,
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    // All files should be processed
    expect(result).toHaveLength(10)
    result.forEach((diff) => {
      expect(diff.diff).toContain('Summary')
    })
  })
})

describe('preprocessLargeFiles', () => {
  const mockTokenizer = (text: string) => Math.ceil(text.length / 4)
  const mockLogger = {
    verbose: jest.fn().mockReturnThis(),
    log: jest.fn().mockReturnThis(),
    startSpinner: jest.fn().mockReturnThis(),
    stopSpinner: jest.fn().mockReturnThis(),
    startTimer: jest.fn().mockReturnThis(),
    stopTimer: jest.fn().mockReturnThis(),
  }
  const mockChain = {} as never
  const mockTextSplitter = {} as never

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should process DiffNode tree and summarize large files', async () => {
    const rootNode: DiffNode = {
      path: '',
      diffs: [
        { file: 'root.ts', diff: 'small', summary: 'root.ts', tokenCount: 100 },
      ],
      children: [
        {
          path: 'src',
          diffs: [
            {
              file: 'src/large.ts',
              diff: 'a'.repeat(2000),
              summary: 'src/large.ts',
              tokenCount: 600,
            },
          ],
          children: [],
        },
      ],
    }

    const result = await preprocessLargeFiles(rootNode, {
      maxFileTokens: 500,
      minTokensForSummary: 400,
      maxConcurrent: 4,
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    // Root file unchanged
    expect(result.diffs[0].tokenCount).toBe(100)

    // Child large file summarized
    expect(result.children[0].diffs[0].diff).toContain('Summary')
    expect(result.children[0].diffs[0].tokenCount).toBeLessThan(600)
  })

  it('should preserve tree structure', async () => {
    const rootNode: DiffNode = {
      path: 'root',
      diffs: [],
      children: [
        {
          path: 'src',
          diffs: [{ file: 'src/a.ts', diff: 'a', summary: 'a.ts', tokenCount: 50 }],
          children: [
            {
              path: 'src/utils',
              diffs: [{ file: 'src/utils/b.ts', diff: 'b', summary: 'b.ts', tokenCount: 50 }],
              children: [],
            },
          ],
        },
      ],
    }

    const result = await preprocessLargeFiles(rootNode, {
      maxFileTokens: 500,
      minTokensForSummary: 400,
      maxConcurrent: 4,
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    // Structure preserved
    expect(result.path).toBe('root')
    expect(result.children).toHaveLength(1)
    expect(result.children[0].path).toBe('src')
    expect(result.children[0].children).toHaveLength(1)
    expect(result.children[0].children[0].path).toBe('src/utils')
  })
})
