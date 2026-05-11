import { singleStagedFileScenario } from './single-staged-file'
import { createTempGitRepo, type TempGitRepo } from '../tempGitRepo'

describe('single-staged-file scenario', () => {
  let repo: TempGitRepo

  beforeAll(async () => {
    repo = await createTempGitRepo()
    await singleStagedFileScenario.setup(repo)
  }, 30_000)

  afterAll(async () => {
    await repo?.cleanup()
  })

  it('has 1 commit on main', async () => {
    const log = await repo.git.log()
    expect(log.total).toBe(1)
  })

  it('has exactly 1 staged file (README.md)', async () => {
    const status = await repo.git.status()
    expect(status.staged).toEqual(['README.md'])
  })

  it('has no unstaged or untracked files', async () => {
    const status = await repo.git.status()
    expect(status.modified).toEqual([])
    expect(status.not_added).toEqual([])
  })
})
