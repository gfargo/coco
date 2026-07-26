import { SimpleGit } from 'simple-git'
import { rejectFlagLike } from './forgeArgGuards'

export type TagActionResult = {
  ok: boolean
  message: string
}

async function runAction(action: () => Promise<unknown>, successMessage: string): Promise<TagActionResult> {
  try {
    await action()

    return {
      ok: true,
      message: successMessage,
    }
  } catch (error) {
    return {
      ok: false,
      message: (error as Error).message,
    }
  }
}

/**
 * Resolve the remote to use for tag push/delete operations.
 * Prefers `origin`; falls back to the first configured remote.
 * Returns `undefined` when no remotes are configured.
 */
async function resolveDefaultRemote(git: SimpleGit): Promise<string | undefined> {
  try {
    const remotes = (await git.getRemotes()).map((r) => r.name).filter(Boolean)
    if (remotes.length === 0) return undefined
    return remotes.includes('origin') ? 'origin' : remotes[0]
  } catch {
    return undefined
  }
}

export function createLightweightTag(
  git: SimpleGit,
  tagName: string,
  target: string
): Promise<TagActionResult> {
  const nameError = rejectFlagLike(tagName, `Tag name '${tagName}'`)
  if (nameError) return Promise.resolve({ ok: false, message: nameError })

  return runAction(
    () => git.raw(['tag', tagName, target]),
    `Created tag ${tagName}`
  )
}

export function deleteLocalTag(git: SimpleGit, tagName: string): Promise<TagActionResult> {
  const nameError = rejectFlagLike(tagName, `Tag name '${tagName}'`)
  if (nameError) return Promise.resolve({ ok: false, message: nameError })

  return runAction(
    () => git.raw(['tag', '-d', tagName]),
    `Deleted local tag ${tagName}`
  )
}

export async function pushTag(git: SimpleGit, tagName: string): Promise<TagActionResult> {
  const remote = await resolveDefaultRemote(git)
  if (!remote) {
    return { ok: false, message: 'No remote configured — cannot push tag.' }
  }

  // Fully qualified refspec: a bare name errors when the remote has a
  // same-named branch ("matches more than one").
  return runAction(
    () => git.raw(['push', remote, `refs/tags/${tagName}`]),
    `Pushed tag ${tagName}`
  )
}

export async function deleteRemoteTag(git: SimpleGit, tagName: string): Promise<TagActionResult> {
  const remote = await resolveDefaultRemote(git)
  if (!remote) {
    return { ok: false, message: 'No remote configured — cannot delete remote tag.' }
  }

  // MUST stay fully qualified: `git push origin :<name>` resolves the
  // deletion target against ANY matching remote ref — with a local tag
  // that was never pushed and a same-named remote branch, the bare form
  // deletes the BRANCH while reporting "Deleted remote tag".
  return runAction(
    () => git.raw(['push', remote, `:refs/tags/${tagName}`]),
    `Deleted remote tag ${tagName}`
  )
}
