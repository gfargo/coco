import { buildSplitDiffRows } from './inkSplitDiff'

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

  it('treats a "\\ No newline at end of file" marker as a context-aligned row', () => {
    const rows = buildSplitDiffRows([
      '@@ -1,1 +1,1 @@',
      '-x',
      '+y',
      '\\ No newline at end of file',
    ])

    expect(rows).toHaveLength(3)
    expect(rows[2].left.kind).toBe('context')
    expect(rows[2].right.kind).toBe('context')
    expect(rows[2].left.text).toBe('\\ No newline at end of file')
  })
})
