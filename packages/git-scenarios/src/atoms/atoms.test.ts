import { readFileSync } from 'fs'
import { join } from 'path'
import { createTempGitRepo, type TempGitRepo } from '../tempGitRepo'
import {
  addCommit,
  chain,
  checkoutBranch,
  commit,
  repeat,
  seededFiles,
  stageFiles,
  switchToBranch,
  writeFiles,
  type Step,
} from './'

async function withRepo(callback: (repo: TempGitRepo) => Promise<void>): Promise<void> {
  const repo = await createTempGitRepo()
  try {
    await callback(repo)
  } finally {
    await repo.cleanup()
  }
}

describe('chain', () => {
  it('runs steps in order, awaiting each', async () => {
    await withRepo(async (repo) => {
      const order: string[] = []
      const step = (label: string): Step => async () => {
        await new Promise((r) => setTimeout(r, 5))
        order.push(label)
      }
      await chain(step('a'), step('b'), step('c'))(repo)
      expect(order).toEqual(['a', 'b', 'c'])
    })
  })

  it('is a no-op with no steps', async () => {
    await withRepo(async (repo) => {
      await chain()(repo)
      // No commits, no files — just confirm no throw.
      const status = await repo.git.status()
      expect(status.isClean()).toBe(true)
    })
  })

  it('short-circuits on rejection', async () => {
    await withRepo(async (repo) => {
      const order: string[] = []
      const ok = (l: string): Step => async () => {
        order.push(l)
      }
      const fail: Step = async () => {
        throw new Error('boom')
      }
      await expect(chain(ok('a'), fail, ok('c'))(repo)).rejects.toThrow('boom')
      expect(order).toEqual(['a'])
    })
  })
})

describe('repeat', () => {
  it('runs the factory N times with monotonic index', async () => {
    await withRepo(async (repo) => {
      const indices: number[] = []
      const step: (i: number) => Step = (i) => async () => {
        indices.push(i)
      }
      await repeat(4, step)(repo)
      expect(indices).toEqual([0, 1, 2, 3])
    })
  })

  it('with n=0 is a no-op', async () => {
    await withRepo(async (repo) => {
      let called = 0
      await repeat(0, () => async () => {
        called += 1
      })(repo)
      expect(called).toBe(0)
    })
  })
})

describe('writeFiles', () => {
  it('writes literal content at the given paths', async () => {
    await withRepo(async (repo) => {
      await writeFiles({
        'README.md': '# hello\n',
        'src/index.ts': 'export const x = 1\n',
      })(repo)
      expect(readFileSync(join(repo.path, 'README.md'), 'utf8')).toBe('# hello\n')
      expect(readFileSync(join(repo.path, 'src/index.ts'), 'utf8')).toBe('export const x = 1\n')
    })
  })

  it('creates parent directories as needed', async () => {
    await withRepo(async (repo) => {
      await writeFiles({ 'a/b/c/d.txt': 'deep' })(repo)
      expect(readFileSync(join(repo.path, 'a/b/c/d.txt'), 'utf8')).toBe('deep')
    })
  })

  it('does not stage what it wrote', async () => {
    await withRepo(async (repo) => {
      await writeFiles({ 'foo.ts': 'x' })(repo)
      const status = await repo.git.status()
      expect(status.not_added).toContain('foo.ts')
      expect(status.staged).toEqual([])
    })
  })
})

describe('stageFiles + commit', () => {
  it('stages everything when called with no args', async () => {
    await withRepo(async (repo) => {
      await writeFiles({ 'a.ts': 'a', 'b.ts': 'b' })(repo)
      await stageFiles()(repo)
      const status = await repo.git.status()
      expect(status.staged.sort()).toEqual(['a.ts', 'b.ts'])
    })
  })

  it('stages only the named paths when given paths', async () => {
    await withRepo(async (repo) => {
      await writeFiles({ 'a.ts': 'a', 'b.ts': 'b' })(repo)
      await stageFiles('a.ts')(repo)
      const status = await repo.git.status()
      expect(status.staged).toContain('a.ts')
      expect(status.not_added).toContain('b.ts')
    })
  })

  it('commit() commits only what is currently staged', async () => {
    await withRepo(async (repo) => {
      await chain(
        writeFiles({ 'a.ts': 'a', 'b.ts': 'b' }),
        stageFiles('a.ts'),
        commit('feat: add a'),
      )(repo)
      const log = await repo.git.log()
      expect(log.latest?.message).toBe('feat: add a')
      const status = await repo.git.status()
      // b.ts wasn't staged, so it stays in the worktree post-commit.
      expect(status.not_added).toContain('b.ts')
    })
  })
})

describe('addCommit', () => {
  it('writes files, stages everything, and commits in one shot', async () => {
    await withRepo(async (repo) => {
      await addCommit({
        message: 'chore: init',
        files: { 'README.md': '# repo\n' },
      })(repo)
      const log = await repo.git.log()
      expect(log.latest?.message).toBe('chore: init')
      expect(readFileSync(join(repo.path, 'README.md'), 'utf8')).toBe('# repo\n')
    })
  })

  it('commits previously-written-but-unstaged files when called without files', async () => {
    await withRepo(async (repo) => {
      await chain(
        writeFiles({ 'a.ts': '…', 'b.ts': '…' }),
        addCommit({ message: 'feat: both' }),
      )(repo)
      const log = await repo.git.log()
      expect(log.latest?.message).toBe('feat: both')
      const status = await repo.git.status()
      expect(status.isClean()).toBe(true)
    })
  })

  it('also pulls already-staged files into the commit (commitAll semantics)', async () => {
    await withRepo(async (repo) => {
      // Staged via stageFiles + a fresh write that addCommit will also stage.
      await chain(
        writeFiles({ 'a.ts': '…' }),
        stageFiles('a.ts'),
        writeFiles({ 'b.ts': '…' }),
        addCommit({ message: 'feat: both' }),
      )(repo)
      const log = await repo.git.log()
      expect(log.total).toBe(1)
      const status = await repo.git.status()
      expect(status.isClean()).toBe(true)
    })
  })

  it('handles an empty files map by behaving like commit(message)', async () => {
    await withRepo(async (repo) => {
      await chain(
        writeFiles({ 'a.ts': '…' }),
        addCommit({ message: 'feat: a', files: {} }),
      )(repo)
      const log = await repo.git.log()
      expect(log.latest?.message).toBe('feat: a')
    })
  })
})

describe('switchToBranch + checkoutBranch', () => {
  async function seedMain(repo: TempGitRepo): Promise<void> {
    await addCommit({ message: 'init', files: { 'README.md': '# repo' } })(repo)
  }

  it('creates and checks out a new branch from current HEAD', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await switchToBranch('feat/x')(repo)
      const status = await repo.git.status()
      expect(status.current).toBe('feat/x')
    })
  })

  it('with `from` branches off the named ref', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await switchToBranch('feat/x')(repo)
      await addCommit({ message: 'on-x', files: { 'x.ts': 'x' } })(repo)
      // Now create feat/y from main (not from the current branch feat/x).
      await switchToBranch('feat/y', { from: 'main' })(repo)
      const log = await repo.git.log()
      // feat/y points at main's HEAD, which has only the init commit.
      expect(log.total).toBe(1)
      expect(log.latest?.message).toBe('init')
    })
  })

  it('checkoutBranch switches to an existing branch without creating', async () => {
    await withRepo(async (repo) => {
      await seedMain(repo)
      await switchToBranch('feat/x')(repo)
      await checkoutBranch('main')(repo)
      const status = await repo.git.status()
      expect(status.current).toBe('main')
    })
  })
})

describe('seededFiles', () => {
  it('produces byte-identical content across runs with the same seed', async () => {
    await withRepo(async (repo) => {
      await seededFiles({
        files: [{ path: 'src/a.ts', tokens: 50 }],
        seed: 0xabc,
      })(repo)
      const first = readFileSync(join(repo.path, 'src/a.ts'), 'utf8')

      // Re-run in a fresh repo with the same args.
      await withRepo(async (repo2) => {
        await seededFiles({
          files: [{ path: 'src/a.ts', tokens: 50 }],
          seed: 0xabc,
        })(repo2)
        const second = readFileSync(join(repo2.path, 'src/a.ts'), 'utf8')
        expect(second).toBe(first)
      })
    })
  })

  it('different seeds produce different content for the same path', async () => {
    await withRepo(async (repo) => {
      await seededFiles({ files: [{ path: 'src/a.ts', tokens: 50 }], seed: 1 })(repo)
      const a1 = readFileSync(join(repo.path, 'src/a.ts'), 'utf8')

      await withRepo(async (repo2) => {
        await seededFiles({ files: [{ path: 'src/a.ts', tokens: 50 }], seed: 2 })(repo2)
        const a2 = readFileSync(join(repo2.path, 'src/a.ts'), 'utf8')
        expect(a2).not.toBe(a1)
      })
    })
  })

  it('does not stage what it wrote', async () => {
    await withRepo(async (repo) => {
      await seededFiles({ files: [{ path: 'src/a.ts', tokens: 30 }], seed: 0 })(repo)
      const status = await repo.git.status()
      expect(status.not_added).toContain('src/a.ts')
    })
  })
})

describe('composition (end-to-end)', () => {
  it('composes a small feature-branch scenario from atoms', async () => {
    await withRepo(async (repo) => {
      await chain(
        addCommit({
          message: 'chore: initial commit',
          files: { 'README.md': '# repo' },
        }),
        seededFiles({ files: [{ path: 'src/index.ts', tokens: 40 }], seed: 1 }),
        addCommit({ message: 'feat: scaffold' }),
        switchToBranch('feat/x'),
        seededFiles({ files: [{ path: 'src/feature.ts', tokens: 50 }], seed: 2 }),
        addCommit({ message: 'feat: add feature' }),
      )(repo)

      const status = await repo.git.status()
      expect(status.current).toBe('feat/x')
      expect(status.isClean()).toBe(true)

      const ahead = await repo.git.raw(['rev-list', '--count', 'main..feat/x'])
      expect(parseInt(ahead.trim(), 10)).toBe(1)

      const log = await repo.git.log()
      expect(log.total).toBe(3)
    })
  })

  it('repeat() generates N commits with monotonic indices', async () => {
    await withRepo(async (repo) => {
      await chain(
        addCommit({ message: 'init', files: { 'README.md': '#' } }),
        repeat(5, (i) =>
          chain(
            seededFiles({
              files: [{ path: `src/file-${i}.ts`, tokens: 30 }],
              seed: 100 + i,
            }),
            addCommit({ message: `feat: commit ${i + 1}` }),
          ),
        ),
      )(repo)
      const log = await repo.git.log()
      expect(log.total).toBe(6)
      const subjects = log.all.map((entry) => entry.message.split('\n')[0])
      expect(subjects[0]).toBe('feat: commit 5')
      expect(subjects[4]).toBe('feat: commit 1')
      expect(subjects[5]).toBe('init')
    })
  })
})
