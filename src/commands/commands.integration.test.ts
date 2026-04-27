import { Arguments } from 'yargs'
import { handler as changelogHandler } from './changelog/handler'
import { ChangelogOptions } from './changelog/config'
import { handler as commitHandler } from './commit/handler'
import { CommitOptions } from './commit/config'
import { loadConfig } from '../lib/config/utils/loadConfig'
import { executeChain } from '../lib/langchain/utils/executeChain'
import { executeChainWithSchema } from '../lib/langchain/utils/executeChainWithSchema'
import { getLlm } from '../lib/langchain/utils/getLlm'
import { getTokenCounter } from '../lib/utils/tokenizer'
import { Logger } from '../lib/utils/logger'
import { Config } from '../commands/types'
import { createTempGitRepo, TempGitRepo } from '../lib/testUtils/tempGitRepo'

jest.mock('@langchain/classic/chains', () => ({
  loadSummarizationChain: jest.fn().mockReturnValue({}),
}))

jest.mock('../lib/config/utils/loadConfig')
jest.mock('../lib/langchain/utils', () => {
  const actual = jest.requireActual('../lib/langchain/utils')

  return {
    ...actual,
    getApiKeyForModel: jest.fn().mockReturnValue('mock-api-key'),
    getModelAndProviderFromConfig: jest.fn().mockReturnValue({
      provider: 'openai',
      model: 'gpt-4o',
    }),
  }
})
jest.mock('../lib/langchain/utils/createSchemaParser', () => ({
  createSchemaParser: jest.fn().mockReturnValue({}),
}))
jest.mock('../lib/langchain/utils/executeChain')
jest.mock('../lib/langchain/utils/executeChainWithSchema')
jest.mock('../lib/langchain/utils/getLlm')
jest.mock('../lib/utils/tokenizer')
jest.mock('../lib/ui/logSuccess', () => ({
  logSuccess: jest.fn(),
}))
jest.mock('../lib/utils/hasCommitlintConfig', () => ({
  hasCommitlintConfig: jest.fn().mockResolvedValue(false),
}))

const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockExecuteChain = executeChain as jest.MockedFunction<typeof executeChain>
const mockExecuteChainWithSchema = executeChainWithSchema as jest.MockedFunction<
  typeof executeChainWithSchema
>
const mockGetLlm = getLlm as jest.MockedFunction<typeof getLlm>
const mockGetTokenCounter = getTokenCounter as jest.MockedFunction<typeof getTokenCounter>

jest.setTimeout(15000)

const serviceConfig = {
  authentication: {
    type: 'APIKey',
    credentials: {
      apiKey: 'mock-api-key',
    },
  },
  provider: 'openai',
  model: 'gpt-4o',
  tokenLimit: 4096,
  temperature: 0.2,
  maxConcurrent: 2,
  minTokensForSummary: 400,
  maxFileTokens: 2000,
}

function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    service: serviceConfig,
    defaultBranch: 'main',
    mode: 'stdout',
    interactive: false,
    ignoredFiles: [],
    ignoredExtensions: [],
    includeBranchName: false,
    conventionalCommits: false,
    openInEditor: false,
    noVerify: true,
    ...overrides,
  } as unknown as Config
}

function createLogger(): Logger {
  return {
    log: jest.fn(),
    verbose: jest.fn(),
    setConfig: jest.fn(),
    startTimer: jest.fn().mockReturnThis(),
    stopTimer: jest.fn().mockReturnThis(),
    startSpinner: jest.fn().mockReturnThis(),
    stopSpinner: jest.fn().mockReturnThis(),
  } as unknown as Logger
}

describe('command integration with temp git repos', () => {
  const originalCwd = process.cwd()
  let repo: TempGitRepo
  let stdout = ''
  let stdoutSpy: jest.SpyInstance

  beforeEach(async () => {
    repo = await createTempGitRepo()
    process.chdir(repo.path)
    stdout = ''
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk)
      return true
    })

    mockGetLlm.mockReturnValue({} as unknown as ReturnType<typeof getLlm>)
    mockGetTokenCounter.mockResolvedValue((text: string) => Math.ceil(text.length / 4))
    mockExecuteChain.mockResolvedValue({
      title: 'Generated changelog',
      content: '- Summarized feature work',
    })
    mockExecuteChainWithSchema.mockResolvedValue({
      title: 'test: commit staged readme',
      body: 'Commit the staged README file.',
    })
  })

  afterEach(async () => {
    stdoutSpy.mockRestore()
    jest.clearAllMocks()
    process.chdir(originalCwd)
    await repo.cleanup()
  })

  it('generates a commit message from real staged git status and diff collection', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    await repo.writeFile('.gitkeep', '\n')
    await repo.commitAll('chore: initial commit')
    await repo.writeFile('README.md', '# Temp repo\n')
    await repo.git.add('README.md')

    await commitHandler({
      $0: 'coco',
      _: ['commit'],
      interactive: false,
      openInEditor: false,
      ignoredFiles: [],
      ignoredExtensions: [],
      withPreviousCommits: 0,
      conventional: false,
      includeBranchName: false,
      noDiff: false,
      noVerify: true,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<CommitOptions>, createLogger())

    const status = await repo.git.status()
    const variables = mockExecuteChainWithSchema.mock.calls[0][3] as Record<string, string>

    expect(stdout).toContain('test: commit staged readme')
    expect(status.staged).toContain('README.md')
    expect(variables.summary).toContain('README.md')
    expect(variables.summary).toContain('# Temp repo')
  })

  it('prints a non-mutating commit split plan for staged files', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))
    mockExecuteChainWithSchema.mockResolvedValueOnce({
      groups: [
        {
          title: 'docs: update readme',
          body: 'Document the temp repo.',
          rationale: 'README-only documentation change.',
          files: ['README.md'],
        },
        {
          title: 'test: add feature fixture',
          body: 'Add a feature fixture file.',
          rationale: 'Fixture code belongs in its own commit.',
          files: ['src/feature.ts'],
        },
      ],
    })

    await repo.writeFile('.gitkeep', '\n')
    await repo.commitAll('chore: initial commit')
    await repo.writeFile('README.md', '# Temp repo\n')
    await repo.writeFile('src/feature.ts', 'export const feature = true\n')
    await repo.git.add(['README.md', 'src/feature.ts'])

    await commitHandler({
      $0: 'coco',
      _: ['commit', 'split'],
      interactive: false,
      openInEditor: false,
      ignoredFiles: [],
      ignoredExtensions: [],
      withPreviousCommits: 0,
      conventional: false,
      includeBranchName: false,
      noDiff: false,
      noVerify: true,
      split: true,
      plan: true,
      apply: false,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<CommitOptions>, createLogger())

    const status = await repo.git.status()

    expect(stdout).toContain('docs: update readme')
    expect(stdout).toContain('test: add feature fixture')
    expect(status.staged).toEqual(expect.arrayContaining(['README.md', 'src/feature.ts']))
  })

  it('applies a file-level commit split plan using real git commits', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))
    mockExecuteChainWithSchema.mockResolvedValueOnce({
      groups: [
        {
          title: 'docs: update readme',
          body: 'Document the temp repo.',
          rationale: 'README-only documentation change.',
          files: ['README.md'],
        },
        {
          title: 'test: add feature fixture',
          body: 'Add a feature fixture file.',
          rationale: 'Fixture code belongs in its own commit.',
          files: ['src/feature.ts'],
        },
      ],
    })

    await repo.writeFile('.gitkeep', '\n')
    await repo.commitAll('chore: initial commit')
    await repo.writeFile('README.md', '# Temp repo\n')
    await repo.writeFile('src/feature.ts', 'export const feature = true\n')
    await repo.git.add(['README.md', 'src/feature.ts'])

    await commitHandler({
      $0: 'coco',
      _: ['commit', 'split'],
      interactive: false,
      openInEditor: false,
      ignoredFiles: [],
      ignoredExtensions: [],
      withPreviousCommits: 0,
      conventional: false,
      includeBranchName: false,
      noDiff: false,
      noVerify: true,
      split: true,
      plan: false,
      apply: true,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<CommitOptions>, createLogger())

    const log = await repo.git.log()
    const status = await repo.git.status()

    expect(stdout).toContain('Created 2 split commit(s).')
    expect(log.all.map((commit) => commit.message)).toEqual(
      expect.arrayContaining(['docs: update readme', 'test: add feature fixture'])
    )
    expect(status.files).toHaveLength(0)
  })

  it('generates a changelog from real branch commit history', async () => {
    mockLoadConfig.mockImplementation((argv) => createConfig({
      ...(argv as Record<string, unknown>),
      mode: 'stdout',
    }))

    await repo.writeFile('README.md', '# Temp repo\n')
    await repo.commitAll('chore: initial commit')
    await repo.git.checkoutLocalBranch('feature/changelog-test')
    await repo.writeFile('src/feature.ts', 'export const feature = true\n')
    await repo.commitAll('feat: add feature module')

    await changelogHandler({
      $0: 'coco',
      _: ['changelog'],
      branch: 'main',
      range: '',
      tag: '',
      sinceLastTag: false,
      withDiff: false,
      onlyDiff: false,
      interactive: false,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<ChangelogOptions>, createLogger())

    const variables = mockExecuteChain.mock.calls[0][0].variables as Record<string, string>

    expect(stdout).toContain('Generated changelog')
    expect(stdout).toContain('- Summarized feature work')
    expect(variables.summary).toContain('feat: add feature module')
    expect(variables.summary).toContain('feature/changelog-test')
  })
})
