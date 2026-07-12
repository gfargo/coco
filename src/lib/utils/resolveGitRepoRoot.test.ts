import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveGitRepoRoot } from './resolveGitRepoRoot'

/**
 * Extracted from `diffSummaryCache.ts`'s `resolveDiffSummaryCacheRepoPath`
 * (#1463) so project config loading (#1616) can share the same "repo root
 * regardless of invocation subdirectory" resolution. These tests mirror
 * that module's own coverage for the shared core.
 */
describe('resolveGitRepoRoot', () => {
  it('resolves a subdirectory to the same toplevel as the repo root', () => {
    const repoRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'coco-resolveroot-repo-')))
    execFileSync('git', ['init', '-q'], { cwd: repoRoot })
    const subDir = path.join(repoRoot, 'nested', 'dir')
    fs.mkdirSync(subDir, { recursive: true })

    try {
      expect(resolveGitRepoRoot(repoRoot)).toBe(repoRoot)
      expect(resolveGitRepoRoot(subDir)).toBe(repoRoot)
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true })
    }
  })

  it('falls back to cwd when not inside a git repo', () => {
    const notARepo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'coco-resolveroot-norepo-')))
    try {
      expect(resolveGitRepoRoot(notARepo)).toBe(notARepo)
    } finally {
      fs.rmSync(notARepo, { recursive: true, force: true })
    }
  })

  it('defaults to process.cwd() when no argument is passed', () => {
    expect(resolveGitRepoRoot()).toBe(resolveGitRepoRoot(process.cwd()))
  })
})
