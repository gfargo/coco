import { existsSync } from 'fs'
import { join } from 'path'

import { midBisectScenario } from './mid-bisect'
import { createTempGitRepo, type TempGitRepo } from '../tempGitRepo'

describe('mid-bisect scenario', () => {
  let repo: TempGitRepo

  beforeAll(async () => {
    repo = await createTempGitRepo()
    await midBisectScenario.setup(repo)
  }, 60_000)

  afterAll(async () => {
    // `git bisect reset` first so the cleanup doesn't trip over the
    // detached-HEAD state that some filesystem cleanup paths dislike.
    // Best-effort — if it fails we still want the dir removed.
    try {
      await repo.git.raw(['bisect', 'reset'])
    } catch {
      /* ignore */
    }
    await repo?.cleanup()
  })

  it('has 20 commits total', async () => {
    // Use `--all` so the count survives the detached-HEAD state. Any
    // reachable commit through any ref counts; the bisect doesn't
    // create new commits, so we get the 20 baseline commits.
    const count = await repo.git.raw(['rev-list', '--all', '--count'])
    expect(parseInt(count.trim(), 10)).toBe(20)
  })

  it('has a bisect in progress (BISECT_LOG exists)', () => {
    expect(existsSync(join(repo.path, '.git', 'BISECT_LOG'))).toBe(true)
  })

  it('has HEAD detached at a non-tip commit', async () => {
    // `git bisect start <bad> <good>` checks out the midpoint. HEAD
    // is detached and not pointing at the `bad` tip.
    const head = (await repo.git.revparse(['HEAD'])).trim()
    const mainTip = (await repo.git.revparse(['main'])).trim()
    expect(head).not.toBe(mainTip)
  })

  it('has no decision lines logged yet (start markers only)', async () => {
    const bisectLog = await repo.git.raw(['bisect', 'log'])
    // The bisect log emits `# bad: ...` / `# good: ...` for the start
    // markers but should have NO `git bisect bad` / `git bisect good`
    // command lines yet — those only appear once decisions are made.
    expect(bisectLog).toMatch(/git bisect start/)
    expect(bisectLog).not.toMatch(/git bisect (good|bad|skip) [a-f0-9]/)
  })
})
