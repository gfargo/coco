/** Field separator (ASCII Unit Separator, 0x1f) — won't appear in commit subjects/bodies. */
const SEP = '\x1f'
/** Record separator (ASCII Record Separator, 0x1e) — terminates each commit entry. Same convention as fileHistoryData.ts. */
const REC = '\x1e'

export const LINT_LOG_FORMAT = `%H${SEP}%h${SEP}%P${SEP}%an${SEP}%ad${SEP}%s${SEP}%b${REC}`

export type LintLogCommit = {
  sha: string
  shortSha: string
  /** Full parent shas. `parents.length > 1` flags a merge commit. */
  parents: string[]
  author: string
  date: string
  subject: string
  body: string
}

/**
 * Parse `git log --pretty=format:${LINT_LOG_FORMAT}` output into one
 * `LintLogCommit` per commit. Each commit occupies one record
 * (terminated by `REC`); fields within are delimited by `SEP`. The body
 * (`%b`) may itself contain newlines, so records — not lines — are the
 * unit of parsing (mirrors `fileHistoryData.ts`).
 */
export function parseLintLogOutput(output: string): LintLogCommit[] {
  const commits: LintLogCommit[] = []
  for (const record of output.split(REC)) {
    const trimmed = record.trim()
    if (!trimmed) continue
    const parts = trimmed.split(SEP)
    if (parts.length < 6) continue
    const [sha, shortSha, parentsStr, author, date, subject, ...bodyParts] = parts
    if (!sha || !shortSha) continue
    commits.push({
      sha,
      shortSha,
      parents: parentsStr ? parentsStr.trim().split(' ').filter(Boolean) : [],
      author,
      date,
      subject: subject.trim(),
      body: bodyParts.join(SEP).trim(),
    })
  }
  return commits
}

/**
 * Resolve the commit range to lint: `--range` verbatim, `--since <ref>`
 * as `<ref>..HEAD`, or `<defaultBranch>..HEAD` when neither is passed.
 * Mutual exclusion of `--since`/`--range` is enforced by the builder's
 * `.check()` (config.ts) — this assumes that's already been validated.
 */
export function resolveLintRange(argv: { since?: string; range?: string }, defaultBranch: string): string {
  if (argv.range) {
    return argv.range
  }
  if (argv.since) {
    return `${argv.since}..HEAD`
  }
  return `${defaultBranch}..HEAD`
}
