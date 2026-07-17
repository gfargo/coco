import { cellWidth, expandTabs, padCells, truncateCells, truncatePathCells, wrapCells } from './text'

describe('log Ink text helpers', () => {
  describe('expandTabs (#1393)', () => {
    it('expands tabs to the next fixed 8-column stop', () => {
      expect(expandTabs('\ta')).toBe('        a')
      expect(expandTabs('ab\tc')).toBe('ab      c')
      expect(expandTabs('12345678\tx')).toBe('12345678        x')
    })

    it('tracks columns across multiple tabs and wide characters', () => {
      // Two-cell CJK char advances the column by 2 before the tab.
      expect(expandTabs('変\tx')).toBe('変      x')
      expect(expandTabs('\t\tx')).toBe('                x')
    })

    it('honours startColumn for segment-wise expansion', () => {
      // Continuing at column 6 → next stop is 8 → 2 spaces.
      expect(expandTabs('\tx', 8, 6)).toBe('  x')
    })

    it('returns tab-free strings unchanged', () => {
      const plain = 'no tabs here'
      expect(expandTabs(plain)).toBe(plain)
    })

    it('makes tab-indented content measurable by cellWidth', () => {
      // The overflow class: cellWidth saw 0 for the tab while the
      // terminal advanced 8 cells.
      expect(cellWidth('\tfoo')).toBe(3)
      expect(cellWidth(expandTabs('\tfoo'))).toBe(11)
    })
  })

  it('measures wide and emoji characters by terminal cell width', () => {
    expect(cellWidth('abc')).toBe(3)
    expect(cellWidth('変更')).toBe(4)
    expect(cellWidth('fix ✨')).toBe(6)
  })

  // #1706 — Symbols & Pictographs Extended-A (U+1FA70-U+1FAFF) and
  // East-Asian-Wide symbols like ⭐/⬛/⭕ were measured as 1 cell while
  // terminals render them 2 cells wide, under-measuring row budgets.
  it('measures modern wide emoji blocks by terminal cell width (#1706)', () => {
    expect(cellWidth('🫡')).toBe(2)
    expect(cellWidth('⭐')).toBe(2)
    expect(cellWidth('⬛')).toBe(2)
    expect(cellWidth('⭕')).toBe(2)
    expect(cellWidth(truncateCells('🫡 approve deploy', 10))).toBeLessThanOrEqual(10)
  })

  it('truncates without splitting wide characters past the target width', () => {
    expect(truncateCells('src/変更-summary.ts', 10)).toBe('src/変更-…')
    expect(cellWidth(truncateCells('emoji ✨ commit message', 12))).toBeLessThanOrEqual(12)
  })

  it('defaults to the unicode ellipsis, matching truncatePathCells (#1366)', () => {
    expect(truncateCells('hello world', 8)).toBe('hello w…')
    expect(cellWidth(truncateCells('hello world', 8))).toBe(8)
  })

  // #1624 — String.padEnd counts UTF-16 code units, so a wide-glyph name
  // padded to a cellWidth-derived column overshoots by one fill char per
  // wide character. padCells pads by cell budget instead.
  describe('padCells (#1624)', () => {
    it('pads an ASCII string identically to String.padEnd', () => {
      expect(padCells('main', 8)).toBe('main'.padEnd(8))
    })

    it('pads a wide-glyph name so its cell width matches an ASCII name in the same column', () => {
      const wide = padCells('変更', 8)
      const ascii = padCells('main', 8)
      expect(cellWidth(wide)).toBe(cellWidth(ascii))
      expect(cellWidth(wide)).toBe(8)
      // Naive .padEnd would instead produce 2 (wide chars, 4 cells) + 6
      // (fill chars) = 10 cells — 2 cells too wide for the column.
      expect(wide).not.toBe('変更'.padEnd(8))
    })

    it('returns the value unchanged when it already meets or exceeds the width', () => {
      expect(padCells('feat/日本語対応', 4)).toBe('feat/日本語対応')
    })
  })

  it('falls back to the ASCII ellipsis under { ascii: true }', () => {
    expect(truncateCells('hello world', 8, { ascii: true })).toBe('hello...')
  })

  describe('wrapCells', () => {
    it('never hangs when the budget is narrower than one wide character', () => {
      // Regression: an empty chunk never shrank `remaining`, spinning
      // the hard-split loop forever. Width 1 vs width-2 CJK chars must
      // still terminate, emitting one (overflowing) char per line.
      expect(wrapCells('日本語', 1)).toEqual(['日', '本', '語'])
    })

    it('returns the input unchanged when it already fits', () => {
      expect(wrapCells('short', 20)).toEqual(['short'])
      expect(wrapCells('', 20)).toEqual([''])
    })

    it('breaks on whitespace when possible', () => {
      const lines = wrapCells('Add a blank line for improved readability and overall flow', 20)
      expect(lines.every((line) => cellWidth(line) <= 20)).toBe(true)
      // Word boundaries preserved — no word should be split across two lines.
      expect(lines.join(' ').replace(/\s+/g, ' ')).toBe(
        'Add a blank line for improved readability and overall flow'
      )
    })

    it('hard-splits a single word longer than the budget', () => {
      const lines = wrapCells('supercalifragilisticexpialidocious', 10)
      expect(lines.length).toBeGreaterThan(1)
      expect(lines.every((line) => cellWidth(line) <= 10)).toBe(true)
      expect(lines.join('')).toBe('supercalifragilisticexpialidocious')
    })

    it('respects wide-character cell counts', () => {
      const lines = wrapCells('変更 を加える branch', 6)
      expect(lines.every((line) => cellWidth(line) <= 6)).toBe(true)
    })
  })

  describe('truncatePathCells', () => {
    // The motivating case: file paths shown in the inspector were
    // being blunt-truncated by `truncateCells` so the user lost the
    // filename — the most useful part. `truncatePathCells` preserves
    // the filename and elides middle directory segments instead.

    it('returns the path unchanged when it already fits', () => {
      expect(truncatePathCells('src/log/data.ts', 100)).toBe('src/log/data.ts')
    })

    it('elides one middle segment when one drop is enough', () => {
      // 'src/commands/log/data.ts' = 24 cells.
      // Drop one segment from the end of the prefix:
      // 'src/commands/log/…/data.ts' is wider, not narrower — wait, that's because
      // we keep the START segments. Walking down: keep=2 → 'src/commands/…/data.ts'
      // (22 cells). Fits in 22, returns that.
      expect(truncatePathCells('src/commands/log/data.ts', 22)).toBe('src/commands/…/data.ts')
    })

    it('keeps shrinking until the filename + ellipsis fits', () => {
      // At width 12, only `…/data.ts` (9) fits.
      expect(truncatePathCells('src/commands/log/data.ts', 12)).toBe('…/data.ts')
    })

    it('falls back to plain truncation when even `…/filename` is too wide', () => {
      // Filename `verylongfilename.txt` (20) + `…/` (2) = 22. At
      // width 10, `…/verylongfilename.txt` doesn't fit; we truncate it
      // with the regular trailing-ellipsis suffix so the user sees
      // start-of-name (truncated) instead of nothing.
      const result = truncatePathCells('a/b/c/verylongfilename.txt', 10)
      expect(result.length).toBeGreaterThan(0)
      expect(cellWidth(result)).toBeLessThanOrEqual(10)
      // Contains the path-elision marker so the user knows the path
      // got truncated AND the filename did too.
      expect(result).toContain('…/')
    })

    it('falls back to plain truncation for inputs without path separators', () => {
      // No `/` in the input — there's no middle to elide, so the
      // helper behaves identically to `truncateCells`.
      expect(truncatePathCells('plainname.ts', 8)).toBe(truncateCells('plainname.ts', 8))
    })

    it('handles a bare filename like a single-segment path', () => {
      // Filename only, no parent directories. No path-aware elision
      // can help; defer to plain truncation.
      expect(truncatePathCells('data.test.ts', 8)).toBe(truncateCells('data.test.ts', 8))
    })

    it('returns empty for width < 1', () => {
      expect(truncatePathCells('any/path.ts', 0)).toBe('')
      expect(truncatePathCells('any/path.ts', -5)).toBe('')
    })

    it('returns input unchanged for paths at exactly the budget', () => {
      // 11 cells for 'src/data.ts'. Width 11 matches exactly.
      expect(truncatePathCells('src/data.ts', 11)).toBe('src/data.ts')
    })

    it('handles deeply-nested paths by elision near the deepest level', () => {
      // 'a/b/c/d/e/f/file.ts' = 19 cells. At width 18, the largest
      // prefix that fits is keep=5: 'a/b/c/d/e/…/file.ts' = 19 — no.
      // Wait, `a/b/c/d/e/…/file.ts` is 19 wide which exceeds 18. So
      // keep=4: 'a/b/c/d/…/file.ts' = 17 cells. Fits.
      expect(truncatePathCells('a/b/c/d/e/f/file.ts', 18)).toBe('a/b/c/d/…/file.ts')
    })

    it('preserves the entire filename including extensions', () => {
      // The filename `data.test.ts` has internal dots — make sure we
      // don't accidentally split on `.` (only `/`).
      const result = truncatePathCells('src/very/deep/path/data.test.ts', 16)
      expect(result.endsWith('data.test.ts')).toBe(true)
    })
  })
})
