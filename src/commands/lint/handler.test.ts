import { Arguments } from 'yargs'
import { SimpleGit, StatusResult } from 'simple-git'
import { handler } from './handler'
import { LintOptions } from './config'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { validateCommitMessage, checkCommitlintAvailability, getCommitlintRulesContext } from '../../lib/utils/commitlintValidator'
import { getInProgressOperationType } from '../../git/operationData'
import { executeRebasePlan } from '../../git/rebasePlanActions'
import { getApiKeyForModel, getModelAndProviderFromConfig } from '../../lib/langchain/utils'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { executeChain } from '../../lib/langchain/utils/executeChain'
import { getTokenCounterForProvider } from '../../lib/utils/tokenizer'
import { Logger } from '../../lib/utils/logger'
import { Config } from '../../commands/types'

jest.mock('../utils/applyRepoFlag')
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/utils/commitlintValidator')
jest.mock('../../git/operationData')
jest.mock('../../git/rebasePlanActions')
jest.mock('../../lib/langchain/utils')
jest.mock('../../lib/langchain/utils/getLlm')
jest.mock('../../lib/langchain/utils/executeChain')
jest.mock('../../lib/utils/tokenizer')

const mockApplyRepoFlag = applyRepoFlag as jest.MockedFunction<typeof applyRepoFlag>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockValidateCommitMessage = validateCommitMessage as jest.MockedFunction<typeof validateCommitMessage>
const mockCheckCommitlintAvailability = checkCommitlintAvailability as jest.MockedFunction<typeof checkCommitlintAvailability>
const mockGetCommitlintRulesContext = getCommitlintRulesContext as jest.MockedFunction<typeof getCommitlintRulesContext>
const mockGetInProgressOperationType = getInProgressOperationType as jest.MockedFunction<typeof getInProgressOperationType>
const mockExecuteRebasePlan = executeRebasePlan as jest.MockedFunction<typeof executeRebasePlan>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>
const mockGetModelAndProviderFromConfig = getModelAndProviderFromConfig as jest.MockedFunction<typeof getModelAndProviderFromConfig>
const mockGetLlm = getLlm as jest.MockedFunction<typeof getLlm>
const mockExecuteChain = executeChain as jest.MockedFunction<typeof executeChain>
const mockGetTokenCounterForProvider = getTokenCounterForProvider as jest.MockedFunction<typeof getTokenCounterForProvider>

const SEP = '\x1f'
const REC = '\x1e'

function record(fields: string[]): string {
  return `${fields.join(SEP)}${REC}\n`
}

type RawHandlers = Record<string, (args: string[]) => Promise<string>>

function makeGit(overrides: { log: string; status?: Partial<StatusResult>; extra?: RawHandlers }): SimpleGit {
  const status: StatusResult = {
    not_added: [],
    conflicted: [],
    created: [],
    deleted: [],
    modified: [],
    renamed: [],
    staged: [],
    files: [],
    ahead: 0,
    behind: 0,
    current: null,
    tracking: null,
    detached: false,
    isClean: () => true,
    ...overrides.status,
  } as StatusResult

  const raw = jest.fn(async (args: string[]) => {
    if (args[0] === 'log') return overrides.log
    if (args[0] === 'rev-parse' && args.includes('--verify')) return 'ok'
    if (args[0] === 'rev-parse' && args.includes('@{upstream}')) throw new Error('no upstream')
    if (args[0] === 'merge-base') throw new Error('not an ancestor')
    const key = args.join(' ')
    if (overrides.extra?.[key]) return overrides.extra[key](args)
    return ''
  })

  return {
    raw,
    status: jest.fn(async () => status),
  } as unknown as SimpleGit
}

describe('lint command handler', () => {
  let logger: Logger
  let baseArgv: Arguments<LintOptions>

  beforeEach(() => {
    jest.clearAllMocks()
    logger = {
      log: jest.fn(),
      verbose: jest.fn(),
      setConfig: jest.fn(),
      error: jest.fn(),
      startTimer: jest.fn().mockReturnThis(),
      stopTimer: jest.fn(),
      startSpinner: jest.fn().mockReturnThis(),
      stopSpinner: jest.fn(),
    } as unknown as Logger

    baseArgv = {
      $0: 'coco',
      _: ['lint'],
      interactive: false,
      mode: 'stdout',
      verbose: false,
      version: false,
      help: false,
      json: false,
      fix: false,
      force: false,
    }

    mockLoadConfig.mockReturnValue({
      defaultBranch: 'main',
      service: {
        authentication: { type: 'APIKey', credentials: { apiKey: 'mock-api-key' } },
        provider: 'openai',
        model: 'gpt-4o',
        tokenLimit: 4096,
        temperature: 0.2,
        maxConcurrent: 1,
      },
    } as unknown as Config)

    mockCheckCommitlintAvailability.mockReturnValue({ available: true, missingPackages: [] })
    mockGetCommitlintRulesContext.mockResolvedValue('')
    mockGetInProgressOperationType.mockResolvedValue('none')
    mockGetApiKeyForModel.mockReturnValue('mock-api-key')
    mockGetModelAndProviderFromConfig.mockReturnValue({ provider: 'openai', model: 'gpt-4o' })
    mockGetLlm.mockResolvedValue({} as unknown as Awaited<ReturnType<typeof getLlm>>)
    mockGetTokenCounterForProvider.mockResolvedValue((text: string) => text.length)
  })

  it('exits 0 when every commit in range is valid', async () => {
    const log = record(['sha1', 'sha1', '', 'Jane', '2026-01-01', 'feat: add thing', ''])
    mockApplyRepoFlag.mockReturnValue(makeGit({ log }))
    mockValidateCommitMessage.mockResolvedValue({ valid: true, errors: [], warnings: [] })

    await expect(handler(baseArgv, logger)).rejects.toMatchObject({ code: 0 })
  })

  it('exits 1 when a commit fails validation under the default --severity error', async () => {
    const log = record(['sha1', 'sha1', '', 'Jane', '2026-01-01', 'bad message', ''])
    mockApplyRepoFlag.mockReturnValue(makeGit({ log }))
    mockValidateCommitMessage.mockResolvedValue({
      valid: false,
      errors: ['type may not be empty'],
      warnings: [],
    })

    await expect(handler(baseArgv, logger)).rejects.toMatchObject({ code: 1 })
  })

  it('emits a machine-readable array under --json', async () => {
    const log = record(['sha1', 'sha1', '', 'Jane', '2026-01-01', 'feat: add thing', ''])
    mockApplyRepoFlag.mockReturnValue(makeGit({ log }))
    mockValidateCommitMessage.mockResolvedValue({ valid: true, errors: [], warnings: [] })

    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      await expect(handler({ ...baseArgv, json: true }, logger)).rejects.toMatchObject({ code: 0 })
      const written = writeSpy.mock.calls.map((call) => call[0]).join('')
      const parsed = JSON.parse(written)
      expect(parsed).toEqual([
        { sha: 'sha1', shortSha: 'sha1', subject: 'feat: add thing', status: 'pass', errors: [], warnings: [] },
      ])
    } finally {
      writeSpy.mockRestore()
    }
  })

  it('marks merge commits as skipped and does not validate them', async () => {
    const log = record(['m1', 'm1', 'p1 p2', 'Jane', '2026-01-01', "Merge branch 'foo'", ''])
    mockApplyRepoFlag.mockReturnValue(makeGit({ log }))

    await expect(handler(baseArgv, logger)).rejects.toMatchObject({ code: 0 })
    expect(mockValidateCommitMessage).not.toHaveBeenCalled()
  })

  it('reaches noResult and exits 0 for an empty range', async () => {
    mockApplyRepoFlag.mockReturnValue(makeGit({ log: '' }))

    await expect(handler(baseArgv, logger)).rejects.toMatchObject({ code: 0 })
    expect(mockValidateCommitMessage).not.toHaveBeenCalled()
  })

  describe('--fix guards', () => {
    it('refuses when a rebase is already in progress, without --force', async () => {
      const log = record(['sha1', 'sha1', '', 'Jane', '2026-01-01', 'bad message', ''])
      mockApplyRepoFlag.mockReturnValue(makeGit({ log }))
      mockValidateCommitMessage.mockResolvedValue({ valid: false, errors: ['type may not be empty'], warnings: [] })
      mockGetInProgressOperationType.mockResolvedValue('rebase')

      await expect(handler({ ...baseArgv, fix: true }, logger)).rejects.toMatchObject({ code: 1 })
      expect(mockExecuteRebasePlan).not.toHaveBeenCalled()
    })

    it('refuses when the range contains a merge commit, without --force', async () => {
      const log =
        record(['sha1', 'sha1', '', 'Jane', '2026-01-01', 'bad message', '']) +
        record(['m1', 'm1', 'sha1 sha0', 'Jane', '2026-01-02', "Merge branch 'foo'", ''])
      mockApplyRepoFlag.mockReturnValue(makeGit({ log }))
      mockValidateCommitMessage.mockResolvedValue({ valid: false, errors: ['type may not be empty'], warnings: [] })

      await expect(handler({ ...baseArgv, fix: true }, logger)).rejects.toMatchObject({ code: 1 })
      expect(mockExecuteRebasePlan).not.toHaveBeenCalled()
    })

    it('refuses when the range has already been pushed upstream, without --force', async () => {
      const log = record(['sha1', 'sha1', '', 'Jane', '2026-01-01', 'bad message', ''])
      const git = makeGit({ log })
      ;(git.raw as jest.Mock).mockImplementation(async (args: string[]) => {
        if (args[0] === 'log') return log
        if (args[0] === 'rev-parse' && args.includes('--verify')) return 'ok'
        if (args[0] === 'rev-parse' && args.includes('@{upstream}')) return 'origin/main'
        if (args[0] === 'merge-base') return ''
        return ''
      })
      mockApplyRepoFlag.mockReturnValue(git)
      mockValidateCommitMessage.mockResolvedValue({ valid: false, errors: ['type may not be empty'], warnings: [] })

      await expect(handler({ ...baseArgv, fix: true }, logger)).rejects.toMatchObject({ code: 1 })
      expect(mockExecuteRebasePlan).not.toHaveBeenCalled()
    })

    it('refuses when the worktree is dirty, without --force', async () => {
      const log = record(['sha1', 'sha1', '', 'Jane', '2026-01-01', 'bad message', ''])
      mockApplyRepoFlag.mockReturnValue(
        makeGit({ log, status: { isClean: () => false } })
      )
      mockValidateCommitMessage.mockResolvedValue({ valid: false, errors: ['type may not be empty'], warnings: [] })

      await expect(handler({ ...baseArgv, fix: true }, logger)).rejects.toMatchObject({ code: 1 })
      expect(mockExecuteRebasePlan).not.toHaveBeenCalled()
    })

    it('proceeds and executes the rebase plan when reword succeeds and no guard triggers', async () => {
      const log = record(['sha1', 'sha1', '', 'Jane', '2026-01-01', 'bad message', ''])
      mockApplyRepoFlag.mockReturnValue(makeGit({ log }))
      mockValidateCommitMessage
        .mockResolvedValueOnce({ valid: false, errors: ['type may not be empty'], warnings: [] })
        .mockResolvedValueOnce({ valid: true, errors: [], warnings: [] })
      mockExecuteChain.mockResolvedValue({ subject: 'fix: a conforming subject' })
      mockExecuteRebasePlan.mockResolvedValue({ ok: true, message: 'Rebase applied — 1 of 1 commits kept' })

      await handler({ ...baseArgv, fix: true }, logger)

      expect(mockExecuteRebasePlan).toHaveBeenCalledTimes(1)
      const rows = mockExecuteRebasePlan.mock.calls[0][1]
      expect(rows).toEqual([
        expect.objectContaining({ sha: 'sha1', action: 'reword', newMessage: 'fix: a conforming subject' }),
      ])
    })
  })
})
