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
import { handler as uiHandler } from './ui/handler'
import { UiOptions } from './ui/config'
import { loadConfig } from '../lib/config/utils/loadConfig'
import { executeChain } from '../lib/langchain/utils/executeChain'
import { executeChainWithSchema } from '../lib/langchain/utils/executeChainWithSchema'
import { getLlm } from '../lib/langchain/utils/getLlm'
import { getTokenCounter } from '../lib/utils/tokenizer'
import { Logger } from '../lib/utils/logger'
import { Config } from '../commands/types'
import {
  createTempGitRepo,
  TempGitRepo,
  detachedHeadScenario,
  featureBranchOneCommitScenario,
  singleStagedFileScenario,
  twoCommitFeatureScenario,
} from '@gfargo/git-scenarios'
import { isCommandExitError } from '../lib/utils/commandExit'

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

jest.setTimeout(180000)

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

    await singleStagedFileScenario.setup(repo)

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

    await singleStagedFileScenario.setup(repo)

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

  it('leaves files the plan omitted uncommitted in the worktree (#1180)', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))
    // The model groups README.md but omits scratch.md entirely.
    // rescueMissingFiles tags scratch.md as an `unclaimed` group; the
    // apply must commit README.md and leave scratch.md behind.
    mockExecuteChainWithSchema.mockResolvedValueOnce({
      groups: [
        {
          title: 'docs: update readme',
          body: 'Document the temp repo.',
          files: ['README.md'],
        },
      ],
    })

    await repo.writeFile('.gitkeep', '\n')
    await repo.commitAll('chore: initial commit')
    await repo.writeFile('README.md', '# Temp repo\n')
    await repo.writeFile('scratch.md', 'scratch notes\n')
    await repo.git.add(['README.md', 'scratch.md'])

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

    // Exactly one commit landed — the confident README.md group; the
    // unclaimed scratch.md group was NOT committed.
    expect(stdout).toContain('Created 1 split commit(s).')
    expect(log.all[0].message).toBe('docs: update readme')
    expect(log.all.map((commit) => commit.message)).not.toContain('Left for you — not committed')
    // scratch.md survives in the worktree for the user to handle.
    expect(status.files.map((file) => file.path)).toContain('scratch.md')
    // The README.md commit doesn't sneak scratch.md in.
    const headFiles = (await repo.git.raw(['show', '--name-only', '--pretty=format:', 'HEAD'])).trim()
    expect(headFiles).toContain('README.md')
    expect(headFiles).not.toContain('scratch.md')
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

  it('retries the split plan when the LLM produces an invalid grouping', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    // First attempt references a file that's NOT in the staged set
    // (unknownFiles validator error — no rescue available). Retry
    // covers both real files. Previously this test used "first
    // attempt drops a file" but rescueMissingFiles now auto-recovers
    // that case in a single attempt — to actually exercise the retry
    // loop we need a non-rescuable invalidation.
    mockExecuteChainWithSchema
      .mockResolvedValueOnce({
        groups: [
          {
            title: 'docs: update readme',
            body: 'Document the temp repo.',
            files: ['README.md', 'ghost.ts'],
            hunks: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        groups: [
          {
            title: 'docs: update readme',
            body: 'Document the temp repo.',
            files: ['README.md'],
            hunks: [],
          },
          {
            title: 'test: add feature fixture',
            body: 'Add a feature fixture file.',
            files: ['src/feature.ts'],
            hunks: [],
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

    expect(mockExecuteChainWithSchema).toHaveBeenCalledTimes(2)

    const firstCallVars = mockExecuteChainWithSchema.mock.calls[0][3] as Record<string, string>
    const secondCallVars = mockExecuteChainWithSchema.mock.calls[1][3] as Record<string, string>

    expect(firstCallVars.previous_attempt_feedback).toContain('first attempt')
    expect(secondCallVars.previous_attempt_feedback).toContain('NOT in the staged file inventory')
    expect(secondCallVars.previous_attempt_feedback).toContain('ghost.ts')
    expect(stdout).toContain('docs: update readme')
    expect(stdout).toContain('test: add feature fixture')
  })

  it('falls back to a single-commit plan after retries are exhausted', async () => {
    // Issue #1005: when the LLM can't produce a valid multi-group
    // plan even with retry feedback, the default behaviour is to fall
    // back to a single-group plan that puts every staged file into
    // one commit — strictly better than throwing and leaving the user
    // with a staged worktree and no commit. Strict-mode coverage is
    // in the sibling test below.
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    // unknownFiles invalidation (no rescue available) — guarantees
    // retries actually exhaust. A missing-file invalidation would be
    // auto-rescued on attempt 1.
    mockExecuteChainWithSchema.mockResolvedValue({
      groups: [
        {
          title: 'docs: update readme',
          body: 'Document the temp repo.',
          files: ['README.md', 'ghost.ts'],
          hunks: [],
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

    expect(mockExecuteChainWithSchema).toHaveBeenCalledTimes(3)
    // Fallback plan: one group, both staged files in it, chore: title.
    expect(stdout).toContain('chore: combined commit')
    expect(stdout).toContain('README.md')
    expect(stdout).toContain('src/feature.ts')
  })

  it('throws after exhausting retries when --strict-split is set', async () => {
    // Opt-in strict mode restores the pre-#1005 behaviour: fail
    // loudly instead of degrading to the single-commit fallback.
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    mockExecuteChainWithSchema.mockResolvedValue({
      groups: [
        {
          title: 'docs: update readme',
          body: 'Document the temp repo.',
          files: ['README.md', 'ghost.ts'],
          hunks: [],
        },
      ],
    })

    await repo.writeFile('.gitkeep', '\n')
    await repo.commitAll('chore: initial commit')
    await repo.writeFile('README.md', '# Temp repo\n')
    await repo.writeFile('src/feature.ts', 'export const feature = true\n')
    await repo.git.add(['README.md', 'src/feature.ts'])

    await expect(
      commitHandler({
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
        strictSplit: true,
        verbose: false,
        version: false,
        help: false,
      } as Arguments<CommitOptions>, createLogger())
    ).rejects.toThrow(/after 3 attempts.*unknown files: ghost\.ts/i)

    expect(mockExecuteChainWithSchema).toHaveBeenCalledTimes(3)
  })

  it('generates a changelog from real branch commit history', async () => {
    mockLoadConfig.mockImplementation((argv) => createConfig({
      ...(argv as Record<string, unknown>),
      mode: 'stdout',
    }))

    await featureBranchOneCommitScenario.setup(repo)

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
    expect(variables.summary).toContain('feat/x')
  })

  // Regression — on a detached HEAD the helper used to emit a yellow
  // "Unable to determine first and last commit" line and the handler
  // still walked the LLM through a "No commits found." summarization.
  // Now the helper emits a clean status line, the parser short-circuits
  // to noResult, and the changelog handler exits 0 without an LLM call.
  it('changelog on detached HEAD exits cleanly without an LLM call', async () => {
    mockLoadConfig.mockImplementation((argv) => createConfig({
      ...(argv as Record<string, unknown>),
      mode: 'stdout',
    }))

    await detachedHeadScenario.setup(repo)

    const logger = createLogger()
    try {
      await changelogHandler({
        $0: 'coco',
        _: ['changelog'],
        branch: '',
        range: '',
        tag: '',
        sinceLastTag: false,
        withDiff: false,
        onlyDiff: false,
        interactive: false,
        verbose: false,
        version: false,
        help: false,
      } as Arguments<ChangelogOptions>, logger)
    } catch (error) {
      // commandExit(0) throws CommandExitError — that's the success
      // signal here. Rethrow anything else.
      if (!isCommandExitError(error)) {
        throw error
      }
      expect((error as { code: number }).code).toBe(0)
    }

    const lines = (logger.log as jest.Mock).mock.calls.map(([msg]) => String(msg))
    const joined = lines.join('\n')
    expect(joined).toMatch(/HEAD is detached/i)
    expect(joined).not.toMatch(/Encountered an error/i)
    expect(joined).not.toMatch(/Unable to determine/i)
    expect(mockExecuteChain).not.toHaveBeenCalled()
  })

  it('changelog --json on detached HEAD emits only JSON, no status chrome, on real stdout', async () => {
    mockLoadConfig.mockImplementation((argv) => createConfig({
      ...(argv as Record<string, unknown>),
      mode: 'stdout',
    }))

    await detachedHeadScenario.setup(repo)

    // A real (non-stubbed) Logger is required here: the hand-rolled
    // createLogger() test double's `.log` is a jest.fn() that always
    // "fires" regardless of `setConfig({ silent: true })`, so it can't
    // catch a silencing regression — only a real Logger writing to the
    // real (spied) stdout can.
    const logger = new Logger({})
    try {
      await changelogHandler({
        $0: 'coco',
        _: ['changelog'],
        branch: '',
        range: '',
        tag: '',
        sinceLastTag: false,
        withDiff: false,
        onlyDiff: false,
        interactive: false,
        json: true,
        verbose: false,
        version: false,
        help: false,
      } as Arguments<ChangelogOptions>, logger)
    } catch (error) {
      // commandExit(0) throws CommandExitError — that's the success
      // signal here. Rethrow anything else.
      if (!isCommandExitError(error)) {
        throw error
      }
      expect((error as { code: number }).code).toBe(0)
    }

    expect(stdout.trim()).toBe('null')
    expect(stdout).not.toMatch(/HEAD is detached/i)
    expect(mockExecuteChain).not.toHaveBeenCalled()
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

    await featureBranchOneCommitScenario.setup(repo)

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

  it('renders an interactive log smoke view when interactive mode is requested', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    await twoCommitFeatureScenario.setup(repo)

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

    expect(stdout).toContain('coco')
    // Assertions match the scenario's commit subject + filename. The
    // specific names are incidental to the smoke test — it's verifying
    // that interactive log rendering surfaces commit subjects and
    // changed files, not testing any particular subject/path.
    expect(stdout).toContain('feat: add feature module')
    expect(stdout).toContain('Changed files:')
    expect(stdout).toContain('src/feature.ts')
  })

  it('renders the ui command smoke view in a non-TTY environment', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    await twoCommitFeatureScenario.setup(repo)

    await uiHandler({
      $0: 'coco',
      _: ['ui'],
      all: false,
      limit: 2,
      interactive: false,
      verbose: false,
      version: false,
      help: false,
      view: 'history',
    } as Arguments<UiOptions>, createLogger())

    expect(stdout).toContain('coco')
    // See the interactive-log test above re: scenario-default subject /
    // filename — same rationale applies here.
    expect(stdout).toContain('feat: add feature module')
    expect(stdout).toContain('Changed files:')
    expect(stdout).toContain('src/feature.ts')
  })

  it('prints machine-readable git log output', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    await twoCommitFeatureScenario.setup(repo)

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
      message: 'feat: add feature module',
      shortHash: expect.any(String),
      hash: expect.any(String),
      refs: expect.any(Array),
    }))
  })

  it('honors the global --json flag on its own (no --format)', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    await twoCommitFeatureScenario.setup(repo)

    await logHandler({
      $0: 'coco',
      _: ['log'],
      json: true,
      limit: 2,
      interactive: false,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<LogOptions>, createLogger())

    const entries = JSON.parse(stdout)

    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual(expect.objectContaining({
      message: 'feat: add feature module',
      shortHash: expect.any(String),
      hash: expect.any(String),
      refs: expect.any(Array),
    }))
  })

  it('skips the interactive TUI when --json is combined with -i', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    await twoCommitFeatureScenario.setup(repo)

    await logHandler({
      $0: 'coco',
      _: ['log'],
      json: true,
      interactive: true,
      limit: 2,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<LogOptions>, createLogger())

    const entries = JSON.parse(stdout)

    expect(entries).toHaveLength(2)
    expect(stdout).not.toContain('Changed files:')
  })

  it('shows changed files for a selected commit', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    await twoCommitFeatureScenario.setup(repo)

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
    expect(stdout).toContain('feat: add feature module')
    expect(stdout).toContain('Changed files:')
    expect(stdout).toContain('A  src/feature.ts')
  })

  it('honors the global --json flag on the --commit detail path', async () => {
    mockLoadConfig.mockReturnValue(createConfig({
      mode: 'stdout',
    }))

    await twoCommitFeatureScenario.setup(repo)

    const commit = (await repo.git.revparse(['HEAD'])).trim()

    await logHandler({
      $0: 'coco',
      _: ['log'],
      commit,
      json: true,
      interactive: false,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<LogOptions>, createLogger())

    const detail = JSON.parse(stdout)

    expect(detail).toEqual(expect.objectContaining({
      hash: commit,
      message: 'feat: add feature module',
      files: expect.arrayContaining([
        expect.objectContaining({ status: 'A', path: 'src/feature.ts' }),
      ]),
    }))
  })
})
