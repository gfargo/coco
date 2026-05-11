import { featureBranchOneCommitScenario } from './feature-branch-one-commit'
import { createTempGitRepo, type TempGitRepo } from '../tempGitRepo'

describe('feature-branch-one-commit scenario', () => {
  let repo: TempGitRepo

  beforeAll(async () => {
    repo = await createTempGitRepo()
    await featureBranchOneCommitScenario.setup(repo)
  }, 30_000)

  afterAll(async () => {
    await repo?.cleanup()
  })

  it('has 1 commit on main', async () => {
    const log = await repo.git.log(['main'])
    expect(log.total).toBe(1)
  })

  it('has feat/x checked out', async () => {
    const status = await repo.git.status()
    expect(status.current).toBe('feat/x')
  })

  it('has 1 commit on feat/x ahead of main', async () => {
    const ahead = await repo.git.raw(['rev-list', '--count', 'main..feat/x'])
    expect(parseInt(ahead.trim(), 10)).toBe(1)
  })

  it('has src/feature.ts present', async () => {
    const content = await repo.git.show(['HEAD:src/feature.ts'])
    expect(content).toContain('export const feature')
  })

  it('has a clean worktree', async () => {
    const status = await repo.git.status()
    expect(status.isClean()).toBe(true)
  })
})
