import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { continueOperation } from './operationActions'

// #2198 — `rebase --continue` after resolving a conflicted `reword` pick
// opens the commit-message editor. `core.editor=false` stands in for a terminal editor that cannot run
// under simple-git's piped stdio: if coco let git launch it, the continue
// would fail ("problem with the editor").
// Note: an exported GIT_EDITOR outranks core.editor and would mask a
// regression here; CI does not set one.
describe('continueOperation never launches an editor (#2198)', () => {
  let dir: string
  let git: SimpleGit

  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coco-continue-'))
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 't@example.com')
    run('config', 'user.name', 't')
    // Stands in for a terminal editor that cannot run under piped stdio.
    run('config', 'core.editor', 'false')
    writeFileSync(join(dir, 'f.txt'), 'a\n')
    run('add', '.')
    run('commit', '-q', '-m', 'init')
    writeFileSync(join(dir, 'f.txt'), 'b\n')
    run('commit', '-q', '-am', 'second')
    writeFileSync(join(dir, 'f.txt'), 'c\n')
    run('commit', '-q', '-am', 'third')
    const [third] = run('log', '-2', '--format=%h').trim().split('\n')
    const todo = join(dir, '..', `todo-${third}`)
    writeFileSync(todo, `reword ${third}\n`)
    // Replaying `third` without `second` conflicts on f.txt, stopping the
    // rebase at a reword pick; resolving it makes `--continue` ask for a
    // commit message, i.e. open the editor.
    try {
      execFileSync('git', ['rebase', '-i', 'HEAD~2'], {
        cwd: dir,
        stdio: 'pipe',
        env: { ...process.env, GIT_SEQUENCE_EDITOR: `cp ${todo}` },
      })
    } catch {
      // expected: conflict stops the rebase
    }
    writeFileSync(join(dir, 'f.txt'), 'resolved\n')
    run('add', 'f.txt')
    git = simpleGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('completes rebase --continue at a reword step without opening GIT_EDITOR', async () => {
    const result = await continueOperation(git, 'rebase')
    expect(result).toEqual({ ok: true, message: 'Continued rebase' })
    expect(run('status', '--porcelain=v1', '--branch')).toContain('## main')
    expect(run('log', '-2', '--format=%s')).toContain('third')
  })
})
