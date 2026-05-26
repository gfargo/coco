import {
  buildLoadedHashSet,
  isHashLoaded,
  resolveCursorSyncDecision,
} from './cursorSyncResolver'

describe('resolveCursorSyncDecision', () => {
  const target = { hash: 'abc123', label: 'branch main' }

  it('returns noop with reason `no-target` when target is undefined', () => {
    // Empty branch list / tag list / stash list — the resolver has
    // nothing to sync to. Callers shouldn't dispatch anything.
    const decision = resolveCursorSyncDecision({
      target: undefined,
      loadedHashes: new Set(),
      lastSyncedHash: undefined,
      attemptedContextHashes: new Set(),
    })
    expect(decision).toEqual({ type: 'noop', reason: 'no-target' })
  })

  it('returns noop with reason `duplicate-of-last` when target matches the last sync', () => {
    // Common case: user re-cursors the same row, or cursors a different
    // ref that points at the same commit (e.g. a tag on top of HEAD).
    // No status churn.
    const decision = resolveCursorSyncDecision({
      target,
      loadedHashes: new Set(['abc123']),
      lastSyncedHash: 'abc123',
      attemptedContextHashes: new Set(),
    })
    expect(decision).toEqual({ type: 'noop', reason: 'duplicate-of-last' })
  })

  it('returns jump when target is in the loaded window', () => {
    // Happy path: target hash is already in the visible commit set.
    // Cursor sync just dispatches selectCommitByHash.
    const decision = resolveCursorSyncDecision({
      target,
      loadedHashes: new Set(['abc123', 'def456']),
      lastSyncedHash: undefined,
      attemptedContextHashes: new Set(),
    })
    expect(decision).toEqual({ type: 'jump', hash: 'abc123', label: 'branch main' })
  })

  it('matches short hashes as well as full hashes', () => {
    // Some surfaces store only the short hash on cursored refs; the
    // membership set the caller builds includes both forms so the
    // resolver's lookup hits.
    const decision = resolveCursorSyncDecision({
      target: { hash: 'abc1234', label: 'tag v1' },
      loadedHashes: buildLoadedHashSet([{ hash: 'abc1234567890', shortHash: 'abc1234' }]),
      lastSyncedHash: undefined,
      attemptedContextHashes: new Set(),
    })
    expect(decision.type).toBe('jump')
  })

  it('returns load-context when target is not in the window and not yet attempted', () => {
    // The new behaviour: instead of saying "tip not in loaded window"
    // immediately, suggest a targeted log fetch anchored on this
    // commit. The caller runs the fetch + appends rows; the effect
    // re-fires and resolves to `jump` next pass.
    const decision = resolveCursorSyncDecision({
      target,
      loadedHashes: new Set(['def456']),
      lastSyncedHash: undefined,
      attemptedContextHashes: new Set(),
    })
    expect(decision).toEqual({ type: 'load-context', target })
  })

  it('returns unreachable after a context load was attempted but the hash still isn\'t loaded', () => {
    // The escape hatch: the caller anchored a `git log` on this hash,
    // merged the result, but the hash still isn't in the loaded
    // window. Either git couldn't reach it (orphan / GC'd ref) or
    // the merge dropped it. Stop chaining and surface a clear status
    // so the user can press \\ or load more manually.
    const decision = resolveCursorSyncDecision({
      target,
      loadedHashes: new Set(['def456']),
      lastSyncedHash: undefined,
      attemptedContextHashes: new Set(['abc123']),
    })
    expect(decision).toEqual({ type: 'unreachable', target })
  })

  it('prefers `duplicate-of-last` over `load-context` when both conditions overlap', () => {
    // Edge case: a target equals the last-synced hash AND isn't in the
    // loaded window (e.g. the user manually reloaded smaller after a
    // sync). No reason to fire another load-context for a target we
    // already considered "settled."
    const decision = resolveCursorSyncDecision({
      target,
      loadedHashes: new Set(),
      lastSyncedHash: 'abc123',
      attemptedContextHashes: new Set(),
    })
    expect(decision.type).toBe('noop')
    expect((decision as { reason?: string }).reason).toBe('duplicate-of-last')
  })

  it('prefers `jump` over `load-context` when target is loaded but also attempted', () => {
    // After a successful load-context the target lands in the window
    // AND its hash is still in attemptedContextHashes. The resolver
    // should jump, not give up.
    const decision = resolveCursorSyncDecision({
      target,
      loadedHashes: new Set(['abc123']),
      lastSyncedHash: undefined,
      attemptedContextHashes: new Set(['abc123']),
    })
    expect(decision.type).toBe('jump')
  })
})

describe('buildLoadedHashSet', () => {
  it('returns an empty set for an empty commit list', () => {
    expect(buildLoadedHashSet([]).size).toBe(0)
  })

  it('indexes both full hash and short hash so callers can match either form', () => {
    const set = buildLoadedHashSet([
      { hash: 'abc1234567890', shortHash: 'abc1234' },
      { hash: 'def4567890', shortHash: 'def4567' },
    ])
    expect(set.has('abc1234567890')).toBe(true)
    expect(set.has('abc1234')).toBe(true)
    expect(set.has('def4567890')).toBe(true)
    expect(set.has('def4567')).toBe(true)
    expect(set.has('ghi9999')).toBe(false)
  })

  it('skips commits without a shortHash without erroring', () => {
    // Defensive — some loaders may produce rows with only the full
    // hash. The set still picks up the full hash so lookups by it
    // work.
    const set = buildLoadedHashSet([{ hash: 'abc1234567890' }])
    expect(set.has('abc1234567890')).toBe(true)
    expect(set.size).toBe(1)
  })
})

describe('isHashLoaded', () => {
  it('returns true on an exact hit (fast path)', () => {
    // The O(1) Set.has short-circuit. This is the path taken for the
    // vast majority of lookups: full-hash to full-hash, or short-hash
    // to short-hash when git's abbreviation happens to match.
    expect(isHashLoaded('abc1234', new Set(['abc1234', 'def5678']))).toBe(true)
  })

  it('returns false when the hash has no prefix relationship to any loaded entry', () => {
    expect(isHashLoaded('abc1234', new Set(['def5678', 'ghi9012']))).toBe(false)
  })

  it('matches when target is shorter than a loaded full hash', () => {
    // The real bug: refs sometimes carry a short hash from
    // `for-each-ref --format=%(objectname:short)` while the loaded
    // window contains full 40-char hashes. The short target should
    // still match by prefix.
    expect(
      isHashLoaded(
        'abc1234',
        new Set(['abc12345678901234567890123456789012345678'])
      )
    ).toBe(true)
  })

  it('matches when target is longer than a loaded short hash', () => {
    // Inverse direction: target is a long hash, loaded set has a
    // short form (e.g. when rows store only shortHash). Still a
    // match via `target.startsWith(loaded)`.
    expect(
      isHashLoaded(
        'abc12345678901234567890123456789012345678',
        new Set(['abc1234'])
      )
    ).toBe(true)
  })

  it("matches when target and loaded short hashes have DIFFERENT lengths (the production bug)", () => {
    // The exact production case: `for-each-ref --format=%(objectname:short)`
    // returned 7 chars for the branch tip ('abc1234'), but `git log
    // --pretty=format:%h` auto-extended to 8 chars for the same commit
    // ('abc12345') because of a collision elsewhere in the loaded
    // window. Bidirectional prefix matching covers this.
    expect(isHashLoaded('abc1234', new Set(['abc12345']))).toBe(true)
    expect(isHashLoaded('abc12345', new Set(['abc1234']))).toBe(true)
  })

  it('refuses to prefix-match on absurdly short targets', () => {
    // A 3-char "hash" would collide with too many real commits.
    // Bail rather than report a false positive.
    expect(isHashLoaded('abc', new Set(['abc1234567'])).valueOf()).toBe(false)
  })

  it('returns false on an empty loaded set', () => {
    expect(isHashLoaded('abc1234', new Set())).toBe(false)
  })

  it('does not match unrelated hashes that share a too-short common prefix', () => {
    // The shorter of the two strings is 'abc' (only 3 chars common).
    // Even though abc1xxx and abc2yyy both start with "abc", neither
    // is a prefix of the other.
    expect(isHashLoaded('abc1234', new Set(['abc5678']))).toBe(false)
  })
})
