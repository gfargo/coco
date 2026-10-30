import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { simpleGit } from 'simple-git'
import { extractDiffHunk } from '../workstation/chrome/hunkExtraction'
import { getCommitFilePreview } from './logData'

// #2204 follow-up. A commit's file-preview hunks are BOTH shown in the
// diff view and fed to `extractDiffHunk` -> `git apply` (the H / gH
// apply-hunk keys). Stripping control bytes from them at the data layer
// removes the `\r` of CRLF files, so applying such a hunk either fails to
// match or, for added lines, silently drops the line endings. Display
// sanitising therefore has to happen at render time.
describe('applying a hunk taken from a commit preview (#2204)', () => {
  let dir: string
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'coco-crlf-hunk-')))
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 't@example.com')
    run('config', 'user.name', 't')
    run('config', 'core.autocrlf', 'false')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  async function previewHunkPatch(): Promise<string> {
    const git = simpleGit(dir)
    const hash = run('rev-parse', 'HEAD').trim()
    const preview = await getCommitFilePreview(git, hash, { path: 'win.txt' } as never)
    const extracted = extractDiffHunk({
      lines: preview.hunks,
      cursorOffset: preview.hunks.findIndex((line) => line.startsWith('@@')),
      path: 'win.txt',
    })
    expect(extracted).not.toBeNull()
    return extracted!.patchText
  }

  it('keeps the carriage returns of a CRLF file so the patch still applies', async () => {
    writeFileSync(join(dir, 'win.txt'), 'one\r\ntwo\r\n')
    run('add', '.')
    run('commit', '-q', '-m', 'base')
    writeFileSync(join(dir, 'win.txt'), 'one\r\nTWO\r\nthree\r\n')
    run('commit', '-q', '-am', 'change')
    const patch = await previewHunkPatch()

    // Revert to the base content and apply the previewed hunk back.
    run('checkout', '-q', 'HEAD~1', '--', 'win.txt')
    writeFileSync(join(dir, 'p.patch'), patch)
    run('apply', '--check', 'p.patch')
    run('apply', 'p.patch')

    expect(readFileSync(join(dir, 'win.txt'), 'utf8')).toBe('one\r\nTWO\r\nthree\r\n')
  })
})
