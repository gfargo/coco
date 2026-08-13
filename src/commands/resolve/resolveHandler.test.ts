import { Arguments } from 'yargs'
import { CommandExitError } from '../../lib/utils/commandExit'
import { Logger } from '../../lib/utils/logger'
import type { ConflictRegion } from '../../git/conflictRegionActions'
import type { ConflictResolutionProposal, ConflictResolutionResult } from '../../git/conflictAiActions'
import { ResolveOptions } from './config'

jest.mock('../utils/applyRepoFlag')
jest.mock('../../git/conflictAiActions')
jest.mock('../../git/conflictRegionActions')
jest.mock('../../git/operationData')
jest.mock('../../git/operationActions')
jest.mock('../../lib/config/utils/loadConfig')
jest.mock('../../lib/langchain/utils')
jest.mock('../../lib/ui/inquirerPrompts')
jest.mock('../../lib/ui/emitJson')
jest.mock('node:child_process', () => ({ spawnSync: jest.fn() }))
jest.mock('node:fs', () => ({
  mkdtempSync: jest.fn(() => '/tmp/coco-conflict-edit-mock'),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  rmSync: jest.fn(),
}))

import { resolveHandler } from './resolveHandler'
import { applyRepoFlag } from '../utils/applyRepoFlag'
import { runConflictResolutionWorkflow } from '../../git/conflictAiActions'
import { applyConflictResolution, getConflictFileRegions } from '../../git/conflictRegionActions'
import { getConflictedFiles, getInProgressOperationType } from '../../git/operationData'
import { stageConflictResolved } from '../../git/operationActions'
import { loadConfig } from '../../lib/config/utils/loadConfig'
import { getApiKeyForModel } from '../../lib/langchain/utils'
import { selectPrompt } from '../../lib/ui/inquirerPrompts'
import { emitJson } from '../../lib/ui/emitJson'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const mockApplyRepoFlag = applyRepoFlag as jest.MockedFunction<typeof applyRepoFlag>
const mockRunConflictResolutionWorkflow = runConflictResolutionWorkflow as jest.MockedFunction<
  typeof runConflictResolutionWorkflow
>
const mockApplyConflictResolution = applyConflictResolution as jest.MockedFunction<
  typeof applyConflictResolution
>
const mockGetConflictFileRegions = getConflictFileRegions as jest.MockedFunction<
  typeof getConflictFileRegions
>
const mockGetConflictedFiles = getConflictedFiles as jest.MockedFunction<typeof getConflictedFiles>
const mockGetInProgressOperationType = getInProgressOperationType as jest.MockedFunction<
  typeof getInProgressOperationType
>
const mockStageConflictResolved = stageConflictResolved as jest.MockedFunction<
  typeof stageConflictResolved
>
const mockLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>
const mockGetApiKeyForModel = getApiKeyForModel as jest.MockedFunction<typeof getApiKeyForModel>
const mockSelectPrompt = selectPrompt as jest.MockedFunction<typeof selectPrompt>
const mockEmitJson = emitJson as jest.MockedFunction<typeof emitJson>
const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>

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

function buildProposal(overrides: Partial<ConflictResolutionProposal> = {}): ConflictResolutionProposal {
  return {
    regionIndex: 0,
    resolution: 'resolved text',
    rationale: 'trivial merge',
    confidence: 'high',
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

describe('resolveHandler (OSS-2269)', () => {
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
    mockStageConflictResolved.mockResolvedValue({ ok: true, message: 'staged' })
  })

  function mockWorkflow(proposals: ConflictResolutionProposal[]): void {
    mockRunConflictResolutionWorkflow.mockResolvedValue({
      ok: true,
      proposals,
      message: `${proposals.length} proposals`,
    } as ConflictResolutionResult)
  }

  describe('--dry-run', () => {
    it('makes zero applyConflictResolution calls and prints each proposal', async () => {
      mockWorkflow([buildProposal({ regionIndex: 0, confidence: 'medium', rationale: 'judgment call' })])

      await resolveHandler(buildArgv({ dryRun: true }), buildLogger())

      expect(mockApplyConflictResolution).not.toHaveBeenCalled()
      expect(mockStageConflictResolved).not.toHaveBeenCalled()
    })

    it('emits a JSON shape with the file proposals and never touches applyConflictResolution', async () => {
      mockWorkflow([buildProposal({ regionIndex: 0, confidence: 'low', rationale: 'ambiguous' })])

      await resolveHandler(buildArgv({ dryRun: true, json: true }), buildLogger())

      expect(mockApplyConflictResolution).not.toHaveBeenCalled()
      expect(mockEmitJson).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'dry-run',
          files: [
            expect.objectContaining({
              path: 'a.ts',
              proposals: [
                expect.objectContaining({ regionIndex: 0, confidence: 'low', rationale: 'ambiguous' }),
              ],
            }),
          ],
        })
      )
    })
  })

  describe('interactive mode', () => {
    it('accept validates the resolution via applyConflictResolution and stages a marker-free file', async () => {
      mockWorkflow([buildProposal({ regionIndex: 0, resolution: 'accepted text' })])
      mockSelectPrompt.mockResolvedValueOnce('accept')
      mockApplyConflictResolution.mockResolvedValueOnce({
        ok: true,
        message: 'Resolved',
        remainingRegions: 0,
      })

      await resolveHandler(buildArgv(), buildLogger())

      expect(mockApplyConflictResolution).toHaveBeenCalledWith(
        {},
        'a.ts',
        buildRegion(0),
        'accepted text'
      )
      expect(mockStageConflictResolved).toHaveBeenCalledWith({}, 'a.ts')
    })

    it('skip leaves the region untouched and the run exits non-zero', async () => {
      mockWorkflow([buildProposal({ regionIndex: 0 })])
      mockSelectPrompt.mockResolvedValueOnce('skip')

      await expect(resolveHandler(buildArgv(), buildLogger())).rejects.toMatchObject({
        code: 1,
      } satisfies Partial<CommandExitError>)

      expect(mockApplyConflictResolution).not.toHaveBeenCalled()
    })

    it('quit halts processing for the rest of the run, including later files', async () => {
      mockGetConflictedFiles.mockResolvedValue([
        { path: 'a.ts', indexStatus: 'U', worktreeStatus: 'U' },
        { path: 'b.ts', indexStatus: 'U', worktreeStatus: 'U' },
      ])
      mockWorkflow([buildProposal({ regionIndex: 0 }), buildProposal({ regionIndex: 1 })])
      mockSelectPrompt.mockResolvedValueOnce('quit')

      await expect(resolveHandler(buildArgv(), buildLogger())).rejects.toMatchObject({ code: 1 })

      expect(mockSelectPrompt).toHaveBeenCalledTimes(1)
      expect(mockRunConflictResolutionWorkflow).toHaveBeenCalledTimes(1)
      expect(mockApplyConflictResolution).not.toHaveBeenCalled()
    })

    it('edit spawns $EDITOR, reads the file back, then applies the edited text', async () => {
      mockWorkflow([buildProposal({ regionIndex: 0, resolution: 'original proposal' })])
      mockSelectPrompt.mockResolvedValueOnce('edit')
      mockSpawnSync.mockReturnValue({ status: 0, signal: null } as never)
      mockReadFileSync.mockReturnValue('edited by user' as never)
      mockApplyConflictResolution.mockResolvedValueOnce({
        ok: true,
        message: 'Resolved',
        remainingRegions: 0,
      })

      await resolveHandler(buildArgv(), buildLogger())

      expect(mockSpawnSync).toHaveBeenCalled()
      expect(mockApplyConflictResolution).toHaveBeenCalledWith({}, 'a.ts', buildRegion(0), 'edited by user')
    })
  })

  describe('--apply', () => {
    it('skips proposals below --confidence with a stated reason and continues past apply failures', async () => {
      mockGetConflictFileRegions.mockResolvedValue({
        ok: true,
        regions: [buildRegion(0), buildRegion(1)],
      })
      mockWorkflow([
        buildProposal({ regionIndex: 0, confidence: 'medium' }),
        buildProposal({ regionIndex: 1, confidence: 'high' }),
      ])
      mockApplyConflictResolution.mockResolvedValueOnce({
        ok: false,
        message: 'Conflict region not found — file changed on disk.',
      })

      const logger = buildLogger()
      await expect(
        resolveHandler(buildArgv({ apply: true, confidence: 'high' }), logger)
      ).rejects.toMatchObject({ code: 1 })

      // Only the high-confidence region (index 1) should have been attempted.
      expect(mockApplyConflictResolution).toHaveBeenCalledTimes(1)
      expect(mockApplyConflictResolution).toHaveBeenCalledWith({}, 'a.ts', buildRegion(1), 'resolved text')
    })

    it('stages a fully-resolved file and exits 0 when every region clears the threshold', async () => {
      mockWorkflow([buildProposal({ regionIndex: 0, confidence: 'high' })])
      mockApplyConflictResolution.mockResolvedValueOnce({
        ok: true,
        message: 'Resolved',
        remainingRegions: 0,
      })

      await resolveHandler(buildArgv({ apply: true }), buildLogger())

      expect(mockStageConflictResolved).toHaveBeenCalledWith({}, 'a.ts')
    })

    it('supports --json with a resolved/skipped/failed summary', async () => {
      mockWorkflow([buildProposal({ regionIndex: 0, confidence: 'low' })])

      await expect(
        resolveHandler(buildArgv({ apply: true, json: true }), buildLogger())
      ).rejects.toMatchObject({ code: 1 })

      expect(mockEmitJson).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'apply',
          confidence: 'medium',
          files: [expect.objectContaining({ path: 'a.ts', resolved: 0, skipped: 1, failed: 0 })],
        })
      )
    })
  })

  it('rejects --dry-run combined with --apply', async () => {
    await expect(
      resolveHandler(buildArgv({ dryRun: true, apply: true }), buildLogger())
    ).rejects.toMatchObject({ code: 1 })

    expect(mockRunConflictResolutionWorkflow).not.toHaveBeenCalled()
  })

  it('never requires an API key when there is nothing to resolve', async () => {
    mockGetConflictedFiles.mockResolvedValue([])
    mockGetApiKeyForModel.mockReturnValue(undefined as unknown as string)
    mockLoadConfig.mockReturnValue({
      service: { authentication: { type: 'APIKey' }, provider: 'openai', model: 'gpt-4o' },
    } as never)

    await expect(resolveHandler(buildArgv(), buildLogger())).rejects.toMatchObject({ code: 1 })

    expect(mockLoadConfig).not.toHaveBeenCalled()
    expect(mockRunConflictResolutionWorkflow).not.toHaveBeenCalled()
  })
})
