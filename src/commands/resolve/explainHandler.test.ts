import { Arguments } from 'yargs'
import { CommandExitError } from '../../lib/utils/commandExit'
import { Logger } from '../../lib/utils/logger'
import type { ConflictRegion } from '../../git/conflictRegionActions'
import type { ConflictExplanation, ConflictExplanationResult } from '../../git/conflictAiActions'
import { ResolveOptions } from './config'

jest.mock('../utils/applyRepoFlag')
jest.mock('../../git/conflictAiActions')
jest.mock('../../git/conflictRegionActions')
jest.mock('../../git/operationData')
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/langchain/utils')
jest.mock('../../lib/ui/emitJson')

import { explainHandler } from './explainHandler'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { runConflictExplanationWorkflow } from '../../git/conflictAiActions'
import { getConflictFileRegions } from '../../git/conflictRegionActions'
import { getConflictedFiles, getInProgressOperationType } from '../../git/operationData'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel } from '../../lib/langchain/utils'
import { emitJson } from '../../lib/ui/emitJson'

const mockApplyRepoFlag = applyRepoFlag as jest.MockedFunction<typeof applyRepoFlag>
const mockRunConflictExplanationWorkflow = runConflictExplanationWorkflow as jest.MockedFunction<
  typeof runConflictExplanationWorkflow
>
const mockGetConflictFileRegions = getConflictFileRegions as jest.MockedFunction<
  typeof getConflictFileRegions
>
const mockGetConflictedFiles = getConflictedFiles as jest.MockedFunction<typeof getConflictedFiles>
const mockGetInProgressOperationType = getInProgressOperationType as jest.MockedFunction<
  typeof getInProgressOperationType
>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>
const mockEmitJson = emitJson as jest.MockedFunction<typeof emitJson>

function buildRegion(index: number): ConflictRegion {
  return {
    index,
    startLine: index * 10 + 1,
    endLine: index * 10 + 5,
    oursLabel: 'HEAD',
    theirsLabel: 'feature',
    ours: ['ours line'],
    theirs: ['theirs line'],
  }
}

function buildExplanation(overrides: Partial<ConflictExplanation> = {}): ConflictExplanation {
  return {
    regionIndex: 0,
    oursIntent: 'renamed the helper',
    theirsIntent: 'added a new parameter',
    conflictNature: 'both sides changed the same function signature',
    ...overrides,
  }
}

function buildArgv(overrides: Partial<ResolveOptions> = {}): Arguments<ResolveOptions> {
  return {
    $0: 'coco',
    _: ['resolve'],
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

describe('explainHandler (OSS-2268)', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockApplyRepoFlag.mockReturnValue({} as never)
    mockLoadConfig.mockReturnValue({
      service: {
        authentication: { type: 'APIKey', credentials: { apiKey: 'mock-api-key' } },
        provider: 'openai',
        model: 'gpt-4o',
        tokenLimit: 4096,
      },
    } as never)
    mockGetApiKeyForModel.mockReturnValue('mock-api-key')
    mockGetInProgressOperationType.mockResolvedValue('merge')
    mockGetConflictedFiles.mockResolvedValue([
      { path: 'a.ts', indexStatus: 'U', worktreeStatus: 'U' },
    ])
    mockGetConflictFileRegions.mockResolvedValue({ ok: true, regions: [buildRegion(0)] })
  })

  function mockWorkflow(explanations: ConflictExplanation[]): void {
    mockRunConflictExplanationWorkflow.mockResolvedValue({
      ok: true,
      explanations,
      message: `${explanations.length} explanations`,
    } as ConflictExplanationResult)
  }

  it('generates and renders explanations for a conflicted file', async () => {
    mockWorkflow([buildExplanation()])
    const logger = buildLogger()

    await explainHandler(buildArgv(), logger)

    expect(mockRunConflictExplanationWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a.ts', operation: 'merge' })
    )
    const logged = (logger.log as jest.Mock).mock.calls.map((call) => call[0]).join('\n')
    expect(logged).toContain('a.ts')
    expect(logged).toContain('renamed the helper')
    expect(logged).toContain('added a new parameter')
    expect(logged).toContain('both sides changed the same function signature')
  })

  it('--file scopes to the requested file only', async () => {
    mockGetConflictedFiles.mockResolvedValue([
      { path: 'a.ts', indexStatus: 'U', worktreeStatus: 'U' },
      { path: 'b.ts', indexStatus: 'U', worktreeStatus: 'U' },
    ])
    mockWorkflow([buildExplanation()])

    await explainHandler(buildArgv({ file: 'a.ts' }), buildLogger())

    expect(mockRunConflictExplanationWorkflow).toHaveBeenCalledTimes(1)
    expect(mockRunConflictExplanationWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a.ts' })
    )
  })

  it('--file pointing at a non-conflicted file errors and exits 1 without calling the workflow', async () => {
    await expect(
      explainHandler(buildArgv({ file: 'missing.ts' }), buildLogger())
    ).rejects.toMatchObject({ code: 1 } satisfies Partial<CommandExitError>)

    expect(mockRunConflictExplanationWorkflow).not.toHaveBeenCalled()
  })

  it('prints "No conflicts to explain" and exits 0 when there are no conflicts', async () => {
    mockGetConflictedFiles.mockResolvedValue([])
    const logger = buildLogger()

    await explainHandler(buildArgv(), logger)

    expect(logger.log).toHaveBeenCalledWith('No conflicts to explain')
    expect(mockLoadConfig).not.toHaveBeenCalled()
    expect(mockRunConflictExplanationWorkflow).not.toHaveBeenCalled()
  })

  it('--json emits an array of explanation objects', async () => {
    mockWorkflow([buildExplanation({ regionIndex: 0 })])

    await explainHandler(buildArgv({ json: true }), buildLogger())

    expect(mockEmitJson).toHaveBeenCalledWith([
      expect.objectContaining({
        path: 'a.ts',
        regionIndex: 0,
        startLine: 1,
        endLine: 5,
        oursIntent: 'renamed the helper',
        theirsIntent: 'added a new parameter',
        conflictNature: 'both sides changed the same function signature',
      }),
    ])
  })

  it('--json emits an empty array when there are no conflicts', async () => {
    mockGetConflictedFiles.mockResolvedValue([])

    await explainHandler(buildArgv({ json: true }), buildLogger())

    expect(mockEmitJson).toHaveBeenCalledWith([])
  })
})
