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
    expect(result.plan).toBe(validPlan)
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
    expect(result.plan).toBe(validPlan)
    expect(mockExecuteChainWithSchema).toHaveBeenCalledTimes(2)

    const firstCallVars = mockExecuteChainWithSchema.mock.calls[0][3] as Record<string, unknown>
    const secondCallVars = mockExecuteChainWithSchema.mock.calls[1][3] as Record<string, unknown>

    expect(firstCallVars.previous_attempt_feedback).toBe(NO_PREVIOUS_FEEDBACK_PLACEHOLDER)
    expect(String(secondCallVars.previous_attempt_feedback)).toContain('Staged files missing')
    expect(String(secondCallVars.previous_attempt_feedback)).toContain('b.ts')
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
