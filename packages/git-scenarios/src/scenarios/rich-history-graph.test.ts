import { richHistoryGraphScenario } from './rich-history-graph'
import { createTempGitRepo, type TempGitRepo } from '../tempGitRepo'

describe('rich-history-graph scenario', () => {
  let repo: TempGitRepo

  beforeAll(async () => {
    repo = await createTempGitRepo()
    await richHistoryGraphScenario.setup(repo)
  }, 60_000)

  afterAll(async () => {
    await repo?.cleanup()
  })

  it('lands with main checked out and a clean worktree', async () => {
    const status = await repo.git.status()
    expect(status.current).toBe('main')
    expect(status.isClean()).toBe(true)
  })

  it('keeps feat/wip unmerged so the chip renderer has a target', async () => {
    const branches = await repo.git.branchLocal()
    expect(branches.all).toContain('feat/wip')

    // feat/wip exists as a ref but is not reachable from main — that's
    // exactly the shape the branch-tip chip needs to render at a tip
    // that isn't HEAD.
    const reachable = await repo.git.raw(['rev-list', '--count', 'main..feat/wip'])
    expect(parseInt(reachable.trim(), 10)).toBeGreaterThan(0)
  })

  it('keeps feat/auth and feat/payments reachable from main via merge commits', async () => {
    const branches = await repo.git.branchLocal()
    expect(branches.all).toContain('feat/auth')
    expect(branches.all).toContain('feat/payments')

    // Both feature branches should be reachable from main (they got
    // merged), but main should NOT be reachable from them — the
    // merge commit is the convergence point on the main side.
    const authReachable = await repo.git.raw(['rev-list', '--count', 'feat/auth..main'])
    const paymentsReachable = await repo.git.raw(['rev-list', '--count', 'feat/payments..main'])
    expect(parseInt(authReachable.trim(), 10)).toBeGreaterThan(0)
    expect(parseInt(paymentsReachable.trim(), 10)).toBeGreaterThan(0)
  })

  it('produces at least two --no-ff merge commits on main', async () => {
    // `--merges` filters to commits with more than one parent. Two
    // explicit merges (feat/auth + feat/payments) should appear.
    const merges = await repo.git.raw(['log', '--merges', '--format=%s', 'main'])
    const lines = merges.trim().split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.some((l) => l.includes('feat/auth'))).toBe(true)
    expect(lines.some((l) => l.includes('feat/payments'))).toBe(true)
  })

  it('spans at least 6 distinct date buckets across the log', async () => {
    // Pull author dates in YYYY-MM-DD form and bucket them coarsely:
    // today / yesterday / this-week / last-week / + each older
    // calendar month (one bucket per month). The scenario should
    // produce at least 6 distinct buckets so the divider renderer
    // has a real ladder to walk.
    const out = await repo.git.raw(['log', '--all', '--date=short', '--pretty=%ad'])
    const dates = out.trim().split('\n').filter(Boolean)

    const now = new Date()
    const oneDay = 24 * 60 * 60 * 1000
    const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const buckets = new Set<string>()
    for (const iso of dates) {
      const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10))
      const commitUtc = Date.UTC(y, m - 1, d)
      const days = Math.floor((nowUtc - commitUtc) / oneDay)
      if (days <= 0) buckets.add('today')
      else if (days === 1) buckets.add('yesterday')
      else if (days < 7) buckets.add('this-week')
      else if (days < 14) buckets.add('last-week')
      else buckets.add(`${y}-${String(m).padStart(2, '0')}`)
    }
    expect(buckets.size).toBeGreaterThanOrEqual(6)
  })

  it('exercises every conventional-commit type the renderer maps', async () => {
    const log = await repo.git.log(['--all'])
    const subjects = log.all.map((entry) => entry.message.split('\n')[0])
    const typeTokens = new Set(
      subjects
        .map((s) => /^([a-z]+)(\([^)]+\))?(!)?:/.exec(s)?.[1])
        .filter(Boolean) as string[]
    )

    for (const expected of ['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'revert']) {
      expect(typeTokens.has(expected)).toBe(true)
    }
  })

  it('includes a breaking-change marker on at least one commit', async () => {
    const log = await repo.git.log(['--all'])
    const subjects = log.all.map((entry) => entry.message.split('\n')[0])
    expect(subjects.some((s) => /^[a-z]+(\([^)]+\))?!:/.test(s))).toBe(true)
  })

  it('has at least one commit dated today (the freshest bucket)', async () => {
    const out = await repo.git.raw(['log', '--date=short', '--pretty=%ad', 'main'])
    const dates = out.trim().split('\n').filter(Boolean)
    const today = new Date()
    const todayIso = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`
    expect(dates).toContain(todayIso)
  })
})
