import { hashLoaded, hashesMatch, hashesMatchAny } from './hashes'

describe('hashesMatch', () => {
  it('returns true on exact equality (fast path)', () => {
    expect(hashesMatch('abc1234', 'abc1234')).toBe(true)
  })

  it('returns false when either input is missing', () => {
    expect(hashesMatch(undefined, 'abc1234')).toBe(false)
    expect(hashesMatch('abc1234', undefined)).toBe(false)
    expect(hashesMatch(undefined, undefined)).toBe(false)
    expect(hashesMatch('', 'abc1234')).toBe(false)
  })

  it('matches when a is a prefix of b', () => {
    expect(hashesMatch('abc1234', 'abc12345678901234567890')).toBe(true)
  })

  it('matches when b is a prefix of a', () => {
    expect(hashesMatch('abc12345678901234567890', 'abc1234')).toBe(true)
  })

  it('matches the production case: same commit, different short-hash lengths from different formatters', () => {
    // `for-each-ref --format=%(objectname:short)` returned 7 chars,
    // `git log --pretty=format:%h` returned 8 (auto-extended). Both
    // refer to the same commit; bidirectional prefix matching catches
    // it where exact equality misses.
    expect(hashesMatch('abc1234', 'abc12345')).toBe(true)
    expect(hashesMatch('abc12345', 'abc1234')).toBe(true)
  })

  it('refuses to match when either input is below the 4-char floor', () => {
    expect(hashesMatch('abc', 'abc1234')).toBe(false)
    expect(hashesMatch('abc1234', 'abc')).toBe(false)
  })

  it('returns false for hashes that only share a too-short common prefix', () => {
    // "abc1234" and "abc5678" share only "abc" — neither is a prefix
    // of the other.
    expect(hashesMatch('abc1234', 'abc5678')).toBe(false)
  })

  it('is symmetric', () => {
    const pairs: Array<[string, string]> = [
      ['abc1234', 'abc12345'],
      ['abc1234', 'def5678'],
      ['abc', 'abc1234'],
      ['abc1234', 'abc1234'],
    ]
    for (const [a, b] of pairs) {
      expect(hashesMatch(a, b)).toBe(hashesMatch(b, a))
    }
  })
})

describe('hashesMatchAny', () => {
  it('returns true when any candidate matches', () => {
    expect(hashesMatchAny('abc1234', ['def5678', 'abc12345'])).toBe(true)
  })

  it('returns false when no candidate matches', () => {
    expect(hashesMatchAny('abc1234', ['def5678', 'ghi9012'])).toBe(false)
  })

  it('skips undefined / empty candidates without erroring', () => {
    expect(hashesMatchAny('abc1234', [undefined, '', 'abc12345'])).toBe(true)
    expect(hashesMatchAny('abc1234', [undefined, ''])).toBe(false)
  })

  it('returns false when the target hash is undefined', () => {
    expect(hashesMatchAny(undefined, ['abc1234'])).toBe(false)
  })
})

describe('hashLoaded', () => {
  it('hits the O(1) fast path on exact match', () => {
    expect(hashLoaded('abc1234', new Set(['abc1234', 'def5678']))).toBe(true)
  })

  it('matches by prefix when no exact entry exists', () => {
    expect(hashLoaded('abc1234', new Set(['abc12345', 'def5678']))).toBe(true)
    expect(hashLoaded('abc12345', new Set(['abc1234', 'def5678']))).toBe(true)
  })

  it('returns false on an empty set', () => {
    expect(hashLoaded('abc1234', new Set())).toBe(false)
  })

  it('respects the 4-char floor', () => {
    expect(hashLoaded('abc', new Set(['abc1234567']))).toBe(false)
  })

  it('returns false when nothing in the set shares a meaningful prefix', () => {
    expect(hashLoaded('abc1234', new Set(['def5678', 'ghi9012']))).toBe(false)
  })
})
