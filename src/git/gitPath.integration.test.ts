import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { simpleGit } from 'simple-git'
import { getInProgressOperationType } from './operationData'
import { resolveGitPath, resolveRevParsePath } from './gitPath'

// #2205 — `git rev-parse --git-path X` answers relative to the directory
// git ran in, but callers existsSync'd it against process.cwd(). In a
// nested repo frame or a subdirectory those are different places.
describe('git path resolution in nested repos (#2205)', () => {
  let root: string
  let sup: string
  let sub: string

  const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'coco-gitpath-')))
    const dep = join(root, 'dep-origin')
    mkdirSync(dep)
    run(dep, 'init', '-q', '-b', 'main')
    run(dep, 'config', 'user.email', 't@example.com')
    run(dep, 'config', 'user.name', 't')
    writeFileSync(join(dep, 'd.txt'), 'd\n')
    run(dep, 'add', '.')
    run(dep, 'commit', '-q', '-m', 'dep')

    sup = join(root, 'super')
    mkdirSync(sup)
    run(sup, 'init', '-q', '-b', 'main')
    run(sup, 'config', 'user.email', 't@example.com')
    run(sup, 'config', 'user.name', 't')
    writeFileSync(join(sup, 's.txt'), 's\n')
    run(sup, 'add', '.')
    run(sup, 'commit', '-q', '-m', 'super')
    run(sup, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', dep, 'libs/dep')
    sub = join(sup, 'libs', 'dep')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('resolves a submodule frame\'s git path to ITS git dir, not the cwd repo\'s', async () => {
    const subGitDir = run(sub, 'rev-parse', '--absolute-git-dir').trim()
    expect(await resolveGitPath(simpleGit(sub), 'MERGE_HEAD')).toBe(join(subGitDir, 'MERGE_HEAD'))
  })

  it('sees an in-progress merge recorded in the submodule\'s git dir', async () => {
    const subGitDir = run(sub, 'rev-parse', '--absolute-git-dir').trim()
    writeFileSync(join(subGitDir, 'MERGE_HEAD'), 'abc123\n')
    await expect(getInProgressOperationType(simpleGit(sub))).resolves.toBe('merge')
  })

  it('does not report the SUPER repo\'s merge for a clean submodule frame', async () => {
    writeFileSync(join(sup, '.git', 'MERGE_HEAD'), 'abc123\n')
    await expect(getInProgressOperationType(simpleGit(sub))).resolves.toBe('none')
    await expect(getInProgressOperationType(simpleGit(sup))).resolves.toBe('merge')
  })

  it('resolves correctly from a subdirectory of a repo (relative answer starts with ../)', async () => {
    const dir = join(sup, 'nested', 'deeper')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(sup, '.git', 'REVERT_HEAD'), 'abc123\n')
    await expect(getInProgressOperationType(simpleGit(dir))).resolves.toBe('revert')
  })

  it('resolves --git-common-dir to the main repo\'s git dir from a linked worktree', async () => {
    const wt = join(root, 'wt')
    run(sup, 'worktree', 'add', '-q', '-b', 'feature', wt)
    const common = await resolveRevParsePath(simpleGit(wt), ['--git-common-dir'])
    expect(realpathSync(common)).toBe(realpathSync(join(sup, '.git')))
  })
})

// #2205 — stash file lists with names git would otherwise C-quote or that
// start/end with spaces.
describe('getStashOverview file names (#2205)', () => {
  let dir: string
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'coco-stash-names-')))
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 't@example.com')
    run('config', 'user.name', 't')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns exact names for non-ASCII, quoted and space-padded files', async () => {
    const { getStashFiles, getStashOverview } = await import('./stashData')
    const names = ['café.txt', ' leading space.txt', 'trailing space .txt', 'tab\there.txt']
    for (const name of names) writeFileSync(join(dir, name), 'v1\n')
    run('add', '.')
    run('commit', '-q', '-m', 'init')
    for (const name of names) writeFileSync(join(dir, name), 'v2\n')
    run('stash', 'push', '-q', '-m', 'wip')

    const overview = await getStashOverview(simpleGit(dir), { withFiles: true })

    expect(overview.stashes).toHaveLength(1)
    expect([...(overview.stashes[0].files ?? [])].sort()).toEqual([...names].sort())
    // The lazy loader the TUI uses reads the same exact names, by hash.
    expect([...(await getStashFiles(simpleGit(dir), overview.stashes[0].hash))].sort()).toEqual([...names].sort())
  })
})
