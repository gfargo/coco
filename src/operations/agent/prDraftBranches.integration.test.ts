/**
 * #1823 — reading the PR draft's head and base from a real repository.
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createAgentOperationContext, readPullRequestBranches } from './context'

jest.setTimeout(30_000)

describe('readPullRequestBranches', () => {
  let dir: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  const read = async () => readPullRequestBranches(await createAgentOperationContext({ repoRoot: dir }))

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coco-pr-draft-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@example.com')
    git('config', 'user.name', 't')
    git('commit', '-q', '--allow-empty', '-m', 'one')
    git('switch', '-q', '-c', 'feat/x')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reads the current branch and falls back to main', async () => {
    await expect(read()).resolves.toEqual({ head: 'feat/x', defaultBase: 'main', defaultBaseRef: 'main' })
  })

  it('uses origin/HEAD without the remote prefix', async () => {
    git('update-ref', 'refs/remotes/origin/trunk', 'HEAD')
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
    // The diff runs against the remote-tracking ref; the PR targets the name.
    await expect(read()).resolves.toEqual({ head: 'feat/x', defaultBase: 'trunk', defaultBaseRef: 'origin/trunk' })
  })

  it('reports no head when detached', async () => {
    git('switch', '-q', '--detach')
    await expect(read()).resolves.toMatchObject({ head: undefined })
  })
})

// #1823 review: a branch comparison diffs from the merge-base, so commits
// the base gained after the branch left it do not appear (reversed) in it.
describe('branch scope diffs from the merge-base', () => {
  let dir: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('leaves out commits the base gained after the branch forked', async () => {
    dir = mkdtempSync(join(tmpdir(), 'coco-merge-base-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@example.com')
    git('config', 'user.name', 't')
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    git('add', '.'); git('commit', '-q', '-m', 'base')
    git('switch', '-q', '-c', 'feat/x')
    writeFileSync(join(dir, 'feature.txt'), 'feature\n')
    git('add', '.'); git('commit', '-q', '-m', 'feature')
    git('switch', '-q', 'main')
    writeFileSync(join(dir, 'main-only.txt'), 'later on main\n')
    git('add', '.'); git('commit', '-q', '-m', 'main moved on')
    git('switch', '-q', 'feat/x')

    const { resolveChangeSource } = await import('./context')
    const resolved = await resolveChangeSource(
      { kind: 'repository', scope: { type: 'branch', base: 'main' } },
      await createAgentOperationContext({ repoRoot: dir }),
    )
    expect(resolved.text).toContain('feature.txt')
    expect(resolved.text).not.toContain('main-only.txt')
  })
})
