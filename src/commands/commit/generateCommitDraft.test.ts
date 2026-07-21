import { Arguments } from 'yargs'
import { SimpleGit } from 'simple-git'

import { generateCommitDraft } from './generateCommitDraft'
import { CommitOptions } from './config'
import { Config } from '../../commands/types'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { resolveDynamicService } from '../../lib/langchain/utils/dynamicModels'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { getTokenCounterForProvider } from '../../lib/utils/tokenizer'
import { fileChangeParser } from '../../lib/parsers/default'
import { getChanges } from '../../lib/simple-git/getChanges'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { getPreviousCommits } from '../../lib/simple-git/getPreviousCommits'
import { hasCommitlintConfig } from '../../lib/utils/hasCommitlintConfig'
import { executeChainWithSchema } from '../../lib/langchain/utils/executeChainWithSchema'

jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/langchain/utils')
jest.mock('../../lib/langchain/utils/dynamicModels')
jest.mock('../../lib/langchain/utils/getLlm')
jest.mock('../../lib/utils/tokenizer')
jest.mock('../../lib/parsers/default')
jest.mock('../../lib/simple-git/getChanges')
jest.mock('../../lib/simple-git/getCurrentBranchName')
jest.mock('../../lib/simple-git/getPreviousCommits')
jest.mock('../../lib/utils/hasCommitlintConfig')
jest.mock('../../lib/langchain/utils/executeChainWithSchema')

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>
const mockGetModelAndProviderFromConfig = getModelAndProviderFromConfig as jest.MockedFunction<
  typeof getModelAndProviderFromConfig
>
const mockResolveDynamicService = resolveDynamicService as jest.MockedFunction<
  typeof resolveDynamicService
>
const mockGetLlm = getLlm as jest.MockedFunction<typeof getLlm>
const mockGetTokenCounterForProvider = getTokenCounterForProvider as jest.MockedFunction<
  typeof getTokenCounterForProvider
>
const mockFileChangeParser = fileChangeParser as jest.MockedFunction<typeof fileChangeParser>
const mockGetChanges = getChanges as jest.MockedFunction<typeof getChanges>
const mockGetCurrentBranchName = getCurrentBranchName as jest.MockedFunction<
  typeof getCurrentBranchName
>
const mockGetPreviousCommits = getPreviousCommits as jest.MockedFunction<typeof getPreviousCommits>
const mockHasCommitlintConfig = hasCommitlintConfig as jest.MockedFunction<
  typeof hasCommitlintConfig
>
const mockExecuteChainWithSchema = executeChainWithSchema as jest.MockedFunction<
  typeof executeChainWithSchema
>

// Deterministic stand-in for tiktoken: 1 character == 1 token. Makes the
// budget math exact and independent of any real tokenizer/model.
const charTokenizer = (text: string) => text.length

function buildConfig(overrides: Record<string, unknown> = {}): Config {
  return {
    service: {
      authentication: { type: 'None' },
      provider: 'openai',
      model: 'gpt-4o',
      tokenLimit: 4096,
    },
    hideCocoBanner: false,
    noDiff: false,
    ignoredFiles: [],
    ignoredExtensions: [],
    includeBranchName: true,
    conventionalCommits: false,
    openInEditor: false,
    mode: 'stdout',
    ...overrides,
  } as unknown as Config
}

function buildArgv(overrides: Partial<CommitOptions> = {}): Arguments<CommitOptions> {
  return {
    $0: 'coco',
    _: ['commit'],
    interactive: false,
    openInEditor: false,
    ignoredFiles: [],
    ignoredExtensions: [],
    withPreviousCommits: 0,
    conventional: false,
    includeBranchName: true,
    noVerify: false,
    verbose: false,
    version: false,
    help: false,
    ...overrides,
  } as Arguments<CommitOptions>
}

describe('generateCommitDraft — diff summary budgeting (OSS-504 / #1459)', () => {
  const git = {
    status: jest.fn().mockResolvedValue({
      files: [{ path: 'src/index.ts', index: 'M', working_dir: ' ' }],
    }),
  } as unknown as SimpleGit

  beforeEach(() => {
    jest.clearAllMocks()

    mockGetApiKeyForModel.mockReturnValue('test-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({ provider: 'openai', model: 'gpt-4o' })
    mockResolveDynamicService.mockImplementation((config, task) => ({
      ...(config.service as Record<string, unknown>),
      model: task === 'commit' ? 'commit-model' : 'summarize-model',
    }) as ReturnType<typeof resolveDynamicService>)
    mockGetLlm.mockResolvedValue({} as Awaited<ReturnType<typeof getLlm>>)
    mockGetTokenCounterForProvider.mockResolvedValue(charTokenizer)
    mockGetChanges.mockResolvedValue({
      staged: [{ filePath: 'src/index.ts', status: 'modified', summary: 'changed' }],
      unstaged: [],
      untracked: [],
    } as unknown as Awaited<ReturnType<typeof getChanges>>)
    mockGetCurrentBranchName.mockResolvedValue('main')
    mockGetPreviousCommits.mockResolvedValue('')
    mockHasCommitlintConfig.mockResolvedValue(false)
    mockExecuteChainWithSchema.mockResolvedValue({ title: 'feat: test change', body: 'Test body.' })
  })

  it('budgets the summarizer below the raw tokenLimit, leaving headroom for prompt overhead', async () => {
    mockLoadConfig.mockReturnValue(buildConfig() as never)
    mockFileChangeParser.mockResolvedValue('a short summary')

    await generateCommitDraft({ git, argv: buildArgv() })

    expect(mockFileChangeParser).toHaveBeenCalledTimes(1)
    const callArgs = mockFileChangeParser.mock.calls[0][0] as unknown as {
      options: { maxTokens: number }
    }
    // Must leave room for format instructions, history, branch/commitlint
    // context, and the response reserve — never the full 4096 tokenLimit.
    expect(callArgs.options.maxTokens).toBeLessThan(4096)
    expect(callArgs.options.maxTokens).toBeGreaterThanOrEqual(512)
  })

  it('does not re-truncate a summary that legitimately fills its (reduced) budget', async () => {
    mockLoadConfig.mockReturnValue(buildConfig() as never)
    // Simulate the summarizer maxing out whatever budget it was given —
    // exactly reproduces the ticket's "summarization succeeded but at the
    // full limit" scenario.
    mockFileChangeParser.mockImplementation(async (params) => {
      const { options } = params as unknown as { options: { maxTokens: number } }
      return 'x'.repeat(options.maxTokens)
    })

    await generateCommitDraft({ git, argv: buildArgv() })

    const requestedBudget = (
      mockFileChangeParser.mock.calls[0][0] as unknown as { options: { maxTokens: number } }
    ).options.maxTokens

    expect(mockExecuteChainWithSchema).toHaveBeenCalledTimes(1)
    const variables = mockExecuteChainWithSchema.mock.calls[0][3] as { summary: string }
    // Before the fix, the final enforcePromptBudget call re-budgeted this
    // already-maxed summary against the same tokenLimit and silently
    // trimmed it further. After the fix, the up-front budget already left
    // headroom, so the final check is a no-op and the full summary survives.
    expect(variables.summary.length).toBe(requestedBudget)
  })

  it('reconciles the 2048/4096 fallback mismatch: an unset tokenLimit resolves to 4096 for both stages', async () => {
    const config = buildConfig()
    delete (config.service as { tokenLimit?: number }).tokenLimit
    mockLoadConfig.mockReturnValue(config as never)
    mockFileChangeParser.mockImplementation(async (params) => {
      const { options } = params as unknown as { options: { maxTokens: number } }
      return 'x'.repeat(options.maxTokens)
    })

    await generateCommitDraft({ git, argv: buildArgv() })

    const requestedBudget = (
      mockFileChangeParser.mock.calls[0][0] as unknown as { options: { maxTokens: number } }
    ).options.maxTokens
    const variables = mockExecuteChainWithSchema.mock.calls[0][3] as { summary: string }

    // Budget derives from the 4096 default, not the stray 2048 fallback —
    // and the final prompt check remains a no-op even without an explicit
    // config.service.tokenLimit.
    expect(requestedBudget).toBeGreaterThan(2048 - 512)
    expect(variables.summary.length).toBe(requestedBudget)
  })

  it('skips LLM summarization entirely for noDiff without an explicit changeSource', async () => {
    mockLoadConfig.mockReturnValue(buildConfig({ noDiff: true }) as never)

    const result = await generateCommitDraft({ git, argv: buildArgv({ noDiff: true }) })

    expect(mockFileChangeParser).not.toHaveBeenCalled()
    expect(mockGetChanges).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })
})

describe('generateCommitDraft — language_context propagation (OSS-989 / #1683)', () => {
  const git = {
    status: jest.fn().mockResolvedValue({
      files: [{ path: 'src/index.ts', index: 'M', working_dir: ' ' }],
    }),
  } as unknown as SimpleGit

  beforeEach(() => {
    jest.clearAllMocks()

    mockGetApiKeyForModel.mockReturnValue('test-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({ provider: 'openai', model: 'gpt-4o' })
    mockResolveDynamicService.mockImplementation((config, task) => ({
      ...(config.service as Record<string, unknown>),
      model: task === 'commit' ? 'commit-model' : 'summarize-model',
    }) as ReturnType<typeof resolveDynamicService>)
    mockGetLlm.mockResolvedValue({} as Awaited<ReturnType<typeof getLlm>>)
    mockGetTokenCounterForProvider.mockResolvedValue(charTokenizer)
    mockGetChanges.mockResolvedValue({
      staged: [{ filePath: 'src/index.ts', status: 'modified', summary: 'changed' }],
      unstaged: [],
      untracked: [],
    } as unknown as Awaited<ReturnType<typeof getChanges>>)
    mockGetCurrentBranchName.mockResolvedValue('main')
    mockGetPreviousCommits.mockResolvedValue('')
    mockHasCommitlintConfig.mockResolvedValue(false)
    mockExecuteChainWithSchema.mockResolvedValue({ title: 'feat: test change', body: 'Test body.' })
    mockFileChangeParser.mockResolvedValue('a short summary')
  })

  it('passes a language_context built from config.language to the prompt variables', async () => {
    mockLoadConfig.mockReturnValue(buildConfig({ language: 'German' }) as never)

    await generateCommitDraft({ git, argv: buildArgv() })

    const variables = mockExecuteChainWithSchema.mock.calls[0][3] as { language_context: string }
    expect(variables.language_context).toContain('Write the commit message in German.')
  })

  it('prefers argv.language over config.language', async () => {
    mockLoadConfig.mockReturnValue(buildConfig({ language: 'German' }) as never)

    await generateCommitDraft({ git, argv: buildArgv({ language: 'French' }) })

    const variables = mockExecuteChainWithSchema.mock.calls[0][3] as { language_context: string }
    expect(variables.language_context).toContain('Write the commit message in French.')
  })

  it('appends the conventional-tokens caveat when conventionalCommits is enabled', async () => {
    mockLoadConfig.mockReturnValue(
      buildConfig({ language: 'German', conventionalCommits: true }) as never
    )

    await generateCommitDraft({ git, argv: buildArgv({ conventional: true }) })

    const variables = mockExecuteChainWithSchema.mock.calls[0][3] as { language_context: string }
    expect(variables.language_context).toContain(
      'Keep the Conventional Commits type/scope tokens (e.g. feat, fix, chore) in English.'
    )
  })

  it('renders an empty language_context when no language is configured', async () => {
    mockLoadConfig.mockReturnValue(buildConfig() as never)

    await generateCommitDraft({ git, argv: buildArgv() })

    const variables = mockExecuteChainWithSchema.mock.calls[0][3] as { language_context: string }
    expect(variables.language_context).toBe('')
  })
})
