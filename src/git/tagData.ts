import { SimpleGit } from 'simple-git'

const FIELD_SEPARATOR = '\x1f'

export type GitTagRef = {
  name: string
  hash: string
  date: string
  subject: string
}

export type TagOverview = {
  tags: GitTagRef[]
}

export type TagRangeSummary = {
  from: string
  to: string
  commitCount: number
  authors: string[]
  changedFiles: string[]
}

export function parseTagRefs(output: string): GitTagRef[] {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [name, objectHash, derefedHash, date, subject] = line.split(FIELD_SEPARATOR)

      // For annotated tags `%(objectname:short)` returns the TAG
      // OBJECT's SHA, not the commit it points to — that's the SHA
      // sitting in `refs/tags/<name>`'s blob. `%(*objectname:short)`
      // dereferences the tag and yields the commit's SHA, but is
      // EMPTY for lightweight tags (which are already direct
      // pointers to commits). Prefer the dereferenced form when
      // present, fall back to the object SHA otherwise. This is what
      // lets cursor-sync find the tagged commit in the loaded log
      // window — anchoring on the tag object's own SHA would never
      // match a commit row.
      const hash = derefedHash || objectHash

      return {
        name,
        hash,
        date,
        subject,
      }
    })
}

export async function getTagOverview(git: SimpleGit): Promise<TagOverview> {
  const output = await git.raw([
    'for-each-ref',
    `--format=%(refname:short)${FIELD_SEPARATOR}%(objectname:short)${FIELD_SEPARATOR}%(*objectname:short)${FIELD_SEPARATOR}%(creatordate:short)${FIELD_SEPARATOR}%(subject)`,
    '--sort=-creatordate',
    'refs/tags',
  ])

  return {
    tags: parseTagRefs(output),
  }
}
