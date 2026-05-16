import { readFileSync } from 'fs'
import { join } from 'path'
import { simpleGit } from 'simple-git'

import { createTempGitRepo, type TempGitRepo } from '../tempGitRepo'
import { submoduleWithHistoryScenario } from './submodule-with-history'

describe('submodule-with-history scenario', () => {
  let repo: TempGitRepo

  beforeAll(async () => {
    repo = await createTempGitRepo()
    await submoduleWithHistoryScenario.setup(repo)
  }, 60_000)

  afterAll(async () => {
    await repo?.cleanup()
  })

  it('has 4 commits on parent main', async () => {
    const log = await repo.git.log(['main'])
    expect(log.total).toBe(4)
  })

  it('has main checked out on the parent', async () => {
    const status = await repo.git.status()
    expect(status.current).toBe('main')
  })

  it('records vendor/lib in .gitmodules with branch = main', () => {
    const body = readFileSync(join(repo.path, '.gitmodules'), 'utf8')
    expect(body).toMatch(/\[submodule "vendor\/lib"\]/)
    expect(body).toMatch(/path\s*=\s*vendor\/lib/)
    expect(body).toMatch(/branch\s*=\s*main/)
  })

  it('reports vendor/lib as a clean submodule (leading space in status)', async () => {
    const out = await repo.git.raw(['submodule', 'status'])
    // Format: " <sha> vendor/lib (refs/...)" — leading space = clean.
    expect(out).toMatch(/^ [0-9a-f]{7,40}\s+vendor\/lib/m)
  })

  it('vendor/lib has 4 commits of its own', async () => {
    const subGit = simpleGit(join(repo.path, 'vendor/lib'))
    const log = await subGit.log()
    expect(log.total).toBe(4)
  })

  it('vendor/lib HEAD matches the pin recorded in the parent', async () => {
    const out = await repo.git.raw(['submodule', 'status'])
    const match = out.match(/^[ +\-U]([0-9a-f]{40})\s+vendor\/lib/m)
    expect(match).not.toBeNull()
    const pinned = match![1]
    const subGit = simpleGit(join(repo.path, 'vendor/lib'))
    const head = (await subGit.revparse(['HEAD'])).trim()
    expect(head).toBe(pinned)
  })

  it('preserves the expected commit subjects on the parent in order', async () => {
    const log = await repo.git.log()
    const subjects = log.all.map((entry) => entry.message.split('\n')[0])
    expect(subjects).toEqual([
      'feat: integrate vendor/lib into entry point',
      'chore: add vendor/lib submodule',
      'feat: app shell',
      'chore: initial scaffold',
    ])
  })

  it('preserves the expected commit subjects on the submodule in order', async () => {
    const subGit = simpleGit(join(repo.path, 'vendor/lib'))
    const log = await subGit.log()
    const subjects = log.all.map((entry) => entry.message.split('\n')[0])
    expect(subjects).toEqual([
      'test: add coverage',
      'feat: add main API',
      'feat: add core types',
      'chore: initial scaffold',
    ])
  })

  it('has a clean parent worktree', async () => {
    const status = await repo.git.status()
    expect(status.isClean()).toBe(true)
  })
})
