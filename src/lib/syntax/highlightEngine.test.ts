import {
  _resetSyntaxHighlightCaches,
  buildSpans,
  detectSyntaxLanguage,
  highlightDiffCode,
  highlightLine,
  selectDiffCodeLines,
  type RawCapture,
} from './highlightEngine'

// NOTE: tree-sitter's .wasm grammars don't load under the jest (jsdom)
// environment — `getTreeSitterParser` returns undefined there, same as
// the existing structural parsers which fall back to regex in tests. So
// the real grammar→captures path is exercised manually (via tsx) and in
// production; here we unit-test the pure pieces: language detection, the
// span-painting algorithm, the diff line selection, and the graceful
// fallbacks (which short-circuit before touching a grammar).

describe('detectSyntaxLanguage', () => {
  it('maps TS/TSX/JS extensions to a grammar', () => {
    expect(detectSyntaxLanguage('src/app.ts')).toBe('typescript')
    expect(detectSyntaxLanguage('src/app.mts')).toBe('typescript')
    expect(detectSyntaxLanguage('src/app.d.ts')).toBe('typescript')
    expect(detectSyntaxLanguage('src/App.tsx')).toBe('tsx')
    expect(detectSyntaxLanguage('src/app.jsx')).toBe('tsx')
    expect(detectSyntaxLanguage('src/app.js')).toBe('tsx')
  })

  it('maps Python / Rust / Go extensions to their grammars', () => {
    expect(detectSyntaxLanguage('app/main.py')).toBe('python')
    expect(detectSyntaxLanguage('app/types.pyi')).toBe('python')
    expect(detectSyntaxLanguage('src/lib.rs')).toBe('rust')
    expect(detectSyntaxLanguage('cmd/main.go')).toBe('go')
  })

  it('returns undefined for unsupported files', () => {
    expect(detectSyntaxLanguage('README.md')).toBeUndefined()
    expect(detectSyntaxLanguage('data.json')).toBeUndefined()
    expect(detectSyntaxLanguage('Makefile')).toBeUndefined()
  })
})

describe('buildSpans', () => {
  const cap = (name: string, start: number, end: number): RawCapture => ({
    name,
    node: { startIndex: start, endIndex: end },
  })

  it('covers the whole line contiguously, filling gaps with plain', () => {
    const text = 'const x = 1'
    const spans = buildSpans(text, [cap('keyword', 0, 5), cap('number', 10, 11)])
    expect(spans[0].start).toBe(0)
    expect(spans[spans.length - 1].end).toBe(text.length)
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBe(spans[i - 1].end)
    }
    // keyword 'const', then a plain run, then number '1'
    expect(spans[0]).toEqual({ start: 0, end: 5, token: 'keyword' })
    expect(spans[spans.length - 1]).toEqual({ start: 10, end: 11, token: 'number' })
  })

  it('lets a narrower capture override a wider overlapping one', () => {
    // Wider 'function' [0,10) with an inner 'keyword' [0,3): inner wins.
    const spans = buildSpans('xxxxxxxxxx', [cap('function', 0, 10), cap('keyword', 0, 3)])
    expect(spans[0]).toEqual({ start: 0, end: 3, token: 'keyword' })
    expect(spans[1]).toEqual({ start: 3, end: 10, token: 'function' })
  })

  it('ignores plain-mapped captures and clamps out-of-range offsets', () => {
    const spans = buildSpans('abc', [cap('operator', 0, 3), cap('number', 1, 99)])
    // 'operator' maps to plain (no color); 'number' clamps to end.
    expect(spans).toEqual([
      { start: 0, end: 1, token: 'plain' },
      { start: 1, end: 3, token: 'number' },
    ])
  })

  it('returns a single plain span when there are no captures', () => {
    expect(buildSpans('plain text', [])).toEqual([{ start: 0, end: 10, token: 'plain' }])
  })
})

describe('selectDiffCodeLines', () => {
  it('keeps marker-stripped +/-/space lines and drops headers/@@', () => {
    const lines = [
      'diff --git a/x.ts b/x.ts',
      'index abc..def 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,2 +1,2 @@',
      '-const a = 1',
      '+const a = 2',
      ' export const b = a',
    ]
    expect(selectDiffCodeLines(lines)).toEqual([
      'const a = 1',
      'const a = 2',
      'export const b = a',
    ])
  })

  it('deduplicates identical code lines', () => {
    expect(
      selectDiffCodeLines(['@@ -1 +1 @@', '+return x', ' return x', '-return x'])
    ).toEqual(['return x'])
  })

  it('ignores +/- lines that appear before any hunk header', () => {
    // The `+++ b/x` / `--- a/x` file headers must NOT be treated as code.
    expect(selectDiffCodeLines(['--- a/x.ts', '+++ b/x.ts'])).toEqual([])
  })
})

describe('highlightLine fallbacks (no grammar needed)', () => {
  beforeEach(() => _resetSyntaxHighlightCaches())

  it('returns [] for empty, non-ASCII, or over-long lines', async () => {
    expect(await highlightLine('typescript', '')).toEqual([])
    expect(await highlightLine('typescript', 'const café = 1')).toEqual([])
    expect(await highlightLine('typescript', 'x'.repeat(5000))).toEqual([])
  })
})

describe('highlightDiffCode', () => {
  beforeEach(() => _resetSyntaxHighlightCaches())

  it('returns an empty map for unsupported file types', async () => {
    const map = await highlightDiffCode('notes.md', [' # heading', '+more text'])
    expect(map.size).toBe(0)
  })

  it('does not throw for supported files (grammar may be unavailable)', async () => {
    // Under jest the grammar can't load → empty map; the point is it
    // resolves cleanly rather than throwing.
    const map = await highlightDiffCode('x.ts', ['+const a = 2', ' export const b = a'])
    expect(map).toBeInstanceOf(Map)
  })
})
