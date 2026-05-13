import {
  extractLfsPatchChange,
  parseLfsPointer,
  renderLfsSummary,
} from './lfsPointer'

describe('parseLfsPointer', () => {
  const VALID_POINTER = [
    'version https://git-lfs.github.com/spec/v1',
    'oid sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    'size 12345',
    '',
  ].join('\n')

  it('returns the oid + size from a well-formed pointer body', () => {
    expect(parseLfsPointer(VALID_POINTER)).toEqual({
      oid: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      size: 12345,
    })
  })

  it('returns undefined when the version line is missing', () => {
    const noVersion = [
      'oid sha256:1234567890abcdef',
      'size 12345',
    ].join('\n')
    expect(parseLfsPointer(noVersion)).toBeUndefined()
  })

  it('returns undefined when the oid is missing', () => {
    const noOid = [
      'version https://git-lfs.github.com/spec/v1',
      'size 12345',
    ].join('\n')
    expect(parseLfsPointer(noOid)).toBeUndefined()
  })

  it('returns undefined when the size is missing or non-numeric', () => {
    const noSize = [
      'version https://git-lfs.github.com/spec/v1',
      'oid sha256:abc',
    ].join('\n')
    expect(parseLfsPointer(noSize)).toBeUndefined()

    const badSize = [
      'version https://git-lfs.github.com/spec/v1',
      'oid sha256:abc',
      'size not-a-number',
    ].join('\n')
    expect(parseLfsPointer(badSize)).toBeUndefined()
  })

  it('rejects bodies that are too large to be pointer files', () => {
    // Pointer files are ~130 bytes. Reject anything that's clearly
    // a regular file with the version marker buried in it, to avoid
    // scanning megabytes of source code.
    const huge = `${'x'.repeat(2048)}\nversion https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1`
    expect(parseLfsPointer(huge)).toBeUndefined()
  })
})

describe('extractLfsPatchChange', () => {
  const POINTER_LINES = [
    'version https://git-lfs.github.com/spec/v1',
    'oid sha256:1111111111111111111111111111111111111111111111111111111111111111',
    'size 1024',
  ]
  const NEW_POINTER_LINES = [
    'version https://git-lfs.github.com/spec/v1',
    'oid sha256:2222222222222222222222222222222222222222222222222222222222222222',
    'size 2048',
  ]

  it('detects a newly-added LFS file', () => {
    const patch = [
      '@@ -0,0 +1,3 @@',
      ...POINTER_LINES.map((line) => `+${line}`),
    ]
    const change = extractLfsPatchChange(patch)
    expect(change?.kind).toBe('added')
    if (change?.kind === 'added') {
      expect(change.after.size).toBe(1024)
      expect(change.after.oid).toMatch(/^1+$/)
    }
  })

  it('detects a removed LFS file', () => {
    const patch = [
      '@@ -1,3 +0,0 @@',
      ...POINTER_LINES.map((line) => `-${line}`),
    ]
    const change = extractLfsPatchChange(patch)
    expect(change?.kind).toBe('removed')
  })

  it('detects an LFS pointer rev (modify) carrying both before and after', () => {
    const patch = [
      '@@ -1,3 +1,3 @@',
      ...POINTER_LINES.map((line) => `-${line}`),
      ...NEW_POINTER_LINES.map((line) => `+${line}`),
    ]
    const change = extractLfsPatchChange(patch)
    expect(change?.kind).toBe('modified')
    if (change?.kind === 'modified') {
      expect(change.before.size).toBe(1024)
      expect(change.after.size).toBe(2048)
    }
  })

  it('returns undefined for a normal (non-LFS) patch', () => {
    const patch = [
      '@@ -1,3 +1,3 @@',
      ' context line',
      '-old line',
      '+new line',
    ]
    expect(extractLfsPatchChange(patch)).toBeUndefined()
  })

  it('ignores `---` / `+++` header lines so they do not corrupt parsing', () => {
    // The file-preview loader already strips these in some paths but
    // not all; the extractor must not treat them as additions /
    // deletions.
    const patch = [
      '--- a/asset.bin',
      '+++ b/asset.bin',
      '@@ -1,3 +1,3 @@',
      ...POINTER_LINES.map((line) => `-${line}`),
      ...NEW_POINTER_LINES.map((line) => `+${line}`),
    ]
    expect(extractLfsPatchChange(patch)?.kind).toBe('modified')
  })
})

describe('renderLfsSummary', () => {
  it('formats added pointers with shortened oid + human size', () => {
    expect(renderLfsSummary({
      kind: 'added',
      after: { oid: '1234567890abcdef', size: 1024 * 1024 * 5 },
    })).toBe('binary file added (LFS): 12345678…, 5.0 MB')
  })

  it('formats removed pointers symmetrically', () => {
    expect(renderLfsSummary({
      kind: 'removed',
      before: { oid: 'abcdef1234567890', size: 512 },
    })).toBe('binary file removed (LFS): abcdef12…, 512 B')
  })

  it('formats modifications with both oids and both sizes', () => {
    const out = renderLfsSummary({
      kind: 'modified',
      before: { oid: '1111111111111111', size: 1024 },
      after: { oid: '2222222222222222', size: 2048 },
    })
    expect(out).toBe('binary file modified (LFS): 11111111… → 22222222…, 1.0 KB → 2.0 KB')
  })

  it('keeps the full oid when it is already short', () => {
    expect(renderLfsSummary({
      kind: 'added',
      after: { oid: 'abc', size: 100 },
    })).toBe('binary file added (LFS): abc, 100 B')
  })
})
