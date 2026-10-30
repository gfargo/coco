import { execFileSync } from 'child_process'
import { mkdtempSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createCancellableGit } from './cancellableGit'

// #2199 — Esc must be able to abandon a network git op that never returns.
// A local remote whose `uploadpack` is `sleep 5 #` makes `git fetch origin`
// hang exactly like an unresponsive server, with no network involved (git
// appends the repo path to that command; the `#` turns it into a comment).
describe('createCancellableGit (#2199)', () => {
  let dir: string
  let remote: string
  const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'coco-cancel-')))
    remote = realpathSync(mkdtempSync(join(tmpdir(), 'coco-cancel-remote-')))
    run(remote, 'init', '-q', '--bare')
    run(dir, 'init', '-q', '-b', 'main')
    run(dir, 'remote', 'add', 'origin', remote)
    run(dir, 'config', 'remote.origin.uploadpack', 'sleep 5 #')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  })

  it('kills a hung fetch promptly when cancelled', async () => {
    const op = createCancellableGit(dir)
    const started = Date.now()
    const pending = op.git.raw(['fetch', 'origin'])
    setTimeout(() => op.cancel(), 300)

    await expect(pending).rejects.toThrow(/abort/i)
    expect(Date.now() - started).toBeLessThan(3000)
    expect(op.wasCancelled()).toBe(true)
  })

  it('reports not-cancelled for an op that finished on its own', async () => {
    const op = createCancellableGit(dir)
    await op.git.raw(['status', '--porcelain'])
    expect(op.wasCancelled()).toBe(false)
  })

  it('is single-use: after a cancel the same instance refuses further commands', async () => {
    const op = createCancellableGit(dir)
    op.cancel()
    await expect(op.git.raw(['status'])).rejects.toThrow(/abort/i)
  })

  it('does not affect other instances', async () => {
    const cancelled = createCancellableGit(dir)
    const other = createCancellableGit(dir)
    cancelled.cancel()
    await expect(other.git.raw(['status', '--porcelain'])).resolves.toBe('')
  })
})
