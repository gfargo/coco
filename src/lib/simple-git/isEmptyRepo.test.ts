import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { isEmptyRepo } from './isEmptyRepo'

async function makeFreshRepo(): Promise<{ git: SimpleGit; path: string }> {
  const path = await mkdtemp(join(tmpdir(), 'coco-empty-repo-test-'))
  const git = simpleGit(path)
  await git.init()
  await git.addConfig('user.name', 'Coco Test')
  await git.addConfig('user.email', 'coco@example.com')
  await git.addConfig('commit.gpgsign', 'false')
  await git.raw(['checkout', '-b', 'main'])
  return { git, path }
}

describe('isEmptyRepo', () => {
  describe('returns true', () => {
    it('on a freshly-initialized repo with no commits', async () => {
      const { git, path } = await makeFreshRepo()
      try {
        await expect(isEmptyRepo(git)).resolves.toBe(true)
      } finally {
        await rm(path, { recursive: true, force: true })
      }
    })

    it('even when there are untracked / staged files but no commits', async () => {
      const { git, path } = await makeFreshRepo()
      try {
        await writeFile(join(path, 'staged.txt'), 'staged content')
        await git.add('staged.txt')
        await writeFile(join(path, 'untracked.txt'), 'untracked content')
        // Files exist but HEAD is still unborn — isEmptyRepo cares
        // about commits, not working-tree state.
        await expect(isEmptyRepo(git)).resolves.toBe(true)
      } finally {
        await rm(path, { recursive: true, force: true })
      }
    })
  })

  describe('returns false', () => {
    it('once the repo has at least one commit', async () => {
      const { git, path } = await makeFreshRepo()
      try {
        await writeFile(join(path, 'README.md'), '# repo\n')
        await git.add('README.md')
        await git.commit('chore: initial')
        await expect(isEmptyRepo(git)).resolves.toBe(false)
      } finally {
        await rm(path, { recursive: true, force: true })
      }
    })
  })
})
