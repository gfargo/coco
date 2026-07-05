/**
 * Coverage for OSS-662: `coco commit --split` should reach parity with
 * regular `coco commit`'s pre-commit-hook UX — show the hook output
 * (identified by which group failed) and offer Retry / Skip hooks /
 * Abort instead of swallowing the failure into a bare "Pre-commit
 * hook failed" string.
 *
 * Exercises the wiring through `handleCommitSplit`'s `--apply` path:
 * plan generation is mocked (covered elsewhere by
 * splitPlanGenerator.test.ts), `createCommit` is mocked to reject with
 * `PreCommitHookError`, and `selectPrompt` drives the interactive
 * choice.
 */
import { Arguments } from 'yargs'
import { Config } from '../../lib/config/types'
import { CommitOptions } from './config'
import { handleCommitSplit } from './split'
import { CommitSplitPlan } from './splitPlanTypes'
import { FileChange } from '../../lib/types'
import { Logger } from '../../lib/utils/logger'

jest.mock('../../lib/simple-git/getChanges')
jest.mock('../../lib/parsers/default')
jest.mock('../../lib/simple-git/getCurrentBranchName')
jest.mock('../../lib/utils/hasCommitlintConfig')
jest.mock('./splitPlanGenerator', () => ({
  DEFAULT_MAX_PLAN_ATTEMPTS: 3,
  generateValidatedCommitSplitPlan: jest.fn(),
}))
jest.mock('../../lib/ui/inquirerPrompts')
jest.mock('../../lib/simple-git/createCommit', () => ({
  createCommit: jest.fn(),
  PreCommitHookError: class PreCommitHookError extends Error {
    hookOutput: string
    constructor(hookOutput: string) {
      super('Pre-commit hook failed')
      this.hookOutput = hookOutput
    }
  },
}))

import { getChanges } from '../../lib/simple-git/getChanges'
import { fileChangeParser } from '../../lib/parsers/default'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { hasCommitlintConfig } from '../../lib/utils/hasCommitlintConfig'
import { generateValidatedCommitSplitPlan } from './splitPlanGenerator'
import { selectPrompt } from '../../lib/ui/inquirerPrompts'
import { createCommit, PreCommitHookError } from '../../lib/simple-git/createCommit'

const mockedGetChanges = getChanges as jest.MockedFunction<typeof getChanges>
const mockedFileChangeParser = fileChangeParser as jest.MockedFunction<typeof fileChangeParser>
const mockedGetCurrentBranchName = getCurrentBranchName as jest.MockedFunction<typeof getCurrentBranchName>
const mockedHasCommitlintConfig = hasCommitlintConfig as jest.MockedFunction<typeof hasCommitlintConfig>
const mockedGenerate = generateValidatedCommitSplitPlan as jest.MockedFunction<
  typeof generateValidatedCommitSplitPlan
>
const mockedSelectPrompt = selectPrompt as jest.MockedFunction<typeof selectPrompt>
const mockedCreateCommit = createCommit as jest.MockedFunction<typeof createCommit>

const stagedFile = (filePath: string): FileChange => ({
  filePath,
  status: 'added',
  summary: '',
})

const plan: CommitSplitPlan = {
  groups: [{ title: 'feat: add widget', files: ['widget.ts'], hunks: [] }],
}

function makeFakeGit() {
  let head = 0

  return {
    raw: jest.fn(async (args: string[]) => {
      if (args[0] === 'diff' && args.includes('--cached')) {
        return 'widget.ts\0'
      }
      return ''
    }),
    add: jest.fn(async () => ''),
    status: jest.fn(async () => ({
      staged: ['widget.ts'],
      created: [],
      renamed: [],
      modified: [],
      deleted: [],
      not_added: [],
      files: [],
    })),
    revparse: jest.fn(async () => `head-${head}`),
    diff: jest.fn(async () => ''),
    advanceHead: () => {
      head += 1
    },
  }
}

describe('handleCommitSplit — pre-commit hook failure recovery (OSS-662)', () => {
  const baseArgv = {
    _: [],
    $0: '',
    split: true,
    apply: true,
  } as unknown as Arguments<CommitOptions>

  const baseConfig = {
    service: { provider: 'anthropic', model: 'claude-x' },
  } as unknown as Config & CommitOptions

  beforeEach(() => {
    jest.clearAllMocks()
    mockedGetChanges.mockResolvedValue({
      staged: [stagedFile('widget.ts')],
      unstaged: [],
      untracked: [],
    })
    mockedFileChangeParser.mockResolvedValue('condensed diff summary')
    mockedGetCurrentBranchName.mockResolvedValue('feature/widget')
    mockedHasCommitlintConfig.mockResolvedValue(false)
    mockedGenerate.mockResolvedValue({ plan, attempts: 1 })
  })

  it('shows hook output identified by group title and retries on "retry"', async () => {
    const git = makeFakeGit()
    mockedCreateCommit
      .mockImplementationOnce(async () => {
        throw new PreCommitHookError('biome check failed on widget.ts')
      })
      .mockImplementationOnce(async () => {
        git.advanceHead()
        return {} as never
      })
    mockedSelectPrompt.mockResolvedValue('retry')

    const logger = new Logger({})
    const logSpy = jest.spyOn(logger, 'log')

    const output = await handleCommitSplit({
      argv: baseArgv,
      config: baseConfig,
      git: git as never,
      logger,
      tokenizer: {} as never,
      llm: {} as never,
      interactive: true,
    })

    expect(mockedSelectPrompt).toHaveBeenCalledTimes(1)
    const loggedLines = logSpy.mock.calls.map((call) => String(call[0]))
    expect(loggedLines.some((line) => line.includes('Hook output:'))).toBe(true)
    expect(loggedLines.some((line) => line.includes('biome check failed on widget.ts'))).toBe(true)
    expect(mockedCreateCommit).toHaveBeenCalledTimes(2)
    expect(output).toContain('Created 1 split commit')
  })

  it('surfaces the group title in the failure header', async () => {
    const git = makeFakeGit()
    mockedCreateCommit.mockImplementation(async () => {
      throw new PreCommitHookError('type check failed')
    })
    mockedSelectPrompt.mockResolvedValue('abort')

    const logger = new Logger({})
    const errorSpy = jest.spyOn(logger, 'error')

    await expect(
      handleCommitSplit({
        argv: baseArgv,
        config: baseConfig,
        git: git as never,
        logger,
        tokenizer: {} as never,
        llm: {} as never,
        interactive: true,
      })
    ).rejects.toThrow('zero commits')

    expect(
      errorSpy.mock.calls.some((call) =>
        String(call[0]).includes('group: "feat: add widget"')
      )
    ).toBe(true)
  })

  it('does not prompt when not interactive, and surfaces the hook failure without hanging', async () => {
    const git = makeFakeGit()
    mockedCreateCommit.mockImplementation(async () => {
      throw new PreCommitHookError('type check failed')
    })

    const logger = new Logger({})

    await expect(
      handleCommitSplit({
        argv: baseArgv,
        config: baseConfig,
        git: git as never,
        logger,
        tokenizer: {} as never,
        llm: {} as never,
        interactive: false,
      })
    ).rejects.toThrow('zero commits')

    expect(mockedSelectPrompt).not.toHaveBeenCalled()
  })
})
