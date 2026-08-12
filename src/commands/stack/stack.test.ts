import { SimpleGit } from 'simple-git'
import yargs from 'yargs'
import { handler } from './handler'
import { StackArgv, builder as stackBuilder, command as stackCommand } from './config'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { createStackedBranch } from '../../git/stackActions'
import { buildStack, getAllStackParents } from '../../git/stackData'
import { checkoutBranchByName } from '../../git/branchActions'
import { rebaseOnto } from '../../git/rebaseActions'
import { Logger } from '../../lib/utils/logger'

jest.mock('../utils/applyRepoFlag')
jest.mock('../../git/stackActions')
jest.mock('../../git/stackData')
jest.mock('../../git/branchActions')
jest.mock('../../git/rebaseActions')

const mockApplyRepoFlag = applyRepoFlag as jest.MockedFunction<typeof applyRepoFlag>
const mockCreateStackedBranch = createStackedBranch as jest.MockedFunction<typeof createStackedBranch>
const mockGetAllStackParents = getAllStackParents as jest.MockedFunction<typeof getAllStackParents>
const mockBuildStack = buildStack as jest.MockedFunction<typeof buildStack>
const mockCheckoutBranchByName = checkoutBranchByName as jest.MockedFunction<typeof checkoutBranchByName>
const mockRebaseOnto = rebaseOnto as jest.MockedFunction<typeof rebaseOnto>

describe('stack command', () => {
  let argv: StackArgv
  let logger: Logger
  let raw: jest.Mock

  beforeEach(() => {
    raw = jest.fn().mockResolvedValue('feature\n')
    mockApplyRepoFlag.mockReturnValue({ raw } as unknown as SimpleGit)
    mockCreateStackedBranch.mockResolvedValue({ ok: true, message: 'Created child stacked on feature' })
    mockGetAllStackParents.mockResolvedValue({})
    mockBuildStack.mockResolvedValue([{ branch: 'feature', parent: undefined, ahead: 0, behind: 0 }])
    mockCheckoutBranchByName.mockResolvedValue({ ok: true, message: 'Checked out' })
    mockRebaseOnto.mockResolvedValue({ ok: true, message: 'Rebased' })

    logger = { log: jest.fn(), verbose: jest.fn(), setConfig: jest.fn(), error: jest.fn() } as unknown as Logger
  })

  afterEach(() => jest.clearAllMocks())

  function baseArgv(overrides: Partial<StackArgv> = {}): StackArgv {
    return {
      $0: 'coco',
      _: ['stack'],
      action: 'create',
      interactive: false,
      verbose: false,
      version: false,
      help: false,
      ...overrides,
    } as StackArgv
  }

  describe('create', () => {
    it('writes config + branch by delegating to createStackedBranch', async () => {
      argv = baseArgv({ name: 'child' })
      await handler(argv, logger)

      expect(mockCreateStackedBranch).toHaveBeenCalledWith(expect.anything(), 'child', 'feature')
      expect(logger.log).toHaveBeenCalledWith('Created child stacked on feature', expect.anything())
    })

    it('uses --parent instead of the current branch when given', async () => {
      argv = baseArgv({ name: 'child', parent: 'main' })
      await handler(argv, logger)

      expect(mockCreateStackedBranch).toHaveBeenCalledWith(expect.anything(), 'child', 'main')
    })

    it('requires a branch name', async () => {
      argv = baseArgv({})
      await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
      expect(mockCreateStackedBranch).not.toHaveBeenCalled()
    })

    it('rejects a flag-like name by surfacing the createStackedBranch failure', async () => {
      mockCreateStackedBranch.mockResolvedValue({ ok: false, message: "Branch name '-child' cannot start with '-'." })
      argv = baseArgv({ name: '-child' })

      await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
      expect(logger.error).toHaveBeenCalledWith("Branch name '-child' cannot start with '-'.", expect.anything())
    })

    it('rejects a duplicate branch name by surfacing the createStackedBranch failure', async () => {
      mockCreateStackedBranch.mockResolvedValue({ ok: false, message: "fatal: A branch named 'child' already exists." })
      argv = baseArgv({ name: 'child' })

      await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
    })

    it('emits JSON instead of log lines with --json', async () => {
      argv = baseArgv({ name: 'child', json: true })
      const writes: string[] = []
      const spy = jest.spyOn(process.stdout, 'write').mockImplementation(((c: string) => {
        writes.push(String(c))
        return true
      }) as never)
      try {
        await handler(argv, logger)
      } finally {
        spy.mockRestore()
      }
      expect(logger.log).not.toHaveBeenCalled()
      const parsed = JSON.parse(writes.join(''))
      expect(parsed).toMatchObject({ ok: true, branch: 'child', parent: 'feature' })
    })
  })

  describe('status', () => {
    it('reads the parent map and prints the built stack', async () => {
      mockBuildStack.mockResolvedValue([
        { branch: 'main', parent: undefined, ahead: 0, behind: 0 },
        { branch: 'feature', parent: 'main', ahead: 2, behind: 1 },
      ])
      argv = baseArgv({ action: 'status' })

      await handler(argv, logger)

      expect(mockGetAllStackParents).toHaveBeenCalled()
      expect(mockBuildStack).toHaveBeenCalledWith(expect.anything(), 'feature', {})
      expect(logger.log).toHaveBeenCalled()
    })

    it('emits JSON with --json', async () => {
      const stack = [{ branch: 'feature', parent: undefined, ahead: 0, behind: 0 }]
      mockBuildStack.mockResolvedValue(stack)
      argv = baseArgv({ action: 'status', json: true })

      const writes: string[] = []
      const spy = jest.spyOn(process.stdout, 'write').mockImplementation(((c: string) => {
        writes.push(String(c))
        return true
      }) as never)
      try {
        await handler(argv, logger)
      } finally {
        spy.mockRestore()
      }
      expect(JSON.parse(writes.join(''))).toEqual(stack)
    })
  })

  describe('restack', () => {
    it('rebases each descendant onto its parent, root→tip, skipping the root', async () => {
      mockBuildStack.mockResolvedValue([
        { branch: 'main', parent: undefined, ahead: 0, behind: 0 },
        { branch: 'b1', parent: 'main', ahead: 1, behind: 0 },
        { branch: 'b2', parent: 'b1', ahead: 1, behind: 0 },
      ])
      argv = baseArgv({ action: 'restack' })

      await handler(argv, logger)

      expect(mockCheckoutBranchByName).toHaveBeenNthCalledWith(1, expect.anything(), 'b1')
      expect(mockCheckoutBranchByName).toHaveBeenNthCalledWith(2, expect.anything(), 'b2')
      expect(mockRebaseOnto).toHaveBeenNthCalledWith(1, expect.anything(), 'main')
      expect(mockRebaseOnto).toHaveBeenNthCalledWith(2, expect.anything(), 'b1')
      expect(mockCheckoutBranchByName).not.toHaveBeenCalledWith(expect.anything(), 'main')
    })

    it('halts on the first conflict and skips branches after it', async () => {
      mockBuildStack.mockResolvedValue([
        { branch: 'main', parent: undefined, ahead: 0, behind: 0 },
        { branch: 'b1', parent: 'main', ahead: 1, behind: 0 },
        { branch: 'b2', parent: 'b1', ahead: 1, behind: 0 },
      ])
      mockRebaseOnto.mockImplementation(async (_git, ref) => {
        if (ref === 'main') return { ok: false, message: 'CONFLICT (content): b1' }
        return { ok: true, message: 'Rebased' }
      })
      argv = baseArgv({ action: 'restack' })

      await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })

      expect(mockRebaseOnto).toHaveBeenCalledTimes(1)
      expect(mockCheckoutBranchByName).toHaveBeenCalledTimes(1)
      expect(mockCheckoutBranchByName).not.toHaveBeenCalledWith(expect.anything(), 'b2')
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Restack halted on b1'), expect.anything())
    })

    it('emits JSON with per-branch ok/failed/skipped statuses', async () => {
      mockBuildStack.mockResolvedValue([
        { branch: 'main', parent: undefined, ahead: 0, behind: 0 },
        { branch: 'b1', parent: 'main', ahead: 1, behind: 0 },
        { branch: 'b2', parent: 'b1', ahead: 1, behind: 0 },
      ])
      mockRebaseOnto.mockImplementation(async (_git, ref) => {
        if (ref === 'main') return { ok: false, message: 'CONFLICT (content): b1' }
        return { ok: true, message: 'Rebased' }
      })
      argv = baseArgv({ action: 'restack', json: true })

      const writes: string[] = []
      const spy = jest.spyOn(process.stdout, 'write').mockImplementation(((c: string) => {
        writes.push(String(c))
        return true
      }) as never)
      try {
        await expect(handler(argv, logger)).rejects.toMatchObject({ code: 1 })
      } finally {
        spy.mockRestore()
      }

      const parsed = JSON.parse(writes.join(''))
      expect(logger.log).not.toHaveBeenCalled()
      expect(parsed).toEqual({
        ok: false,
        results: [
          { branch: 'b1', parent: 'main', status: 'failed', message: 'CONFLICT (content): b1' },
          { branch: 'b2', parent: 'b1', status: 'skipped' },
        ],
      })
    })

    it('reports no-op when the current branch is not part of a stack', async () => {
      mockBuildStack.mockResolvedValue([{ branch: 'feature', parent: undefined, ahead: 0, behind: 0 }])
      argv = baseArgv({ action: 'restack' })

      await handler(argv, logger)

      expect(mockRebaseOnto).not.toHaveBeenCalled()
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('not part of a stack'))
    })
  })

  describe('unknown action', () => {
    it('hits yargs choices validation before the handler runs', () => {
      let failMessage: string | null = null
      let handlerCalled = false

      const y = yargs()
      y.option('repo', { type: 'string', alias: 'cwd', global: true })
      y.option('verbose', { type: 'boolean', alias: 'v', global: true })
      y.option('quiet', { type: 'boolean', alias: 'q', global: true })
      y.option('json', { type: 'boolean', global: true })

      y.command(stackCommand, 'desc', stackBuilder, () => {
        handlerCalled = true
      })

      try {
        y.strictOptions()
          .fail((msg) => {
            failMessage = msg
            throw new Error(msg || 'fail')
          })
          .exitProcess(false)
          .parse(['stack', 'rebase'])
      } catch {
        // Expected — choices validation rejects before the handler runs.
      }

      expect(failMessage).toMatch(/invalid values/i)
      expect(handlerCalled).toBe(false)
    })
  })
})
