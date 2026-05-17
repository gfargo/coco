import { multiCommitBranchScenario } from './multi-commit-branch'
import { createTempGitRepo, type TempGitRepo } from '../tempGitRepo'

describe('multi-commit-branch scenario', () => {
  let repo: TempGitRepo

  beforeAll(async () => {
    repo = await createTempGitRepo()
    await multiCommitBranchScenario.setup(repo)
  }, 30_000)

  afterAll(async () => {
    await repo?.cleanup()
  })

  it('has 2 commits on main', async () => {
    const log = await repo.git.log(['main'])
    expect(log.total).toBe(2)
  })

  it('has feat/dashboard checked out', async () => {
    const status = await repo.git.status()
    expect(status.current).toBe('feat/dashboard')
  })

  it('has 8 commits on feat/dashboard ahead of main', async () => {
    const ahead = await repo.git.raw(['rev-list', '--count', 'main..feat/dashboard'])
    expect(parseInt(ahead.trim(), 10)).toBe(8)
  })

  it('has a clean worktree', async () => {
    const status = await repo.git.status()
    expect(status.isClean()).toBe(true)
  })

  it('has commits with varied conventional-commit types', async () => {
    const log = await repo.git.log()
    const subjects = log.all.map((entry) => entry.message.split('\n')[0])
    // Sample 3 of the expected types — the full list is in the
    // scenario file itself; the test just confirms variety, not
    // exact ordering (the scenario could reorder commits later).
    const types = new Set(subjects.map((s) => s.split(':')[0]))
    expect(types.has('feat')).toBe(true)
    expect(types.has('fix')).toBe(true)
    expect(types.has('docs')).toBe(true)
    expect(types.has('test')).toBe(true)
    expect(types.has('refactor')).toBe(true)
    expect(types.has('chore')).toBe(true)
  })
})
