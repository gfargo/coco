import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { simpleGit } from 'simple-git'
import { autosquashRebase } from './historyActions'

// The TUI's autosquash workflow used to pass `-c sequence.editor=true`
// through simple-git, which refuses it ("Configuring sequence.editor is not
// permitted without enabling allowUnsafeEditor"), so it failed every time.
// A mocked `git.raw` could not see that; this runs the real thing.
describe('autosquashRebase against a real repo', () => {
  let dir: string
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  const write = (name: string, content: string) => writeFileSync(join(dir, name), content)
  const subjects = () => run('log', '--format=%s').trim().split('\n')

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'coco-autosquash-')))
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 't@example.com')
    run('config', 'user.name', 't')
    write('a.txt', 'base\n')
    run('add', '.')
    run('commit', '-q', '-m', 'base')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const commitRef = (hash: string) => ({ hash, shortHash: hash.slice(0, 7), message: 'feature' })

  it('folds a fixup! commit into its target', async () => {
    write('a.txt', 'base\nfeature\n')
    run('commit', '-q', '-am', 'feature')
    const target = run('rev-parse', 'HEAD').trim()
    write('b.txt', 'extra\n')
    run('add', '.')
    run('commit', '-q', '--fixup', target)
    expect(subjects()).toEqual(['fixup! feature', 'feature', 'base'])

    const result = await autosquashRebase(simpleGit(dir), commitRef(target))

    expect(result).toMatchObject({ ok: true, message: `Autosquashed fixups into ${target.slice(0, 7)}` })
    expect(subjects()).toEqual(['feature', 'base'])
    // The fixup's change landed in the squashed commit.
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('extra\n')
    expect(run('show', '--stat', '--format=', 'HEAD')).toContain('b.txt')
  })

  it('does not wait on, or fail because of, editors the user has configured', async () => {
    write('a.txt', 'base\nfeature\n')
    run('commit', '-q', '-am', 'feature')
    const target = run('rev-parse', 'HEAD').trim()
    write('b.txt', 'extra\n')
    run('add', '.')
    run('commit', '-q', '--fixup', target)
    // An editor that always fails would break the rebase if it were ever launched.
    run('config', 'core.editor', 'false')
    run('config', 'sequence.editor', 'false')
    const saved = { GIT_EDITOR: process.env.GIT_EDITOR, GIT_SEQUENCE_EDITOR: process.env.GIT_SEQUENCE_EDITOR }
    process.env.GIT_EDITOR = 'false'
    process.env.GIT_SEQUENCE_EDITOR = 'false'
    try {
      const result = await autosquashRebase(simpleGit(dir), commitRef(target))
      expect(result.ok).toBe(true)
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
    expect(subjects()).toEqual(['feature', 'base'])
  })

  it('combines a squash! commit without opening a message editor', async () => {
    write('a.txt', 'base\nfeature\n')
    run('commit', '-q', '-am', 'feature')
    const target = run('rev-parse', 'HEAD').trim()
    write('b.txt', 'extra\n')
    run('add', '.')
    run('commit', '-q', '--squash', target, '-m', 'extra note')
    run('config', 'core.editor', 'false')

    const result = await autosquashRebase(simpleGit(dir), commitRef(target))

    expect(result.ok).toBe(true)
    expect(subjects()).toEqual(['feature', 'base'])
  })

  it('reports a conflict with git\'s own message and leaves the rebase in progress', async () => {
    write('a.txt', 'one\n')
    run('commit', '-q', '-am', 'feature')
    const target = run('rev-parse', 'HEAD').trim()
    write('a.txt', 'two\n')
    run('commit', '-q', '-am', 'later')
    write('a.txt', 'three\n')
    run('commit', '-q', '-am', `fixup! feature`)

    const result = await autosquashRebase(simpleGit(dir), commitRef(target))

    expect(result.ok).toBe(false)
    // The workflow layer classifies this with isOperationConflictError.
    expect([result.message, ...(result.details ?? [])].join('\n')).toMatch(/could not apply|CONFLICT/i)
    expect(existsSync(join(dir, '.git', 'rebase-merge'))).toBe(true)
  })

  it('refuses while another operation is already in progress, before touching anything', async () => {
    write('a.txt', 'base\nfeature\n')
    run('commit', '-q', '-am', 'feature')
    const target = run('rev-parse', 'HEAD').trim()
    writeFileSync(join(dir, '.git', 'MERGE_HEAD'), `${target}\n`)

    const result = await autosquashRebase(simpleGit(dir), commitRef(target))

    expect(result).toMatchObject({ ok: false })
    expect(result.message).toMatch(/in-progress merge/)
  })
})
