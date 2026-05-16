import type { SimpleGit } from 'simple-git'
import type { LogInkRepoFrame } from '../../commands/log/inkViewModel'
import { createLogInkContextStatus } from '../chrome/context'
import {
  getActiveRepoFrameRuntime,
  syncRepoStackRuntimes,
  updateRepoFrameRuntime,
  type RepoFrameRuntime,
  type RepoStackRuntimes,
} from './repoStackRuntime'

// Each test fakes `SimpleGit` with a tagged stub; we only care about
// identity preservation here, not real git behavior. Calls into the
// runtime never reach the actual library.
function fakeGit(tag: string): SimpleGit {
  return { __tag: tag } as unknown as SimpleGit
}

function makeRuntime(tag: string): RepoFrameRuntime {
  return {
    git: fakeGit(tag),
    context: {},
    contextStatus: createLogInkContextStatus('idle'),
  }
}

function frame(label: string, workdir?: string): LogInkRepoFrame {
  return { label, workdir }
}

describe('syncRepoStackRuntimes', () => {
  it('returns prev unchanged when the stack length is unchanged', () => {
    const prev: RepoStackRuntimes = [makeRuntime('root')]
    const result = syncRepoStackRuntimes(
      prev,
      [frame('root', '/repo')],
      () => makeRuntime('should-not-build'),
    )
    expect(result.runtimes).toBe(prev)
    expect(result.newlyAddedIndices).toEqual([])
  })

  it('appends a new runtime when the stack grew by one (push)', () => {
    const prev: RepoStackRuntimes = [makeRuntime('root')]
    const stack = [frame('root', '/repo'), frame('vendor/lib', '/repo/vendor/lib')]

    const factoryCalls: Array<{ frame: LogInkRepoFrame; depth: number }> = []
    const result = syncRepoStackRuntimes(prev, stack, (f, d) => {
      factoryCalls.push({ frame: f, depth: d })
      return makeRuntime(`${f.label}@${d}`)
    })

    expect(factoryCalls).toEqual([{ frame: stack[1], depth: 1 }])
    expect(result.newlyAddedIndices).toEqual([1])
    expect(result.runtimes).toHaveLength(2)
    expect(result.runtimes[0]).toBe(prev[0])
    expect((result.runtimes[1].git as unknown as { __tag: string }).__tag).toBe('vendor/lib@1')
  })

  it('appends multiple runtimes when the stack grew by more than one', () => {
    const prev: RepoStackRuntimes = [makeRuntime('root')]
    const stack = [
      frame('root', '/repo'),
      frame('vendor/lib', '/repo/vendor/lib'),
      frame('vendor/lib/deep', '/repo/vendor/lib/deep'),
    ]
    const result = syncRepoStackRuntimes(prev, stack, (f, d) => makeRuntime(`${f.label}@${d}`))
    expect(result.newlyAddedIndices).toEqual([1, 2])
    expect(result.runtimes).toHaveLength(3)
    expect(result.runtimes[0]).toBe(prev[0])
  })

  it('slices off the dropped runtimes when the stack shrank (pop)', () => {
    const prev: RepoStackRuntimes = [
      makeRuntime('root'),
      makeRuntime('vendor/lib'),
      makeRuntime('vendor/lib/deep'),
    ]
    const result = syncRepoStackRuntimes(
      prev,
      [frame('root', '/repo'), frame('vendor/lib', '/repo/vendor/lib')],
      () => makeRuntime('should-not-build'),
    )
    expect(result.runtimes).toHaveLength(2)
    expect(result.runtimes[0]).toBe(prev[0])
    expect(result.runtimes[1]).toBe(prev[1])
    expect(result.newlyAddedIndices).toEqual([])
  })

  it('handles a multi-level pop by slicing to the new stack length', () => {
    const prev: RepoStackRuntimes = [
      makeRuntime('root'),
      makeRuntime('vendor/lib'),
      makeRuntime('vendor/lib/deep'),
    ]
    const result = syncRepoStackRuntimes(
      prev,
      [frame('root', '/repo')],
      () => makeRuntime('should-not-build'),
    )
    expect(result.runtimes).toHaveLength(1)
    expect(result.runtimes[0]).toBe(prev[0])
  })

  it('builds a root runtime when starting from an empty list', () => {
    const result = syncRepoStackRuntimes(
      [],
      [frame('root', '/repo')],
      (f, d) => makeRuntime(`${f.label}@${d}`),
    )
    expect(result.newlyAddedIndices).toEqual([0])
    expect(result.runtimes).toHaveLength(1)
  })

  it('passes the matching frame and depth into the factory for each new index', () => {
    const calls: Array<{ label: string; depth: number; workdir?: string }> = []
    syncRepoStackRuntimes(
      [makeRuntime('root')],
      [
        frame('root', '/repo'),
        frame('vendor/lib', '/repo/vendor/lib'),
        frame('vendor/lib/deep', '/repo/vendor/lib/deep'),
      ],
      (f, d) => {
        calls.push({ label: f.label, depth: d, workdir: f.workdir })
        return makeRuntime(f.label)
      },
    )
    expect(calls).toEqual([
      { label: 'vendor/lib', depth: 1, workdir: '/repo/vendor/lib' },
      { label: 'vendor/lib/deep', depth: 2, workdir: '/repo/vendor/lib/deep' },
    ])
  })
})

describe('getActiveRepoFrameRuntime', () => {
  it('returns the top of the runtime list', () => {
    const runtimes: RepoStackRuntimes = [makeRuntime('root'), makeRuntime('vendor/lib')]
    expect(getActiveRepoFrameRuntime(runtimes)).toBe(runtimes[1])
  })

  it('returns undefined for an empty list', () => {
    expect(getActiveRepoFrameRuntime([])).toBeUndefined()
  })

  it('returns the only entry for a single-frame list', () => {
    const runtimes: RepoStackRuntimes = [makeRuntime('root')]
    expect(getActiveRepoFrameRuntime(runtimes)).toBe(runtimes[0])
  })
})

describe('updateRepoFrameRuntime', () => {
  it('replaces the entry at the given index using the updater', () => {
    const runtimes: RepoStackRuntimes = [makeRuntime('root'), makeRuntime('vendor/lib')]
    const swapped = updateRepoFrameRuntime(runtimes, 1, (prev) => ({
      ...prev,
      context: { provider: { kind: 'github' } } as unknown as RepoFrameRuntime['context'],
    }))
    expect(swapped).not.toBe(runtimes)
    expect(swapped).toHaveLength(2)
    expect(swapped[0]).toBe(runtimes[0])
    expect(swapped[1]).not.toBe(runtimes[1])
    expect(swapped[1].context).toEqual({ provider: { kind: 'github' } })
  })

  it('returns prev unchanged when the index is out of range', () => {
    const runtimes: RepoStackRuntimes = [makeRuntime('root')]
    expect(updateRepoFrameRuntime(runtimes, 5, () => makeRuntime('nope'))).toBe(runtimes)
    expect(updateRepoFrameRuntime(runtimes, -1, () => makeRuntime('nope'))).toBe(runtimes)
  })
})
