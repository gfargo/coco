import { promises as fsp } from 'fs'
import { tmpdir } from 'os'
import { applyHunkPatch } from './hunkActions'

const SAMPLE_PATCH = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1,1 +1,2 @@',
  ' const a = 1',
  '+const b = 2',
  '',
].join('\n')

describe('applyHunkPatch', () => {
  let writtenPath: string | undefined
  let writtenContent: string | undefined
  let originalWriteFile: typeof fsp.writeFile
  let originalUnlink: typeof fsp.unlink
  let unlinkCalls: string[]

  beforeEach(() => {
    writtenPath = undefined
    writtenContent = undefined
    unlinkCalls = []

    originalWriteFile = fsp.writeFile
    originalUnlink = fsp.unlink

    // Spy on writeFile so we can confirm the patch lands in $TMPDIR
    // without actually creating files (and without making the test
    // environment-dependent).
    Object.defineProperty(fsp, 'writeFile', {
      configurable: true,
      writable: true,
      value: async (path: string, content: string) => {
        writtenPath = path
        writtenContent = content
      },
    })
    Object.defineProperty(fsp, 'unlink', {
      configurable: true,
      writable: true,
      value: async (path: string) => {
        unlinkCalls.push(path)
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(fsp, 'writeFile', {
      configurable: true,
      writable: true,
      value: originalWriteFile,
    })
    Object.defineProperty(fsp, 'unlink', {
      configurable: true,
      writable: true,
      value: originalUnlink,
    })
  })

  it('writes the patch to a temp file and runs `git apply` for worktree target', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }

    const result = await applyHunkPatch(git as never, SAMPLE_PATCH, { target: 'worktree' })

    expect(result).toEqual({ ok: true, message: 'Applied hunk to worktree' })
    expect(writtenPath).toBeDefined()
    expect(writtenPath!.startsWith(tmpdir())).toBe(true)
    expect(writtenPath!.endsWith('.patch')).toBe(true)
    expect(writtenContent).toBe(SAMPLE_PATCH)
    expect(git.raw).toHaveBeenCalledWith(['apply', '--whitespace=nowarn', writtenPath])
    expect(unlinkCalls).toEqual([writtenPath])
  })

  it('passes --cached for index target', async () => {
    const git = { raw: jest.fn().mockResolvedValue('') }

    const result = await applyHunkPatch(git as never, SAMPLE_PATCH, { target: 'index' })

    expect(result).toEqual({ ok: true, message: 'Applied hunk to index' })
    expect(git.raw).toHaveBeenCalledWith(['apply', '--cached', '--whitespace=nowarn', writtenPath])
  })

  it('surfaces the first line of git stderr on failure with details', async () => {
    const git = {
      raw: jest.fn().mockRejectedValue(new Error([
        'error: patch failed: src/foo.ts:1',
        'error: src/foo.ts: patch does not apply',
      ].join('\n'))),
    }

    const result = await applyHunkPatch(git as never, SAMPLE_PATCH, { target: 'worktree' })

    expect(result.ok).toBe(false)
    expect(result.message).toBe('error: patch failed: src/foo.ts:1')
    expect(result.details).toEqual(['error: src/foo.ts: patch does not apply'])
    // Tempfile cleanup still runs after a failed apply.
    expect(unlinkCalls).toEqual([writtenPath])
  })

  it('cleans up the temp file even when writeFile throws', async () => {
    Object.defineProperty(fsp, 'writeFile', {
      configurable: true,
      writable: true,
      value: async () => { throw new Error('disk full') },
    })

    const git = { raw: jest.fn() }

    const result = await applyHunkPatch(git as never, SAMPLE_PATCH, { target: 'worktree' })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('disk full')
    expect(git.raw).not.toHaveBeenCalled()
    // Even on writeFile failure we attempt the unlink (it will hit
    // ENOENT internally, which the runner swallows).
    expect(unlinkCalls.length).toBe(1)
  })

  it('rejects empty patch text without invoking git', async () => {
    const git = { raw: jest.fn() }

    const result = await applyHunkPatch(git as never, '   \n  ', { target: 'worktree' })

    expect(result).toEqual({ ok: false, message: 'No hunk under cursor to apply.' })
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('swallows ENOENT during cleanup', async () => {
    const enoentError = new Error('ENOENT') as NodeJS.ErrnoException
    enoentError.code = 'ENOENT'

    Object.defineProperty(fsp, 'unlink', {
      configurable: true,
      writable: true,
      value: async () => { throw enoentError },
    })

    const git = { raw: jest.fn().mockResolvedValue('') }

    // Should still report success even when the cleanup unlink hits
    // ENOENT (e.g. because some other process or test cleanup beat us
    // to it).
    const result = await applyHunkPatch(git as never, SAMPLE_PATCH, { target: 'worktree' })
    expect(result.ok).toBe(true)
  })
})
