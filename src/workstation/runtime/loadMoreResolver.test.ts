import { LOG_INTERACTIVE_DEFAULT_LIMIT } from '../../commands/log/data'
import {
  isCursorNearBottom,
  pageImpliesMore,
  shouldLoadMore,
  type LoadMoreGuardSnapshot,
} from './loadMoreResolver'

const baseSnap = (): LoadMoreGuardSnapshot => ({
  logArgv: { interactive: true } as { limit?: number },
  loadingMore: false,
  hasMoreCommits: true,
  filteredCommitsLength: 1000,
})

describe('shouldLoadMore', () => {
  it('fires when interactive, more pages exist, not loading, rows present', () => {
    expect(shouldLoadMore(baseSnap())).toBe(true)
  })

  it('bails when there is no logArgv', () => {
    expect(shouldLoadMore({ ...baseSnap(), logArgv: null })).toBe(false)
    expect(shouldLoadMore({ ...baseSnap(), logArgv: undefined })).toBe(false)
  })

  it('bails when an explicit --limit is set', () => {
    expect(shouldLoadMore({ ...baseSnap(), logArgv: { limit: 50 } })).toBe(false)
  })

  it('bails when a fetch is already in flight', () => {
    expect(shouldLoadMore({ ...baseSnap(), loadingMore: true })).toBe(false)
  })

  it('bails when no more pages are believed to exist', () => {
    expect(shouldLoadMore({ ...baseSnap(), hasMoreCommits: false })).toBe(false)
  })

  it('bails when zero commits are loaded (nothing to skip past)', () => {
    expect(shouldLoadMore({ ...baseSnap(), filteredCommitsLength: 0 })).toBe(false)
  })
})

describe('isCursorNearBottom', () => {
  it('is false when the cursor is far from the last loaded row', () => {
    // 100 rows, cursor at 0 → remaining 99 > 20
    expect(isCursorNearBottom(100, 0)).toBe(false)
  })

  it('is false at exactly 21 rows remaining', () => {
    // length 100, index 78 → remaining = 100 - 78 - 1 = 21
    expect(isCursorNearBottom(100, 78)).toBe(false)
  })

  it('is true at exactly 20 rows remaining (boundary)', () => {
    // length 100, index 79 → remaining = 100 - 79 - 1 = 20
    expect(isCursorNearBottom(100, 79)).toBe(true)
  })

  it('is true on the last row', () => {
    expect(isCursorNearBottom(100, 99)).toBe(true)
  })
})

describe('pageImpliesMore', () => {
  it('is true for a full page', () => {
    expect(pageImpliesMore(LOG_INTERACTIVE_DEFAULT_LIMIT)).toBe(true)
    expect(pageImpliesMore(LOG_INTERACTIVE_DEFAULT_LIMIT + 5)).toBe(true)
  })

  it('is false for a short page (end of history)', () => {
    expect(pageImpliesMore(LOG_INTERACTIVE_DEFAULT_LIMIT - 1)).toBe(false)
    expect(pageImpliesMore(0)).toBe(false)
  })
})
