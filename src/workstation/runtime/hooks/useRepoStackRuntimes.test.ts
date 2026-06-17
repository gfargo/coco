import type { SimpleGit } from 'simple-git'
import { createInitialContextStatus } from '../repoFrameFactory'
import type { RepoFrameRuntime, RepoStackRuntimes } from '../repoStackRuntime'
import type { LogInkContext } from '../types'
import { useRepoStackRuntimes } from './useRepoStackRuntimes'

/**
 * Tests for `useRepoStackRuntimes` (app.ts decomposition item 6 / #1237).
 * Driven through a fake-React harness (the sync effect is ignored — it is a
 * verbatim lift of the separately-tested `syncRepoStackRuntimes`). Covers the
 * seed projection and the frame-tagged `setContext` / `setContextStatus`
 * writers, including `targetDepth` routing and the out-of-range guard.
 */

const rootGit = { __tag: 'rootGit' } as unknown as SimpleGit

/** A fake frame runtime with a labelled git + given context. */
const frame = (label: string, context: LogInkContext = {}): RepoFrameRuntime =>
  ({
    git: { __tag: label } as unknown as SimpleGit,
    context,
    contextStatus: createInitialContextStatus(),
  })

function makeReact(): {
  React: typeof import('react')
  setRuntimes: jest.Mock
} {
  const setRuntimes = jest.fn()
  const React = {
    useState: (init: unknown) => [
      typeof init === 'function' ? (init as () => unknown)() : init,
      setRuntimes,
    ],
    useEffect: () => {},
    useCallback: (fn: unknown) => fn,
  } as unknown as typeof import('react')
  return { React, setRuntimes }
}

/** Apply the (function) updater the writer handed to setRuntimes. */
const applyUpdater = (setRuntimes: jest.Mock, prev: RepoStackRuntimes) =>
  (setRuntimes.mock.calls[0][0] as (p: RepoStackRuntimes) => RepoStackRuntimes)(prev)

describe('useRepoStackRuntimes seed projection', () => {
  it('seeds a single root frame and projects git/context/contextStatus off it', () => {
    const { React } = makeReact()
    const result = useRepoStackRuntimes(React, { rootGit, repoStack: [] })

    expect(result.runtimes).toHaveLength(1)
    expect(result.git).toBe(rootGit)
    expect(result.context).toEqual({})
    expect(result.contextStatus).toEqual(createInitialContextStatus())
  })
})

describe('setContext', () => {
  it('writes the active (top-of-stack) frame, leaving the others untouched', () => {
    const { React, setRuntimes } = makeReact()
    const { setContext } = useRepoStackRuntimes(React, { rootGit, repoStack: [] })

    setContext({ pendingKey: 'branchList' } as unknown as LogInkContext)
    const prev: RepoStackRuntimes = [frame('parent'), frame('child')]
    const next = applyUpdater(setRuntimes, prev)

    expect(next[1].context).toEqual({ pendingKey: 'branchList' })
    expect(next[0]).toBe(prev[0])
  })

  it('supports the function-updater form against the active frame', () => {
    const { React, setRuntimes } = makeReact()
    const { setContext } = useRepoStackRuntimes(React, { rootGit, repoStack: [] })

    setContext((prevContext) => ({ ...prevContext, pendingKey: 'tagList' }))
    const prev: RepoStackRuntimes = [
      frame('only', { pendingKey: 'stashList' } as unknown as LogInkContext),
    ]
    const next = applyUpdater(setRuntimes, prev)

    expect(next[0].context).toEqual({ pendingKey: 'tagList' })
  })

  it('routes to a specific frame when targetDepth is given', () => {
    const { React, setRuntimes } = makeReact()
    const { setContext } = useRepoStackRuntimes(React, { rootGit, repoStack: [] })

    setContext({ pendingKey: 'branchList' } as unknown as LogInkContext, 0)
    const prev: RepoStackRuntimes = [frame('parent'), frame('child')]
    const next = applyUpdater(setRuntimes, prev)

    expect(next[0].context).toEqual({ pendingKey: 'branchList' })
    expect(next[1]).toBe(prev[1])
  })

  it('no-ops on a negative depth (drops the write)', () => {
    const { React, setRuntimes } = makeReact()
    const { setContext } = useRepoStackRuntimes(React, { rootGit, repoStack: [] })

    setContext({ pendingKey: 'branchList' } as unknown as LogInkContext, -1)
    const prev: RepoStackRuntimes = [frame('parent')]
    const next = applyUpdater(setRuntimes, prev)

    expect(next).toBe(prev)
  })

  it('drops the write when targetDepth points at a popped (out-of-range) frame', () => {
    const { React, setRuntimes } = makeReact()
    const { setContext } = useRepoStackRuntimes(React, { rootGit, repoStack: [] })

    setContext({ pendingKey: 'branchList' } as unknown as LogInkContext, 5)
    const prev: RepoStackRuntimes = [frame('parent')]
    const next = applyUpdater(setRuntimes, prev)

    expect(next).toEqual(prev)
    expect(next[0].context).toEqual(prev[0].context)
  })
})

describe('setContextStatus', () => {
  it('writes the active frame contextStatus via the function-updater form', () => {
    const { React, setRuntimes } = makeReact()
    const { setContextStatus } = useRepoStackRuntimes(React, { rootGit, repoStack: [] })

    setContextStatus((prevStatus) => ({ ...prevStatus, branchList: 'loading' } as never))
    const prev: RepoStackRuntimes = [frame('parent'), frame('child')]
    const next = applyUpdater(setRuntimes, prev)

    expect(next[1].contextStatus).toMatchObject({ branchList: 'loading' })
    expect(next[0]).toBe(prev[0])
  })
})
