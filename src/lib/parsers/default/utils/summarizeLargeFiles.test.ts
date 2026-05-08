import { FileDiff, DiffNode } from '../../../types'
import { summarize } from '../../../langchain/chains/summarize'
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

const mockSummarize = summarize as jest.MockedFunction<typeof summarize>

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

  it('skips later large files once the running total drops under maxTokens', async () => {
    // Three large files, sum 10500 tokens. With maxTokens=8000 and a
    // mock summarizer that collapses each call to ~1 token (very small
    // synthetic summary), summarizing the first file alone is enough
    // to drop the total under budget — the remaining two should skip.
    const diffs: FileDiff[] = [
      { file: 'a.ts', diff: 'a'.repeat(20000), summary: 'a.ts', tokenCount: 5000 },
      { file: 'b.ts', diff: 'b'.repeat(12000), summary: 'b.ts', tokenCount: 3000 },
      { file: 'c.ts', diff: 'c'.repeat(10000), summary: 'c.ts', tokenCount: 2500 },
    ]

    const result = await summarizeLargeFiles(diffs, {
      maxFileTokens: 1000,
      minTokensForSummary: 400,
      maxConcurrent: 1, // serialize so the budget check is deterministic
      maxTokens: 8000,
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    // Only the largest file should have been sent to the LLM.
    expect(mockSummarize).toHaveBeenCalledTimes(1)

    // First file (largest, dispatched first) is summarized.
    expect(result[0].diff).toContain('Summary')

    // Remaining two files keep their raw diffs — never sent to the LLM.
    expect(result[1]).toEqual(diffs[1])
    expect(result[2]).toEqual(diffs[2])

    expect(mockLogger.verbose).toHaveBeenCalledWith(
      expect.stringContaining('Skipped 2 pre-summary call(s)'),
      expect.any(Object)
    )
  })

  it('summarizes every eligible file when maxTokens is omitted (backward compat)', async () => {
    const diffs: FileDiff[] = [
      { file: 'a.ts', diff: 'a'.repeat(20000), summary: 'a.ts', tokenCount: 5000 },
      { file: 'b.ts', diff: 'b'.repeat(12000), summary: 'b.ts', tokenCount: 3000 },
      { file: 'c.ts', diff: 'c'.repeat(10000), summary: 'c.ts', tokenCount: 2500 },
    ]

    await summarizeLargeFiles(diffs, {
      maxFileTokens: 1000,
      minTokensForSummary: 400,
      maxConcurrent: 1,
      // no maxTokens — old behavior: every eligible file is summarized
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    expect(mockSummarize).toHaveBeenCalledTimes(3)
  })

  it('still summarizes every file when the budget cannot be met by the eligible set', async () => {
    // Three large files. maxTokens=100 is unreachable even after every
    // file is summarized to ~1 token, so no skip should fire.
    const diffs: FileDiff[] = [
      { file: 'a.ts', diff: 'a'.repeat(20000), summary: 'a.ts', tokenCount: 5000 },
      { file: 'b.ts', diff: 'b'.repeat(12000), summary: 'b.ts', tokenCount: 3000 },
      { file: 'c.ts', diff: 'c'.repeat(10000), summary: 'c.ts', tokenCount: 2500 },
    ]

    await summarizeLargeFiles(diffs, {
      maxFileTokens: 1000,
      minTokensForSummary: 400,
      maxConcurrent: 1,
      maxTokens: 100,
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    expect(mockSummarize).toHaveBeenCalledTimes(3)
  })

  it('dispatches biggest-first so a single big file can short-circuit the rest', async () => {
    // Files defined in non-sorted order. The largest one (b.ts) should
    // be summarized first, regardless of array position.
    const diffs: FileDiff[] = [
      { file: 'small-a.ts', diff: 'a'.repeat(8000), summary: 'small-a.ts', tokenCount: 2000 },
      { file: 'big-b.ts', diff: 'b'.repeat(40000), summary: 'big-b.ts', tokenCount: 10000 },
      { file: 'small-c.ts', diff: 'c'.repeat(8000), summary: 'small-c.ts', tokenCount: 2000 },
    ]

    await summarizeLargeFiles(diffs, {
      maxFileTokens: 1000,
      minTokensForSummary: 400,
      maxConcurrent: 1,
      maxTokens: 5000, // total is 14000; summarizing big-b alone collapses it under budget
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    expect(mockSummarize).toHaveBeenCalledTimes(1)
    // The single call should have processed big-b.ts (the largest).
    const firstCallDocs = mockSummarize.mock.calls[0][0] as { metadata?: { file?: string } }[]
    expect(firstCallDocs[0]?.metadata?.file).toBe('big-b.ts')
  })

  it('routes markdown modification diffs to the LLM by default (fastPath off)', async () => {
    const markdownDiff = [
      'diff --git a/docs/intro.md b/docs/intro.md',
      'index aaa..bbb 100644',
      '--- a/docs/intro.md',
      '+++ b/docs/intro.md',
      '@@ -1,5 +1,8 @@',
      ' some context',
      '-the old wording for the intro',
      '-another old sentence that was here',
      '+## New section',
      '+plenty of new prose lines making this large',
      '+more new prose',
    ].join('\n')

    const diffs: FileDiff[] = [
      {
        file: 'docs/intro.md',
        diff: markdownDiff,
        summary: 'docs/intro.md',
        tokenCount: 600,
      },
    ]

    await summarizeLargeFiles(diffs, {
      maxFileTokens: 500,
      minTokensForSummary: 400,
      maxConcurrent: 4,
      // no fastPath -> markdown still goes to LLM
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    expect(mockSummarize).toHaveBeenCalledTimes(1)
  })

  it('routes markdown modification diffs to the templated extract when fastPath.markdown is enabled', async () => {
    const markdownDiff = [
      'diff --git a/docs/intro.md b/docs/intro.md',
      'index aaa..bbb 100644',
      '--- a/docs/intro.md',
      '+++ b/docs/intro.md',
      '@@ -1,5 +1,8 @@',
      ' some context',
      '-the old wording for the intro',
      '-another old sentence that was here',
      '+## New section',
      '+plenty of new prose lines making this large',
      '+more new prose',
    ].join('\n')

    const diffs: FileDiff[] = [
      {
        file: 'docs/intro.md',
        diff: markdownDiff,
        summary: 'docs/intro.md',
        tokenCount: 600,
      },
    ]

    const result = await summarizeLargeFiles(diffs, {
      maxFileTokens: 500,
      minTokensForSummary: 400,
      maxConcurrent: 4,
      fastPath: { markdown: true },
      tokenizer: mockTokenizer,
      logger: mockLogger as never,
      chain: mockChain,
      textSplitter: mockTextSplitter,
    })

    expect(mockSummarize).not.toHaveBeenCalled()
    expect(result[0].diff).toContain('Updated markdown')
    expect(result[0].diff).toContain('New section')
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
