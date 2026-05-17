import { featurePrReadyScenario } from './feature-pr-ready'
import { createTempGitRepo, type TempGitRepo } from '../tempGitRepo'

describe('feature-pr-ready scenario', () => {
  let repo: TempGitRepo

  beforeAll(async () => {
    repo = await createTempGitRepo()
    await featurePrReadyScenario.setup(repo)
  }, 30_000)

  afterAll(async () => {
    await repo?.cleanup()
  })

  it('has 3 commits on main', async () => {
    const log = await repo.git.log(['main'])
    expect(log.total).toBe(3)
  })

  it('has feat/widget-v2 checked out', async () => {
    const status = await repo.git.status()
    expect(status.current).toBe('feat/widget-v2')
  })

  it('has feat/widget-v2 4 commits ahead of main', async () => {
    const ahead = await repo.git.raw(['rev-list', '--count', 'main..feat/widget-v2'])
    expect(parseInt(ahead.trim(), 10)).toBe(4)
  })

  it('has a clean worktree', async () => {
    const status = await repo.git.status()
    expect(status.isClean()).toBe(true)
  })

  it('preserves commit subjects in the expected order', async () => {
    const log = await repo.git.log()
    const subjects = log.all.map((entry) => entry.message.split('\n')[0])
    expect(subjects).toEqual([
      'docs: document widget-v2 API and migration path',
      'test: cover widget-v2 happy path and edge cases',
      'feat: expose widget-v2 from public index',
      'feat: add widget-v2 entry point and types',
      'test: add baseline widget tests',
      'feat: scaffold widget module',
      'chore: initial commit',
    ])
  })
})
