import { MAX_COALESCED_KEYS, splitCoalescedKeys } from './coalescedKeys'

describe('splitCoalescedKeys', () => {
  it('splits a short run of typed characters into one entry per key', () => {
    expect(splitCoalescedKeys('gz', {})).toEqual(['g', 'z'])
    expect(splitCoalescedKeys('gcgb', {})).toEqual(['g', 'c', 'g', 'b'])
  })

  it('keeps spaces and punctuation as individual keys', () => {
    expect(splitCoalescedKeys('a b', {})).toEqual(['a', ' ', 'b'])
    expect(splitCoalescedKeys('[]', {})).toEqual(['[', ']'])
  })

  it('leaves a single key alone', () => {
    expect(splitCoalescedKeys('g', {})).toBeNull()
    expect(splitCoalescedKeys('', {})).toBeNull()
  })

  it('leaves long runs alone', () => {
    expect(splitCoalescedKeys('x'.repeat(MAX_COALESCED_KEYS), {})).toHaveLength(MAX_COALESCED_KEYS)
    expect(splitCoalescedKeys('x'.repeat(MAX_COALESCED_KEYS + 1), {})).toBeNull()
  })

  it('leaves SGR mouse reports and CSI remnants alone', () => {
    expect(splitCoalescedKeys('[<0;12;5M', {})).toBeNull()
    expect(splitCoalescedKeys('[<64;1;1m', {})).toBeNull()
    expect(splitCoalescedKeys('[1;5Z', {})).toBeNull()
  })

  it('leaves special and modified keys alone', () => {
    expect(splitCoalescedKeys('ab', { ctrl: true })).toBeNull()
    expect(splitCoalescedKeys('ab', { meta: true })).toBeNull()
    expect(splitCoalescedKeys('ab', { escape: true })).toBeNull()
    expect(splitCoalescedKeys('ab', { return: true })).toBeNull()
  })

  it('leaves non-ASCII and control characters alone', () => {
    expect(splitCoalescedKeys('éa', {})).toBeNull()
    expect(splitCoalescedKeys('a\rb', {})).toBeNull()
    expect(splitCoalescedKeys('a\tb', {})).toBeNull()
    expect(splitCoalescedKeys('\x1bab', {})).toBeNull()
  })
})
