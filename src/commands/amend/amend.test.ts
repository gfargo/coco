import { Arguments } from 'yargs'
import { SimpleGit } from 'simple-git'
import { handler } from './handler'
import { AmendOptions } from './config'
import { Config } from '../../commands/types'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { generateCommitDraft } from '../commit/generateCommitDraft'
import { getChangesByCommit } from '../../lib/simple-git/getChangesByCommit'
import { getChanges } from '../../lib/simple-git/getChanges'
import { createCommit } from '../../lib/simple-git/createCommit'
import { Logger } from '../../lib/utils/logger'

jest.mock('../utils/applyRepoFlag')
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../commit/generateCommitDraft')
jest.mock('../../lib/simple-git/getChangesByCommit')
jest.mock('../../lib/simple-git/getChanges')
jest.mock('../../lib/simple-git/createCommit', () => ({
  ...jest.requireActual('../../lib/simple-git/createCommit'),
  createCommit: jest.fn(),
}))

const mockApplyRepoFlag = applyRepoFlag as jest.MockedFunction<typeof applyRepoFlag>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGenerate = generateCommitDraft as jest.MockedFunction<typeof generateCommitDraft>
const mockGetChangesByCommit = getChangesByCommit as jest.MockedFunction<typeof getChangesByCommit>
const mockGetChanges = getChanges as jest.MockedFunction<typeof getChanges>
const mockCreateCommit = createCommit as jest.MockedFunction<typeof createCommit>

describe('amend command', () => {
  let argv: Arguments<AmendOptions>
  let logger: Logger
  let git: { revparse: jest.Mock; raw: jest.Mock }

  beforeEach(() => {
    argv = {
      $0: 'coco',
      _: ['amend'],
      interactive: false,
      conventional: false,
      noVerify: false,
      verbose: false,
      version: false,
      help: false,
    } as Arguments<AmendOptions>

    logger = {
      log: jest.fn(),
      verbose: jest.fn(),
      setConfig: jest.fn(),
    } as unknown as Logger

    git = {
      revparse: jest.fn().mockResolvedValue('abc123'),
      raw: jest.fn().mockResolvedValue('chore: original message\n'),
    }
    mockApplyRepoFlag.mockReturnValue(git as unknown as SimpleGit)
    mockLoadConfig.mockReturnValue({ service: { provider: 'openai' } } as unknown as Config)
    mockGetChangesByCommit.mockResolvedValue([
      { filePath: 'src/a.ts', status: 'modified', summary: 'changed a' },
    ])
    mockGetChanges.mockResolvedValue({ staged: [], unstaged: [], untracked: [] })
    mockGenerate.mockResolvedValue({
      ok: true,
      draft: 'feat: regenerated message',
      warnings: [],
      validationErrors: [],
    })
    mockCreateCommit.mockResolvedValue({} as never)
  })

  afterEach(() => jest.clearAllMocks())

  it('amends the last commit with the regenerated message by default', async () => {
    await handler(argv, logger)
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ changeSource: expect.objectContaining({ commitRef: 'HEAD' }) })
    )
    expect(mockCreateCommit).toHaveBeenCalledWith(
      'feat: regenerated message',
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({ amend: true, noVerify: false })
    )
  })

  it('does not amend on --dry-run, just prints the message', async () => {
    argv.dryRun = true
    await handler(argv, logger)
    expect(mockCreateCommit).not.toHaveBeenCalled()
    expect(logger.log).toHaveBeenCalledWith('feat: regenerated message')
  })

  it('emits JSON and does not amend on --json', async () => {
    argv.json = true
    const writes: string[] = []
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(((c: string) => {
        writes.push(String(c))
        return true
      }) as never)
    try {
      await handler(argv, logger)
    } finally {
      spy.mockRestore()
    }
    expect(mockCreateCommit).not.toHaveBeenCalled()
    const json = writes.find((w) => {
      try {
        JSON.parse(w)
        return true
      } catch {
        return false
      }
    })
    expect(json).toBeDefined()
    const parsed = JSON.parse(json as string)
    expect(parsed.message).toBe('feat: regenerated message')
    expect(parsed.previous).toContain('original message')
  })

  it('passes --no-verify through to the amend commit', async () => {
    argv.noVerify = true
    await handler(argv, logger)
    expect(mockCreateCommit).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({ amend: true, noVerify: true })
    )
  })

  it('exits non-zero when there is no commit to amend', async () => {
    git.revparse.mockRejectedValue(new Error('fatal: needed a single revision'))
    await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
    expect(mockCreateCommit).not.toHaveBeenCalled()
  })

  it('exits non-zero when draft generation fails', async () => {
    mockGenerate.mockResolvedValue({
      ok: false,
      draft: '',
      warnings: ['No changes detected to summarize.'],
      validationErrors: [],
    })
    await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
    expect(mockCreateCommit).not.toHaveBeenCalled()
  })
})
