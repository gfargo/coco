/**
 * Tests that additionalContext is wired into the review and recap prompt
 * templates and that the agent generation functions pass it through.
 *
 * Follows the pattern established by conventionsContextPromptWiring.test.ts
 * (#1956) for prompt-level assertions, and generate.test.ts for agent-level
 * assertions.
 */

import { PromptTemplate } from '@langchain/core/prompts'

import { getPrompt } from '../../lib/langchain/utils/getPrompt'
import { RECAP_PROMPT } from '../../commands/recap/prompt'
import { REVIEW_PROMPT } from '../../commands/review/prompt'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { executeChainStreaming } from '../../lib/langchain/utils/executeChainStreaming'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { resolveDynamicService } from '../../lib/langchain/utils/dynamicModels'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getTokenCounterForProvider } from '../../lib/utils/tokenizer'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { AgentOperationContext, resolveChangeSource } from './context'
import { generateAgentReview, generateAgentRecap } from './generate'
import { AgentOptionsSchema, AgentTaskInput } from './schemas'

// ─── Mock setup (mirrors generate.test.ts) ───────────────────────────────────

jest.mock('./context', () => ({
  resolveChangeSource: jest.fn(),
  getConventionsContext: jest.fn().mockReturnValue({ text: '', provenance: null }),
}))
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/langchain/utils')
jest.mock('../../lib/langchain/utils/dynamicModels')
jest.mock('../../lib/langchain/utils/getLlm')
jest.mock('../../lib/utils/tokenizer')
jest.mock('../../lib/langchain/utils/executeChain')
jest.mock('../../lib/langchain/utils/executeChainStreaming')
jest.mock('../../lib/langchain/utils/createSchemaParser', () => ({
  createSchemaParser: jest.fn().mockReturnValue({}),
}))

const mockResolveChangeSource = resolveChangeSource as jest.MockedFunction<typeof resolveChangeSource>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>
const mockGetModelAndProviderFromConfig = getModelAndProviderFromConfig as jest.MockedFunction<
  typeof getModelAndProviderFromConfig
>
const mockResolveDynamicService = resolveDynamicService as jest.MockedFunction<typeof resolveDynamicService>
const mockGetLlm = getLlm as jest.MockedFunction<typeof getLlm>
const mockGetTokenCounterForProvider = getTokenCounterForProvider as jest.MockedFunction<
  typeof getTokenCounterForProvider
>
const mockExecuteChain = executeChain as jest.MockedFunction<typeof executeChain>
const mockExecuteChainStreaming = executeChainStreaming as jest.MockedFunction<typeof executeChainStreaming>

// ─── Prompt-template tests ────────────────────────────────────────────────────

const TEMPLATES: { name: string; template: PromptTemplate }[] = [
  { name: 'REVIEW_PROMPT', template: REVIEW_PROMPT },
  { name: 'RECAP_PROMPT', template: RECAP_PROMPT },
]

// Rebuild with mustache format, matching how executeStructured renders them.
function renderableFor(template: PromptTemplate): PromptTemplate {
  return getPrompt({
    template: template.template as string,
    variables: template.inputVariables,
    fallback: template,
  })
}

describe('additionalContext prompt wiring (#1837)', () => {
  describe('prompt inputVariables', () => {
    it.each(TEMPLATES)('$name declares additional_context as an input variable', ({ template }) => {
      expect(template.inputVariables).toContain('additional_context')
    })
  })

  describe('prompt rendering with supplied additionalContext', () => {
    it.each(TEMPLATES)('$name renders supplied additional_context content into the output', async ({ template }) => {
      const variables = Object.fromEntries(
        template.inputVariables.map((key) => [
          key,
          key === 'additional_context'
            ? '## Additional Context\nThis file is auto-generated; ignore style findings.'
            : 'placeholder',
        ])
      )

      const rendered = await renderableFor(template).format(variables)
      expect(rendered).toContain('This file is auto-generated; ignore style findings.')
    })
  })

  describe('prompt rendering with empty additionalContext (CLI path)', () => {
    it.each(TEMPLATES)('$name renders an empty additional_context without throwing', async ({ template }) => {
      const variables = Object.fromEntries(
        template.inputVariables.map((key) => [key, key === 'additional_context' ? '' : 'placeholder'])
      )

      await expect(renderableFor(template).format(variables)).resolves.toEqual(expect.any(String))
    })
  })
})

// ─── Agent generation tests ───────────────────────────────────────────────────

const baseInput: AgentTaskInput = {
  version: 1,
  source: { kind: 'summary', summary: 'Implemented the thing.' },
  options: AgentOptionsSchema.parse({}),
}

function makeContext(): AgentOperationContext {
  return {
    repoRoot: '/repo',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    git: {} as any,
    logger: { setConfig: jest.fn(), verbose: jest.fn() } as unknown as AgentOperationContext['logger'],
    surface: 'mcp',
  }
}

describe('generateAgentReview — additionalContext forwarding', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveChangeSource.mockResolvedValue({
      text: 'diff content',
      meta: { kind: 'summary', digest: 'sha256:test', verification: 'provided-unverified' },
    })
    mockLoadConfig.mockReturnValue({
      service: {
        tokenLimit: 100000,
        authentication: { type: 'None' },
        streaming: { enabled: false },
        provider: 'test-provider',
      },
      prompt: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    mockGetApiKeyForModel.mockReturnValue('test-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({ provider: 'test-provider' } as never)
    mockResolveDynamicService.mockReturnValue({ model: 'test-model' } as never)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetLlm.mockResolvedValue({} as any)
    mockGetTokenCounterForProvider.mockResolvedValue(((text: string) => text.length) as never)
    mockExecuteChain.mockResolvedValue([{
      title: 'finding',
      summary: 'summary',
      severity: 5,
      category: 'bug',
      filePath: 'a.ts',
    }] as never)
    mockExecuteChainStreaming.mockResolvedValue([{
      title: 'finding',
      summary: 'summary',
      severity: 5,
      category: 'bug',
      filePath: 'a.ts',
    }] as never)
  })

  it('passes additionalContext in the formatted prompt variables when supplied', async () => {
    const inputWithContext: AgentTaskInput = {
      ...baseInput,
      options: AgentOptionsSchema.parse({ additionalContext: 'Ticket: COCO-999 — ignore generated files.' }),
    }

    await generateAgentReview(inputWithContext, makeContext())

    expect(mockExecuteChain).toHaveBeenCalledTimes(1)
    const calledVariables = mockExecuteChain.mock.calls[0][0].variables as Record<string, string>
    expect(calledVariables.additional_context).toContain('COCO-999')
    expect(calledVariables.additional_context).toContain('## Additional Context')
  })

  it('passes an empty string for additional_context when additionalContext is omitted', async () => {
    await generateAgentReview(baseInput, makeContext())

    expect(mockExecuteChain).toHaveBeenCalledTimes(1)
    const calledVariables = mockExecuteChain.mock.calls[0][0].variables as Record<string, string>
    expect(calledVariables.additional_context).toBe('')
  })
})

describe('generateAgentRecap — additionalContext forwarding', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveChangeSource.mockResolvedValue({
      text: 'diff content',
      meta: { kind: 'summary', digest: 'sha256:test', verification: 'provided-unverified' },
    })
    mockLoadConfig.mockReturnValue({
      service: {
        tokenLimit: 100000,
        authentication: { type: 'None' },
        streaming: { enabled: false },
        provider: 'test-provider',
      },
      prompt: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    mockGetApiKeyForModel.mockReturnValue('test-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({ provider: 'test-provider' } as never)
    mockResolveDynamicService.mockReturnValue({ model: 'test-model' } as never)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetLlm.mockResolvedValue({} as any)
    mockGetTokenCounterForProvider.mockResolvedValue(((text: string) => text.length) as never)
    mockExecuteChain.mockResolvedValue({ title: 'Recap title', summary: 'Recap summary.' } as never)
    mockExecuteChainStreaming.mockResolvedValue({ title: 'Recap title', summary: 'Recap summary.' } as never)
  })

  it('passes additionalContext in the formatted prompt variables when supplied', async () => {
    const inputWithContext: AgentTaskInput = {
      ...baseInput,
      options: AgentOptionsSchema.parse({ additionalContext: 'Focus on the authentication changes.' }),
    }

    await generateAgentRecap(inputWithContext, makeContext())

    expect(mockExecuteChain).toHaveBeenCalledTimes(1)
    const calledVariables = mockExecuteChain.mock.calls[0][0].variables as Record<string, string>
    expect(calledVariables.additional_context).toContain('authentication changes')
    expect(calledVariables.additional_context).toContain('## Additional Context')
  })

  it('passes an empty string for additional_context when additionalContext is omitted', async () => {
    await generateAgentRecap(baseInput, makeContext())

    expect(mockExecuteChain).toHaveBeenCalledTimes(1)
    const calledVariables = mockExecuteChain.mock.calls[0][0].variables as Record<string, string>
    expect(calledVariables.additional_context).toBe('')
  })
})
