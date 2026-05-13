import { extractSubmoduleChange, renderSubmoduleSummary } from './submoduleDiff'

describe('extractSubmoduleChange', () => {
  it('detects a submodule modification (most common case)', () => {
    const patch = [
      'diff --git a/vendor/sub b/vendor/sub',
      '--- a/vendor/sub',
      '+++ b/vendor/sub',
      '@@ -1 +1 @@',
      '-Subproject commit 1111111111111111111111111111111111111111',
      '+Subproject commit 2222222222222222222222222222222222222222',
    ]
    const change = extractSubmoduleChange(patch)
    expect(change?.kind).toBe('modified')
    if (change?.kind === 'modified') {
      expect(change.before).toMatch(/^1+$/)
      expect(change.after).toMatch(/^2+$/)
    }
  })

  it('detects a newly-added submodule', () => {
    const patch = [
      '@@ -0,0 +1 @@',
      '+Subproject commit 1234567890abcdef1234567890abcdef12345678',
    ]
    const change = extractSubmoduleChange(patch)
    expect(change?.kind).toBe('added')
    if (change?.kind === 'added') {
      expect(change.after.slice(0, 4)).toBe('1234')
    }
  })

  it('detects a removed submodule', () => {
    const patch = [
      '@@ -1 +0,0 @@',
      '-Subproject commit abcdef1234567890abcdef1234567890abcdef12',
    ]
    const change = extractSubmoduleChange(patch)
    expect(change?.kind).toBe('removed')
  })

  it('returns undefined for a normal (non-submodule) patch', () => {
    const patch = [
      '@@ -1,3 +1,3 @@',
      ' context line',
      '-old line',
      '+new line',
    ]
    expect(extractSubmoduleChange(patch)).toBeUndefined()
  })

  it('ignores `---` / `+++` header lines so they do not corrupt parsing', () => {
    // Defensive: the loader contract sometimes preserves diff
    // headers in the lines array. They must not be misread as
    // additions / deletions.
    const patch = [
      '--- a/vendor/sub',
      '+++ b/vendor/sub',
      '-Subproject commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '+Subproject commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ]
    expect(extractSubmoduleChange(patch)?.kind).toBe('modified')
  })

  it('handles whitespace after the sha gracefully', () => {
    const patch = [
      '-Subproject commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  ',
      '+Subproject commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ]
    const change = extractSubmoduleChange(patch)
    expect(change?.kind).toBe('modified')
    if (change?.kind === 'modified') {
      // Trailing whitespace must not contaminate the parsed sha.
      expect(change.before).toMatch(/^a+$/)
    }
  })
})

describe('renderSubmoduleSummary', () => {
  it('formats added submodules', () => {
    expect(renderSubmoduleSummary({
      kind: 'added',
      after: '1234567890abcdef1234567890abcdef12345678',
    })).toBe('submodule added: 12345678…')
  })

  it('formats removed submodules', () => {
    expect(renderSubmoduleSummary({
      kind: 'removed',
      before: 'abcdef1234567890abcdef1234567890abcdef12',
    })).toBe('submodule removed: abcdef12…')
  })

  it('formats modifications with both shas', () => {
    const out = renderSubmoduleSummary({
      kind: 'modified',
      before: '1111111111111111111111111111111111111111',
      after: '2222222222222222222222222222222222222222',
    })
    expect(out).toBe('submodule modified: 11111111… → 22222222…')
  })

  it('does not truncate short shas (defensive)', () => {
    // Theoretical: a tiny sha shouldn't get an ellipsis. Real-world
    // submodule pointers are always full 40-char shas, but the
    // renderer should still handle the edge.
    expect(renderSubmoduleSummary({
      kind: 'added',
      after: 'abc',
    })).toBe('submodule added: abc')
  })
})
