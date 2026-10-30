/**
 * #1824 — the agent split-plan reads the staged state through the hardened
 * runner instead of the CLI's simple-git path.
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createAgentOperationContext, readStagedFileChanges, readStagedFileDiff } from './context'

jest.setTimeout(30_000)

describe('staged readers', () => {
  let dir: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  const write = (name: string, content: string) => writeFileSync(join(dir, name), content)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coco-staged-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@example.com')
    git('config', 'user.name', 't')
    write('keep.txt', 'one\ntwo\nthree\n')
    write('gone.txt', 'bye\n')
    write('old name.txt', 'a\nb\nc\nd\ne\n')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('lists staged files with status, including renames and spaces', async () => {
    write('keep.txt', 'one\nTWO\nthree\n')
    write('new file.txt', 'hello\n')
    git('rm', '-q', 'gone.txt')
    git('mv', 'old name.txt', 'new name.txt')
    git('add', 'keep.txt', 'new file.txt')
    const context = await createAgentOperationContext({ repoRoot: dir })

    const changes = await readStagedFileChanges(context)
    expect(changes.sort((a, b) => a.filePath.localeCompare(b.filePath))).toEqual([
      { filePath: 'gone.txt', status: 'deleted', summary: '' },
      { filePath: 'keep.txt', status: 'modified', summary: '' },
      { filePath: 'new file.txt', status: 'added', summary: '' },
      { filePath: 'new name.txt', oldFilePath: 'old name.txt', status: 'renamed', summary: '' },
    ])
  })

  it('reads one staged file\'s patch and nothing unstaged', async () => {
    write('keep.txt', 'one\nTWO\nthree\n')
    git('add', 'keep.txt')
    write('keep.txt', 'one\nTWO\nthree\nunstaged\n')
    const context = await createAgentOperationContext({ repoRoot: dir })

    const patch = await readStagedFileDiff(context, 'keep.txt')
    expect(patch).toContain('+TWO')
    expect(patch).not.toContain('unstaged')
  })

  it('returns nothing when the index is clean', async () => {
    const context = await createAgentOperationContext({ repoRoot: dir })
    await expect(readStagedFileChanges(context)).resolves.toEqual([])
  })
})
