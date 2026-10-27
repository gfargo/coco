import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { getCompareDiff } from './compareData'
import type { WorktreeFile } from './statusData'
import { getWorktreeFileDiff } from './worktreeDiffData'
import { getWorktreeHunks, stageHunk } from './statusHunks'

const FILE: WorktreeFile = {
  path: 'app.txt',
  indexStatus: ' ',
  worktreeStatus: 'M',
  state: 'unstaged',
}

// Each entry is user config that used to corrupt machine-parsed diffs (#2200).
const HOSTILE_CONFIGS: Array<[string, string, string]> = [
  ['diff.external', 'diff.external', 'echo EXTERNAL-DIFF-TOOL'],
  ['color.ui=always', 'color.ui', 'always'],
  ['diff.noprefix', 'diff.noprefix', 'true'],
  ['diff.mnemonicPrefix', 'diff.mnemonicPrefix', 'true'],
]

describe.each(HOSTILE_CONFIGS)('machine-parsed diffs under %s (#2200)', (_label, key, value) => {
  let dir: string
  let git: SimpleGit

  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coco-machine-diff-'))
    run('init', '-q')
    run('config', 'user.email', 't@example.com')
    run('config', 'user.name', 't')
    writeFileSync(join(dir, 'app.txt'), 'one\ntwo\nthree\n')
    run('add', '.')
    run('commit', '-q', '-m', 'init')
    run('branch', 'base')
    writeFileSync(join(dir, 'app.txt'), 'one\nTWO\nthree\n')
    run('config', key, value)
    git = simpleGit(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('still parses hunks and stages one with git apply', async () => {
    const overview = await getWorktreeHunks(git, FILE)
    expect(overview?.hunks).toHaveLength(1)

    await stageHunk(git, overview!.hunks[0])
    expect(run('diff', '--cached', '--no-ext-diff', '--no-color', '--numstat')).toContain('app.txt')
  })

  it('returns a plain unified diff for the worktree view', async () => {
    const diff = await getWorktreeFileDiff(git, FILE)
    const text = (diff?.lines ?? []).join('\n')
    expect(text).toContain('@@')
    expect(text).not.toContain('EXTERNAL-DIFF-TOOL')
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/\u001b\[/)
  })

  it('returns a plain unified diff for compare', async () => {
    run('commit', '-q', '-am', 'change')
    const lines = await getCompareDiff(git, 'base', 'HEAD')
    const text = lines.join('\n')
    expect(text).toContain('--- a/app.txt')
    expect(text).toContain('+++ b/app.txt')
    expect(text).not.toContain('EXTERNAL-DIFF-TOOL')
  })
})
