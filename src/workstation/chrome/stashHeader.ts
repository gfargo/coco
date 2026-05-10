import { StashEntry } from '../../git/stashData'

/**
 * Header identity strings for the stash diff surface.
 *
 * `git stash list --date=iso` returns refs like `stash@{2026-05-01
 * 23:01:18 -0400}` because of the date-style flag we use for stable
 * parsing. That timestamp ref reads as noise in the diff panel title
 * bar — the human-meaningful identifier is the message + branch + the
 * sequential stash index (`@{0}`, `@{1}`, …).
 *
 * `subtitle` is what shows in the panel header's right slot — the
 * one-line "what am I looking at" answer. `bodyLine` is the first
 * header line inside the panel body — it preserves the full ref so the
 * user can still copy it for `git stash apply <ref>` etc.
 *
 * When the entry can't be found in the active stash list (race with a
 * `git stash drop` between Enter and the diff fetch, or empty
 * context.stashes), we degrade gracefully to the bare ref so the
 * surface stays usable.
 */
export type StashHeaderIdentity = {
  subtitle: string
  bodyLine: string
}

export function formatStashHeaderIdentity(
  ref: string | undefined,
  stashes: StashEntry[] | undefined
): StashHeaderIdentity {
  if (!ref) {
    return { subtitle: 'no stash', bodyLine: 'Stash:' }
  }

  const index = stashes?.findIndex((entry) => entry.ref === ref) ?? -1
  const entry = index >= 0 ? stashes![index] : undefined

  if (!entry) {
    return {
      subtitle: ref,
      bodyLine: `Stash: ${ref}`,
    }
  }

  const onBranch = entry.branch && entry.branch !== '<unknown>' ? ` on ${entry.branch}` : ''
  const message = entry.message?.trim() || '(no message)'

  return {
    subtitle: `@{${index}} ${message}${onBranch}`,
    bodyLine: `Stash: ${ref}${onBranch} — ${message}`,
  }
}
