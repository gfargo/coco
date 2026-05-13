import {
  LfsAttributeStatus,
  isPathLfsTracked,
  parseLfsAttributes,
} from './lfsAttributes'

describe('parseLfsAttributes', () => {
  it('returns only the patterns marked filter=lfs', () => {
    const body = [
      '*.bin filter=lfs diff=lfs merge=lfs -text',
      '*.txt text',
      'videos/* filter=lfs',
      '# comment line — should be ignored',
      '',
      'docs/*.md export-ignore',
    ].join('\n')

    const patterns = parseLfsAttributes(body, '')
    expect(patterns).toEqual([
      { baseDir: '', pattern: '*.bin' },
      { baseDir: '', pattern: 'videos/*' },
    ])
  })

  it('records the baseDir on each pattern', () => {
    const patterns = parseLfsAttributes('*.psd filter=lfs', 'assets')
    expect(patterns).toEqual([{ baseDir: 'assets', pattern: '*.psd' }])
  })

  it('handles lines with extra whitespace gracefully', () => {
    const patterns = parseLfsAttributes('   *.png   filter=lfs   diff=lfs', '')
    expect(patterns).toEqual([{ baseDir: '', pattern: '*.png' }])
  })

  it('returns an empty list for empty / whitespace-only inputs', () => {
    expect(parseLfsAttributes('', '')).toEqual([])
    expect(parseLfsAttributes('   \n  \n', '')).toEqual([])
  })

  it('ignores pattern-only lines that lack a filter=lfs attribute', () => {
    expect(parseLfsAttributes('*.bin', '')).toEqual([])
    expect(parseLfsAttributes('*.bin text', '')).toEqual([])
  })
})

describe('isPathLfsTracked', () => {
  it('returns false when LFS is disabled (no patterns)', () => {
    const status: LfsAttributeStatus = { enabled: false, patterns: [] }
    expect(isPathLfsTracked(status, 'foo.bin')).toBe(false)
  })

  it('matches patterns anchored to the repo root', () => {
    const status: LfsAttributeStatus = {
      enabled: true,
      patterns: [{ baseDir: '', pattern: '*.bin' }],
    }
    expect(isPathLfsTracked(status, 'foo.bin')).toBe(true)
    // matchBase: '*.bin' should match the file in any directory.
    expect(isPathLfsTracked(status, 'src/nested/foo.bin')).toBe(true)
    expect(isPathLfsTracked(status, 'foo.txt')).toBe(false)
  })

  it('scopes patterns to the directory of their .gitattributes file', () => {
    const status: LfsAttributeStatus = {
      enabled: true,
      patterns: [{ baseDir: 'assets', pattern: '*.psd' }],
    }
    expect(isPathLfsTracked(status, 'assets/hero.psd')).toBe(true)
    expect(isPathLfsTracked(status, 'src/hero.psd')).toBe(false)
  })

  it('respects glob patterns with explicit directory components', () => {
    const status: LfsAttributeStatus = {
      enabled: true,
      patterns: [{ baseDir: '', pattern: 'videos/**/*.mp4' }],
    }
    expect(isPathLfsTracked(status, 'videos/foo.mp4')).toBe(true)
    expect(isPathLfsTracked(status, 'videos/sub/foo.mp4')).toBe(true)
    expect(isPathLfsTracked(status, 'foo.mp4')).toBe(false)
  })

  it('treats nested baseDir patterns relative to their own directory', () => {
    const status: LfsAttributeStatus = {
      enabled: true,
      patterns: [{ baseDir: 'docs/assets', pattern: '*.png' }],
    }
    expect(isPathLfsTracked(status, 'docs/assets/cover.png')).toBe(true)
    expect(isPathLfsTracked(status, 'docs/cover.png')).toBe(false)
    expect(isPathLfsTracked(status, 'src/cover.png')).toBe(false)
  })

  it('returns false on a path that has no matching pattern', () => {
    const status: LfsAttributeStatus = {
      enabled: true,
      patterns: [
        { baseDir: '', pattern: '*.bin' },
        { baseDir: 'assets', pattern: '*.psd' },
      ],
    }
    expect(isPathLfsTracked(status, 'src/parser.ts')).toBe(false)
  })
})
