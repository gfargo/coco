jest.mock('../../git/operationData', () => ({
  getInProgressOperationType: jest.fn(),
  getConflictedFiles: jest.fn(),
}))

jest.mock('../utils/applyRepoFlag', () => ({
  applyRepoFlag: jest.fn(),
}))

import { getConflictedFiles, getInProgressOperationType } from '../../git/operationData'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { statusHandler } from './statusHandler'

const mockedGetOperation = getInProgressOperationType as jest.MockedFunction<typeof getInProgressOperationType>
const mockedGetConflictedFiles = getConflictedFiles as jest.MockedFunction<typeof getConflictedFiles>
const mockedApplyRepoFlag = applyRepoFlag as jest.MockedFunction<typeof applyRepoFlag>

describe('coco resolve status', () => {
  let logger: { log: jest.Mock; error: jest.Mock }

  beforeEach(() => {
    logger = { log: jest.fn(), error: jest.fn() }
    mockedApplyRepoFlag.mockReturnValue({} as ReturnType<typeof applyRepoFlag>)
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('no-operation path: reports nothing in progress and resolves cleanly (exit 0)', async () => {
    mockedGetOperation.mockResolvedValue('none')
    mockedGetConflictedFiles.mockResolvedValue([])

    await expect(
      statusHandler({ subcommand: 'status' } as never, logger as never)
    ).resolves.toBeUndefined()

    expect(logger.log).toHaveBeenCalledWith('No operation in progress')
  })

  it('conflicts-present path: prints operation + files and exits 1', async () => {
    mockedGetOperation.mockResolvedValue('merge')
    mockedGetConflictedFiles.mockResolvedValue([
      { path: 'src/a.ts', indexStatus: 'U', worktreeStatus: 'U' },
    ])

    await expect(
      statusHandler({ subcommand: 'status' } as never, logger as never)
    ).rejects.toMatchObject({
      name: 'CommandExitError',
      code: 1,
    })

    const lines = logger.log.mock.calls.map((args) => args[0]).join('\n')
    expect(lines).toContain('merge')
    expect(lines).toContain('src/a.ts')
    expect(lines).toContain('UU')
  })

  it('--json: emits { operation, conflictedFiles, count } and exits 1 when conflicts present', async () => {
    mockedGetOperation.mockResolvedValue('rebase')
    mockedGetConflictedFiles.mockResolvedValue([
      { path: 'src/b.ts', indexStatus: 'U', worktreeStatus: 'U' },
    ])
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await expect(
      statusHandler({ subcommand: 'status', json: true } as never, logger as never)
    ).rejects.toMatchObject({
      name: 'CommandExitError',
      code: 1,
    })

    expect(logger.log).not.toHaveBeenCalled()
    const written = writeSpy.mock.calls.map((args) => args[0]).join('')
    const payload = JSON.parse(written)
    expect(payload).toEqual({
      operation: 'rebase',
      conflictedFiles: [{ path: 'src/b.ts', indexStatus: 'U', worktreeStatus: 'U' }],
      count: 1,
    })

    writeSpy.mockRestore()
  })

  it('--json with no conflicts: emits count 0 and does not throw', async () => {
    mockedGetOperation.mockResolvedValue('none')
    mockedGetConflictedFiles.mockResolvedValue([])
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await expect(
      statusHandler({ subcommand: 'status', json: true } as never, logger as never)
    ).resolves.toBeUndefined()

    const written = writeSpy.mock.calls.map((args) => args[0]).join('')
    const payload = JSON.parse(written)
    expect(payload).toEqual({ operation: 'none', conflictedFiles: [], count: 0 })

    writeSpy.mockRestore()
  })
})
