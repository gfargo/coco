/**
 * #1823 — reading the PR draft's head and base from a real repository.
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
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
    await expect(read()).resolves.toEqual({ head: 'feat/x', defaultBase: 'main' })
  })

  it('uses origin/HEAD without the remote prefix', async () => {
    git('update-ref', 'refs/remotes/origin/trunk', 'HEAD')
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
    await expect(read()).resolves.toEqual({ head: 'feat/x', defaultBase: 'trunk' })
  })

  it('reports no head when detached', async () => {
    git('switch', '-q', '--detach')
    await expect(read()).resolves.toMatchObject({ head: undefined })
  })
})
