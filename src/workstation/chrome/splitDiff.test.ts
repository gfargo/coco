import { buildSplitDiffRows, computeDiffContext } from './splitDiff'

describe('buildSplitDiffRows', () => {
  it('returns an empty array for empty input', () => {
    expect(buildSplitDiffRows([])).toEqual([])
  })

  it('emits a header row for a single hunk header', () => {
    const rows = buildSplitDiffRows(['@@ -1,1 +1,1 @@'])

    expect(rows).toHaveLength(1)
    expect(rows[0].left.kind).toBe('header')
    expect(rows[0].right.kind).toBe('header')
    expect(rows[0].left.text).toBe('@@ -1,1 +1,1 @@')
  })

  it('pairs a 1-1 change block element-wise', () => {
    const rows = buildSplitDiffRows([
      '@@ -1,1 +1,1 @@',
      '-old line',
      '+new line',
    ])

    // header + 1 paired row
    expect(rows).toHaveLength(2)
    const change = rows[1]
    expect(change.left.kind).toBe('remove')
    expect(change.left.text).toBe('old line')
    expect(change.left.lineNumber).toBe(1)
    expect(change.right.kind).toBe('add')
    expect(change.right.text).toBe('new line')
    expect(change.right.lineNumber).toBe(1)
  })

  it('pads the shorter side with empty rows when removals outnumber additions', () => {
    const rows = buildSplitDiffRows([
      '@@ -1,3 +1,1 @@',
      '-a',
      '-b',
      '-c',
      '+x',
    ])

    // header + 3 rows (longest side)
    expect(rows).toHaveLength(4)
    expect(rows[1]).toMatchObject({
      left: { text: 'a', kind: 'remove', lineNumber: 1 },
      right: { text: 'x', kind: 'add', lineNumber: 1 },
    })
    expect(rows[2]).toMatchObject({
      left: { text: 'b', kind: 'remove', lineNumber: 2 },
      right: { text: '', kind: 'empty' },
    })
    expect(rows[3]).toMatchObject({
      left: { text: 'c', kind: 'remove', lineNumber: 3 },
      right: { text: '', kind: 'empty' },
    })
  })

  it('pads the shorter side with empty rows when additions outnumber removals', () => {
    const rows = buildSplitDiffRows([
      '@@ -1,1 +1,3 @@',
      '-only',
      '+x',
      '+y',
      '+z',
    ])

    expect(rows).toHaveLength(4)
    expect(rows[1]).toMatchObject({
      left: { text: 'only', kind: 'remove', lineNumber: 1 },
      right: { text: 'x', kind: 'add', lineNumber: 1 },
    })
    expect(rows[2]).toMatchObject({
      left: { text: '', kind: 'empty' },
      right: { text: 'y', kind: 'add', lineNumber: 2 },
    })
    expect(rows[3]).toMatchObject({
      left: { text: '', kind: 'empty' },
      right: { text: 'z', kind: 'add', lineNumber: 3 },
    })
  })

  it('does not pair across a context line that interrupts a change block', () => {
    const rows = buildSplitDiffRows([
      '@@ -1,3 +1,3 @@',
      '-a',
      '+b',
      ' ctx',
      '-c',
      '+d',
    ])

    // header + change + context + change
    expect(rows).toHaveLength(4)
    expect(rows[1]).toMatchObject({
      left: { text: 'a', kind: 'remove', lineNumber: 1 },
      right: { text: 'b', kind: 'add', lineNumber: 1 },
    })
    expect(rows[2]).toMatchObject({
      left: { text: 'ctx', kind: 'context', lineNumber: 2 },
      right: { text: 'ctx', kind: 'context', lineNumber: 2 },
    })
    expect(rows[3]).toMatchObject({
      left: { text: 'c', kind: 'remove', lineNumber: 3 },
      right: { text: 'd', kind: 'add', lineNumber: 3 },
    })
  })

  it('handles an all-additions hunk (file added) with empty left column', () => {
    const rows = buildSplitDiffRows([
      '@@ -0,0 +1,2 @@',
      '+first',
      '+second',
    ])

    expect(rows).toHaveLength(3)
    expect(rows[1]).toMatchObject({
      left: { text: '', kind: 'empty' },
      right: { text: 'first', kind: 'add', lineNumber: 1 },
    })
    expect(rows[2]).toMatchObject({
      left: { text: '', kind: 'empty' },
      right: { text: 'second', kind: 'add', lineNumber: 2 },
    })
  })

  it('handles an all-removals hunk (file deleted) with empty right column', () => {
    const rows = buildSplitDiffRows([
      '@@ -1,2 +0,0 @@',
      '-first',
      '-second',
    ])

    expect(rows).toHaveLength(3)
    expect(rows[1]).toMatchObject({
      left: { text: 'first', kind: 'remove', lineNumber: 1 },
      right: { text: '', kind: 'empty' },
    })
    expect(rows[2]).toMatchObject({
      left: { text: 'second', kind: 'remove', lineNumber: 2 },
      right: { text: '', kind: 'empty' },
    })
  })

  it('emits diff metadata lines (diff/index/+++/---) as header rows', () => {
    const rows = buildSplitDiffRows([
      'diff --git a/foo.ts b/foo.ts',
      'index abc..def 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,1 +1,1 @@',
      '-x',
      '+y',
    ])

    expect(rows.slice(0, 4)).toEqual([
      { left: { text: 'diff --git a/foo.ts b/foo.ts', kind: 'header' }, right: { text: 'diff --git a/foo.ts b/foo.ts', kind: 'header' } },
      { left: { text: 'index abc..def 100644', kind: 'header' }, right: { text: 'index abc..def 100644', kind: 'header' } },
      { left: { text: '--- a/foo.ts', kind: 'header' }, right: { text: '--- a/foo.ts', kind: 'header' } },
      { left: { text: '+++ b/foo.ts', kind: 'header' }, right: { text: '+++ b/foo.ts', kind: 'header' } },
    ])
    expect(rows[4].left.kind).toBe('header')
    expect(rows[5].left.kind).toBe('remove')
    expect(rows[5].right.kind).toBe('add')
  })

  it('handles multiple hunks with independent line-number cursors', () => {
    const rows = buildSplitDiffRows([
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
      '@@ -10,1 +10,1 @@',
      '-c',
      '+d',
    ])

    expect(rows).toHaveLength(4)
    expect(rows[1]).toMatchObject({
      left: { lineNumber: 1, text: 'a' },
      right: { lineNumber: 1, text: 'b' },
    })
    expect(rows[3]).toMatchObject({
      left: { lineNumber: 10, text: 'c' },
      right: { lineNumber: 10, text: 'd' },
    })
  })

  it('keeps removals and additions paired even when grouped across the block', () => {
    const rows = buildSplitDiffRows([
      '@@ -1,2 +1,2 @@',
      '-a',
      '-b',
      '+x',
      '+y',
    ])

    expect(rows).toHaveLength(3)
    expect(rows[1]).toMatchObject({
      left: { text: 'a', kind: 'remove' },
      right: { text: 'x', kind: 'add' },
    })
    expect(rows[2]).toMatchObject({
      left: { text: 'b', kind: 'remove' },
      right: { text: 'y', kind: 'add' },
    })
  })

  // Regression: the marker used to be treated as a CONTEXT line — it
  // force-flushed the pair block (the -x/+y change rendered as two
  // unpaired rows), was given line numbers it doesn't have, and advanced
  // both cursors so every number below drifted by one.
  it('skips the "\\ No newline at end of file" marker without breaking pairing or numbering', () => {
    const rows = buildSplitDiffRows([
      '@@ -1,1 +1,1 @@',
      '-x',
      '\\ No newline at end of file',
      '+y',
      '\\ No newline at end of file',
    ])

    // Header + ONE paired change row; markers render nothing.
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({
      left: { text: 'x', kind: 'remove', lineNumber: 1 },
      right: { text: 'y', kind: 'add', lineNumber: 1 },
    })
  })

  it('classifies deleted `-- ` content lines as removals, not headers', () => {
    // A deletion of a SQL/Lua comment reads `--- select 1` on the wire —
    // it used to match the `--- ` file-header check inside the hunk,
    // rendering as an accent header and drifting old-side numbering.
    const rows = buildSplitDiffRows([
      '@@ -10,3 +10,2 @@',
      ' context',
      '--- drop this comment',
      ' more context',
    ])

    expect(rows).toHaveLength(4)
    expect(rows[2]).toMatchObject({
      left: { text: '-- drop this comment', kind: 'remove', lineNumber: 11 },
    })
    // Old-side numbering continues correctly after the removal.
    expect(rows[3]).toMatchObject({
      left: { text: 'more context', kind: 'context', lineNumber: 12 },
      right: { text: 'more context', kind: 'context', lineNumber: 11 },
    })
  })

  // Regression for #1114: when the split renderer windows the diff to a
  // scroll offset that lands PAST the `@@` header, the lines handed to
  // buildSplitDiffRows have no hunk header. Without a seed, `inHunk`
  // starts false and every visible line is misclassified as a header —
  // which painted the whole window in the accent color when scrolling.
  describe('windowed (seeded) parsing', () => {
    const fullDiff = [
      '@@ -1,4 +1,4 @@',
      ' context a',
      ' context b',
      '-removed c',
      '+added c',
      ' context d',
      ' context e',
    ]

    it('misclassifies a mid-hunk window as all-header WITHOUT a seed (the bug)', () => {
      // Slice starting after the @@ header — the unfixed path.
      const slice = fullDiff.slice(3) // ['-removed c', '+added c', ' context d', ' context e']
      const rows = buildSplitDiffRows(slice)
      // Every row collapses to a header (accent color) — the reported bug.
      expect(rows.every((row) => row.left.kind === 'header')).toBe(true)
    })

    it('classifies a mid-hunk window correctly WHEN seeded with the hunk context', () => {
      const offset = 3
      const seed = computeDiffContext(fullDiff, offset)
      expect(seed.inHunk).toBe(true)

      const slice = fullDiff.slice(offset)
      const rows = buildSplitDiffRows(slice, seed)

      // No header rows — real change + context, just like the full parse.
      expect(rows.some((row) => row.left.kind === 'header')).toBe(false)
      const change = rows.find((row) => row.right.kind === 'add')
      expect(change?.right.text).toBe('added c')
      expect(change?.left.text).toBe('removed c')
    })

    it('seeds continuous line numbers across the cut', () => {
      // Full parse line numbers for the trailing context rows…
      const full = buildSplitDiffRows(fullDiff)
      const lastContext = full[full.length - 1]
      expect(lastContext.left.kind).toBe('context')

      // …match what the windowed+seeded parse produces for the same row.
      const offset = 5 // start at ' context d'
      const seed = computeDiffContext(fullDiff, offset)
      const windowed = buildSplitDiffRows(fullDiff.slice(offset), seed)
      const windowedLast = windowed[windowed.length - 1]
      expect(windowedLast.left.lineNumber).toBe(lastContext.left.lineNumber)
      expect(windowedLast.right.lineNumber).toBe(lastContext.right.lineNumber)
    })

    it('computeDiffContext reports not-in-hunk before the first header', () => {
      const lines = ['diff --git a/f b/f', '@@ -1,1 +1,1 @@', '-x', '+y']
      expect(computeDiffContext(lines, 1)).toMatchObject({ inHunk: false })
      expect(computeDiffContext(lines, 2)).toMatchObject({ inHunk: true })
    })
  })
})
