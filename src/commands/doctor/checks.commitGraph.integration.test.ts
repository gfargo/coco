/**
 * #2209 — the commit-graph probe against real git, including a linked
 * worktree, whose `objects/` live in the main checkout's common dir.
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { probeCommitGraph } from './checks'

jest.setTimeout(30_000)

describe('probeCommitGraph (real git)', () => {
  let dir: string
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coco-commit-graph-'))
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.email', 't@example.com')
    git(dir, 'config', 'user.name', 't')
    // Keep git from writing a commit-graph on its own during the test.
    git(dir, 'config', 'gc.writeCommitGraph', 'false')
    git(dir, 'config', 'fetch.writeCommitGraph', 'false')
    for (let i = 0; i < 3; i++) git(dir, 'commit', '-q', '--allow-empty', '-m', `c${i}`)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('counts commits and sees whether a commit-graph exists', async () => {
    await expect(probeCommitGraph(dir)).resolves.toEqual({ inRepo: true, commitCount: 3, hasCommitGraph: false })
    git(dir, 'commit-graph', 'write', '--reachable')
    await expect(probeCommitGraph(dir)).resolves.toEqual({ inRepo: true, commitCount: 3, hasCommitGraph: true })
  })

  it('finds the main checkout\'s commit-graph from a linked worktree', async () => {
    git(dir, 'commit-graph', 'write', '--reachable')
    const linked = join(dir, 'linked')
    git(dir, 'worktree', 'add', '-q', linked, '-b', 'side')
    await expect(probeCommitGraph(linked)).resolves.toMatchObject({ inRepo: true, hasCommitGraph: true })
  })

  it('reports a directory outside any repository', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'coco-not-a-repo-'))
    try {
      await expect(probeCommitGraph(outside)).resolves.toEqual({ inRepo: false })
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
