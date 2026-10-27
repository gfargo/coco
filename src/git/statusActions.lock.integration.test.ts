import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { simpleGit } from 'simple-git'
import { stageFile } from './statusActions'
import type { WorktreeFile } from './statusData'

// #2201 — the user's own git process (or a refresh) holds index.lock for a
// moment; a TUI mutation must wait it out instead of surfacing the error.
describe('stageFile under a transient index.lock (#2201)', () => {
  let dir: string
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  const file: WorktreeFile = { path: 'a.txt', indexStatus: '?', worktreeStatus: '?', state: 'untracked' }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coco-lock-'))
    run('init', '-q')
    writeFileSync(join(dir, 'a.txt'), 'a\n')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('succeeds once the lock is released within the retry window', async () => {
    const lock = join(dir, '.git', 'index.lock')
    writeFileSync(lock, '')
    setTimeout(() => unlinkSync(lock), 100)

    const result = await stageFile(simpleGit(dir), file)

    expect(result).toEqual({ ok: true, message: 'Staged a.txt' })
    expect(run('status', '--porcelain')).toBe('A  a.txt\n')
  })

  it('reports the lock error when it never clears', async () => {
    writeFileSync(join(dir, '.git', 'index.lock'), '')

    const result = await stageFile(simpleGit(dir), file)

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/index\.lock/)
  })
})
