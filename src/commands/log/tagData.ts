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
      const [name, hash, date, subject] = line.split(FIELD_SEPARATOR)

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
    `--format=%(refname:short)${FIELD_SEPARATOR}%(objectname:short)${FIELD_SEPARATOR}%(creatordate:short)${FIELD_SEPARATOR}%(subject)`,
    '--sort=-creatordate',
    'refs/tags',
  ])

  return {
    tags: parseTagRefs(output),
  }
}

export async function getTagRangeSummary(
  git: SimpleGit,
  from: string,
  to = 'HEAD'
): Promise<TagRangeSummary> {
  const [commits, authors, files] = await Promise.all([
    git.raw(['rev-list', '--count', `${from}..${to}`]),
    git.raw(['log', '--format=%an', `${from}..${to}`]),
    git.raw(['diff', '--name-only', `${from}..${to}`]),
  ])

  return {
    from,
    to,
    commitCount: Number.parseInt(commits.trim(), 10) || 0,
    authors: Array.from(new Set(authors.split('\n').map((author) => author.trim()).filter(Boolean))),
    changedFiles: Array.from(new Set(files.split('\n').map((file) => file.trim()).filter(Boolean))),
  }
}
