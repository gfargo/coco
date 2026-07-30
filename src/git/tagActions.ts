import { SimpleGit } from 'simple-git'
import { rejectFlagLike } from './forgeArgGuards'
import { resolveDefaultRemoteName } from './remoteResolution'

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

/**
 * Recreate a tag previously deleted at its recorded sha — the undo-stack
 * inverse (OSS-1606). Always recreates as a lightweight tag: if the
 * deleted tag was annotated, the tag object (message/tagger metadata)
 * was deleted along with the ref, so only the commit it pointed to can
 * be restored — the annotation itself is gone.
 */
export function restoreDeletedTag(git: SimpleGit, tagName: string, sha: string): Promise<TagActionResult> {
  const nameError = rejectFlagLike(tagName, `Tag name '${tagName}'`)
  if (nameError) return Promise.resolve({ ok: false, message: nameError })

  return runAction(
    () => git.raw(['tag', tagName, sha]),
    `Restored tag ${tagName}`
  )
}

export async function pushTag(git: SimpleGit, tagName: string): Promise<TagActionResult> {
  const remote = await resolveDefaultRemoteName(git)
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
  const remote = await resolveDefaultRemoteName(git)
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
