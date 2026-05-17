import { twoCommitFeatureScenario } from './two-commit-feature'
import { createTempGitRepo, type TempGitRepo } from '../tempGitRepo'

describe('two-commit-feature scenario', () => {
  let repo: TempGitRepo

  beforeAll(async () => {
    repo = await createTempGitRepo()
    await twoCommitFeatureScenario.setup(repo)
  }, 30_000)

  afterAll(async () => {
    await repo?.cleanup()
  })

  it('has 2 commits on main', async () => {
    const log = await repo.git.log()
    expect(log.total).toBe(2)
  })

  it('has the expected commit subjects in chronological order', async () => {
    const log = await repo.git.log()
    expect(log.all.map((c) => c.message)).toEqual([
      'feat: add feature module',
      'chore: initial commit',
    ])
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
