import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SimpleGit } from 'simple-git'

import * as conflictRegionActions from '../../git/conflictRegionActions'
import { runConflictResolutionWorkflow } from '../../git/conflictAiActions'
import * as atomicFileWrite from '../../lib/utils/atomicFileWrite'
import { AgentOperationContext, digestOf } from './context'
import { runConflictResolve } from './generate'
import { ConflictResolveRequestSchema } from './schemas'

jest.mock('../../git/conflictAiActions')

const mockRunConflictResolutionWorkflow =
  runConflictResolutionWorkflow as jest.MockedFunction<typeof runConflictResolutionWorkflow>

const DIFF3_CONFLICT = [
  '<<<<<<< HEAD',
  'ours line',
  '||||||| merged common ancestors',
  'base line',
  '=======',
  'theirs line',
  '>>>>>>> feature/x',
  '',
].join('\n')

const TWO_REGION_CONFLICT = [
  '<<<<<<< HEAD',
  'ours A',
  '=======',
  'theirs A',
  '>>>>>>> feature/x',
  '<<<<<<< HEAD',
  'ours B',
  '=======',
  'theirs B',
  '>>>>>>> feature/x',
  '',
].join('\n')

function makeGit(root: string, statusOutput: string): SimpleGit {
  const raw = jest.fn(async (args: string[]) => {
    if (args[0] === 'status') return statusOutput
    return ''
  })
  const revparse = jest.fn(async (args: string[]) => {
    if (args.includes('--show-toplevel')) return root
    if (args.includes('--git-path')) return join(root, args[args.length - 1])
    return ''
  })
  return { raw, revparse } as unknown as SimpleGit
}

function makeContext(root: string, git: SimpleGit | undefined): AgentOperationContext {
  return {
    repoRoot: root,
    git,
    logger: { setConfig: jest.fn(), verbose: jest.fn() } as unknown as AgentOperationContext['logger'],
    surface: 'mcp',
  }
}

function okResult(proposals: Array<{ regionIndex: number; resolution: string; rationale: string; confidence: 'high' | 'medium' | 'low' }>) {
  return { ok: true as const, message: `${proposals.length} regions have proposals`, proposals }
}

describe('runConflictResolve', () => {
  let root: string

  beforeEach(() => {
    jest.clearAllMocks()
    root = mkdtempSync(join(tmpdir(), 'coco-conflict-resolve-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('throws INVALID_REPOSITORY when the context has no git binding', async () => {
    const input = ConflictResolveRequestSchema.parse({})
    await expect(runConflictResolve(input, makeContext(root, undefined))).rejects.toMatchObject({
      code: 'INVALID_REPOSITORY',
    })
  })

  it('returns an empty envelope with no LLM call when there are no conflicted files', async () => {
    const git = makeGit(root, '')
    const input = ConflictResolveRequestSchema.parse({})
    const result = await runConflictResolve(input, makeContext(root, git))
    expect(result.data).toEqual({ conflicts: [], unresolved: [] })
    expect(mockRunConflictResolutionWorkflow).not.toHaveBeenCalled()
  })

  it('produces per-region proposal/confidence/rationale/digest for a diff3-style conflict', async () => {
    writeFileSync(join(root, 'a.ts'), DIFF3_CONFLICT)
    const git = makeGit(root, 'UU a.ts\0')
    mockRunConflictResolutionWorkflow.mockResolvedValue(
      okResult([{ regionIndex: 0, resolution: 'resolved line', rationale: 'combined both sides', confidence: 'high' }])
    )

    const input = ConflictResolveRequestSchema.parse({})
    const result = await runConflictResolve(input, makeContext(root, git))

    expect(result.data.unresolved).toEqual([])
    expect(result.data.conflicts).toEqual([{
      path: 'a.ts',
      regionIndex: 0,
      ours: ['ours line'],
      theirs: ['theirs line'],
      base: ['base line'],
      proposal: 'resolved line',
      confidence: 'high',
      rationale: 'combined both sides',
      digest: digestOf(DIFF3_CONFLICT),
    }])
    expect(mockRunConflictResolutionWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      path: 'a.ts',
      operation: 'none',
    }))
  })

  it('reports a binary file as unresolved with a reason, without calling the LLM', async () => {
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]))
    const git = makeGit(root, 'UU bin.dat\0')

    const input = ConflictResolveRequestSchema.parse({})
    const result = await runConflictResolve(input, makeContext(root, git))

    expect(result.data.conflicts).toEqual([])
    expect(result.data.unresolved).toEqual([{
      path: 'bin.dat',
      regionIndex: 0,
      reason: expect.stringContaining('binary'),
    }])
    expect(mockRunConflictResolutionWorkflow).not.toHaveBeenCalled()
  })

  it('reports files beyond maxFiles as unresolved overflow', async () => {
    writeFileSync(join(root, 'a.ts'), DIFF3_CONFLICT)
    writeFileSync(join(root, 'b.ts'), DIFF3_CONFLICT)
    const git = makeGit(root, 'UU a.ts\0UU b.ts\0')
    mockRunConflictResolutionWorkflow.mockResolvedValue(
      okResult([{ regionIndex: 0, resolution: 'resolved', rationale: 'r', confidence: 'high' }])
    )

    const input = ConflictResolveRequestSchema.parse({ maxFiles: 1 })
    const result = await runConflictResolve(input, makeContext(root, git))

    expect(result.data.conflicts).toHaveLength(1)
    expect(result.data.conflicts[0].path).toBe('a.ts')
    expect(result.data.unresolved).toEqual([{
      path: 'b.ts',
      regionIndex: 0,
      reason: expect.stringContaining('maxFiles'),
    }])
    expect(mockRunConflictResolutionWorkflow).toHaveBeenCalledTimes(1)
  })

  it('reports regions beyond maxRegions as unresolved overflow', async () => {
    writeFileSync(join(root, 'a.ts'), TWO_REGION_CONFLICT)
    const git = makeGit(root, 'UU a.ts\0')
    mockRunConflictResolutionWorkflow.mockResolvedValue(
      okResult([{ regionIndex: 0, resolution: 'resolved A', rationale: 'r', confidence: 'high' }])
    )

    const input = ConflictResolveRequestSchema.parse({ maxRegions: 1 })
    const result = await runConflictResolve(input, makeContext(root, git))

    expect(mockRunConflictResolutionWorkflow).toHaveBeenCalledTimes(1)
    const call = mockRunConflictResolutionWorkflow.mock.calls[0][0]
    expect(call.regions).toHaveLength(1)
    expect(call.regions[0].index).toBe(0)

    expect(result.data.conflicts).toEqual([expect.objectContaining({ path: 'a.ts', regionIndex: 0 })])
    expect(result.data.unresolved).toEqual([{
      path: 'a.ts',
      regionIndex: 1,
      reason: expect.stringContaining('maxRegions'),
    }])
  })

  it('intersects conflicted files with input.files when provided', async () => {
    writeFileSync(join(root, 'a.ts'), DIFF3_CONFLICT)
    writeFileSync(join(root, 'b.ts'), DIFF3_CONFLICT)
    const git = makeGit(root, 'UU a.ts\0UU b.ts\0')
    mockRunConflictResolutionWorkflow.mockResolvedValue(
      okResult([{ regionIndex: 0, resolution: 'resolved', rationale: 'r', confidence: 'high' }])
    )

    const input = ConflictResolveRequestSchema.parse({ files: ['b.ts'] })
    const result = await runConflictResolve(input, makeContext(root, git))

    expect(result.data.conflicts).toHaveLength(1)
    expect(result.data.conflicts[0].path).toBe('b.ts')
    expect(mockRunConflictResolutionWorkflow).toHaveBeenCalledTimes(1)
  })

  it('throws AUTHENTICATION_REQUIRED when no API key is configured', async () => {
    writeFileSync(join(root, 'a.ts'), DIFF3_CONFLICT)
    const git = makeGit(root, 'UU a.ts\0')
    mockRunConflictResolutionWorkflow.mockResolvedValue({
      ok: false,
      message: 'No API key configured. Set one via env or .coco.config.json first.',
    })

    const input = ConflictResolveRequestSchema.parse({})
    await expect(runConflictResolve(input, makeContext(root, git))).rejects.toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
    })
  })

  it('throws CANCELLED when the workflow reports cancellation', async () => {
    writeFileSync(join(root, 'a.ts'), DIFF3_CONFLICT)
    const git = makeGit(root, 'UU a.ts\0')
    mockRunConflictResolutionWorkflow.mockResolvedValue({
      ok: false,
      cancelled: true,
      message: 'Conflict resolution cancelled.',
    })

    const input = ConflictResolveRequestSchema.parse({})
    await expect(runConflictResolve(input, makeContext(root, git))).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('reports a region as unresolved when the workflow fails for a non-auth reason', async () => {
    writeFileSync(join(root, 'a.ts'), DIFF3_CONFLICT)
    const git = makeGit(root, 'UU a.ts\0')
    mockRunConflictResolutionWorkflow.mockResolvedValue({
      ok: false,
      message: 'The model returned no usable proposals — try again.',
    })

    const input = ConflictResolveRequestSchema.parse({})
    const result = await runConflictResolve(input, makeContext(root, git))

    expect(result.data.conflicts).toEqual([])
    expect(result.data.unresolved).toEqual([{
      path: 'a.ts',
      regionIndex: 0,
      reason: 'The model returned no usable proposals — try again.',
    }])
  })

  it('never calls applyConflictResolution or writeFileAtomic (read-only call graph)', async () => {
    const applySpy = jest.spyOn(conflictRegionActions, 'applyConflictResolution')
    const writeSpy = jest.spyOn(atomicFileWrite, 'writeFileAtomic')

    writeFileSync(join(root, 'a.ts'), DIFF3_CONFLICT)
    const git = makeGit(root, 'UU a.ts\0')
    mockRunConflictResolutionWorkflow.mockResolvedValue(
      okResult([{ regionIndex: 0, resolution: 'resolved line', rationale: 'combined both sides', confidence: 'high' }])
    )

    const input = ConflictResolveRequestSchema.parse({})
    await runConflictResolve(input, makeContext(root, git))

    expect(applySpy).not.toHaveBeenCalled()
    expect(writeSpy).not.toHaveBeenCalled()

    applySpy.mockRestore()
    writeSpy.mockRestore()
  })
})
