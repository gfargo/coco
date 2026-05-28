/**
 * Tests for the pure helpers exported by `runtime.ts`. The React
 * component (`WorkspaceInkApp`) is exercised indirectly through
 * `view.test.ts` snapshots; this file just covers the data utilities
 * that the runtime exports.
 */

import { mergeKnownRepos } from './runtime'

describe('mergeKnownRepos', () => {
  it('combines config + cached entries and de-dupes', () => {
    expect(mergeKnownRepos(['/a', '/b'], ['/c'])).toEqual(['/a', '/b', '/c'])
  })

  it('keeps config-first precedence for overlapping entries', () => {
    // Both lists contain `/shared`. The merged result lists `/shared`
    // exactly once, in the position the config supplied — so any
    // future ordering-aware consumer (e.g. "first match wins")
    // observes the config entry, not the cached one.
    expect(mergeKnownRepos(['/shared', '/config-only'], ['/cache-only', '/shared'])).toEqual([
      '/shared',
      '/config-only',
      '/cache-only',
    ])
  })

  it('returns an empty list when both inputs are empty', () => {
    expect(mergeKnownRepos([], [])).toEqual([])
  })

  it('treats config as the canonical source — its order survives', () => {
    expect(mergeKnownRepos(['/b', '/a'], ['/a', '/b'])).toEqual(['/b', '/a'])
  })
})
