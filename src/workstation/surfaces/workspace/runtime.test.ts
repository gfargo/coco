/**
 * Tests for the pure helpers exported by `runtime.ts`. The React
 * component (`WorkspaceInkApp`) is exercised indirectly through
 * `view.test.ts` snapshots; this file just covers the data utilities
 * that the runtime exports.
 */

import { failureStatus, formatWorkspaceSnapshotJson, mergeKnownRepos } from './runtime'

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

// #2166: a failed load used to show the raw error and nothing else.
describe('failureStatus', () => {
  it('names the way out after the reason', () => {
    expect(failureStatus(new Error('gh: not found'), 'Refresh failed.')).toBe('gh: not found. Press r to retry.')
  })

  it('does not double the full stop', () => {
    expect(failureStatus(new Error('Discovery failed.'), 'x')).toBe('Discovery failed. Press r to retry.')
  })

  it('falls back for a non-Error or an empty message', () => {
    expect(failureStatus(undefined, 'Refresh failed.')).toBe('Refresh failed. Press r to retry.')
    expect(failureStatus(new Error(''), 'Row refresh failed.')).toBe('Row refresh failed. Press r to retry.')
  })

  // The footer has a fixed height: a raw multi-line git error overflowed it
  // and pushed "Press r to retry" out of view.
  it('is always one line, and keeps the retry hint at the end however long the error', () => {
    const fetchError = new Error(
      'ssh: connect to host 127.0.0.1 port 1: Connection refused\r\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.',
    )
    expect(failureStatus(fetchError, 'Refresh failed.')).toBe('ssh: connect to host 127.0.0.1 port 1: Connection refused. Press r to retry.')

    const long = failureStatus(new Error('x'.repeat(400)), 'Refresh failed.')
    expect(long).not.toMatch(/[\r\n]/)
    expect(long.endsWith('… Press r to retry.')).toBe(true)
    expect(long.length).toBeLessThanOrEqual(90 + ' Press r to retry.'.length)
  })

  it('strips ANSI and the fatal: prefix', () => {
    expect(failureStatus(new Error('\u001b[31mfatal:\u001b[0m not a git repository'), 'x')).toBe('not a git repository. Press r to retry.')
  })

  it('names the repo when the failure is about one', () => {
    expect(failureStatus(new Error('fatal: bad object HEAD'), 'Row refresh failed.', 'acme-api')).toBe('acme-api: bad object HEAD. Press r to retry.')
  })
})

describe('formatWorkspaceSnapshotJson (#2211)', () => {
  it('lists every repo with divergence, upstream state and load errors, including the failing ones', () => {
    const json = JSON.parse(formatWorkspaceSnapshotJson({
      roots: ['/w'],
      scannedAt: '2026-11-01T00:00:00.000Z',
      repos: [
        { path: '/w/a', name: 'a', branch: 'main', ahead: 1, behind: 2, dirty: 3, upstream: 'origin/main', detached: false },
        { path: '/w/b', name: 'b', ahead: 0, behind: 0, dirty: 0, error: 'not a git repository' },
      ],
    }))
    expect(json.roots).toEqual(['/w'])
    expect(json.repos[0]).toMatchObject({ name: 'a', ahead: 1, behind: 2, dirty: 3, upstream: 'origin/main', error: null })
    expect(json.repos[1]).toMatchObject({ name: 'b', branch: null, upstream: null, error: 'not a git repository' })
  })
})
