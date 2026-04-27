import { Arguments } from 'yargs'
import { loadSummarizationChain } from '@langchain/classic/chains'
import { handler as changelogHandler } from './changelog/handler'
import { ChangelogOptions } from './changelog/config'
import { handler as commitHandler } from './commit/handler'
import { CommitOptions } from './commit/config'
import { handler as logHandler } from './log/handler'
import { LogOptions } from './log/config'
import { handler as reviewHandler } from './review/handler'
import { ReviewOptions } from './review/config'
import { loadConfig } from '../lib/config/utils/loadConfig'
import { executeChain } from '../lib/langchain/utils/executeChain'
import { executeChainWithSchema } from '../lib/langchain/utils/executeChainWithSchema'
import { getLlm } from '../lib/langchain/utils/getLlm'
import { getTokenCounter } from '../lib/utils/tokenizer'
import { Logger } from '../lib/utils/logger'
import { Config } from '../commands/types'
import { createTempGitRepo, TempGitRepo } from '../lib/testUtils/tempGitRepo'

jest.mock('@langchain/classic/chains', () => ({
  loadSummarizationChain: jest.fn(),
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
jest.mock('../lib/ui/TaskList', () => ({
  TaskList: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
  })),
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
const mockLoadSummarizationChain = loadSummarizationChain as jest.MockedFunction<
  typeof loadSummarizationChain
>

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
    mockLoadSummarizationChain.mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ text: 'condensed large diff summary' }),
    } as never)
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

  it('routes dynamic commit and summarize models through the commit command', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
      service: {
        ...serviceConfig,
        model: 'dynamic',
        dynamicModels: {
          commit: 'gpt-4.1',
          summarize: 'gpt-4.1-nano',
        },
      },
    } as unknown as Config))

    await repo.writeFile('.gitkeep', '\n')
    await repo.commitAll('chore: initial commit')
    await repo.writeFile('README.md', '# Dynamic repo\n')
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

    expect(mockGetLlm).toHaveBeenCalledWith(
      'openai',
      'gpt-4.1',
      expect.objectContaining({
        service: expect.objectContaining({
          model: 'gpt-4.1',
        }),
      })
    )
    expect(mockGetLlm).toHaveBeenCalledWith(
      'openai',
      'gpt-4.1-nano',
      expect.objectContaining({
        service: expect.objectContaining({
          model: 'gpt-4.1-nano',
        }),
      })
    )
  })

  it('keeps large staged commit summarization calls bounded', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
      service: {
        ...serviceConfig,
        tokenLimit: 2500,
        minTokensForSummary: 50,
        maxFileTokens: 1000,
        maxConcurrent: 4,
      },
    } as unknown as Config))

    await repo.writeFile('.gitkeep', '\n')
    await repo.commitAll('chore: initial commit')

    for (let index = 0; index < 60; index++) {
      await repo.writeFile(
        `src/large/file-${index}.ts`,
        [
          `export const value${index} = ${index}`,
          `export const label${index} = "large staged change ${index}"`,
          `export function feature${index}() {`,
          `  return value${index}`,
          '}',
          '',
        ].join('\n')
      )
    }
    await repo.git.add('src/large')

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

    const variables = mockExecuteChainWithSchema.mock.calls[0][3] as Record<string, string>

    const summarizeInvoke = (mockLoadSummarizationChain.mock.results[0].value as {
      invoke: jest.Mock
    }).invoke

    expect(summarizeInvoke).toHaveBeenCalled()
    expect(summarizeInvoke.mock.calls.length).toBeLessThanOrEqual(2)
    expect(mockExecuteChainWithSchema).toHaveBeenCalledTimes(1)
    expect(variables.summary).toContain('condensed large diff summary')
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

  it('applies a hunk-level commit split plan within a single file', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))
    mockExecuteChainWithSchema.mockResolvedValueOnce({
      groups: [
        {
          title: 'feat: update first behavior',
          body: 'Update the first behavior in the shared module.',
          rationale: 'The first hunk is an independent behavior change.',
          files: [],
          hunks: ['src/feature.ts::hunk-1'],
        },
        {
          title: 'fix: update second behavior',
          body: 'Update the second behavior in the shared module.',
          rationale: 'The second hunk is an independent behavior change.',
          files: [],
          hunks: ['src/feature.ts::hunk-2'],
        },
      ],
    })

    await repo.writeFile(
      'src/feature.ts',
      [
        'export const first = "old"',
        'const spacer1 = 1',
        'const spacer2 = 2',
        'const spacer3 = 3',
        'const spacer4 = 4',
        'const spacer5 = 5',
        'const spacer6 = 6',
        'const spacer7 = 7',
        'const spacer8 = 8',
        'export const second = "old"',
        '',
      ].join('\n')
    )
    await repo.commitAll('chore: initial feature')
    await repo.writeFile(
      'src/feature.ts',
      [
        'export const first = "new"',
        'const spacer1 = 1',
        'const spacer2 = 2',
        'const spacer3 = 3',
        'const spacer4 = 4',
        'const spacer5 = 5',
        'const spacer6 = 6',
        'const spacer7 = 7',
        'const spacer8 = 8',
        'export const second = "new"',
        '',
      ].join('\n')
    )
    await repo.git.add('src/feature.ts')

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
    const firstCommit = await repo.git.show(['HEAD~1:src/feature.ts'])
    const secondCommit = await repo.git.show(['HEAD:src/feature.ts'])
    const status = await repo.git.status()
    const variables = mockExecuteChainWithSchema.mock.calls[0][3] as Record<string, string>

    expect(stdout).toContain('Created 2 split commit(s).')
    expect(log.all.map((commit) => commit.message)).toEqual(
      expect.arrayContaining(['feat: update first behavior', 'fix: update second behavior'])
    )
    expect(firstCommit).toContain('export const first = "new"')
    expect(firstCommit).toContain('export const second = "old"')
    expect(secondCommit).toContain('export const first = "new"')
    expect(secondCommit).toContain('export const second = "new"')
    expect(status.files).toHaveLength(0)
    expect(variables.hunk_inventory).toContain('src/feature.ts::hunk-1')
    expect(variables.hunk_inventory).toContain('src/feature.ts::hunk-2')
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

  it('reviews real working tree changes from a temp git repo', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))
    mockExecuteChain.mockResolvedValueOnce([
      {
        title: 'Review finding',
        summary: 'Check README wording.',
        severity: 4,
        category: 'maintainability',
        filePath: 'README.md',
      },
    ])

    await repo.writeFile('README.md', '# Temp repo\n')
    await repo.commitAll('chore: initial commit')
    await repo.writeFile('README.md', '# Temp repo\n\nUpdated documentation.\n')

    await reviewHandler({
      $0: 'coco',
      _: ['review'],
      branch: '',
      interactive: false,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<ReviewOptions>, createLogger())

    const variables = mockExecuteChain.mock.calls[0][0].variables as Record<string, string>

    expect(variables.changes).toContain('README.md')
    expect(variables.changes).toContain('Updated documentation')
  })

  it('reviews real branch diffs from a temp git repo', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))
    mockExecuteChain.mockResolvedValueOnce([
      {
        title: 'Review finding',
        summary: 'Check feature module.',
        severity: 5,
        category: 'maintainability',
        filePath: 'src/feature.ts',
      },
    ])

    await repo.writeFile('README.md', '# Temp repo\n')
    await repo.commitAll('chore: initial commit')
    await repo.git.checkoutLocalBranch('feature/review-test')
    await repo.writeFile('src/feature.ts', 'export const feature = true\n')
    await repo.commitAll('feat: add review feature')

    await reviewHandler({
      $0: 'coco',
      _: ['review'],
      branch: 'main',
      interactive: false,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<ReviewOptions>, createLogger())

    const variables = mockExecuteChain.mock.calls[0][0].variables as Record<string, string>

    expect(variables.changes).toContain('src/feature.ts')
    expect(variables.changes).toContain('export const feature = true')
  })

  it('prints a visual git log with refs and graph metadata', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    await repo.writeFile('README.md', '# Temp repo\n')
    await repo.commitAll('chore: initial commit')
    await repo.git.addTag('v0.1.0')
    await repo.git.checkoutLocalBranch('feature/log-test')
    await repo.writeFile('src/feature.ts', 'export const feature = true\n')
    await repo.commitAll('feat: add log feature')

    await logHandler({
      $0: 'coco',
      _: ['log'],
      all: true,
      format: 'table',
      limit: 10,
      interactive: false,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<LogOptions>, createLogger())

    expect(stdout).toContain('Graph')
    expect(stdout).toContain('Commit')
    expect(stdout).toContain('feat: add log feature')
    expect(stdout).toContain('v0.1.0')
    expect(stdout).toContain('*')
  })

  it('prints log output when interactive mode is requested', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    await repo.writeFile('README.md', '# Temp repo\n')
    await repo.commitAll('chore: initial commit')
    await repo.writeFile('src/interactive.ts', 'export const interactive = true\n')
    await repo.commitAll('feat: add interactive log coverage')

    await logHandler({
      $0: 'coco',
      _: ['log'],
      format: 'table',
      limit: 2,
      interactive: true,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<LogOptions>, createLogger())

    expect(stdout).toContain('feat: add interactive log coverage')
    expect(stdout).toContain('Graph')
  })

  it('prints machine-readable git log output', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    await repo.writeFile('README.md', '# Temp repo\n')
    await repo.commitAll('chore: initial commit')
    await repo.writeFile('src/feature.ts', 'export const feature = true\n')
    await repo.commitAll('feat: add json log output')

    await logHandler({
      $0: 'coco',
      _: ['log'],
      format: 'json',
      limit: 2,
      interactive: false,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<LogOptions>, createLogger())

    const entries = JSON.parse(stdout)

    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual(expect.objectContaining({
      message: 'feat: add json log output',
      shortHash: expect.any(String),
      hash: expect.any(String),
      refs: expect.any(Array),
    }))
  })

  it('shows changed files for a selected commit', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    await repo.writeFile('README.md', '# Temp repo\n')
    await repo.commitAll('chore: initial commit')
    await repo.writeFile('src/detail.ts', 'export const detail = true\n')
    await repo.commitAll('feat: add commit detail file')

    const commit = (await repo.git.revparse(['HEAD'])).trim()

    await logHandler({
      $0: 'coco',
      _: ['log'],
      commit,
      format: 'table',
      interactive: false,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<LogOptions>, createLogger())

    expect(stdout).toContain(`commit ${commit}`)
    expect(stdout).toContain('feat: add commit detail file')
    expect(stdout).toContain('Changed files:')
    expect(stdout).toContain('A  src/detail.ts')
  })
})
