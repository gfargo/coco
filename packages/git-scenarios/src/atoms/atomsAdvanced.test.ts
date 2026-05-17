import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createTempGitRepo, type TempGitRepo } from '../tempGitRepo'
import {
  abortMerge,
  addCommit,
  addRemote,
  addSubmodule,
  amendCommit,
  applyStash,
  bisectStep,
  chain,
  checkoutBranch,
  createBranch,
  createTag,
  defineScenario,
  deleteBranch,
  deleteTag,
  dropStash,
  emptyCommit,
  insideSubmodule,
  onBranch,
  pinSubmodule,
  popStash,
  removeRemote,
  renameRemote,
  resetBisect,
  resetTo,
  stashChanges,
  startBisect,
  startMerge,
  switchToBranch,
  writeFiles,
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

describe('defineScenario validation', () => {
  const validBase = {
    name: 'valid-scenario',
    summary: 'a valid scenario',
    description: 'a valid scenario for testing',
    kind: 'branch' as const,
    setup: async () => {},
  }

  it('accepts a valid scenario unchanged', () => {
    const scenario = defineScenario(validBase)
    expect(scenario.name).toBe('valid-scenario')
  })

  it('rejects non-kebab-case names', () => {
    expect(() =>
      defineScenario({ ...validBase, name: 'My_Scenario' }),
    ).toThrow(/kebab-case/)
    expect(() =>
      defineScenario({ ...validBase, name: 'has spaces' }),
    ).toThrow(/kebab-case/)
    expect(() =>
      defineScenario({ ...validBase, name: '-leading-dash' }),
    ).toThrow(/kebab-case/)
  })

  it('rejects unknown kinds', () => {
    expect(() =>
      // @ts-expect-error — intentional bad kind to verify validation.
      defineScenario({ ...validBase, kind: 'branche' }),
    ).toThrow(/kind must be one of/)
  })

  it('rejects empty summary / description', () => {
    expect(() => defineScenario({ ...validBase, summary: '' })).toThrow(/summary/)
    expect(() => defineScenario({ ...validBase, description: '   ' })).toThrow(/description/)
  })

  it('rejects empty contracts entries', () => {
    expect(() =>
      defineScenario({ ...validBase, contracts: ['valid', ''] }),
    ).toThrow(/contracts\[1\]/)
  })

  it('accepts all the built-in kinds', () => {
    const kinds = ['branch', 'worktree', 'operation', 'history', 'stash', 'submodule'] as const
    for (const kind of kinds) {
      expect(() => defineScenario({ ...validBase, kind })).not.toThrow()
    }
  })
})

describe('branch operations', () => {
  it('createBranch makes a branch without checking it out', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await createBranch('feat/x')(repo)
      const status = await repo.git.status()
      expect(status.current).toBe('main')
      const branches = await repo.git.branchLocal()
      expect(branches.all).toContain('feat/x')
    })
  })

  it('createBranch with `from` branches off a different ref', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await switchToBranch('feat/old')(repo)
      await addCommit({ message: 'on-old', files: { 'a.ts': 'a' } })(repo)
      await checkoutBranch('main')(repo)
      // feat/new branches from main (not feat/old)
      await createBranch('feat/new', { from: 'main' })(repo)
      const newLog = await repo.git.log(['feat/new'])
      expect(newLog.total).toBe(1)
    })
  })

  it('deleteBranch removes a merged branch', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await createBranch('feat/x')(repo)
      await deleteBranch('feat/x')(repo)
      const branches = await repo.git.branchLocal()
      expect(branches.all).not.toContain('feat/x')
    })
  })

  it('deleteBranch with force drops an unmerged branch', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await switchToBranch('feat/diverged')(repo)
      await addCommit({ message: 'unmerged', files: { 'a.ts': 'a' } })(repo)
      await checkoutBranch('main')(repo)
      await deleteBranch('feat/diverged', { force: true })(repo)
      const branches = await repo.git.branchLocal()
      expect(branches.all).not.toContain('feat/diverged')
    })
  })
})

describe('tags', () => {
  it('createTag without message produces a lightweight tag', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await createTag('v0.1.0')(repo)
      const tags = await repo.git.tags()
      expect(tags.all).toContain('v0.1.0')
    })
  })

  it('createTag with message produces an annotated tag', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await createTag('v1.0.0', { message: 'first release' })(repo)
      const tagOutput = await repo.git.raw(['cat-file', '-t', 'v1.0.0'])
      expect(tagOutput.trim()).toBe('tag') // annotated tags are 'tag' objects
    })
  })

  it('createTag with sha targets a specific commit', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      const firstSha = (await repo.git.revparse(['HEAD'])).trim()
      await addCommit({ message: 'second', files: { 'b.ts': 'b' } })(repo)
      await createTag('v0', { sha: firstSha })(repo)
      const taggedSha = (await repo.git.revparse(['v0'])).trim()
      expect(taggedSha).toBe(firstSha)
    })
  })

  it('deleteTag removes a tag', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await createTag('v1.0.0')(repo)
      await deleteTag('v1.0.0')(repo)
      const tags = await repo.git.tags()
      expect(tags.all).not.toContain('v1.0.0')
    })
  })
})

describe('remotes', () => {
  it('addRemote registers the URL under a name', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await addRemote('origin', 'git@github.com:org/repo.git')(repo)
      const remotes = await repo.git.getRemotes(true)
      const origin = remotes.find((r) => r.name === 'origin')
      expect(origin?.refs.push).toBe('git@github.com:org/repo.git')
    })
  })

  it('supports multiple remotes simultaneously', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await addRemote('origin', 'git@github.com:fork/repo.git')(repo)
      await addRemote('upstream', 'git@github.com:source/repo.git')(repo)
      const remotes = await repo.git.getRemotes()
      expect(remotes.map((r) => r.name).sort()).toEqual(['origin', 'upstream'])
    })
  })

  it('removeRemote drops the named remote', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await addRemote('origin', 'git@github.com:org/repo.git')(repo)
      await removeRemote('origin')(repo)
      const remotes = await repo.git.getRemotes()
      expect(remotes.length).toBe(0)
    })
  })

  it('renameRemote changes the remote name without changing the URL', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await addRemote('origin', 'git@github.com:org/repo.git')(repo)
      await renameRemote('origin', 'upstream')(repo)
      const remotes = await repo.git.getRemotes(true)
      const upstream = remotes.find((r) => r.name === 'upstream')
      expect(upstream?.refs.push).toBe('git@github.com:org/repo.git')
    })
  })
})

describe('stash', () => {
  it('stashChanges pushes worktree changes onto the stash', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await writeFiles({ 'src/foo.ts': 'foo' })(repo)
      await stashChanges({ message: 'wip', includeUntracked: true })(repo)
      const list = await repo.git.stashList()
      expect(list.total).toBe(1)
      expect(list.latest?.message).toMatch(/wip/)
      // Worktree is clean after stash.
      const status = await repo.git.status()
      expect(status.isClean()).toBe(true)
    })
  })

  it('applyStash restores worktree changes without dropping', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await writeFiles({ 'src/foo.ts': 'foo' })(repo)
      await stashChanges({ message: 'wip', includeUntracked: true })(repo)
      await applyStash()(repo)
      expect(existsSync(join(repo.path, 'src/foo.ts'))).toBe(true)
      const list = await repo.git.stashList()
      expect(list.total).toBe(1) // still there
    })
  })

  it('popStash applies and drops in one shot', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await writeFiles({ 'src/foo.ts': 'foo' })(repo)
      await stashChanges({ message: 'wip', includeUntracked: true })(repo)
      await popStash()(repo)
      const list = await repo.git.stashList()
      expect(list.total).toBe(0)
    })
  })

  it('dropStash removes without applying', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await writeFiles({ 'src/foo.ts': 'foo' })(repo)
      await stashChanges({ message: 'wip', includeUntracked: true })(repo)
      await dropStash()(repo)
      const list = await repo.git.stashList()
      expect(list.total).toBe(0)
      expect(existsSync(join(repo.path, 'src/foo.ts'))).toBe(false)
    })
  })

  it('multiple stashes stack in LIFO order with distinct messages', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await chain(
        writeFiles({ 'a.ts': 'a' }),
        stashChanges({ message: 'stash-a', includeUntracked: true }),
        writeFiles({ 'b.ts': 'b' }),
        stashChanges({ message: 'stash-b', includeUntracked: true }),
      )(repo)
      const list = await repo.git.stashList()
      expect(list.total).toBe(2)
      // Newest is at stash@{0}.
      expect(list.all[0].message).toMatch(/stash-b/)
      expect(list.all[1].message).toMatch(/stash-a/)
    })
  })
})

describe('merge operations', () => {
  it('startMerge of a clean ref produces a clean merge commit', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await switchToBranch('feat/clean')(repo)
      await addCommit({ message: 'theirs', files: { 'a.ts': 'a' } })(repo)
      await checkoutBranch('main')(repo)
      await startMerge('feat/clean')(repo)
      const log = await repo.git.log()
      expect(log.total).toBe(2)
      const status = await repo.git.status()
      expect(status.isClean()).toBe(true)
    })
  })

  it('startMerge swallows conflict and leaves the repo mid-merge by default', async () => {
    await withRepo(async (repo) => {
      await addCommit({ message: 'base', files: { 'x.ts': 'base\n' } })(repo)
      await switchToBranch('feat/theirs')(repo)
      await addCommit({ message: 'theirs', files: { 'x.ts': 'theirs\n' } })(repo)
      await checkoutBranch('main')(repo)
      await addCommit({ message: 'ours', files: { 'x.ts': 'ours\n' } })(repo)

      await startMerge('feat/theirs')(repo)

      const status = await repo.git.status()
      expect(status.conflicted).toContain('x.ts')
      // MERGE_HEAD exists during mid-merge.
      expect(existsSync(join(repo.path, '.git/MERGE_HEAD'))).toBe(true)
    })
  })

  it('startMerge with allowConflict: false rethrows on conflict', async () => {
    await withRepo(async (repo) => {
      await addCommit({ message: 'base', files: { 'x.ts': 'base\n' } })(repo)
      await switchToBranch('feat/theirs')(repo)
      await addCommit({ message: 'theirs', files: { 'x.ts': 'theirs\n' } })(repo)
      await checkoutBranch('main')(repo)
      await addCommit({ message: 'ours', files: { 'x.ts': 'ours\n' } })(repo)

      await expect(
        startMerge('feat/theirs', { allowConflict: false })(repo),
      ).rejects.toThrow()
    })
  })

  it('abortMerge restores pre-merge state', async () => {
    await withRepo(async (repo) => {
      await addCommit({ message: 'base', files: { 'x.ts': 'base\n' } })(repo)
      await switchToBranch('feat/theirs')(repo)
      await addCommit({ message: 'theirs', files: { 'x.ts': 'theirs\n' } })(repo)
      await checkoutBranch('main')(repo)
      await addCommit({ message: 'ours', files: { 'x.ts': 'ours\n' } })(repo)
      await startMerge('feat/theirs')(repo)
      expect(existsSync(join(repo.path, '.git/MERGE_HEAD'))).toBe(true)

      await abortMerge()(repo)

      expect(existsSync(join(repo.path, '.git/MERGE_HEAD'))).toBe(false)
      const status = await repo.git.status()
      expect(status.isClean()).toBe(true)
      expect(readFileSync(join(repo.path, 'x.ts'), 'utf8')).toBe('ours\n')
    })
  })
})

describe('bisect', () => {
  it('startBisect + bisectStep drive the search', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      for (let i = 0; i < 5; i++) {
        await emptyCommit(`commit ${i + 1}`)(repo)
      }
      // 6 commits total; first one is the seed.
      const tipBefore = (await repo.git.revparse(['HEAD'])).trim()
      const goodSha = (await repo.git.revparse(['HEAD~5'])).trim()

      await startBisect({ bad: tipBefore, good: goodSha })(repo)
      // After start, .git/BISECT_LOG exists.
      expect(existsSync(join(repo.path, '.git/BISECT_LOG'))).toBe(true)

      await bisectStep('good')(repo) // narrows further
      await resetBisect()(repo)
      expect(existsSync(join(repo.path, '.git/BISECT_LOG'))).toBe(false)
    })
  })
})

describe('resetTo / emptyCommit / amendCommit', () => {
  it('resetTo hard drops the last commit and worktree changes', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await addCommit({ message: 'to be dropped', files: { 'x.ts': 'x' } })(repo)
      await resetTo({ target: 'HEAD~1', mode: 'hard' })(repo)
      const log = await repo.git.log()
      expect(log.total).toBe(1)
      expect(existsSync(join(repo.path, 'x.ts'))).toBe(false)
    })
  })

  it('resetTo soft leaves changes staged', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await addCommit({ message: 'to soften', files: { 'x.ts': 'x' } })(repo)
      await resetTo({ target: 'HEAD~1', mode: 'soft' })(repo)
      const log = await repo.git.log()
      expect(log.total).toBe(1)
      const status = await repo.git.status()
      expect(status.staged).toContain('x.ts')
    })
  })

  it('emptyCommit produces a commit with no diff', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await emptyCommit('chore: bump')(repo)
      const log = await repo.git.log()
      expect(log.total).toBe(2)
      expect(log.latest?.message).toBe('chore: bump')
    })
  })

  it('amendCommit folds new content into the last commit', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      // `--all` only stages modified-tracked files, not untracked ones,
      // so for a new file we stage explicitly before amending.
      await chain(
        writeFiles({ 'src/foo.ts': 'foo' }),
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        async (r) => {
          await r.git.add('src/foo.ts')
        },
        amendCommit(),
      )(repo)
      const log = await repo.git.log()
      expect(log.total).toBe(1) // still one commit
      // The amended commit now contains README.md AND src/foo.ts.
      const tree = await repo.git.raw(['ls-tree', '-r', 'HEAD', '--name-only'])
      expect(tree).toContain('README.md')
      expect(tree).toContain('src/foo.ts')
    })
  })

  it('amendCommit with message rewrites the subject', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await amendCommit({ message: 'rewritten init' })(repo)
      const log = await repo.git.log()
      expect(log.latest?.message).toBe('rewritten init')
    })
  })
})

describe('onBranch scope', () => {
  it('runs the step on the named branch and restores the previous one', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await createBranch('feat/x')(repo)
      const beforeStatus = await repo.git.status()
      expect(beforeStatus.current).toBe('main')

      await onBranch(
        'feat/x',
        addCommit({ message: 'on feat/x', files: { 'a.ts': 'a' } }),
      )(repo)

      const afterStatus = await repo.git.status()
      expect(afterStatus.current).toBe('main')
      const featLog = await repo.git.log(['feat/x'])
      expect(featLog.latest?.message).toBe('on feat/x')
      const mainLog = await repo.git.log(['main'])
      expect(mainLog.latest?.message).toBe('init')
    })
  })

  it('restores the previous branch even if the step throws', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await createBranch('feat/x')(repo)
      await expect(
        onBranch('feat/x', async () => {
          throw new Error('boom')
        })(repo),
      ).rejects.toThrow('boom')
      const status = await repo.git.status()
      expect(status.current).toBe('main')
    })
  })
})

describe('addSubmodule + insideSubmodule + pinSubmodule', () => {
  it('addSubmodule clones the source repo at the parent path', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await addSubmodule({
        path: 'vendor/lib',
        branch: 'main',
        setup: chain(
          addCommit({ message: 'init lib', files: { 'README.md': '# lib' } }),
        ),
      })(repo)
      await addCommit({ message: 'chore: add submodule' })(repo)
      expect(existsSync(join(repo.path, 'vendor/lib/README.md'))).toBe(true)
      const gitmodules = readFileSync(join(repo.path, '.gitmodules'), 'utf8')
      expect(gitmodules).toMatch(/path = vendor\/lib/)
      expect(gitmodules).toMatch(/branch = main/)
    })
  })

  it('insideSubmodule runs atoms against the submodule working tree', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await addSubmodule({
        path: 'vendor/lib',
        branch: 'main',
        setup: chain(
          addCommit({ message: 'init lib', files: { 'README.md': '# lib' } }),
        ),
      })(repo)
      await addCommit({ message: 'chore: add submodule' })(repo)

      // Submodule starts with 1 commit. Add 2 more inside the
      // submodule WITHOUT updating the parent's pin.
      await insideSubmodule(
        'vendor/lib',
        chain(
          addCommit({ message: 'feat: post-pin A', files: { 'src/a.ts': 'a' } }),
          addCommit({ message: 'feat: post-pin B', files: { 'src/b.ts': 'b' } }),
        ),
      )(repo)

      // Submodule now has 3 commits.
      const subStatus = await repo.git.raw(['submodule', 'status'])
      // Parent's pin is the original (commit 1); submodule HEAD is now
      // at commit 3, so `git submodule status` shows the `+` modified
      // flag — exactly the "out of date submodule" shape.
      expect(subStatus).toMatch(/^\+/)
    })
  })

  it('pinSubmodule updates the parent record to a specific sha', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await addSubmodule({
        path: 'vendor/lib',
        branch: 'main',
        setup: chain(
          addCommit({ message: 'init lib', files: { 'README.md': '# lib' } }),
          addCommit({ message: 'feat: a', files: { 'a.ts': 'a' } }),
          addCommit({ message: 'feat: b', files: { 'b.ts': 'b' } }),
        ),
      })(repo)
      await addCommit({ message: 'chore: add submodule' })(repo)

      // Submodule HEAD is at the 3rd commit. Roll the pin back to the
      // first commit. Resolve the submodule's HEAD~2 via its own git.
      const subRepoPath = join(repo.path, 'vendor/lib')
      const { simpleGit } = await import('simple-git')
      const subGit = simpleGit(subRepoPath)
      const firstSha = (await subGit.revparse(['HEAD~2'])).trim()

      await pinSubmodule('vendor/lib', firstSha)(repo)
      await addCommit({ message: 'chore: roll back pin' })(repo)

      const status = await repo.git.raw(['submodule', 'status'])
      // After pin update + commit, submodule status is clean again
      // (parent's pin matches submodule HEAD = firstSha). `git
      // submodule status` prefixes each line with ` ` for clean,
      // `+` for modified, `-` for uninitialized. Don't trim before
      // the check — the leading space IS the signal.
      expect(status.startsWith(' ')).toBe(true)
    })
  }, 60_000)
})

describe('composition (advanced)', () => {
  it('multi-remote scenario assembles cleanly', async () => {
    await withRepo(async (repo) => {
      await chain(
        addCommit({ message: 'init', files: { 'README.md': '# repo' } }),
        addRemote('origin', 'git@github.com:fork/repo.git'),
        addRemote('upstream', 'git@github.com:source/repo.git'),
        addRemote('mirror', 'git@gitlab.com:mirror/repo.git'),
      )(repo)
      const remotes = await repo.git.getRemotes()
      expect(remotes.map((r) => r.name).sort()).toEqual(['mirror', 'origin', 'upstream'])
    })
  })

  it('mid-merge-conflict scenario composes from atoms', async () => {
    await withRepo(async (repo) => {
      await chain(
        addCommit({
          message: 'base',
          files: { 'src/widget.ts': 'export const widget = () => null\n' },
        }),
        switchToBranch('feat/theirs'),
        addCommit({
          message: 'theirs: add config option',
          files: { 'src/widget.ts': 'export const widget = (config) => null\n' },
        }),
        checkoutBranch('main'),
        addCommit({
          message: 'ours: make it async',
          files: { 'src/widget.ts': 'export const widget = async () => null\n' },
        }),
        startMerge('feat/theirs'),
      )(repo)
      const status = await repo.git.status()
      expect(status.conflicted).toContain('src/widget.ts')
    })
  })
})
