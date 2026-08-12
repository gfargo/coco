import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SimpleGit } from 'simple-git'
import { runHookEntry } from './runHookEntry'
import { handler } from './handler'
import { HooksArgv } from './config'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { generateCommitDraft } from '../commit/generateCommitDraft'
import { Logger } from '../../lib/utils/logger'

jest.mock('../utils/applyRepoFlag')
jest.mock('../commit/generateCommitDraft')

const mockApplyRepoFlag = applyRepoFlag as jest.MockedFunction<typeof applyRepoFlag>
const mockGenerate = generateCommitDraft as jest.MockedFunction<typeof generateCommitDraft>

describe('coco hooks run <messageFile> (#2460)', () => {
  let tmpDir: string
  let originalCocoSkip: string | undefined

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coco-hooks-run-')))
    mockApplyRepoFlag.mockReturnValue({} as unknown as SimpleGit)
    originalCocoSkip = process.env.COCO_SKIP
    delete process.env.COCO_SKIP
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    if (originalCocoSkip === undefined) {
      delete process.env.COCO_SKIP
    } else {
      process.env.COCO_SKIP = originalCocoSkip
    }
    jest.resetAllMocks()
  })

  function messageFile(): string {
    return path.join(tmpDir, 'COMMIT_EDITMSG')
  }

  function argv(overrides: Partial<HooksArgv> = {}): HooksArgv {
    return {
      action: 'run',
      messageFile: messageFile(),
      $0: 'coco',
      _: ['hooks'],
      ...overrides,
    } as unknown as HooksArgv
  }

  it('writes the generated draft when the message file is missing', async () => {
    mockGenerate.mockResolvedValue({
      ok: true,
      draft: 'feat: add thing',
      warnings: [],
      validationErrors: [],
    })

    await runHookEntry(argv())

    expect(fs.readFileSync(messageFile(), 'utf8')).toBe('feat: add thing\n')
    expect(mockGenerate).toHaveBeenCalledTimes(1)
  })

  it('writes the generated draft when the message file is empty', async () => {
    fs.writeFileSync(messageFile(), '')
    mockGenerate.mockResolvedValue({
      ok: true,
      draft: 'feat: add thing',
      warnings: [],
      validationErrors: [],
    })

    await runHookEntry(argv())

    expect(fs.readFileSync(messageFile(), 'utf8')).toBe('feat: add thing\n')
  })

  it('treats comment-only / blank content as empty and still generates a draft', async () => {
    fs.writeFileSync(messageFile(), '\n# Please enter the commit message\n#\n   \n')
    mockGenerate.mockResolvedValue({
      ok: true,
      draft: 'fix: correct bug',
      warnings: [],
      validationErrors: [],
    })

    await runHookEntry(argv())

    expect(fs.readFileSync(messageFile(), 'utf8')).toBe('fix: correct bug\n')
  })

  it('does not clobber a message file that already has real content', async () => {
    fs.writeFileSync(messageFile(), 'chore: manual message\n')

    await runHookEntry(argv())

    expect(fs.readFileSync(messageFile(), 'utf8')).toBe('chore: manual message\n')
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('leaves the file untouched when generation fails (ok: false)', async () => {
    mockGenerate.mockResolvedValue({
      ok: false,
      draft: '',
      warnings: [],
      validationErrors: ['No API key configured for the commit service.'],
    })

    await expect(runHookEntry(argv())).resolves.toBeUndefined()
    expect(fs.existsSync(messageFile())).toBe(false)
  })

  it('fails open when generateCommitDraft throws', async () => {
    mockGenerate.mockRejectedValue(new Error('boom'))

    await expect(runHookEntry(argv())).resolves.toBeUndefined()
    expect(fs.existsSync(messageFile())).toBe(false)
  })

  it('is a no-op when COCO_SKIP is set', async () => {
    process.env.COCO_SKIP = '1'

    await runHookEntry(argv())

    expect(mockGenerate).not.toHaveBeenCalled()
    expect(fs.existsSync(messageFile())).toBe(false)
  })

  it('is a no-op when no messageFile is provided', async () => {
    await runHookEntry(argv({ messageFile: undefined }))

    expect(mockGenerate).not.toHaveBeenCalled()
    expect(mockApplyRepoFlag).not.toHaveBeenCalled()
  })

  it('fails open when not inside a git repository', async () => {
    mockApplyRepoFlag.mockImplementation(() => {
      throw new Error('not a git repository')
    })

    await expect(runHookEntry(argv())).resolves.toBeUndefined()
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('never throws or sets a non-zero exit code through the real handler', async () => {
    mockGenerate.mockRejectedValue(new Error('boom'))
    const logger = {
      log: jest.fn(),
      verbose: jest.fn(),
      setConfig: jest.fn(),
      error: jest.fn(),
      startTimer: jest.fn().mockReturnThis(),
      stopTimer: jest.fn(),
      startSpinner: jest.fn().mockReturnThis(),
      stopSpinner: jest.fn(),
    } as unknown as Logger

    const originalExitCode = process.exitCode
    process.exitCode = undefined
    try {
      await expect(handler(argv(), logger)).resolves.toBeUndefined()
      expect(process.exitCode).toBeUndefined()
    } finally {
      process.exitCode = originalExitCode
    }
  })
})
