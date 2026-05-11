import { spinUpScenario } from './spinUpScenario'
import type { TempGitRepo } from './tempGitRepo'

describe('spinUpScenario', () => {
  const repos: TempGitRepo[] = []

  afterAll(async () => {
    await Promise.all(repos.map((r) => r.cleanup()))
  })

  it('returns a TempGitRepo with the named scenario applied', async () => {
    const repo = await spinUpScenario('feature-pr-ready')
    repos.push(repo)
    const status = await repo.git.status()
    expect(status.current).toBe('feat/widget-v2')
    expect(status.isClean()).toBe(true)
  }, 30_000)

  it('throws a helpful error with the available names for an unknown scenario', async () => {
    await expect(spinUpScenario('does-not-exist')).rejects.toThrow(
      /Unknown scenario "does-not-exist"\. Available: .*feature-pr-ready/
    )
  })

  it('produces independent repos when called multiple times', async () => {
    const a = await spinUpScenario('multi-commit-branch')
    const b = await spinUpScenario('multi-commit-branch')
    repos.push(a, b)
    expect(a.path).not.toBe(b.path)
    // Same scenario name + deterministic seeds → identical commit graph.
    const aLog = await a.git.log()
    const bLog = await b.git.log()
    expect(aLog.all.map((c) => c.message)).toEqual(bLog.all.map((c) => c.message))
  }, 60_000)
})
