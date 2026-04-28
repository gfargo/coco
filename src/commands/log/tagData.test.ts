import { parseTagRefs } from './tagData'

describe('log tag data', () => {
  it('parses tag refs from git for-each-ref output', () => {
    const refs = parseTagRefs([
      ['0.33.0', 'abc1234', '2026-04-27', 'release v0.33.0'].join('\x1f'),
      ['0.32.0', 'def5678', '2026-04-26', 'release v0.32.0'].join('\x1f'),
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
})
