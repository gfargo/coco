import { DiffNode } from '../../../types'
import { createDirectoryDiffs, summarizeDiffs, summarizeDirectoryDiff } from './summarizeDiffs'

// Mock the summarize chain
jest.mock('../../../langchain/chains/summarize', () => ({
  summarize: jest.fn().mockImplementation(async (docs) => {
    // Return a shorter summary
    return `Summary of ${docs.length} file(s)`
  }),
}))

// Mock the preprocessLargeFiles function
jest.mock('./summarizeLargeFiles', () => ({
  preprocessLargeFiles: jest.fn().mockImplementation(async (node) => node),
}))

describe('createDirectoryDiffs', () => {
  it('should group diffs by directory path', () => {
    const rootNode: DiffNode = {
      path: '',
      diffs: [
        { file: 'src/components/Button.tsx', diff: 'diff1', summary: 'Button', tokenCount: 100 },
        { file: 'src/components/Input.tsx', diff: 'diff2', summary: 'Input', tokenCount: 150 },
        { file: 'src/utils/helpers.ts', diff: 'diff3', summary: 'helpers', tokenCount: 200 },
      ],
      children: [],
    }

    const result = createDirectoryDiffs(rootNode)

    expect(result).toHaveLength(2)

    const componentsGroup = result.find((g) => g.path === 'src/components')
    expect(componentsGroup).toBeDefined()
    expect(componentsGroup?.diffs).toHaveLength(2)
    expect(componentsGroup?.tokenCount).toBe(250)

    const utilsGroup = result.find((g) => g.path === 'src/utils')
    expect(utilsGroup).toBeDefined()
    expect(utilsGroup?.diffs).toHaveLength(1)
    expect(utilsGroup?.tokenCount).toBe(200)
  })

  it('should handle nested children', () => {
    const rootNode: DiffNode = {
      path: '',
      diffs: [],
      children: [
        {
          path: 'src',
          diffs: [{ file: 'src/index.ts', diff: 'diff1', summary: 'index', tokenCount: 50 }],
          children: [
            {
              path: 'src/lib',
              diffs: [{ file: 'src/lib/utils.ts', diff: 'diff2', summary: 'utils', tokenCount: 75 }],
              children: [],
            },
          ],
        },
      ],
    }

    const result = createDirectoryDiffs(rootNode)

    expect(result).toHaveLength(2)
    expect(result.find((g) => g.path === 'src')).toBeDefined()
    expect(result.find((g) => g.path === 'src/lib')).toBeDefined()
  })

  it('should handle empty node', () => {
    const rootNode: DiffNode = {
      path: '',
      diffs: [],
      children: [],
    }

    const result = createDirectoryDiffs(rootNode)
    expect(result).toHaveLength(0)
  })
})

describe('summarizeDirectoryDiff', () => {
  const mockTokenizer = (text: string) => Math.ceil(text.length / 4)
  const mockChain = {} as never
  const mockTextSplitter = {} as never

  it('should summarize directory and update token count', async () => {
    const directory = {
      path: 'src/components',
      diffs: [
        { file: 'src/components/A.tsx', diff: 'a'.repeat(400), summary: 'A', tokenCount: 100 },
        { file: 'src/components/B.tsx', diff: 'b'.repeat(400), summary: 'B', tokenCount: 100 },
      ],
      tokenCount: 200,
    }

    const result = await summarizeDirectoryDiff(directory, {
      chain: mockChain,
      textSplitter: mockTextSplitter,
      tokenizer: mockTokenizer,
    })

    expect(result.path).toBe('src/components')
    expect(result.summary).toBeDefined()
    expect(result.summary).toContain('Summary')
    expect(result.diffs).toEqual(directory.diffs) // Original diffs preserved
  })
})

describe('summarizeDiffs', () => {
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

  it('should skip summarization when total tokens under maxTokens', async () => {
    const rootNode: DiffNode = {
      path: '',
      diffs: [
        { file: 'src/small.ts', diff: 'small change', summary: 'small', tokenCount: 100 },
      ],
      children: [],
    }

    const result = await summarizeDiffs(rootNode, {
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      maxTokens: 2048,
      minTokensForSummary: 400,
      maxConcurrent: 6,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    // Should contain raw diff, not summary
    expect(result).toContain('small change')
    expect(mockLogger.verbose).toHaveBeenCalledWith(
      expect.stringContaining('Already under token budget'),
      expect.any(Object)
    )
  })

  it('should summarize when total tokens exceed maxTokens', async () => {
    const rootNode: DiffNode = {
      path: '',
      diffs: [
        { file: 'src/large1.ts', diff: 'a'.repeat(2000), summary: 'large1', tokenCount: 500 },
        { file: 'src/large2.ts', diff: 'b'.repeat(2000), summary: 'large2', tokenCount: 500 },
        { file: 'src/large3.ts', diff: 'c'.repeat(2000), summary: 'large3', tokenCount: 500 },
      ],
      children: [],
    }

    const result = await summarizeDiffs(rootNode, {
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      maxTokens: 1000, // Total is 1500, so needs summarization
      minTokensForSummary: 400,
      maxConcurrent: 6,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    // Should contain summary
    expect(result).toContain('Summary')
  })

  it('should not summarize directories below minTokensForSummary', async () => {
    const rootNode: DiffNode = {
      path: '',
      diffs: [
        { file: 'src/small.ts', diff: 'small', summary: 'small', tokenCount: 200 },
        { file: 'lib/large.ts', diff: 'a'.repeat(2000), summary: 'large', tokenCount: 600 },
      ],
      children: [],
    }

    const result = await summarizeDiffs(rootNode, {
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      maxTokens: 500, // Needs summarization
      minTokensForSummary: 400, // src/small.ts (200) should be skipped
      maxConcurrent: 6,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    // Large file directory should have summary
    expect(result).toContain('Summary')
    // Small file should still have raw content preserved
    expect(result).toContain('small')
  })

  it('should use default maxFileTokens as 25% of maxTokens', async () => {
    const preprocessLargeFilesMock = jest.requireMock('./summarizeLargeFiles').preprocessLargeFiles

    const rootNode: DiffNode = {
      path: '',
      diffs: [{ file: 'test.ts', diff: 'test', summary: 'test', tokenCount: 100 }],
      children: [],
    }

    await summarizeDiffs(rootNode, {
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      maxTokens: 2000,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    // preprocessLargeFiles should be called with maxFileTokens = 500 (25% of 2000)
    expect(preprocessLargeFilesMock).toHaveBeenCalledWith(
      rootNode,
      expect.objectContaining({
        maxFileTokens: 500,
      })
    )
  })

  it('should respect custom maxFileTokens', async () => {
    const preprocessLargeFilesMock = jest.requireMock('./summarizeLargeFiles').preprocessLargeFiles

    const rootNode: DiffNode = {
      path: '',
      diffs: [{ file: 'test.ts', diff: 'test', summary: 'test', tokenCount: 100 }],
      children: [],
    }

    await summarizeDiffs(rootNode, {
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      maxTokens: 2000,
      maxFileTokens: 300, // Custom value
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    expect(preprocessLargeFilesMock).toHaveBeenCalledWith(
      rootNode,
      expect.objectContaining({
        maxFileTokens: 300,
      })
    )
  })

  it('should format output correctly', async () => {
    const rootNode: DiffNode = {
      path: '',
      diffs: [
        { file: 'src/components/Button.tsx', diff: 'button code', summary: 'Button component', tokenCount: 100 },
      ],
      children: [],
    }

    const result = await summarizeDiffs(rootNode, {
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      maxTokens: 2048,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    expect(result).toContain('changes in "/src/components"')
    expect(result).toContain('Button component')
    expect(result).toContain('button code')
  })
})
