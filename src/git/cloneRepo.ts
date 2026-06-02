/**
 * Clone a remote repository into a local path — the runtime side of the
 * workspace surface's `c` (clone) flow.
 *
 * `deriveRepoName` is pure (and tested) so the UI can pre-fill the
 * destination as `<cwd>/<name>` the moment a URL is typed; `cloneRepo`
 * does the filesystem-touching work and reports a friendly result.
 */
import * as fs from 'fs'
import { simpleGit } from 'simple-git'

export type CloneResult = {
  ok: boolean
  message: string
}

/**
 * Infer the repository folder name from a clone URL or SSH spec:
 *   git@github.com:gfargo/coco.git  → coco
 *   https://github.com/gfargo/coco  → coco
 *   https://example.com/a/b/c.git/  → c
 * Falls back to `repo` when nothing usable can be parsed.
 */
export function deriveRepoName(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '').replace(/\.git$/i, '')
  if (!trimmed) return 'repo'
  // Split on both `/` and `:` so `host:owner/name` SSH specs work.
  const segment = trimmed.split(/[/:]/).filter(Boolean).pop() || ''
  return segment || 'repo'
}

/**
 * Clone `url` into `targetPath`. Refuses to clobber an existing path so
 * a typo never overwrites a directory. Network / auth failures surface
 * git's own message (trimmed to one line).
 */
export async function cloneRepo(url: string, targetPath: string): Promise<CloneResult> {
  const remote = url.trim()
  const dest = targetPath.trim()
  if (!remote) return { ok: false, message: 'Enter a remote URL to clone.' }
  if (!dest) return { ok: false, message: 'Enter a destination path.' }
  if (fs.existsSync(dest)) {
    return { ok: false, message: `${dest} already exists — choose another path.` }
  }
  try {
    await simpleGit().clone(remote, dest)
    return { ok: true, message: `Cloned into ${dest}` }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `Clone failed: ${raw.split('\n')[0]}` }
  }
}
