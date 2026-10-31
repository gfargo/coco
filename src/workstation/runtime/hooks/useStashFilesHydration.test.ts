import type * as ReactTypes from 'react'
import type { StashEntry } from '../../../git/stashData'
import type { LogInkContext } from '../types'
import {
  STASH_FILES_BATCH_SIZE,
  useStashFilesHydration,
  type UseStashFilesHydrationDeps,
} from './useStashFilesHydration'

/** Same single-effect harness as `usePullRequestChecksHydration.test.ts`. */
function hookHarness(): {
  React: typeof ReactTypes
  flushEffect: () => Promise<void>
  unmount: () => void
} {
  let pendingEffect: (() => void | (() => void)) | undefined
  let lastCleanup: (() => void) | undefined
  const React = {
    useEffect: (fn: () => void | (() => void)) => {
      pendingEffect = fn
    },
  } as unknown as typeof ReactTypes
  return {
    React,
    flushEffect: async () => {
      lastCleanup?.()
      const cleanup = pendingEffect?.()
      lastCleanup = typeof cleanup === 'function' ? cleanup : undefined
      await new Promise((resolve) => setImmediate(resolve))
    },
    unmount: () => lastCleanup?.(),
  }
}

const stash = (n: number, files?: string[]): StashEntry => ({
  ref: `stash@{${n}}`, hash: `hash${n}`, baseHash: 'base', date: '', branch: 'main', message: `m${n}`, ...(files ? { files } : {}),
})

describe('useStashFilesHydration (#2209)', () => {
  function makeDeps(stashes: StashEntry[], overrides: Partial<UseStashFilesHydrationDeps> = {}) {
    const raw = jest.fn(async (args: string[]) => `${args[args.length - 1]}.ts\0`)
    let context = { stashes: { stashes } } as unknown as LogInkContext
    const setContext = jest.fn((arg: LogInkContext | ((prev: LogInkContext) => LogInkContext)) => {
      context = typeof arg === 'function' ? arg(context) : arg
    })
    const deps = {
      git: { raw } as never,
      stashes,
      active: true,
      runtimes: [{}],
      setContext,
      ...overrides,
    } as UseStashFilesHydrationDeps
    return { deps, raw, setContext, current: () => context.stashes?.stashes ?? [] }
  }

  it('does nothing while no stash surface is showing, so a refresh costs no stash show', async () => {
    const { React, flushEffect } = hookHarness()
    const { deps, raw } = makeDeps([stash(0), stash(1)], { active: false })
    useStashFilesHydration(React, deps)
    await flushEffect()
    expect(raw).not.toHaveBeenCalled()
  })

  it('loads the missing files by hash once a stash surface is showing', async () => {
    const { React, flushEffect } = hookHarness()
    const { deps, raw, current } = makeDeps([stash(0), stash(1)])
    useStashFilesHydration(React, deps)
    await flushEffect()
    expect(raw).toHaveBeenCalledTimes(2)
    expect(raw).toHaveBeenCalledWith(['stash', 'show', '--name-only', '-z', 'hash0'])
    expect(current().map((entry) => entry.files)).toEqual([['hash0.ts'], ['hash1.ts']])
  })

  it('skips stashes whose files are already loaded', async () => {
    const { React, flushEffect } = hookHarness()
    const { deps, raw, current } = makeDeps([stash(0, ['kept.ts']), stash(1)])
    useStashFilesHydration(React, deps)
    await flushEffect()
    expect(raw).toHaveBeenCalledTimes(1)
    expect(raw).toHaveBeenCalledWith(['stash', 'show', '--name-only', '-z', 'hash1'])
    expect(current()[0].files).toEqual(['kept.ts'])
  })

  it('does not read anything when every stash already has its files', async () => {
    const { React, flushEffect } = hookHarness()
    const { deps, raw } = makeDeps([stash(0, ['a.ts']), stash(1, [])])
    useStashFilesHydration(React, deps)
    await flushEffect()
    expect(raw).not.toHaveBeenCalled()
  })

  it('fills the counts in batches, not all at once', async () => {
    const { React, flushEffect } = hookHarness()
    const many = Array.from({ length: STASH_FILES_BATCH_SIZE + 3 }, (_, index) => stash(index))
    const { deps, setContext } = makeDeps(many)
    useStashFilesHydration(React, deps)
    await flushEffect()
    await flushEffect()
    expect(setContext.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('stores an empty list for a stash it cannot read, so it does not retry forever', async () => {
    const { React, flushEffect } = hookHarness()
    const { deps, current } = makeDeps([stash(0), stash(1)], {
      git: { raw: jest.fn(async (args: string[]) => { if (args[args.length - 1] === 'hash0') throw new Error('gone'); return 'b.ts\0' }) } as never,
    })
    useStashFilesHydration(React, deps)
    await flushEffect()
    expect(current().map((entry) => entry.files)).toEqual([[], ['b.ts']])
  })

  it('tags the write with the frame depth it was issued at', async () => {
    const { React, flushEffect } = hookHarness()
    const { deps, setContext } = makeDeps([stash(0)], { runtimes: [{}, {}] })
    useStashFilesHydration(React, deps)
    await flushEffect()
    expect(setContext).toHaveBeenCalledWith(expect.any(Function), 1)
  })

  it('drops a result that lands after the effect was cleaned up', async () => {
    const { React, flushEffect, unmount } = hookHarness()
    let release: (value: string) => void = () => undefined
    const { deps, setContext } = makeDeps([stash(0)], {
      git: { raw: jest.fn(() => new Promise<string>((resolve) => { release = resolve })) } as never,
    })
    useStashFilesHydration(React, deps)
    await flushEffect()
    unmount()
    release('late.ts\0')
    await new Promise((resolve) => setImmediate(resolve))
    expect(setContext).not.toHaveBeenCalled()
  })
})
