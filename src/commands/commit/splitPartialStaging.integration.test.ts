/**
 * #2129 — a file that is staged AND edited again on disk (`AM` / `MM`)
 * used to make `applyCommitSplitPlan` refuse ("also have unstaged or
 * untracked changes"). The apply path now commits the STAGED content and
 * leaves the disk edits unstaged. Real repo, real `git`.
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { getChanges } from '../../lib/simple-git/getChanges'
import { Logger } from '../../lib/utils/logger'
import { applyCommitSplitPlan, type CommitSplitPlan } from './split'

const emptyHunkInventory = { hunks: [], byId: new Map(), byFile: new Map() } as never

describe('applyCommitSplitPlan with partially staged files (#2129)', () => {
  let dir: string
  let git: SimpleGit

  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  const write = (name: string, content: string) => writeFileSync(join(dir, name), content)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coco-split-partial-'))
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 't@example.com')
    run('config', 'user.name', 't')
    write('base.txt', 'base\n')
    run('add', '.')
    run('commit', '-q', '-m', 'init')
    git = simpleGit(dir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  async function apply(plan: CommitSplitPlan, noVerify = true) {
    const changes = await getChanges({ git })
    return applyCommitSplitPlan({
      plan,
      changes,
      hunkInventory: emptyHunkInventory,
      git,
      logger: new Logger({ silent: true }),
      noVerify,
    })
  }

  it('commits the staged content of a new file edited again on disk (AM)', async () => {
    write('new.txt', 'staged v1\n')
    write('other.txt', 'other\n')
    run('add', 'new.txt', 'other.txt')
    write('new.txt', 'staged v1\nunstaged v2\n')

    const result = await apply({
      groups: [
        { title: 'feat: add new', body: '', files: ['new.txt'] },
        { title: 'feat: add other', body: '', files: ['other.txt'] },
      ],
    } as CommitSplitPlan)

    expect(result.commitHashes).toHaveLength(2)
    expect(run('show', 'HEAD~1:new.txt')).toBe('staged v1\n')
    // The disk edit survives, unstaged, and was not committed.
    expect(readFileSync(join(dir, 'new.txt'), 'utf8')).toBe('staged v1\nunstaged v2\n')
    expect(run('status', '--porcelain')).toBe(' M new.txt\n')
  })

  it('commits only the staged hunk of a modified file with further disk edits (MM)', async () => {
    write('base.txt', 'base\nstaged line\n')
    run('add', 'base.txt')
    write('base.txt', 'base\nstaged line\nunstaged line\n')

    const result = await apply({
      groups: [{ title: 'fix: base', body: '', files: ['base.txt'] }],
    } as CommitSplitPlan)

    expect(result.commitHashes).toHaveLength(1)
    expect(run('show', 'HEAD:base.txt')).toBe('base\nstaged line\n')
    expect(run('status', '--porcelain')).toBe(' M base.txt\n')
  })

  it('re-stages a partially staged file from a failed group without sweeping in disk edits', async () => {
    write('new.txt', 'staged v1\n')
    write('other.txt', 'other\n')
    run('add', 'new.txt', 'other.txt')
    write('new.txt', 'staged v1\nunstaged v2\n')
    // A pre-commit hook that rejects any commit touching new.txt.
    writeFileSync(
      join(dir, '.git', 'hooks', 'pre-commit'),
      '#!/bin/sh\ngit diff --cached --name-only | grep -q new.txt && exit 1\nexit 0\n',
      { mode: 0o755 }
    )

    const result = await apply(
      {
        groups: [
          { title: 'feat: add new', body: '', files: ['new.txt'] },
          { title: 'feat: add other', body: '', files: ['other.txt'] },
        ],
      } as CommitSplitPlan,
      false
    )

    expect(result.commitHashes).toHaveLength(1)
    // new.txt is back in the index with its STAGED content; the disk edit
    // is still unstaged rather than swept in by a whole-file `git add`.
    expect(run('status', '--porcelain')).toBe('AM new.txt\n')
    expect(run('show', ':new.txt')).toBe('staged v1\n')
  })
})
