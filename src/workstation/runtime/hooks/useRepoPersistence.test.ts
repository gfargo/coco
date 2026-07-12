/**
 * Regression coverage for #1598: the restore effect and the two save
 * effects in `useViewModePersistence` each fire behind their own
 * independent `revparse`, with no ordering guarantee between them. A
 * save's continuation resolving before the restore's read used to
 * silently overwrite a cached preference with the mount-time default.
 *
 * The fix gates both save effects on a `restoredGitRef` that only marks
 * the current `git` once THIS git's restore effect has completed —
 * verified here by invoking the three registered effects out of
 * declaration order and asserting the save effects no-op (never even
 * call `revparse`) until the restore effect's async work settles.
 */
import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import {
  useViewModePersistence,
  type UseViewModePersistenceDeps,
} from './useRepoPersistence'
import { getSavedSidebarTab, saveSidebarTab } from '../../chrome/sidebarPersistence'
import { getSavedDiffViewMode, saveDiffViewMode } from '../../chrome/diffViewModePersistence'

jest.mock('../../chrome/sidebarPersistence', () => ({
  getSavedSidebarTab: jest.fn(),
  saveSidebarTab: jest.fn(),
}))
jest.mock('../../chrome/diffViewModePersistence', () => ({
  getSavedDiffViewMode: jest.fn(),
  saveDiffViewMode: jest.fn(),
}))

const getSavedSidebarTabMock = getSavedSidebarTab as jest.MockedFunction<typeof getSavedSidebarTab>
const saveSidebarTabMock = saveSidebarTab as jest.MockedFunction<typeof saveSidebarTab>
const getSavedDiffViewModeMock = getSavedDiffViewMode as jest.MockedFunction<typeof getSavedDiffViewMode>
const saveDiffViewModeMock = saveDiffViewMode as jest.MockedFunction<typeof saveDiffViewMode>

type EffectFn = () => void | (() => void)

/** Fake React: records every `useEffect` registration; `useRef` is a real persistent box. */
function effectsReact(): { React: typeof import('react'); effects: EffectFn[] } {
  const effects: EffectFn[] = []
  let ref: { current: unknown } | undefined
  const React = {
    useEffect: (fn: EffectFn) => {
      effects.push(fn)
    },
    useRef: (init: unknown) => {
      if (!ref) ref = { current: init }
      return ref
    },
  } as unknown as typeof import('react')
  return { React, effects }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

function baseDeps(overrides: Partial<UseViewModePersistenceDeps> = {}): UseViewModePersistenceDeps {
  return {
    git: {} as SimpleGit,
    dispatch: jest.fn(),
    repoRootRef: { current: undefined } as ReactTypes.MutableRefObject<string | undefined>,
    userSidebarTab: 'status',
    diffViewMode: 'unified',
    ...overrides,
  }
}

describe('useViewModePersistence — restore/save race (#1598)', () => {
  beforeEach(() => {
    getSavedSidebarTabMock.mockReset()
    saveSidebarTabMock.mockReset()
    getSavedDiffViewModeMock.mockReset()
    saveDiffViewModeMock.mockReset()
  })

  it('the mount-time save effects never write before the restore effect completes for this git', async () => {
    let resolveRevparse: ((value: string) => void) | undefined
    const revparse = jest.fn().mockImplementation(
      () => new Promise<string>((resolve) => { resolveRevparse = resolve })
    )
    const git = { revparse } as unknown as SimpleGit
    getSavedSidebarTabMock.mockReturnValue('branches')

    const { React, effects } = effectsReact()
    useViewModePersistence(React, baseDeps({ git, userSidebarTab: 'status' }))
    expect(effects).toHaveLength(3)
    const [restoreEffect, sidebarSaveEffect, diffSaveEffect] = effects

    // Fire the save effects FIRST — mirroring the arbitrary ordering the
    // three independent revparse continuations could resolve in. Before
    // the fix these called revparse unconditionally; now the gate
    // short-circuits before ever touching git.
    sidebarSaveEffect()
    diffSaveEffect()
    expect(saveSidebarTabMock).not.toHaveBeenCalled()
    expect(saveDiffViewModeMock).not.toHaveBeenCalled()
    // The gate rejects synchronously, before the revparse call — so
    // only the restore effect (fired next) should have called it.
    expect(revparse).not.toHaveBeenCalled()

    restoreEffect()
    expect(revparse).toHaveBeenCalledTimes(1)
    resolveRevparse?.('/repo/root')
    await flush()

    // Restore read the cache and (since it differs from the mount-time
    // default) dispatched the correction — the save effects never wrote
    // 'status' over the cached 'branches'.
    expect(saveSidebarTabMock).not.toHaveBeenCalled()
    expect(saveDiffViewModeMock).not.toHaveBeenCalled()
  })

  it('a genuine user tab change after restore has completed still saves', async () => {
    const revparse = jest.fn().mockResolvedValue('/repo/root')
    const git = { revparse } as unknown as SimpleGit
    getSavedSidebarTabMock.mockReturnValue('status')
    getSavedDiffViewModeMock.mockReturnValue('unified')

    const { React, effects } = effectsReact()
    useViewModePersistence(React, baseDeps({ git, userSidebarTab: 'status', diffViewMode: 'unified' }))
    const [restoreEffect, sidebarSaveEffect] = effects

    restoreEffect()
    await flush()

    // Simulate the next render: the user switched tabs, so a fresh
    // sidebar-save effect instance fires (same restoredGitRef, same git).
    sidebarSaveEffect()
    await flush()

    expect(saveSidebarTabMock).toHaveBeenCalledWith('/repo/root', 'status')
  })
})
