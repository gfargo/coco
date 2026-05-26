import { parseTagRefs } from './tagData'

describe('log tag data', () => {
  it('parses lightweight tag refs (deref field empty → fall back to object SHA)', () => {
    // Lightweight tags ARE direct pointers to commits, so
    // `%(objectname:short)` already returns the commit SHA. The
    // `%(*objectname:short)` deref field comes back empty for these.
    const refs = parseTagRefs([
      ['0.33.0', 'abc1234', '', '2026-04-27', 'release v0.33.0'].join('\x1f'),
      ['0.32.0', 'def5678', '', '2026-04-26', 'release v0.32.0'].join('\x1f'),
    ].join('\n'))

    expect(refs).toEqual([
      {
        name: '0.33.0',
        hash: 'abc1234',
        date: '2026-04-27',
        subject: 'release v0.33.0',
      },
      {
        name: '0.32.0',
        hash: 'def5678',
        date: '2026-04-26',
        subject: 'release v0.32.0',
      },
    ])
  })

  it('prefers the dereferenced commit SHA for annotated tags', () => {
    // Annotated tags wrap a tag object (which has its own SHA) around
    // the commit. `%(objectname:short)` returns the TAG OBJECT's SHA;
    // `%(*objectname:short)` follows the wrapper to the underlying
    // commit. The parser MUST take the dereferenced form, otherwise
    // cursor-sync would search the loaded log for a SHA that doesn't
    // belong to any commit and report "unreachable."
    const refs = parseTagRefs(
      ['v1.0.0', 'tag0bj0', 'c0mm17ed', '2026-05-01', 'annotated release'].join('\x1f')
    )

    expect(refs).toEqual([
      {
        name: 'v1.0.0',
        hash: 'c0mm17ed',
        date: '2026-05-01',
        subject: 'annotated release',
      },
    ])
  })
})
