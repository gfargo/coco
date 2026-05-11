import { dirtyManyFilesScenario } from './dirty-many-files'
import { createTempGitRepo, type TempGitRepo } from '../tempGitRepo'

describe('dirty-many-files scenario', () => {
  let repo: TempGitRepo

  beforeAll(async () => {
    repo = await createTempGitRepo()
    await dirtyManyFilesScenario.setup(repo)
  }, 30_000)

  afterAll(async () => {
    await repo?.cleanup()
  })

  it('has 2 commits on main', async () => {
    const log = await repo.git.log(['main'])
    expect(log.total).toBe(2)
  })

  // simple-git's StatusResult helpers double-count files modified in
  // both index AND worktree (e.g. a file that was staged AND then
  // edited again). Use the raw porcelain v2 output to get unambiguous
  // counts per stage position.
  async function porcelainCounts(): Promise<{
    stagedOnly: number
    unstagedOnly: number
    untracked: number
  }> {
    const raw = await repo.git.raw(['status', '--porcelain'])
    let stagedOnly = 0
    let unstagedOnly = 0
    let untracked = 0
    for (const line of raw.split('\n')) {
      if (!line) continue
      const [x, y] = [line[0], line[1]]
      if (x === '?' && y === '?') {
        untracked += 1
      } else {
        if (x !== ' ' && x !== '?') stagedOnly += 1
        if (y !== ' ' && y !== '?') unstagedOnly += 1
      }
    }
    return { stagedOnly, unstagedOnly, untracked }
  }

  it('has 12 staged files', async () => {
    const counts = await porcelainCounts()
    expect(counts.stagedOnly).toBe(12)
  })

  it('has 6 unstaged (modified-but-not-staged) files', async () => {
    const counts = await porcelainCounts()
    expect(counts.unstagedOnly).toBe(6)
  })

  it('has 3 untracked files', async () => {
    const counts = await porcelainCounts()
    expect(counts.untracked).toBe(3)
  })

  it('dirty changes span src/, tests/, and docs/', async () => {
    const status = await repo.git.status()
    const allPaths = [
      ...status.staged,
      ...status.modified,
      ...status.not_added,
    ]
    const topLevelDirs = new Set(
      allPaths
        .map((p) => p.split('/')[0])
        .filter((d) => d.includes('/') === false && (d === 'src' || d === 'tests' || d === 'docs'))
    )
    expect(topLevelDirs).toContain('src')
    expect(topLevelDirs).toContain('tests')
    expect(topLevelDirs).toContain('docs')
  })
})
