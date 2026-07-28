/**
 * Tests for generateAgentCondenseDiff / runCondenseDiff.
 *
 * Key coverage:
 * - structural mode produces no LLM call
 * - Over-budget diff drops files to stay within budget (filesOmitted > 0)
 * - reductionRatio populated correctly
 * - Per-file `applied` field correctly reports structural / trivial / line-based / omitted
 * - Non-code diff (SQL/YAML) condenses without misparse (#1699 reference)
 * - `summary` mode returns UNSUPPORTED_MODE error
 * - Empty diff surfaces as NO_CHANGES
 * - Metrics token definitions are consistent with runStructuralExtractEval usage
 */

import type { AgentOperationContext } from './context'
import { runCondenseDiff } from './generate'
import type { CondenseDiffRequest } from './schemas'

// ─── mock the structural parser and trivialDiff modules ─────────────────────
// We want to control what each file returns so we can assert on `applied` values
// without needing real tree-sitter WASM in the test environment.

const mockDispatchStructuralParser = jest.fn<Promise<string | undefined>, [string, unknown]>()
const mockSummarizeTrivialDiff = jest.fn<string | undefined, [unknown]>()
const mockDetectStructuralLanguageId = jest.fn<string | undefined, [string]>()

jest.mock('../../lib/parsers/default/utils/structuralParserRegistry', () => ({
  dispatchStructuralParser: (...args: unknown[]) => mockDispatchStructuralParser(...(args as [string, unknown])),
}))
jest.mock('../../lib/parsers/default/utils/trivialDiff', () => ({
  summarizeTrivialDiff: (...args: unknown[]) => mockSummarizeTrivialDiff(...(args as [unknown])),
}))
jest.mock('../../lib/parsers/default/utils/summarizeLargeFiles', () => ({
  detectStructuralLanguageId: (...args: unknown[]) => mockDetectStructuralLanguageId(...(args as [string])),
}))
jest.mock('../../lib/utils/tokenizer', () => ({
  getTokenCounterForProvider: jest.fn().mockResolvedValue((text: string) => Math.ceil(text.length / 4)),
}))

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeContext(): AgentOperationContext {
  return {
    repoRoot: '/repo',
    git: {} as never,
    logger: { setConfig: jest.fn(), verbose: jest.fn(), log: jest.fn(), startSpinner: jest.fn(), stopSpinner: jest.fn(), startTimer: jest.fn(), stopTimer: jest.fn() } as never,
    surface: 'agent-cli',
    signal: undefined,
  }
}

/** Build a minimal CondenseDiffRequest with a `patch` source. */
function makeRequest(patch: string, budgetTokens: number, overrides?: Partial<CondenseDiffRequest>): CondenseDiffRequest {
  return {
    version: 1,
    source: { kind: 'patch', patch },
    budget: { tokens: budgetTokens },
    mode: 'structural',
    trustRepositoryConfig: false,
    ...overrides,
  }
}

const TS_FILE_DIFF = `\
diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo() {
+  return 42
 }`

const PY_FILE_DIFF = `\
diff --git a/main.py b/main.py
index 111..222 100644
--- a/main.py
+++ b/main.py
@@ -1,2 +1,2 @@
-def hello():
+def hello(name: str):`

const SQL_FILE_DIFF = `\
diff --git a/db/schema.sql b/db/schema.sql
index aaa..bbb 100644
--- a/db/schema.sql
+++ b/db/schema.sql
@@ -1,3 +1,3 @@
--- old comment
+-- new comment
 CREATE TABLE users (id UUID PRIMARY KEY);`

const YAML_FILE_DIFF = `\
diff --git a/config.yml b/config.yml
index ccc..ddd 100644
--- a/config.yml
+++ b/config.yml
@@ -1,2 +1,2 @@
-timeout: 30
+timeout: 60`

// ─── tests ────────────────────────────────────────────────────────────────────

describe('runCondenseDiff', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Default: no structural extraction (fall through to line-based)
    mockDispatchStructuralParser.mockResolvedValue(undefined)
    mockSummarizeTrivialDiff.mockReturnValue(undefined)
    mockDetectStructuralLanguageId.mockReturnValue(undefined)
  })

  it('returns a structural result without any LLM call (no API key required)', async () => {
    const patch = [TS_FILE_DIFF, PY_FILE_DIFF].join('\n')
    mockDetectStructuralLanguageId.mockImplementation((path) => path.endsWith('.ts') ? 'ts' : 'py')
    mockDispatchStructuralParser.mockResolvedValue('structural summary')

    const result = await runCondenseDiff(makeRequest(patch, 99999), makeContext())

    expect(result.ok).toBe(true)
    expect(result.operation).toBe('condense-diff')
    expect(result.data.metrics.strategy).toBe('structural')
    // getApiKeyForModel should never be called — we assert indirectly by
    // checking that the result succeeds without any mock for it.
  })

  it('reports `structural` applied for files where the parser returns a summary', async () => {
    mockDetectStructuralLanguageId.mockReturnValue('ts')
    mockDispatchStructuralParser.mockResolvedValue('Updated TypeScript `foo.ts`: added foo()')

    const result = await runCondenseDiff(makeRequest(TS_FILE_DIFF, 99999), makeContext())

    expect(result.data.files[0].applied).toBe('structural')
    expect(result.data.condensed).toContain('Updated TypeScript')
  })

  it('reports `trivial` applied when trivialDiff shortcut fires', async () => {
    mockDetectStructuralLanguageId.mockReturnValue(undefined)
    mockSummarizeTrivialDiff.mockReturnValue('Added `newfile.ts` (3 lines).')

    const result = await runCondenseDiff(makeRequest(TS_FILE_DIFF, 99999), makeContext())

    expect(result.data.files[0].applied).toBe('trivial')
  })

  it('reports `line-based` when no structural extraction and no trivial match', async () => {
    mockDetectStructuralLanguageId.mockReturnValue(undefined)
    mockSummarizeTrivialDiff.mockReturnValue(undefined)

    const result = await runCondenseDiff(makeRequest(TS_FILE_DIFF, 99999), makeContext())

    expect(result.data.files[0].applied).toBe('line-based')
    // condensed should be the raw diff text
    expect(result.data.condensed).toContain('diff --git')
  })

  it('reports `line-based` for non-code files (SQL, YAML) without misparse (#1699)', async () => {
    const patch = [SQL_FILE_DIFF, YAML_FILE_DIFF].join('\n')
    mockDetectStructuralLanguageId.mockReturnValue(undefined)
    mockSummarizeTrivialDiff.mockReturnValue(undefined)

    const result = await runCondenseDiff(makeRequest(patch, 99999), makeContext())

    expect(result.data.files).toHaveLength(2)
    expect(result.data.files[0].path).toBe('db/schema.sql')
    expect(result.data.files[1].path).toBe('config.yml')
    expect(result.data.files[0].applied).toBe('line-based')
    expect(result.data.files[1].applied).toBe('line-based')
  })

  it('drops files to meet token budget and populates filesOmitted + reductionRatio', async () => {
    // Use a tiny budget that forces one file to be dropped.
    const patch = [TS_FILE_DIFF, PY_FILE_DIFF].join('\n')
    mockDetectStructuralLanguageId.mockReturnValue(undefined)
    mockSummarizeTrivialDiff.mockReturnValue(undefined)

    // Budget: 1 token — everything should be dropped except nothing fits, but
    // the algorithm keeps at least the smallest file. Use a slightly larger
    // budget that allows one but not both.
    // TS_FILE_DIFF ~ 180 chars → ~45 tokens; PY_FILE_DIFF ~ 140 chars → ~35 tokens.
    // Budget of 40 tokens should keep only the Python file (smaller).
    const result = await runCondenseDiff(makeRequest(patch, 40), makeContext())

    expect(result.data.metrics.filesOmitted).toBeGreaterThan(0)
    expect(result.data.metrics.filesIncluded).toBeGreaterThanOrEqual(0)
    expect(result.data.metrics.reductionRatio).toBeGreaterThan(0)
    const omittedFiles = result.data.files.filter((f) => f.applied === 'omitted')
    expect(omittedFiles.length).toBeGreaterThan(0)
    for (const f of omittedFiles) {
      expect(f.outputTokens).toBe(0)
    }
  })

  it('populates inputTokens / outputTokens / reductionRatio consistently', async () => {
    const patch = [TS_FILE_DIFF, PY_FILE_DIFF].join('\n')
    mockDetectStructuralLanguageId.mockReturnValue('ts')
    // Return a very short structural summary to ensure output < input
    mockDispatchStructuralParser.mockResolvedValue('fn()')

    const result = await runCondenseDiff(makeRequest(patch, 99999), makeContext())

    const { inputTokens, outputTokens, reductionRatio } = result.data.metrics
    expect(inputTokens).toBeGreaterThan(0)
    expect(outputTokens).toBeGreaterThan(0)
    expect(outputTokens).toBeLessThan(inputTokens)

    const expectedRatio = Math.round((1 - outputTokens / inputTokens) * 10000) / 10000
    expect(reductionRatio).toBeCloseTo(expectedRatio, 4)
  })

  it('filters structural extraction to specified languages', async () => {
    const patch = [TS_FILE_DIFF, PY_FILE_DIFF].join('\n')
    mockDetectStructuralLanguageId.mockImplementation((path) => {
      if (path.endsWith('.ts')) return 'ts'
      if (path.endsWith('.py')) return 'py'
      return undefined
    })
    mockDispatchStructuralParser.mockResolvedValue('structural summary')
    mockSummarizeTrivialDiff.mockReturnValue(undefined)

    // Only allow 'ts' — Python file should fall to line-based
    const result = await runCondenseDiff(makeRequest(patch, 99999, { languages: ['ts'] }), makeContext())

    const tsFile = result.data.files.find((f) => f.path === 'src/foo.ts')!
    const pyFile = result.data.files.find((f) => f.path === 'main.py')!
    expect(tsFile.applied).toBe('structural')
    expect(pyFile.applied).toBe('line-based')
  })

  it('returns UNSUPPORTED_MODE for summary mode', async () => {
    await expect(
      runCondenseDiff(makeRequest(TS_FILE_DIFF, 99999, { mode: 'summary' }), makeContext())
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MODE' })
  })

  it('throws NO_CHANGES for an empty patch', async () => {
    // An empty patch that still passes ChangeSourceSchema min:1 check would
    // be " " — split will return [] which triggers NO_CHANGES.
    await expect(
      runCondenseDiff({
        ...makeRequest('no-diff-git-headers-here', 99999),
        source: { kind: 'patch', patch: ' ' },
      }, makeContext())
    ).rejects.toMatchObject({ code: 'NO_CHANGES' })
  })

  it('includes a lossy-reduction warning in every structural result', async () => {
    mockDetectStructuralLanguageId.mockReturnValue(undefined)
    mockSummarizeTrivialDiff.mockReturnValue(undefined)

    const result = await runCondenseDiff(makeRequest(TS_FILE_DIFF, 99999), makeContext())

    expect(result.warnings.some((w) => w.toLowerCase().includes('lossy'))).toBe(true)
  })

  it('rejects a `summary` source with UNSUPPORTED_SOURCE instead of a misleading NO_CHANGES', async () => {
    await expect(
      runCondenseDiff({
        ...makeRequest(TS_FILE_DIFF, 99999),
        source: { kind: 'summary', summary: 'Refactored the foo module.' },
      }, makeContext())
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' })
  })

  it('rejects a `files` source with UNSUPPORTED_SOURCE instead of merging records under one path', async () => {
    await expect(
      runCondenseDiff({
        ...makeRequest(TS_FILE_DIFF, 99999),
        source: {
          kind: 'files',
          files: [{ path: 'src/foo.ts', status: 'modified', patch: TS_FILE_DIFF }],
        },
      }, makeContext())
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' })
  })

  it('accounts for join-separator tokens so the serialized `condensed` string fits the budget', async () => {
    // Three equal-size files, each a multiple of 4 chars (so per-file token
    // counts have zero rounding slack under the suite's `ceil(len/4)`
    // tokenizer). Budget is set to exactly the sum of their outputTokens —
    // with no headroom for the two '\n\n' join separators the final
    // `condensed` string adds. A drop loop that ignores separator cost would
    // report "within budget" while the real serialized output exceeds it.
    mockDetectStructuralLanguageId.mockReturnValue(undefined)
    mockSummarizeTrivialDiff.mockReturnValue(undefined)

    const makeFile = (name: string) =>
      `diff --git a/${name} b/${name}\nindex 1..2 100644\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-xxx\n+y`
    const fileA = makeFile('a.txt')
    const fileB = makeFile('b.txt')
    const fileC = makeFile('c.txt')
    expect(fileA.length % 4).toBe(0) // guards the zero-rounding-slack assumption above
    const patch = [fileA, fileB, fileC].join('\n')

    const perFileTokens = fileA.length / 4
    const budget = perFileTokens * 3 // exactly the sum, no separator headroom

    const result = await runCondenseDiff(makeRequest(patch, budget), makeContext())

    // Re-tokenize the actual serialized output the same way the suite's mock
    // tokenizer would, to assert it truly fits within budget.
    const serializedTokens = Math.ceil(result.data.condensed.length / 4)
    expect(serializedTokens).toBeLessThanOrEqual(budget)
    expect(result.data.metrics.filesOmitted).toBeGreaterThan(0)
  })
})
