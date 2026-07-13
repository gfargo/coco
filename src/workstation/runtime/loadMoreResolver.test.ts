import { LOG_INTERACTIVE_DEFAULT_LIMIT } from '../../git/logData'
import {
  isCursorNearBottom,
  isStaleBootLoadResolve,
  isStaleFrameResolve,
  isStaleLoadMoreCompletion,
  pageImpliesMore,
  shouldLoadMore,
  type BootLoadResolveSnapshot,
  type LoadMoreCompletionSnapshot,
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

// #1384 — frame-scoped stale-completion decisions. The history rows are
// swapped in place on every repo-frame push / pop, so a resolve issued
// in one frame must DROP when the stack changed mid-flight rather than
// splice its rows into whichever frame is active now.
describe('isStaleFrameResolve', () => {
  it('accepts a resolve that lands in the frame that issued it', () => {
    expect(
      isStaleFrameResolve({ mounted: true, issuedAtDepth: 0, currentDepth: 0 }),
    ).toBe(false)
  })

  it('drops after a drill-in (parent fetch resolving in the child frame)', () => {
    expect(
      isStaleFrameResolve({ mounted: true, issuedAtDepth: 0, currentDepth: 1 }),
    ).toBe(true)
  })

  it('drops after a pop (child fetch resolving back in the parent frame)', () => {
    expect(
      isStaleFrameResolve({ mounted: true, issuedAtDepth: 1, currentDepth: 0 }),
    ).toBe(true)
  })

  it('drops after unmount regardless of depth', () => {
    expect(
      isStaleFrameResolve({ mounted: false, issuedAtDepth: 0, currentDepth: 0 }),
    ).toBe(true)
  })
})

// Regression for #1361's boot-load-vs-filter race: useDeferredBootLoad's
// one-shot background fetch used to unconditionally clobber a server-side
// history filter (author:/path:/S:/G:) submitted while it was still in
// flight, since it had no way to know a fresher useHistoryRefetch had
// already painted the correctly filtered rows.
describe('isStaleBootLoadResolve', () => {
  const baseBootSnap = (): BootLoadResolveSnapshot => ({
    mounted: true,
    issuedAtDepth: 0,
    currentDepth: 0,
    issuedRefetchGeneration: 0,
    currentRefetchGeneration: 0,
  })

  it('accepts a resolve when nothing changed since dispatch', () => {
    expect(isStaleBootLoadResolve(baseBootSnap())).toBe(false)
  })

  it('drops when a refetch generation has advanced since dispatch (a filter/graph refetch started)', () => {
    expect(
      isStaleBootLoadResolve({ ...baseBootSnap(), currentRefetchGeneration: 1 }),
    ).toBe(true)
  })

  it('still drops on a repo-frame change even with no refetch (existing #1384 guard preserved)', () => {
    expect(
      isStaleBootLoadResolve({ ...baseBootSnap(), currentDepth: 1 }),
    ).toBe(true)
  })

  it('drops after unmount regardless of everything else', () => {
    expect(
      isStaleBootLoadResolve({ ...baseBootSnap(), mounted: false }),
    ).toBe(true)
  })
})

describe('isStaleLoadMoreCompletion', () => {
  const fresh = (): LoadMoreCompletionSnapshot => ({
    mounted: true,
    requestId: 3,
    currentRequestId: 3,
    issuedAtDepth: 0,
    currentDepth: 0,
  })

  it('accepts the completion of the current request in the issuing frame', () => {
    expect(isStaleLoadMoreCompletion(fresh())).toBe(false)
  })

  it('drops after unmount', () => {
    expect(isStaleLoadMoreCompletion({ ...fresh(), mounted: false })).toBe(true)
  })

  it('drops when a newer request superseded this one', () => {
    expect(isStaleLoadMoreCompletion({ ...fresh(), currentRequestId: 4 })).toBe(true)
  })

  it('drops when the repo-frame depth changed mid-flight (drill-in)', () => {
    expect(isStaleLoadMoreCompletion({ ...fresh(), currentDepth: 1 })).toBe(true)
  })

  it('drops a push → pop round trip back to the SAME depth via the rescoped request family', () => {
    // The frame push and pop each bump the request family, so even
    // though the depth matches again, the id no longer does.
    expect(
      isStaleLoadMoreCompletion({
        ...fresh(),
        issuedAtDepth: 0,
        currentDepth: 0,
        requestId: 3,
        currentRequestId: 5,
      }),
    ).toBe(true)
  })
})
