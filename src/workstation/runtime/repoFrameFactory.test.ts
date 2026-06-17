import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { SimpleGit } from 'simple-git'
import { createInitialContextStatus, createRepoFrameRuntime } from './repoFrameFactory'

function fakeGit(tag: string): SimpleGit {
  return { __tag: tag } as unknown as SimpleGit
}

// `simpleGit(path)` refuses to bind against a non-existent directory,
// so the workdir-bound assertions need a real path on disk.
let realWorkdir: string

beforeAll(() => {
  realWorkdir = mkdtempSync(join(tmpdir(), 'coco-repo-frame-factory-'))
})

afterAll(() => {
  if (realWorkdir) {
    rmSync(realWorkdir, { recursive: true, force: true })
  }
})

describe('createInitialContextStatus', () => {
  it('seeds every fetched key in loading', () => {
    const status = createInitialContextStatus()
    expect(status.branches).toBe('loading')
    expect(status.tags).toBe('loading')
    expect(status.stashes).toBe('loading')
    expect(status.worktree).toBe('loading')
    expect(status.worktreeList).toBe('loading')
    expect(status.submodules).toBe('loading')
  })

  it('seeds every lazy-loaded key as idle so the chrome does not stick on "loading context"', () => {
    const status = createInitialContextStatus()
    // These three are hydrated on entry to their view, not at boot, so
    // leaving them 'loading' kept the header's context indicator stuck
    // forever (#808 fixed pullRequest; issueList / pullRequestList were
    // the missed siblings).
    expect(status.pullRequest).toBe('idle')
    expect(status.issueList).toBe('idle')
    expect(status.pullRequestList).toBe('idle')
  })

  it('returns a fresh object on each call', () => {
    const a = createInitialContextStatus()
    const b = createInitialContextStatus()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

describe('createRepoFrameRuntime', () => {
  it('binds simpleGit to the frame workdir when one is set', () => {
    const rootGit = fakeGit('root')
    const runtime = createRepoFrameRuntime(
      { label: 'vendor/lib', workdir: realWorkdir },
      rootGit,
    )
    // We can't easily assert against the real simple-git instance,
    // but we CAN assert it's not the root. Production binds against
    // the workdir via simpleGit() — a different instance every time.
    expect(runtime.git).not.toBe(rootGit)
  })

  it('falls back to rootGit when the frame has no workdir', () => {
    const rootGit = fakeGit('root')
    const runtime = createRepoFrameRuntime({ label: 'orphan' }, rootGit)
    expect(runtime.git).toBe(rootGit)
  })

  it('starts the context empty', () => {
    const runtime = createRepoFrameRuntime(
      { label: 'vendor/lib', workdir: realWorkdir },
      fakeGit('root'),
    )
    expect(runtime.context).toEqual({})
  })

  it('seeds the context status with the canonical initial shape', () => {
    const runtime = createRepoFrameRuntime(
      { label: 'vendor/lib', workdir: realWorkdir },
      fakeGit('root'),
    )
    expect(runtime.contextStatus).toEqual(createInitialContextStatus())
  })
})
