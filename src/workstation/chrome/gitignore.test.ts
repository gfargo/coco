import { deriveGitignoreOptions } from './gitignore'

describe('deriveGitignoreOptions', () => {
  it('always ends with a custom-pattern escape hatch seeded with the path', () => {
    const opts = deriveGitignoreOptions('src/foo.ts')
    const last = opts[opts.length - 1]
    expect(last.custom).toBe(true)
    expect(last.label).toBe('Custom pattern…')
    expect(last.pattern).toBe('src/foo.ts')
  })

  it('offers exact / by-extension / by-folder / by-name for a nested file', () => {
    const patterns = deriveGitignoreOptions('src/utils/debug.log').map((o) => o.pattern)
    expect(patterns).toEqual([
      'src/utils/debug.log', // this file only
      '*.log', // by extension
      'src/utils/', // its folder
      'debug.log', // by name anywhere
      'src/utils/debug.log', // custom (seeded with the path)
    ])
  })

  it('offers anchored + bare folder forms for a directory (trailing slash)', () => {
    const opts = deriveGitignoreOptions('.www/')
    const nonCustom = opts.filter((o) => !o.custom).map((o) => o.pattern)
    // Anchored-to-root and match-anywhere variants.
    expect(nonCustom).toEqual(['/.www/', '.www/'])
  })

  it('handles a nested directory', () => {
    const nonCustom = deriveGitignoreOptions('packages/app/dist/')
      .filter((o) => !o.custom)
      .map((o) => o.pattern)
    expect(nonCustom).toEqual(['/packages/app/dist/', 'dist/'])
  })

  it('omits the extension option for a dotfile / extensionless file', () => {
    const patterns = deriveGitignoreOptions('.env').map((o) => o.pattern)
    // leading-dot name has no "extension" (lastIndexOf('.') === 0) — no *.x option
    expect(patterns).not.toContain('*.env')
    expect(patterns).toContain('.env')
  })

  it('deduplicates patterns (top-level file: this-file === by-name)', () => {
    const opts = deriveGitignoreOptions('notes.txt')
    const nonCustom = opts.filter((o) => !o.custom).map((o) => o.pattern)
    // 'notes.txt' (this file) and 'notes.txt' (by name) collapse to one;
    // '*.txt' remains. No parent folder for a top-level file.
    expect(nonCustom).toEqual(['notes.txt', '*.txt'])
  })

  it('returns only the custom option for an empty path', () => {
    const opts = deriveGitignoreOptions('')
    expect(opts).toHaveLength(1)
    expect(opts[0].custom).toBe(true)
  })
})
