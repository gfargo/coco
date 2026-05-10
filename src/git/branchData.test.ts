import { FIELD_SEPARATOR } from '../commands/log/data'
import { parseBranchRefs, parseDivergence } from './branchData'

describe('log branch data', () => {
  it('parses local and remote branch refs from stable git output', () => {
    const refs = parseBranchRefs([
      [
        'refs/heads/main',
        'main',
        'abc1234',
        'origin/main',
        '*',
        '2026-04-27',
        'feat: current branch',
      ].join(FIELD_SEPARATOR),
      [
        'refs/remotes/origin/main',
        'origin/main',
        'def5678',
        '',
        '',
        '2026-04-26',
        'feat: remote branch',
      ].join(FIELD_SEPARATOR),
      [
        'refs/remotes/origin/HEAD',
        'origin/HEAD',
        'def5678',
        '',
        '',
        '2026-04-26',
        'origin/main',
      ].join(FIELD_SEPARATOR),
    ].join('\n'))

    expect(refs).toEqual([
      expect.objectContaining({
        type: 'local',
        shortName: 'main',
        upstream: 'origin/main',
        current: true,
      }),
      expect.objectContaining({
        type: 'remote',
        remote: 'origin',
        shortName: 'origin/main',
        current: false,
      }),
    ])
  })

  it('parses upstream divergence as behind and ahead counts', () => {
    expect(parseDivergence('2\t5\n')).toEqual({
      behind: 2,
      ahead: 5,
    })
  })
})
