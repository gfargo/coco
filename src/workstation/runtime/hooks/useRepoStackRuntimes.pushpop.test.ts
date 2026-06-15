import * as os from 'os'
import type { SimpleGit } from 'simple-git'
import type { LogInkRepoFrame } from '../inkViewModel'
import type { LogInkContext } from '../types'
import { useRepoStackRuntimes } from './useRepoStackRuntimes'

/**
 * Effect-driven drill-in / drill-out integration test for
 * `useRepoStackRuntimes` (app.ts decomposition item 6 / #1237).
 *
 * This is the one repo-stack behavior CI couldn't otherwise reach: the *live*
 * submodule push / pop path. The pure helpers (`syncRepoStackRuntimes`,
 * `updateRepoFrameRuntime`, `getActiveRepoFrameRuntime`) are covered by
 * `repoStackRuntime.test.ts`, and the hook's writers + seed by
 * `useRepoStackRuntimes.test.ts` — but neither runs the hook's *sync effect*
 * across re-renders. A real renderer is out of reach here (ink is ESM-only and
 * loaded via dynamic import at boot, so ts-jest can't import it), so this drives
 * the hook through a tiny hooks simulator faithful enough for the three hooks it
 * uses (`useState` / `useEffect` / `useCallback`): it renders, runs effects in
 * order, and re-renders when an effect or an external setter mutates state —
 * exactly the render → commit → effect → re-render cycle the push/pop relies on.
 */

type StateCell = { kind: 'state'; value: unknown }
type EffectCell = {
  kind: 'effect'
  deps?: readonly unknown[]
  pending?: () => void | (() => void)
  cleanup?: void | (() => void)
}
type CallbackCell = { kind: 'callback'; deps?: readonly unknown[]; value: unknown }
type Cell = StateCell | EffectCell | CallbackCell

function depsChanged(
  prev: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
): boolean {
  if (!prev || !next) return true
  if (prev.length !== next.length) return true
  return next.some((d, i) => !Object.is(d, prev[i]))
}

/**
 * Minimal hooks host. Supports `useState` (value + updater forms),
 * `useEffect` (deps-gated, with cleanup), and `useCallback` (deps-memoized).
 * Renders are deterministic and synchronous; effects flush after each render
 * and may schedule another render (as the sync effect's `setRuntimes` does).
 */
function renderHook<P, R>(hook: (react: typeof import('react'), props: P) => R, initial: P) {
  const cells: Cell[] = []
  let cursor = 0
  let props = initial
  let result!: R
  let dirty = false

  const react = {
    useState(init: unknown) {
      const i = cursor++
      if (!cells[i]) {
        cells[i] = { kind: 'state', value: typeof init === 'function' ? (init as () => unknown)() : init }
      }
      const cell = cells[i] as StateCell
      const setState = (next: unknown) => {
        const value = typeof next === 'function' ? (next as (p: unknown) => unknown)(cell.value) : next
        if (!Object.is(value, cell.value)) {
          cell.value = value
          dirty = true
        }
      }
      return [cell.value, setState]
    },
    useEffect(fn: () => void | (() => void), deps?: readonly unknown[]) {
      const i = cursor++
      const existing = cells[i] as EffectCell | undefined
      if (!existing) {
        cells[i] = { kind: 'effect', deps, pending: fn }
      } else if (depsChanged(existing.deps, deps)) {
        existing.deps = deps
        existing.pending = fn
      }
    },
    useCallback(fn: unknown, deps?: readonly unknown[]) {
      const i = cursor++
      const existing = cells[i] as CallbackCell | undefined
      if (!existing || depsChanged(existing.deps, deps)) {
        cells[i] = { kind: 'callback', deps, value: fn }
      }
      return (cells[i] as CallbackCell).value
    },
  } as unknown as typeof import('react')

  const renderOnce = () => {
    cursor = 0
    result = hook(react, props)
  }
  const runEffects = () => {
    for (const cell of cells) {
      if (cell && cell.kind === 'effect' && cell.pending) {
        if (typeof cell.cleanup === 'function') cell.cleanup()
        cell.cleanup = cell.pending()
        cell.pending = undefined
      }
    }
  }
  const flush = () => {
    let guard = 0
    do {
      dirty = false
      runEffects()
      if (dirty) renderOnce()
    } while (dirty && guard++ < 50)
  }

  renderOnce()
  flush()

  return {
    get result() {
      return result
    },
    rerender(next: P) {
      props = next
      renderOnce()
      flush()
    },
    /** Run an external mutation (e.g. `setContext`) and settle the result. */
    act(fn: () => void) {
      fn()
      if (dirty) renderOnce()
      flush()
    },
  }
}

const rootGit = { __tag: 'rootGit' } as unknown as SimpleGit
const frame = (label: string, workdir?: string): LogInkRepoFrame =>
  ({ label, workdir } as LogInkRepoFrame)

// A stable root frame (no workdir → the seeded root runtime keeps `rootGit`).
const ROOT = frame('root')
// A submodule frame with a workdir → the factory binds it to its own git.
// `simpleGit()` validates the dir exists at construction (it need not be a git
// repo — no git command runs here), so use a real existing directory.
const SUB = frame('sub', os.tmpdir())

describe('useRepoStackRuntimes drill-in / drill-out (push/pop)', () => {
  it('seeds a single root frame whose git is rootGit', () => {
    const host = renderHook(useRepoStackRuntimes, { rootGit, repoStack: [ROOT] })
    expect(host.result.runtimes).toHaveLength(1)
    expect(host.result.git).toBe(rootGit)
  })

  it('appends a child runtime on push and projects the child as active', () => {
    const host = renderHook(useRepoStackRuntimes, { rootGit, repoStack: [ROOT] })

    host.rerender({ rootGit, repoStack: [ROOT, SUB] })

    expect(host.result.runtimes).toHaveLength(2)
    // The submodule frame got its own git (bound to its workdir), not rootGit.
    expect(host.result.git).not.toBe(rootGit)
    // A freshly-pushed frame starts with empty context.
    expect(host.result.context).toEqual({})
  })

  it('restores the parent on pop, including its cached context (drill-out)', () => {
    const host = renderHook(useRepoStackRuntimes, { rootGit, repoStack: [ROOT] })

    // Parent loads some context while active (e.g. a branch list).
    host.act(() => {
      host.result.setContext({ pendingKey: 'branchList' } as unknown as LogInkContext)
    })
    expect(host.result.context).toEqual({ pendingKey: 'branchList' })

    // Drill in → child active, parent's context parked on its cached frame.
    host.rerender({ rootGit, repoStack: [ROOT, SUB] })
    expect(host.result.git).not.toBe(rootGit)
    expect(host.result.context).toEqual({})

    // Drill out → parent restored instantly with its cached context intact.
    host.rerender({ rootGit, repoStack: [ROOT] })
    expect(host.result.runtimes).toHaveLength(1)
    expect(host.result.git).toBe(rootGit)
    expect(host.result.context).toEqual({ pendingKey: 'branchList' })
  })

  it('routes an in-flight load to its issuing frame via targetDepth (no cross-frame bleed)', () => {
    const host = renderHook(useRepoStackRuntimes, { rootGit, repoStack: [ROOT] })

    // A parent load was issued at depth 0, then the user drilled into the
    // submodule before it resolved.
    host.rerender({ rootGit, repoStack: [ROOT, SUB] })
    expect(host.result.git).not.toBe(rootGit)

    // The in-flight parent load lands with its captured depth (0) — it must
    // write the PARENT frame, never the now-active child.
    host.act(() => {
      host.result.setContext({ pendingKey: 'stashList' } as unknown as LogInkContext, 0)
    })

    // Child (active) is untouched; the write landed on the parent frame.
    expect(host.result.context).toEqual({})
    expect(host.result.runtimes[0].context).toEqual({ pendingKey: 'stashList' })
  })
})
