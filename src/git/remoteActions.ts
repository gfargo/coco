import { SimpleGit } from 'simple-git'
import { BranchActionResult } from './branchActions'
import { rejectFlagLike } from './forgeArgGuards'

/**
 * Remote maintenance actions (#0.71 — expanded git ops).
 *
 * The Remotes view lists every configured remote; these four actions
 * let the user manage remotes without dropping to a shell:
 *   - `addRemote`    → `git remote add <name> <url>`
 *   - `removeRemote` → `git remote remove <name>`     (destructive)
 *   - `setRemoteUrl` → `git remote set-url <name> <url>`
 *   - `pruneRemote`  → `git remote prune <name>`       (destructive)
 *
 * All run through `runAction`, returning `{ ok, message }` — `ok:true`
 * with a friendly success line, or `ok:false` carrying git's own error
 * text. Inputs are validated up front: empty name/url is rejected, and
 * a name or url beginning with `-` is rejected so a value can never be
 * misparsed by git as a flag (defense-in-depth — argv is passed via
 * simple-git's execFile, so there's no shell to inject into, but a
 * leading `-` could still flip an unrelated flag).
 */

async function runAction(
  action: () => Promise<unknown>,
  successMessage: string
): Promise<BranchActionResult> {
  try {
    await action()
    return { ok: true, message: successMessage }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
}

function validateName(name: string): string | undefined {
  const trimmed = name.trim()
  if (!trimmed) return 'Remote name required.'
  return rejectFlagLike(trimmed, `Remote name '${trimmed}'`)
}

function validateUrl(url: string): string | undefined {
  const trimmed = url.trim()
  if (!trimmed) return 'Remote URL required.'
  return rejectFlagLike(trimmed, `Remote URL '${trimmed}'`)
}

/**
 * `git remote add <name> <url>`: register a new remote. Validates both
 * the name and the URL before touching git so a bad value never reaches
 * argv. Non-destructive — only adds a config entry.
 */
export function addRemote(git: SimpleGit, name: string, url: string): Promise<BranchActionResult> {
  const nameError = validateName(name)
  if (nameError) return Promise.resolve({ ok: false, message: nameError })
  const urlError = validateUrl(url)
  if (urlError) return Promise.resolve({ ok: false, message: urlError })
  const cleanName = name.trim()
  const cleanUrl = url.trim()
  return runAction(
    () => git.raw(['remote', 'add', cleanName, cleanUrl]),
    `Added remote ${cleanName}`
  )
}

/**
 * `git remote remove <name>`: delete a remote and its tracking refs.
 * Destructive — drops the remote's config + remote-tracking branches —
 * so the TUI gates this behind a y-confirm before calling it.
 */
export function removeRemote(git: SimpleGit, name: string): Promise<BranchActionResult> {
  const nameError = validateName(name)
  if (nameError) return Promise.resolve({ ok: false, message: nameError })
  const cleanName = name.trim()
  return runAction(
    () => git.raw(['remote', 'remove', cleanName]),
    `Removed remote ${cleanName}`
  )
}

/**
 * `git remote set-url <name> <url>`: repoint an existing remote at a
 * new URL. Validates the name + URL like `addRemote`. Non-destructive
 * to history, but the prompt that collects the URL is the affirmative
 * gate, so the TUI runs it directly (no y-confirm).
 */
export function setRemoteUrl(git: SimpleGit, name: string, url: string): Promise<BranchActionResult> {
  const nameError = validateName(name)
  if (nameError) return Promise.resolve({ ok: false, message: nameError })
  const urlError = validateUrl(url)
  if (urlError) return Promise.resolve({ ok: false, message: urlError })
  const cleanName = name.trim()
  const cleanUrl = url.trim()
  return runAction(
    () => git.raw(['remote', 'set-url', cleanName, cleanUrl]),
    `Set ${cleanName} URL`
  )
}

/**
 * `git remote prune <name>`: delete stale remote-tracking refs that no
 * longer exist on the remote. Destructive — it removes refs — so the
 * TUI gates this behind a y-confirm. The remote's config is untouched.
 */
export function pruneRemote(git: SimpleGit, name: string): Promise<BranchActionResult> {
  const nameError = validateName(name)
  if (nameError) return Promise.resolve({ ok: false, message: nameError })
  const cleanName = name.trim()
  return runAction(
    () => git.raw(['remote', 'prune', cleanName]),
    `Pruned remote ${cleanName}`
  )
}
