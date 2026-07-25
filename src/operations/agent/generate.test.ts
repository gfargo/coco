import * as fs from 'node:fs'
import * as path from 'node:path'

import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { detectLocalDefaultBranch, getProviderRepositoryForGit } from '../../git/providerData'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { resolveDynamicService } from '../../lib/langchain/utils/dynamicModels'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getTokenCounterForProvider } from '../../lib/utils/tokenizer'
import { Logger } from '../../lib/utils/logger'
import { AgentOperationContext, resolveChangeSource } from './context'
import { AgentOperationError } from './errors'
import { generateAgentPrDraft } from './generate'
import { AgentTaskInputSchema } from './schemas'

jest.mock('../../lib/simple-git/getCurrentBranchName')
jest.mock('../../git/providerData')
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/langchain/utils')
jest.mock('../../lib/langchain/utils/dynamicModels')
jest.mock('../../lib/langchain/utils/executeChain')
jest.mock('../../lib/langchain/utils/getLlm')
jest.mock('../../lib/utils/tokenizer')
jest.mock('../../lib/langchain/utils/createSchemaParser', () => ({
  createSchemaParser: jest.fn().mockReturnValue({}),
}))
jest.mock('./context', () => ({
  ...jest.requireActual('./context'),
  resolveChangeSource: jest.fn(),
}))

const mockGetCurrentBranchName = getCurrentBranchName as jest.MockedFunction<typeof getCurrentBranchName>
const mockDetectLocalDefaultBranch = detectLocalDefaultBranch as jest.MockedFunction<typeof detectLocalDefaultBranch>
const mockGetProviderRepositoryForGit = getProviderRepositoryForGit as jest.MockedFunction<typeof getProviderRepositoryForGit>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>
const mockGetModelAndProviderFromConfig = getModelAndProviderFromConfig as jest.MockedFunction<typeof getModelAndProviderFromConfig>
const mockResolveDynamicService = resolveDynamicService as jest.MockedFunction<typeof resolveDynamicService>
const mockExecuteChain = executeChain as jest.MockedFunction<typeof executeChain>
const mockGetLlm = getLlm as jest.MockedFunction<typeof getLlm>
const mockGetTokenCounterForProvider = getTokenCounterForProvider as jest.MockedFunction<typeof getTokenCounterForProvider>
const mockResolveChangeSource = resolveChangeSource as jest.MockedFunction<typeof resolveChangeSource>

function createContext(): AgentOperationContext {
  return {
    repoRoot: '/repo',
    git: {} as AgentOperationContext['git'],
    logger: new Logger({ silent: true }),
    surface: 'agent-cli',
    signal: undefined,
  }
}

const resolvedMeta = {
  kind: 'repository' as const,
  digest: 'sha256:test',
  repositoryHead: 'abc123',
  verification: 'repository-derived' as const,
}

describe('generateAgentPrDraft', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCurrentBranchName.mockResolvedValue('feature/x')
    mockDetectLocalDefaultBranch.mockResolvedValue('main')
    mockGetProviderRepositoryForGit.mockResolvedValue({
      provider: 'github',
      remote: 'origin',
    })
    mockLoadConfig.mockReturnValue({
      service: { authentication: { type: 'None' }, tokenLimit: 4096 },
      prompt: undefined,
    } as never)
    mockGetApiKeyForModel.mockReturnValue('key')
    mockGetModelAndProviderFromConfig.mockReturnValue({ provider: 'openai' } as never)
    mockResolveDynamicService.mockReturnValue({ model: 'gpt-5.4' } as never)
    mockGetLlm.mockResolvedValue({} as never)
    mockGetTokenCounterForProvider.mockResolvedValue((() => 10) as never)
    mockResolveChangeSource.mockResolvedValue({ text: 'diff --git a/a b/a', meta: resolvedMeta })
    mockExecuteChain.mockResolvedValue({ title: 'Add feature', content: 'Body details.' })
  })

  it('drafts a title/body from the branch diff and echoes base/head/draft', async () => {
    const input = AgentTaskInputSchema.parse({ options: { base: 'develop', draft: true } })

    const result = await generateAgentPrDraft(input, createContext())

    expect(mockResolveChangeSource).toHaveBeenCalledWith(
      { kind: 'repository', scope: { type: 'branch', base: 'develop', head: 'feature/x' } },
      expect.anything(),
      expect.objectContaining({ trustRepositoryConfig: false }),
    )
    expect(result.data).toEqual({
      base: 'develop',
      head: 'feature/x',
      title: 'Add feature',
      body: 'Body details.',
      draft: true,
    })
    expect(result.meta).toEqual(resolvedMeta)
  })

  it('falls back to the detected default branch when no base override is supplied', async () => {
    const input = AgentTaskInputSchema.parse({})

    const result = await generateAgentPrDraft(input, createContext())

    expect(mockDetectLocalDefaultBranch).toHaveBeenCalled()
    expect(result.data.base).toBe('main')
    expect(result.data.draft).toBe(false)
  })

  it('rejects when already on the base branch, using forge-aware terminology', async () => {
    mockGetCurrentBranchName.mockResolvedValue('main')
    mockGetProviderRepositoryForGit.mockResolvedValue({
      provider: 'gitlab',
      remote: 'origin',
    })
    const input = AgentTaskInputSchema.parse({ options: { base: 'main' } })

    await expect(generateAgentPrDraft(input, createContext())).rejects.toMatchObject({
      code: 'NO_CHANGES',
      message: expect.stringContaining('merge request'),
    })
    expect(mockResolveChangeSource).not.toHaveBeenCalled()
  })

  it('surfaces a friendly NO_CHANGES error when the branch has no commits ahead of base', async () => {
    mockResolveChangeSource.mockRejectedValue(
      new AgentOperationError('NO_CHANGES', 'No changes were found for the requested source.'),
    )
    const input = AgentTaskInputSchema.parse({ options: { base: 'develop' } })

    await expect(generateAgentPrDraft(input, createContext())).rejects.toMatchObject({
      code: 'NO_CHANGES',
      message: expect.stringContaining("'develop'"),
    })
  })

  it('rejects when the branch cannot be determined (detached HEAD)', async () => {
    mockGetCurrentBranchName.mockResolvedValue('')
    const input = AgentTaskInputSchema.parse({})

    await expect(generateAgentPrDraft(input, createContext())).rejects.toMatchObject({
      code: 'INVALID_REPOSITORY',
    })
  })
})

describe('generate.ts forge-mutation safety', () => {
  it('never references forge mutation APIs — pr-draft must stay generation-only', () => {
    const source = fs.readFileSync(path.join(__dirname, 'generate.ts'), 'utf8')
    expect(source).not.toMatch(/forgeActions|createPullRequest|openPullRequest/)
  })
})
