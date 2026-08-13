import { Arguments } from 'yargs'
import { CommandExitError } from '../../lib/utils/commandExit'
import { Logger } from '../../lib/utils/logger'
import { ResolveOptions } from './config'

jest.mock('../utils/applyRepoFlag')
jest.mock('../../git/operationData')
jest.mock('../../lib/ui/emitJson')

import { statusHandler } from './statusHandler'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { getConflictedFiles, getInProgressOperationType } from '../../git/operationData'
import { emitJson } from '../../lib/ui/emitJson'

const mockApplyRepoFlag = applyRepoFlag as jest.MockedFunction<typeof applyRepoFlag>
const mockGetConflictedFiles = getConflictedFiles as jest.MockedFunction<typeof getConflictedFiles>
const mockGetInProgressOperationType = getInProgressOperationType as jest.MockedFunction<
  typeof getInProgressOperationType
>
const mockEmitJson = emitJson as jest.MockedFunction<typeof emitJson>

function buildArgv(overrides: Partial<ResolveOptions> = {}): Arguments<ResolveOptions> {
  return {
    $0: 'coco',
    _: ['resolve', 'status'],
    interactive: false,
    verbose: false,
    version: false,
    help: false,
    json: false,
    ...overrides,
  }
}

function buildLogger(): Logger {
  return {
    log: jest.fn(),
    error: jest.fn(),
    verbose: jest.fn(),
    setConfig: jest.fn(),
  } as unknown as Logger
}

describe('resolve status handler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApplyRepoFlag.mockReturnValue({} as never)
  })

  it('exits 0 and reports no operation / no conflicts', async () => {
    mockGetInProgressOperationType.mockResolvedValue('none')
    mockGetConflictedFiles.mockResolvedValue([])

    const logger = buildLogger()
    await statusHandler(buildArgv(), logger)

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('none'))
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('0'))
    expect(mockEmitJson).not.toHaveBeenCalled()
  })

  it('exits 1 and prints per-file path + status when conflicts are present', async () => {
    mockGetInProgressOperationType.mockResolvedValue('merge')
    mockGetConflictedFiles.mockResolvedValue([
      { path: 'a.ts', indexStatus: 'U', worktreeStatus: 'U' },
      { path: 'b.ts', indexStatus: 'A', worktreeStatus: 'A' },
    ])

    const logger = buildLogger()
    await expect(statusHandler(buildArgv(), logger)).rejects.toMatchObject({
      code: 1,
    } satisfies Partial<CommandExitError>)

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('merge'))
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('a.ts'))
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('b.ts'))
  })

  it('emits the documented JSON shape and exits 1 when conflicts are present', async () => {
    mockGetInProgressOperationType.mockResolvedValue('rebase')
    mockGetConflictedFiles.mockResolvedValue([
      { path: 'a.ts', indexStatus: 'U', worktreeStatus: 'U' },
    ])

    await expect(statusHandler(buildArgv({ json: true }), buildLogger())).rejects.toMatchObject({
      code: 1,
    })

    expect(mockEmitJson).toHaveBeenCalledWith({
      operation: 'rebase',
      conflictedFiles: [{ path: 'a.ts', indexStatus: 'U', worktreeStatus: 'U' }],
      count: 1,
    })
  })

  it('emits JSON and exits 0 when there are no conflicts', async () => {
    mockGetInProgressOperationType.mockResolvedValue('none')
    mockGetConflictedFiles.mockResolvedValue([])

    await statusHandler(buildArgv({ json: true }), buildLogger())

    expect(mockEmitJson).toHaveBeenCalledWith({
      operation: 'none',
      conflictedFiles: [],
      count: 0,
    })
  })
})
