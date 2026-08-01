import { FIELD_SEPARATOR } from './logData'
import { getBranchOverview, parseBranchRefs, parseDivergence } from './branchData'

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

describe('getBranchOverview snapshot parameter (OSS-596)', () => {
  function makeGit(forEachRefOutput = '') {
    return {
      raw: jest.fn().mockImplementation(async (args: string[]) => {
        if (args[0] === 'for-each-ref') return forEachRefOutput
        if (args[0] === 'status') return ''
        if (args[0] === 'branch') return 'main\n'
        return ''
      }),
    }
  }

  it('skips status --porcelain and branch --show-current when snapshot supplies both', async () => {
    const git = makeGit()
    const snapshot = { statusOutput: ' M dirty.ts\0', currentBranch: 'feat/foo' }

    const result = await getBranchOverview(git as never, snapshot)

    // for-each-ref must still run — it's never skipped
    expect(git.raw).toHaveBeenCalledWith(expect.arrayContaining(['for-each-ref']))
    // Neither status nor branch should be fetched
    const statusCalls = (git.raw as jest.Mock).mock.calls.filter(
      (args: string[][]) => args[0][0] === 'status',
    )
    const branchCalls = (git.raw as jest.Mock).mock.calls.filter(
      (args: string[][]) => args[0][0] === 'branch',
    )
    expect(statusCalls).toHaveLength(0)
    expect(branchCalls).toHaveLength(0)

    expect(result.dirty).toBe(true)
    expect(result.currentBranch).toBe('feat/foo')
  })

  it('fetches status --porcelain internally when snapshot.statusOutput is omitted', async () => {
    const git = makeGit()
    const snapshot = { currentBranch: 'feat/foo' }

    await getBranchOverview(git as never, snapshot)

    const statusCalls = (git.raw as jest.Mock).mock.calls.filter(
      (args: string[][]) => args[0][0] === 'status',
    )
    expect(statusCalls).toHaveLength(1)
  })

  it('fetches branch --show-current internally when snapshot.currentBranch is omitted', async () => {
    const git = makeGit()
    const snapshot = { statusOutput: '' }

    await getBranchOverview(git as never, snapshot)

    const branchCalls = (git.raw as jest.Mock).mock.calls.filter(
      (args: string[][]) => args[0][0] === 'branch',
    )
    expect(branchCalls).toHaveLength(1)
  })

  it('fetches both when no snapshot is supplied (backward compatibility)', async () => {
    const git = makeGit()

    await getBranchOverview(git as never)

    const statusCalls = (git.raw as jest.Mock).mock.calls.filter(
      (args: string[][]) => args[0][0] === 'status',
    )
    const branchCalls = (git.raw as jest.Mock).mock.calls.filter(
      (args: string[][]) => args[0][0] === 'branch',
    )
    expect(statusCalls).toHaveLength(1)
    expect(branchCalls).toHaveLength(1)
  })
})
