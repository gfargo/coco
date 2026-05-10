import { promises as fsp } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { SimpleGit } from 'simple-git'
import { BranchActionResult } from './branchActions'

export type ApplyHunkTarget = 'worktree' | 'index'

export type ApplyHunkOptions = {
  /** `worktree` runs `git apply`; `index` adds `--cached` so the patch
   *  lands in the index without touching the working tree. */
  target: ApplyHunkTarget
}

function compactOutputLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await fsp.unlink(path)
  } catch (error) {
    // ENOENT is fine — the temp file was never created or already
    // cleaned up. Anything else we silently swallow because the
    // worst-case impact is a single ~1KB file in $TMPDIR.
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      // Intentional no-op: failing the action because we couldn't tidy
      // up the tempfile would mask the actual git result.
    }
  }
}

/**
 * Write a unified-diff patch to a temp file and feed it to
 * `git apply` (or `git apply --cached` when target === 'index').
 *
 * This is the runner behind the `apply-hunk-worktree` /
 * `apply-hunk-index` workflow actions — the input handler builds
 * `patchText` from the cursored hunk via `extractDiffHunk` and the
 * runtime hands it here.
 *
 * `--whitespace=nowarn` keeps `git apply` quiet about trailing
 * whitespace differences (the most common false positive when the
 * patch comes from a stash made on a different platform). Real
 * conflicts still surface via the non-zero exit code.
 *
 * The patch is written to a temp file rather than piped on stdin
 * because some `simple-git` adapters don't expose a clean stdin
 * channel for `git.raw`; the tempfile path keeps the runner
 * portable across environments.
 */
export async function applyHunkPatch(
  git: SimpleGit,
  patchText: string,
  options: ApplyHunkOptions
): Promise<BranchActionResult> {
  if (!patchText.trim()) {
    return {
      ok: false,
      message: 'No hunk under cursor to apply.',
    }
  }

  const targetLabel = options.target === 'index' ? 'index' : 'worktree'
  const tempPath = join(tmpdir(), `coco-hunk-${randomUUID()}.patch`)

  try {
    await fsp.writeFile(tempPath, patchText, 'utf8')

    const args = ['apply']
    if (options.target === 'index') {
      args.push('--cached')
    }
    args.push('--whitespace=nowarn')
    args.push(tempPath)

    try {
      await git.raw(args)
      return {
        ok: true,
        message: `Applied hunk to ${targetLabel}`,
      }
    } catch (error) {
      const lines = compactOutputLines((error as Error).message)
      return {
        ok: false,
        message: lines[0] || `Failed to apply hunk to ${targetLabel}`,
        details: lines.slice(1, 6),
      }
    }
  } catch (error) {
    return {
      ok: false,
      message: `Could not stage hunk for apply: ${(error as Error).message}`,
    }
  } finally {
    await safeUnlink(tempPath)
  }
}
