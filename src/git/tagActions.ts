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

export function createAnnotatedTag(
  git: SimpleGit,
  tagName: string,
  target: string,
  message: string
): Promise<TagActionResult> {
  const nameError = rejectFlagLike(tagName, `Tag name '${tagName}'`)
  if (nameError) return Promise.resolve({ ok: false, message: nameError })

  return runAction(
    () => git.raw(['tag', '-a', tagName, target, '-m', message]),
    `Created annotated tag ${tagName}`
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

export function pushTag(git: SimpleGit, tagName: string): Promise<TagActionResult> {
  // Fully qualified refspec: a bare name errors when the remote has a
  // same-named branch ("matches more than one").
  return runAction(
    () => git.raw(['push', 'origin', `refs/tags/${tagName}`]),
    `Pushed tag ${tagName}`
  )
}

export function deleteRemoteTag(git: SimpleGit, tagName: string): Promise<TagActionResult> {
  // MUST stay fully qualified: `git push origin :<name>` resolves the
  // deletion target against ANY matching remote ref — with a local tag
  // that was never pushed and a same-named remote branch, the bare form
  // deletes the BRANCH while reporting "Deleted remote tag".
  return runAction(
    () => git.raw(['push', 'origin', `:refs/tags/${tagName}`]),
    `Deleted remote tag ${tagName}`
  )
}
