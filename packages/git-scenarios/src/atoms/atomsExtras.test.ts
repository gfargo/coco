import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTempGitRepo, type TempGitRepo } from '../tempGitRepo'
import {
  abortCherryPick,
  addCommit,
  addRemote,
  addWorktree,
  applyStash,
  bisectStep,
  chain,
  checkoutBranch,
  cherryPick,
  daysAgo,
  deleteBranch,
  deleteTag,
  pinSubmodule,
  removeRemote,
  removeWorktree,
  resetBisect,
  revert,
  setConfig,
  startMerge,
  switchToBranch,
  withAuthor,
} from './'

async function withRepo(callback: (repo: TempGitRepo) => Promise<void>): Promise<void> {
  const repo = await createTempGitRepo()
  try {
    await callback(repo)
  } finally {
    await repo.cleanup()
  }
}

async function seedMain(repo: TempGitRepo): Promise<void> {
  await addCommit({ message: 'init', files: { 'README.md': '# repo\n' } })(repo)
}

describe('cherryPick', () => {
  it('cherry-picks a commit from another branch', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await switchToBranch('feat/source')(repo)
      await addCommit({ message: 'pickable', files: { 'src/feature.ts': 'x\n' } })(repo)
      await checkoutBranch('main')(repo)
      const beforeLog = await repo.git.log()
      expect(beforeLog.total).toBe(1)

      await cherryPick('feat/source')(repo)

      const afterLog = await repo.git.log()
      expect(afterLog.total).toBe(2)
      expect(afterLog.latest?.message).toBe('pickable')
      expect(existsSync(join(repo.path, 'src/feature.ts'))).toBe(true)
    })
  })

  it('leaves repo mid-cherry-pick on conflict (default allowConflict)', async () => {
    await withRepo(async (repo) => {
      await addCommit({ message: 'base', files: { 'x.ts': 'base\n' } })(repo)
      await switchToBranch('feat/source')(repo)
      await addCommit({ message: 'pickable', files: { 'x.ts': 'source\n' } })(repo)
      await checkoutBranch('main')(repo)
      await addCommit({ message: 'main change', files: { 'x.ts': 'mainchange\n' } })(repo)

      await cherryPick('feat/source')(repo)

      const status = await repo.git.status()
      expect(status.conflicted).toContain('x.ts')
      expect(existsSync(join(repo.path, '.git/CHERRY_PICK_HEAD'))).toBe(true)
    })
  })

  it('rethrows on conflict when allowConflict: false', async () => {
    await withRepo(async (repo) => {
      await addCommit({ message: 'base', files: { 'x.ts': 'base\n' } })(repo)
      await switchToBranch('feat/source')(repo)
      await addCommit({ message: 'pickable', files: { 'x.ts': 'source\n' } })(repo)
      await checkoutBranch('main')(repo)
      await addCommit({ message: 'main change', files: { 'x.ts': 'mainchange\n' } })(repo)

      await expect(
        cherryPick('feat/source', { allowConflict: false })(repo),
      ).rejects.toThrow()
    })
  })

  it('abortCherryPick restores pre-pick state', async () => {
    await withRepo(async (repo) => {
      await addCommit({ message: 'base', files: { 'x.ts': 'base\n' } })(repo)
      await switchToBranch('feat/source')(repo)
      await addCommit({ message: 'pickable', files: { 'x.ts': 'source\n' } })(repo)
      await checkoutBranch('main')(repo)
      await addCommit({ message: 'main change', files: { 'x.ts': 'mainchange\n' } })(repo)
      await cherryPick('feat/source')(repo)
      expect(existsSync(join(repo.path, '.git/CHERRY_PICK_HEAD'))).toBe(true)

      await abortCherryPick()(repo)

      expect(existsSync(join(repo.path, '.git/CHERRY_PICK_HEAD'))).toBe(false)
      const status = await repo.git.status()
      expect(status.isClean()).toBe(true)
    })
  })
})

describe('revert', () => {
  it('reverts a commit by producing an inverse commit', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await addCommit({ message: 'add foo', files: { 'foo.ts': 'foo\n' } })(repo)
      expect(existsSync(join(repo.path, 'foo.ts'))).toBe(true)

      await revert('HEAD')(repo)

      expect(existsSync(join(repo.path, 'foo.ts'))).toBe(false)
      const log = await repo.git.log()
      expect(log.total).toBe(3) // init + add foo + Revert "add foo"
      expect(log.latest?.message).toMatch(/Revert "add foo"/)
    })
  })

  it('reverts a merge commit with mainline option', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await switchToBranch('feat/branch')(repo)
      await addCommit({ message: 'feat: on branch', files: { 'feat.ts': 'feat\n' } })(repo)
      await checkoutBranch('main')(repo)
      await startMerge('feat/branch', { noFastForward: true })(repo)

      // Now revert the merge. mainline:1 = revert against main.
      await revert('HEAD', { mainline: 1 })(repo)

      // The merged file should be gone.
      expect(existsSync(join(repo.path, 'feat.ts'))).toBe(false)
    })
  })
})

describe('withAuthor', () => {
  it('attributes commits to the named author / email', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await withAuthor(
        { name: 'Alice', email: 'alice@example.com' },
        addCommit({ message: 'feat: by alice', files: { 'a.ts': 'a' } }),
      )(repo)
      const log = await repo.git.log()
      expect(log.latest?.author_name).toBe('Alice')
      expect(log.latest?.author_email).toBe('alice@example.com')
    })
  })

  it('does not affect commits outside the scope', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await withAuthor(
        { name: 'Alice', email: 'alice@x' },
        addCommit({ message: 'feat: alice', files: { 'a.ts': 'a' } }),
      )(repo)
      // After the scope, normal commits go back to the default identity.
      await addCommit({ message: 'feat: default', files: { 'b.ts': 'b' } })(repo)

      const log = await repo.git.log()
      expect(log.all[0].author_name).toBe('Coco Test') // most recent
      expect(log.all[1].author_name).toBe('Alice')
    })
  })

  it('composes multiple authors in sequence', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await chain(
        withAuthor(
          { name: 'Alice', email: 'alice@x' },
          addCommit({ message: 'feat: a', files: { 'a.ts': 'a' } }),
        ),
        withAuthor(
          { name: 'Bob', email: 'bob@x' },
          addCommit({ message: 'fix: b', files: { 'b.ts': 'b' } }),
        ),
        withAuthor(
          { name: 'Carol', email: 'carol@x' },
          addCommit({ message: 'docs: c', files: { 'c.ts': 'c' } }),
        ),
      )(repo)

      const log = await repo.git.log()
      const authors = log.all.map((entry) => entry.author_name)
      // Newest-first.
      expect(authors[0]).toBe('Carol')
      expect(authors[1]).toBe('Bob')
      expect(authors[2]).toBe('Alice')
      expect(authors[3]).toBe('Coco Test') // init
    })
  })

  it('pins date when passed in identity', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      const date = daysAgo(15)
      await withAuthor(
        { name: 'Alice', email: 'alice@x', date },
        addCommit({ message: 'feat: dated', files: { 'a.ts': 'a' } }),
      )(repo)
      const log = await repo.git.log()
      // Author date roundtripped via simple-git log includes date in the entry.
      expect(log.latest?.author_name).toBe('Alice')
      // We can't easily compare ISO strings, but the date stamp shouldn't be today.
      const today = new Date().toISOString().slice(0, 10)
      expect(log.latest?.date).not.toContain(today)
    })
  })
})

describe('addWorktree / removeWorktree', () => {
  let scratchParent: string
  beforeEach(() => {
    scratchParent = mkdtempSync(join(tmpdir(), 'coco-scenarios-wt-'))
  })
  afterEach(() => {
    rmSync(scratchParent, { recursive: true, force: true })
  })

  it('addWorktree with branch creates a new branch + linked worktree', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      const wtPath = join(scratchParent, 'wt-feat-x')
      await addWorktree(wtPath, { branch: 'feat/x' })(repo)
      expect(existsSync(join(wtPath, 'README.md'))).toBe(true)
      const list = await repo.git.raw(['worktree', 'list'])
      expect(list).toContain('feat/x')
    })
  })

  it('addWorktree with checkout uses an existing ref', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await switchToBranch('feat/preexisting')(repo)
      await addCommit({ message: 'feat: a', files: { 'a.ts': 'a' } })(repo)
      await checkoutBranch('main')(repo)

      const wtPath = join(scratchParent, 'wt-pre')
      await addWorktree(wtPath, { checkout: 'feat/preexisting' })(repo)
      expect(existsSync(join(wtPath, 'a.ts'))).toBe(true)
    })
  })

  it('addWorktree with detach yields a detached HEAD worktree', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await addCommit({ message: 'second', files: { 's.ts': 's' } })(repo)
      const wtPath = join(scratchParent, 'wt-detached')
      await addWorktree(wtPath, { checkout: 'HEAD~1', detach: true })(repo)
      expect(existsSync(join(wtPath, 'README.md'))).toBe(true)
      expect(existsSync(join(wtPath, 's.ts'))).toBe(false) // older commit
    })
  })

  it('addWorktree throws when both branch and checkout are passed', async () => {
    expect(() =>
      addWorktree('/tmp/x', { branch: 'a', checkout: 'b' }),
    ).toThrow(/cannot pass both/)
  })

  it('removeWorktree drops a linked worktree', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      const wtPath = join(scratchParent, 'wt-feat')
      await addWorktree(wtPath, { branch: 'feat/x' })(repo)
      expect(existsSync(wtPath)).toBe(true)

      await removeWorktree(wtPath)(repo)

      expect(existsSync(wtPath)).toBe(false)
    })
  })
})

describe('setConfig', () => {
  it('sets a local git config value', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await setConfig('commit.template', '.gitmessage')(repo)
      const value = (await repo.git.raw(['config', 'commit.template'])).trim()
      expect(value).toBe('.gitmessage')
    })
  })

  it('unsets a key when unset: true', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await setConfig('coco.test', 'foo')(repo)
      const before = await repo.git.raw(['config', '--list', '--local'])
      expect(before).toContain('coco.test=foo')

      await setConfig('coco.test', '', { unset: true })(repo)

      const after = await repo.git.raw(['config', '--list', '--local'])
      expect(after).not.toContain('coco.test')
    })
  })
})

describe('error paths', () => {
  it('deleteBranch rejects for a non-existent branch', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await expect(deleteBranch('does-not-exist')(repo)).rejects.toThrow()
    })
  })

  it('deleteTag rejects for a non-existent tag', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await expect(deleteTag('does-not-exist')(repo)).rejects.toThrow()
    })
  })

  it('removeRemote rejects for an unknown remote', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await expect(removeRemote('nope')(repo)).rejects.toThrow()
    })
  })

  it('startMerge of a non-existent branch rethrows (not a conflict)', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await expect(startMerge('feat/never-existed')(repo)).rejects.toThrow()
    })
  })

  it('cherryPick of a non-existent sha rethrows', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await expect(cherryPick('not-a-real-sha')(repo)).rejects.toThrow()
    })
  })

  it('revert of a non-existent sha rethrows', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await expect(revert('not-a-real-sha')(repo)).rejects.toThrow()
    })
  })

  it('applyStash of a non-existent ref rejects', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await expect(applyStash({ ref: 'stash@{99}' })(repo)).rejects.toThrow()
    })
  })

  it('bisectStep outside an active bisect rejects', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await expect(bisectStep('good')(repo)).rejects.toThrow()
    })
  })

  it('resetBisect outside an active bisect is a no-op (does not throw)', async () => {
    // git bisect reset is idempotent — exits 0 even if no bisect is running.
    await withRepo(async (repo) => {
      await seedMain(repo)
      await expect(resetBisect()(repo)).resolves.not.toThrow()
    })
  })

  it('pinSubmodule rejects for a non-existent submodule path', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await expect(
        pinSubmodule('vendor/does-not-exist', 'abcdef')(repo),
      ).rejects.toThrow()
    })
  })

  it('addRemote with a name that already exists rejects', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await addRemote('origin', 'git@example.com:a.git')(repo)
      await expect(
        addRemote('origin', 'git@example.com:b.git')(repo),
      ).rejects.toThrow()
    })
  })
})

describe('composition (real-world scenarios)', () => {
  it('multi-contributor history reads correctly', async () => {
    await withRepo(async (repo) => {
      await chain(
        addCommit({ message: 'init', files: { 'README.md': '# repo' } }),
        withAuthor(
          { name: 'Alice', email: 'alice@org' },
          chain(
            addCommit({ message: 'feat: alice 1', files: { 'a1.ts': 'x' } }),
            addCommit({ message: 'feat: alice 2', files: { 'a2.ts': 'x' } }),
          ),
        ),
        withAuthor(
          { name: 'Bob', email: 'bob@org' },
          addCommit({ message: 'fix: bob 1', files: { 'b1.ts': 'x' } }),
        ),
      )(repo)
      const log = await repo.git.log()
      expect(log.total).toBe(4)
      const authors = log.all.map((entry) => entry.author_name)
      // Newest-first.
      expect(authors).toEqual(['Bob', 'Alice', 'Alice', 'Coco Test'])
    })
  })

  it('cherry-pick + revert dance lands clean', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await switchToBranch('feat/source')(repo)
      await addCommit({ message: 'feat: cherry me', files: { 'feature.ts': 'x' } })(repo)
      const sourceSha = (await repo.git.revparse(['HEAD'])).trim()
      await checkoutBranch('main')(repo)

      await chain(
        cherryPick(sourceSha),
        addCommit({ message: 'feat: post-cherry work', files: { 'b.ts': 'b' } }),
        revert('HEAD~1'), // revert the cherry-pick
      )(repo)

      const log = await repo.git.log()
      expect(log.total).toBe(4) // init + cherry + post + revert
      expect(log.latest?.message).toMatch(/Revert/)
      // feature.ts came back via cherry, then went away via revert
      expect(existsSync(join(repo.path, 'feature.ts'))).toBe(false)
      expect(existsSync(join(repo.path, 'b.ts'))).toBe(true)
    })
  })
})
