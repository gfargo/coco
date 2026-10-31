/**
 * Lazy loader for the files each stash changes (#2209).
 *
 * `getStashOverview` lists stashes without their files: a `git stash show` per
 * stash made every refresh spawn a process for each one (about 14 ms each, 560
 * ms for 40 stashes) whether or not a stash surface was open. This effect
 * loads the missing files only while one is, and only for stashes that do not
 * have them yet. A stash commit never changes, and `mergeRefreshedContext`
 * carries loaded files across refreshes by hash, so each stash is read once.
 *
 * Files are fetched by stash hash, in small batches so the counts fill in
 * progressively, and written into `context.stashes` with the frame-tagged
 * `setContext` so a result that lands after a repo-stack push or pop is dropped.
 * A failed read stores an empty list: it ends the retry instead of looping, and
 * a stash dropped in the meantime leaves the list on the next refresh anyway.
 *
 * `React` is injected per the runtime's convention.
 */

import type * as ReactTypes from 'react'
import type { SimpleGit } from 'simple-git'
import { getStashFiles, type StashEntry } from '../../../git/stashData'
import type { LogInkContext } from '../types'

/** Stashes read at once; simple-git also caps its own parallel processes. */
export const STASH_FILES_BATCH_SIZE = 8

export type UseStashFilesHydrationDeps = {
  git: SimpleGit
  /** `context.stashes?.stashes`. */
  stashes: StashEntry[] | undefined
  /** True while a surface that shows stash files is on screen. */
  active: boolean
  /** Repo-stack runtimes — `runtimes.length - 1` is the frame-tag depth. */
  runtimes: readonly unknown[]
  setContext: (
    arg: LogInkContext | ((prev: LogInkContext) => LogInkContext),
    targetDepth?: number,
  ) => void
}

export function useStashFilesHydration(
  React: typeof ReactTypes,
  deps: UseStashFilesHydrationDeps,
): void {
  const { git, stashes, active, runtimes, setContext } = deps

  React.useEffect(() => {
    if (!active || !stashes?.length) return
    const missing = stashes.filter((stash) => !stash.files)
    if (missing.length === 0) return

    const issuedAtDepth = runtimes.length - 1
    let cancelled = false

    void (async () => {
      for (let start = 0; start < missing.length; start += STASH_FILES_BATCH_SIZE) {
        const batch = missing.slice(start, start + STASH_FILES_BATCH_SIZE)
        const loaded = await Promise.all(batch.map(async (stash) => {
          const files = await getStashFiles(git, stash.hash).catch(() => [] as string[])
          return [stash.hash, files] as const
        }))
        if (cancelled) return
        const filesByHash = new Map(loaded)
        setContext(
          (current) => current.stashes
            ? {
              ...current,
              stashes: {
                ...current.stashes,
                stashes: current.stashes.stashes.map((stash) =>
                  !stash.files && filesByHash.has(stash.hash)
                    ? { ...stash, files: filesByHash.get(stash.hash) }
                    : stash),
              },
            }
            : current,
          issuedAtDepth,
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [active, stashes, git, runtimes.length, setContext])
}
