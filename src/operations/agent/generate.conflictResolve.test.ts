/**
 * Tests for `runConflictResolve`.
 *
 * Key coverage:
 * - Never calls `applyConflictResolution` / `writeFileAtomic` — the operation
 *   is strictly read-only; proposals are returned, never applied.
 * - A diff3-style mid-merge fixture (with a base section) produces a
 *   per-region proposal/confidence/rationale/digest.
 * - A binary fixture is skipped into `unresolved` without invoking the LLM
 *   workflow.
 * - `maxFiles` / `maxRegions` overflow is reported in `unresolved`.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { SimpleGit } from 'simple-git'

import { runConflictResolutionWorkflow } from '../../git/conflictAiActions'
import { applyConflictResolution } from '../../git/conflictRegionActions'
import { writeFileAtomic } from '../../lib/utils/atomicFileWrite'
import type { AgentOperationContext } from './context'
import { runConflictResolve } from './generate'
import { ConflictResolveRequestSchema } from './schemas'

jest.mock('../../git/conflictAiActions')
jest.mock('../../git/conflictRegionActions', () => ({
  ...jest.requireActual('../../git/conflictRegionActions'),
  applyConflictResolution: jest.fn(),
}))
jest.mock('../../lib/utils/atomicFileWrite', () => ({
  ...jest.requireActual('../../lib/utils/atomicFileWrite'),
  writeFileAtomic: jest.fn(),
}))

const mockRunConflictResolutionWorkflow = runConflictResolutionWorkflow as jest.MockedFunction<
  typeof runConflictResolutionWorkflow
>
const mockApplyConflictResolution = applyConflictResolution as jest.MockedFunction<typeof applyConflictResolution>
const mockWriteFileAtomic = writeFileAtomic as jest.MockedFunction<typeof writeFileAtomic>

const DIFF3_CONFLICT = `top
<<<<<<< HEAD
ours line
||||||| base
base line
=======
theirs line
>>>>>>> feature
bottom
`

const TWO_REGION_CONFLICT = `top
<<<<<<< HEAD
ours1
=======
theirs1
>>>>>>> feature
middle
<<<<<<< HEAD
ours2
=======
theirs2
>>>>>>> feature
bottom
`

function statusToken(indexStatus: string, worktreeStatus: string, filePath: string): string {
  return `${indexStatus}${worktreeStatus} ${filePath}`
}

function makeGit(tempDir: string, statusOutput: string, opts: { inMerge?: boolean } = {}): SimpleGit {
  const gitDir = path.join(tempDir, '.git')
  if (opts.inMerge) {
    fs.mkdirSync(gitDir, { recursive: true })
    fs.writeFileSync(path.join(gitDir, 'MERGE_HEAD'), 'deadbeef\n')
  }
  const revparse = jest.fn(async (args: string[]) => {
    if (args[0] === '--show-toplevel') return tempDir
    if (args[0] === '--git-path') return path.join(gitDir, args[1])
    return ''
  })
  const raw = jest.fn(async (args: string[]) => {
    if (args[0] === 'status') return statusOutput
    return ''
  })
  return { revparse, raw } as unknown as SimpleGit
}

function makeContext(repoRoot: string, git: SimpleGit | undefined): AgentOperationContext {
  return {
    repoRoot,
    git,
    logger: { setConfig: jest.fn(), verbose: jest.fn() } as unknown as AgentOperationContext['logger'],
    surface: 'mcp',
  }
}

describe('runConflictResolve', () => {
  let tempDir: string

  beforeEach(() => {
    jest.clearAllMocks()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-conflict-resolve-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('throws INVALID_REPOSITORY when the context has no git binding', async () => {
    const input = ConflictResolveRequestSchema.parse({})
    await expect(runConflictResolve(input, makeContext(tempDir, undefined))).rejects.toMatchObject({
      code: 'INVALID_REPOSITORY',
    })
  })

  it('returns an empty result when there are no conflicted files', async () => {
    const git = makeGit(tempDir, '')
    const input = ConflictResolveRequestSchema.parse({})
    const result = await runConflictResolve(input, makeContext(tempDir, git))

    expect(result.data).toEqual({ conflicts: [], unresolved: [] })
    expect(mockRunConflictResolutionWorkflow).not.toHaveBeenCalled()
  })

  it('produces per-region proposal/confidence/rationale/digest for a diff3 mid-merge fixture', async () => {
    fs.writeFileSync(path.join(tempDir, 'file.txt'), DIFF3_CONFLICT)
    const git = makeGit(tempDir, `${statusToken('U', 'U', 'file.txt')}\0`, { inMerge: true })
    mockRunConflictResolutionWorkflow.mockResolvedValue({
      ok: true,
      proposals: [{ regionIndex: 0, resolution: 'combined line', rationale: 'merged both sides', confidence: 'high' }],
      message: '1 of 1 regions have proposals',
    })

    const input = ConflictResolveRequestSchema.parse({})
    const result = await runConflictResolve(input, makeContext(tempDir, git))

    expect(result.data.unresolved).toEqual([])
    expect(result.data.conflicts).toHaveLength(1)
    expect(result.data.conflicts[0]).toMatchObject({
      path: 'file.txt',
      regionIndex: 0,
      ours: ['ours line'],
      theirs: ['theirs line'],
      base: ['base line'],
      proposal: 'combined line',
      confidence: 'high',
      rationale: 'merged both sides',
    })
    expect(result.data.conflicts[0].digest).toMatch(/^sha256:/)
    expect(mockRunConflictResolutionWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      path: 'file.txt',
      operation: 'merge',
    }))
    expect(mockApplyConflictResolution).not.toHaveBeenCalled()
    expect(mockWriteFileAtomic).not.toHaveBeenCalled()
  })

  it('reports an unresolved entry for a binary file without calling the LLM workflow', async () => {
    fs.writeFileSync(path.join(tempDir, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00]))
    const git = makeGit(tempDir, `${statusToken('U', 'U', 'binary.bin')}\0`, { inMerge: true })

    const input = ConflictResolveRequestSchema.parse({})
    const result = await runConflictResolve(input, makeContext(tempDir, git))

    expect(result.data.conflicts).toEqual([])
    expect(result.data.unresolved).toEqual([
      { path: 'binary.bin', regionIndex: -1, reason: expect.stringContaining('Binary') },
    ])
    expect(mockRunConflictResolutionWorkflow).not.toHaveBeenCalled()
    expect(mockApplyConflictResolution).not.toHaveBeenCalled()
    expect(mockWriteFileAtomic).not.toHaveBeenCalled()
  })

  it('reports unresolved entries for files beyond maxFiles', async () => {
    fs.writeFileSync(path.join(tempDir, 'a.txt'), DIFF3_CONFLICT)
    fs.writeFileSync(path.join(tempDir, 'b.txt'), DIFF3_CONFLICT)
    const statusOutput = [statusToken('U', 'U', 'a.txt'), statusToken('U', 'U', 'b.txt')].join('\0') + '\0'
    const git = makeGit(tempDir, statusOutput, { inMerge: true })
    mockRunConflictResolutionWorkflow.mockResolvedValue({
      ok: true,
      proposals: [{ regionIndex: 0, resolution: 'x', rationale: 'y', confidence: 'high' }],
      message: 'ok',
    })

    const input = ConflictResolveRequestSchema.parse({ maxFiles: 1 })
    const result = await runConflictResolve(input, makeContext(tempDir, git))

    expect(result.data.conflicts).toHaveLength(1)
    expect(result.data.conflicts[0].path).toBe('a.txt')
    expect(result.data.unresolved).toEqual([
      { path: 'b.txt', regionIndex: -1, reason: expect.stringContaining('maxFiles') },
    ])
    expect(mockRunConflictResolutionWorkflow).toHaveBeenCalledTimes(1)
  })

  it('reports unresolved entries for regions beyond maxRegions', async () => {
    fs.writeFileSync(path.join(tempDir, 'file.txt'), TWO_REGION_CONFLICT)
    const git = makeGit(tempDir, `${statusToken('U', 'U', 'file.txt')}\0`, { inMerge: true })
    mockRunConflictResolutionWorkflow.mockResolvedValue({
      ok: true,
      proposals: [{ regionIndex: 0, resolution: 'x', rationale: 'y', confidence: 'high' }],
      message: 'ok',
    })

    const input = ConflictResolveRequestSchema.parse({ maxRegions: 1 })
    const result = await runConflictResolve(input, makeContext(tempDir, git))

    expect(result.data.conflicts).toHaveLength(1)
    expect(result.data.conflicts[0].regionIndex).toBe(0)
    expect(result.data.unresolved).toEqual([
      { path: 'file.txt', regionIndex: 1, reason: expect.stringContaining('maxRegions') },
    ])
    expect(mockRunConflictResolutionWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      regions: [expect.objectContaining({ index: 0 })],
    }))
  })

  it('intersects conflicted files with the requested `files` filter', async () => {
    fs.writeFileSync(path.join(tempDir, 'a.txt'), DIFF3_CONFLICT)
    fs.writeFileSync(path.join(tempDir, 'b.txt'), DIFF3_CONFLICT)
    const statusOutput = [statusToken('U', 'U', 'a.txt'), statusToken('U', 'U', 'b.txt')].join('\0') + '\0'
    const git = makeGit(tempDir, statusOutput, { inMerge: true })
    mockRunConflictResolutionWorkflow.mockResolvedValue({
      ok: true,
      proposals: [{ regionIndex: 0, resolution: 'x', rationale: 'y', confidence: 'high' }],
      message: 'ok',
    })

    const input = ConflictResolveRequestSchema.parse({ files: ['a.txt'] })
    const result = await runConflictResolve(input, makeContext(tempDir, git))

    expect(result.data.conflicts).toHaveLength(1)
    expect(result.data.conflicts[0].path).toBe('a.txt')
    expect(result.data.unresolved).toEqual([])
    expect(mockRunConflictResolutionWorkflow).toHaveBeenCalledTimes(1)
  })

  it('reports an unresolved entry per region when the LLM workflow fails', async () => {
    fs.writeFileSync(path.join(tempDir, 'file.txt'), DIFF3_CONFLICT)
    const git = makeGit(tempDir, `${statusToken('U', 'U', 'file.txt')}\0`, { inMerge: true })
    mockRunConflictResolutionWorkflow.mockResolvedValue({
      ok: false,
      message: 'No API key configured.',
    })

    const input = ConflictResolveRequestSchema.parse({})
    const result = await runConflictResolve(input, makeContext(tempDir, git))

    expect(result.data.conflicts).toEqual([])
    expect(result.data.unresolved).toEqual([
      { path: 'file.txt', regionIndex: 0, reason: 'No API key configured.' },
    ])
  })
})
