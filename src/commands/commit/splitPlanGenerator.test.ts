import { PromptTemplate } from '@langchain/core/prompts'
import { executeChainWithSchema } from '../../lib/langchain/utils/executeChainWithSchema'
import { FileChange } from '../../lib/types'
import {
  generateValidatedCommitSplitPlan,
  NO_PREVIOUS_FEEDBACK_PLACEHOLDER,
} from './splitPlanGenerator'
import { CommitSplitPlan } from './splitPlanTypes'

jest.mock('../../lib/langchain/utils/executeChainWithSchema')

const mockExecuteChainWithSchema = executeChainWithSchema as jest.MockedFunction<
  typeof executeChainWithSchema
>

const stagedFile = (filePath: string): FileChange => ({
  filePath,
  status: 'modified',
  summary: '',
})

const noopPrompt = PromptTemplate.fromTemplate('noop')

const baseArgs = () => ({
  llm: {} as never,
  prompt: noopPrompt,
  variables: { file_inventory: '', hunk_inventory: '', summary: '', additional_context: '' },
  staged: [stagedFile('a.ts'), stagedFile('b.ts')],
})

describe('generateValidatedCommitSplitPlan', () => {
  beforeEach(() => {
    mockExecuteChainWithSchema.mockReset()
  })

  it('returns immediately when the first plan is valid', async () => {
    const validPlan: CommitSplitPlan = {
      groups: [
        { title: 'a', files: ['a.ts'], hunks: [] },
        { title: 'b', files: ['b.ts'], hunks: [] },
      ],
    }
    mockExecuteChainWithSchema.mockResolvedValueOnce(validPlan)

    const result = await generateValidatedCommitSplitPlan(baseArgs())

    expect(result.attempts).toBe(1)
    // toStrictEqual rather than toBe — the generator now passes the
    // raw plan through rescuePhantomHunks which returns a new object,
    // so reference equality no longer holds. The semantic content is
    // identical when the plan has no phantom hunks to rescue.
    expect(result.plan).toStrictEqual(validPlan)
    expect(mockExecuteChainWithSchema).toHaveBeenCalledTimes(1)

    const variables = mockExecuteChainWithSchema.mock.calls[0][3] as Record<string, unknown>
    expect(variables.previous_attempt_feedback).toBe(NO_PREVIOUS_FEEDBACK_PLACEHOLDER)
  })

  it('feeds validator complaints back into a retry attempt and succeeds', async () => {
    const invalidPlan: CommitSplitPlan = {
      groups: [{ title: 'a', files: ['a.ts'], hunks: [] }],
    }
    const validPlan: CommitSplitPlan = {
      groups: [
        { title: 'a', files: ['a.ts'], hunks: [] },
        { title: 'b', files: ['b.ts'], hunks: [] },
      ],
    }

    mockExecuteChainWithSchema
      .mockResolvedValueOnce(invalidPlan)
      .mockResolvedValueOnce(validPlan)

    const result = await generateValidatedCommitSplitPlan(baseArgs())

    expect(result.attempts).toBe(2)
    // toStrictEqual rather than toBe — the generator now passes the
    // raw plan through rescuePhantomHunks which returns a new object,
    // so reference equality no longer holds. The semantic content is
    // identical when the plan has no phantom hunks to rescue.
    expect(result.plan).toStrictEqual(validPlan)
    expect(mockExecuteChainWithSchema).toHaveBeenCalledTimes(2)

    const firstCallVars = mockExecuteChainWithSchema.mock.calls[0][3] as Record<string, unknown>
    const secondCallVars = mockExecuteChainWithSchema.mock.calls[1][3] as Record<string, unknown>

    expect(firstCallVars.previous_attempt_feedback).toBe(NO_PREVIOUS_FEEDBACK_PLACEHOLDER)
    expect(String(secondCallVars.previous_attempt_feedback)).toContain('Staged files missing')
    expect(String(secondCallVars.previous_attempt_feedback)).toContain('b.ts')
  })

  it('rescues phantom hunks before validation when the inventory is empty', async () => {
    // Regression for the #916 failure pattern: LLM emits hunk IDs
    // against an empty inventory (all staged files are new/added),
    // validator rejects, retry loop never recovers. With the rescue
    // pass, the same LLM output validates on the first attempt.
    const phantomHunkPlan: CommitSplitPlan = {
      groups: [
        {
          title: 'feat: a/b',
          files: [],
          hunks: ['a.ts::hunk-1', 'b.ts::hunk-1'],
        },
      ],
    }
    mockExecuteChainWithSchema.mockResolvedValueOnce(phantomHunkPlan)

    // baseArgs() has 2 staged files (a.ts, b.ts) and no hunk inventory.
    const result = await generateValidatedCommitSplitPlan(baseArgs())

    expect(result.attempts).toBe(1)
    // Phantom hunks promoted to files; the rescued plan validates
    // because the staged files are now claimed via files[].
    expect(result.plan.groups[0].files).toEqual(['a.ts', 'b.ts'])
    expect(result.plan.groups[0].hunks).toEqual([])
    expect(mockExecuteChainWithSchema).toHaveBeenCalledTimes(1)
  })

  it('rescues mixed-mode file claims before validation (#919 regression)', async () => {
    // Exact pattern from #919 manual testing on dirty-many-files:
    // src/index.ts is the only modified file (has real hunks), but
    // the LLM put it BOTH in group A's files[] AND used its hunks in
    // group B's hunks[]. Validator's mixedFiles check rejected it
    // for 3 attempts running. With rescueMixedFiles, the same output
    // validates on the first attempt.
    // baseArgs() has 2 staged files (a.ts, b.ts); include b.ts in
    // group 2 so the plan satisfies file-coverage post-rescue.
    const mixedPlan: CommitSplitPlan = {
      groups: [
        { title: 'feat: integration', files: ['a.ts'], hunks: [] },
        { title: 'feat: misc', files: ['b.ts'], hunks: ['a.ts::hunk-1'] },
      ],
    }
    mockExecuteChainWithSchema.mockResolvedValueOnce(mixedPlan)

    // Override baseArgs to provide an inventory with real hunks for a.ts
    // — this is what makes the mixedFiles validation kick in (without
    // inventory, the hunks would just get phantom-rescued).
    const inventoryWithRealHunks = {
      byId: new Map([['a.ts::hunk-1', { id: 'a.ts::hunk-1', filePath: 'a.ts' }]]),
      byFile: new Map([['a.ts', [{ id: 'a.ts::hunk-1', filePath: 'a.ts' }]]]),
    }
    const result = await generateValidatedCommitSplitPlan({
      ...baseArgs(),
      hunkInventory: inventoryWithRealHunks,
    })

    expect(result.attempts).toBe(1)
    expect(result.plan.groups[0].files).toEqual(['a.ts'])
    expect(result.plan.groups[1].hunks).toEqual([])
    expect(mockExecuteChainWithSchema).toHaveBeenCalledTimes(1)
  })

  it('throws after exhausting retries with the final validator complaints in the message', async () => {
    const invalidPlan: CommitSplitPlan = {
      groups: [{ title: 'a', files: ['a.ts'], hunks: [] }],
    }
    mockExecuteChainWithSchema.mockResolvedValue(invalidPlan)

    await expect(
      generateValidatedCommitSplitPlan({ ...baseArgs(), maxAttempts: 2 })
    ).rejects.toThrow(/after 2 attempts.*missing files: b\.ts/i)

    expect(mockExecuteChainWithSchema).toHaveBeenCalledTimes(2)
  })

  it('tags each LLM call with an incrementing planAttempt in metadata', async () => {
    const invalidPlan: CommitSplitPlan = {
      groups: [{ title: 'a', files: ['a.ts'], hunks: [] }],
    }
    const validPlan: CommitSplitPlan = {
      groups: [
        { title: 'a', files: ['a.ts'], hunks: [] },
        { title: 'b', files: ['b.ts'], hunks: [] },
      ],
    }

    mockExecuteChainWithSchema
      .mockResolvedValueOnce(invalidPlan)
      .mockResolvedValueOnce(validPlan)

    await generateValidatedCommitSplitPlan(baseArgs())

    const firstOptions = mockExecuteChainWithSchema.mock.calls[0][4] as { metadata?: Record<string, unknown> }
    const secondOptions = mockExecuteChainWithSchema.mock.calls[1][4] as { metadata?: Record<string, unknown> }
    expect(firstOptions.metadata?.planAttempt).toBe(1)
    expect(secondOptions.metadata?.planAttempt).toBe(2)
  })
})
