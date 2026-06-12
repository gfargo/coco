import { shouldHydrateContextKey } from './useContextHydration'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'

/**
 * Unit tests for the pure `shouldHydrateContextKey` core (0.72 app.ts
 * decomposition, PR 9). No React harness — the two context-hydration effects
 * (boot load + PR overview) are verbatim lifts of inline-async effects
 * validated by the green build; only the extracted per-key boot gate
 * ("hydrate a key unless its status is already 'ready'") is exercised here.
 * This mirrors the inline guard
 * `if (contextStatusRef.current[key] === 'ready') return`.
 */
describe('shouldHydrateContextKey', () => {
  it('hydrates (true) a key that is still idle', () => {
    const status = createLogInkContextStatus('idle')
    expect(shouldHydrateContextKey(status, 'branches')).toBe(true)
  })

  it('hydrates (true) a key that is mid-load', () => {
    const status = updateLogInkContextStatus(
      createLogInkContextStatus('idle'),
      'tags',
      'loading',
    )
    expect(shouldHydrateContextKey(status, 'tags')).toBe(true)
  })

  it('skips (false) a key that is already ready', () => {
    const status = updateLogInkContextStatus(
      createLogInkContextStatus('idle'),
      'branches',
      'ready',
    )
    expect(shouldHydrateContextKey(status, 'branches')).toBe(false)
  })

  it('decides per key — a ready sibling does not gate another key', () => {
    const status = updateLogInkContextStatus(
      createLogInkContextStatus('idle'),
      'branches',
      'ready',
    )
    // `branches` is ready (skip) but `tags` is still idle (hydrate).
    expect(shouldHydrateContextKey(status, 'branches')).toBe(false)
    expect(shouldHydrateContextKey(status, 'tags')).toBe(true)
  })

  it('hydrates (true) every key when the whole status is fresh', () => {
    const status = createLogInkContextStatus('idle')
    for (const key of Object.keys(status) as Array<keyof typeof status>) {
      expect(shouldHydrateContextKey(status, key)).toBe(true)
    }
  })

  it('skips (false) every key when the whole status is ready', () => {
    const status = createLogInkContextStatus('ready')
    for (const key of Object.keys(status) as Array<keyof typeof status>) {
      expect(shouldHydrateContextKey(status, key)).toBe(false)
    }
  })
})
