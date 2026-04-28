import { SimpleGit } from 'simple-git'

export type StashEntry = {
  ref: string
  hash: string
  date: string
  branch: string
  message: string
  files: string[]
}

export type StashOverview = {
  stashes: StashEntry[]
}

function parseStashSubject(subject: string): { branch: string; message: string } {
  const match = subject.match(/^(?:WIP on|On) ([^:]+):\s*(.*)$/)

  if (!match) {
    return {
      branch: '<unknown>',
      message: subject,
    }
  }

  return {
    branch: match[1],
    message: match[2] || subject,
  }
}

export function parseStashList(output: string): Omit<StashEntry, 'files'>[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [ref, hash, date, subject] = line.split('\x1f')
      const parsedSubject = parseStashSubject(subject || '')

      return {
        ref,
        hash,
        date,
        branch: parsedSubject.branch,
        message: parsedSubject.message,
      }
    })
}

export function parseStashFiles(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export async function getStashOverview(git: SimpleGit): Promise<StashOverview> {
  const stashes = parseStashList(
    await git.raw(['stash', 'list', '--date=iso', '--format=%gd%x1f%H%x1f%ci%x1f%gs'])
  )

  return {
    stashes: await Promise.all(stashes.map(async (stash) => ({
      ...stash,
      files: parseStashFiles(await git.raw(['stash', 'show', '--name-only', stash.ref])),
    }))),
  }
}

export async function getStashDiffSummary(git: SimpleGit, stashRef: string): Promise<string[]> {
  return (await git.raw(['stash', 'show', '--stat', stashRef]))
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
}

export const stashDataTestInternals = {
  parseStashSubject,
}
