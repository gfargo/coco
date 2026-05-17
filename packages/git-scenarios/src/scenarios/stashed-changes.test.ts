import { stashedChangesScenario } from './stashed-changes'
import { createTempGitRepo, type TempGitRepo } from '../tempGitRepo'

describe('stashed-changes scenario', () => {
  let repo: TempGitRepo

  beforeAll(async () => {
    repo = await createTempGitRepo()
    await stashedChangesScenario.setup(repo)
  }, 30_000)

  afterAll(async () => {
    await repo?.cleanup()
  })

  it('has 2 commits on main', async () => {
    const log = await repo.git.log()
    expect(log.total).toBe(2)
  })

  it('has a clean worktree', async () => {
    const status = await repo.git.status()
    expect(status.isClean()).toBe(true)
  })

  it('has 3 stashes with the expected messages in LIFO order', async () => {
    const list = await repo.git.raw(['stash', 'list'])
    const lines = list.trim().split('\n')
    expect(lines).toHaveLength(3)
    // Most-recent stash is stash@{0}. Messages appear after the
    // stash ref + branch prefix ("stash@{0}: On main: <message>").
    expect(lines[0]).toContain('WIP: experiment-c')
    expect(lines[1]).toContain('WIP: experiment-b')
    expect(lines[2]).toContain('WIP: experiment-a')
  })

  it('each stash touches a distinct file (verified by inspecting patches)', async () => {
    const stash0 = await repo.git.raw(['stash', 'show', '--name-only', 'stash@{0}'])
    const stash1 = await repo.git.raw(['stash', 'show', '--name-only', 'stash@{1}'])
    const stash2 = await repo.git.raw(['stash', 'show', '--name-only', 'stash@{2}'])
    expect(stash0.trim()).toBe('src/feature-c.ts')
    expect(stash1.trim()).toBe('src/feature-b.ts')
    expect(stash2.trim()).toBe('src/feature-a.ts')
  })
})
