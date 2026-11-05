import { SimpleGit } from 'simple-git'
import { createAgentOperationContext } from '../operations/agent/context'
import { runLint } from '../operations/agent/generate'
import type { LintCommitResult } from '../operations/agent/schemas'
import type { BranchRef } from './branchData'
import { suggestCommitMessageForCommit } from './commitWorkflowActions'
import { flaggedSubjects, shouldLintSubjects } from './outgoingReview'
import { getRebasePlanRows, type RebasePlanRow } from './rebasePlanActions'

/** Most subjects we draft a replacement for in one go (one LLM call each). */
export const MAX_SUBJECT_FIXES = 8

export type OutgoingSubjectFixPlan =
  | { ok: true; rows: RebasePlanRow[]; message: string }
  | { ok: false; message: string }

const first = (text: string) => text.split('\n')[0]

/**
 * Plan the "fix outgoing subjects" hand-off (#2216, step 3): lint
 * `<upstream>..HEAD`, draft a conventional replacement for each subject that
 * breaks the rules, and return rebase-plan rows with those commits already set
 * to `reword`. Nothing is rewritten here; the caller opens the plan and the
 * user reviews, edits and runs it.
 *
 * Refuses (with a reason) when the plan couldn't be run safely: not the
 * current branch, no upstream, merge commits in the range (a rebase would
 * flatten them), or a repo that doesn't use Conventional Commits.
 */
export async function planOutgoingSubjectFixes(
  git: SimpleGit,
  branch: BranchRef,
  signal?: AbortSignal,
): Promise<OutgoingSubjectFixPlan> {
  if (branch.type !== 'local') {
    return { ok: false, message: 'Only local branches can have their subjects fixed.' }
  }
  const current = (await git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')).trim()
  if (current !== branch.shortName) {
    return {
      ok: false,
      message: `Fixing subjects rewrites the current branch. Check out ${branch.shortName} first (you're on ${current || 'a detached HEAD'}).`,
    }
  }
  if (!branch.upstream) {
    return { ok: false, message: `${branch.shortName} has no upstream, so there is no outgoing range to fix.` }
  }

  const range = `${branch.upstream}..${branch.shortName}`
  let shas: string[]
  try {
    shas = (await git.raw(['rev-list', '--reverse', range])).split('\n').map((line) => line.trim()).filter(Boolean)
  } catch (error) {
    return { ok: false, message: `Could not read ${range}: ${first((error as Error).message)}` }
  }
  if (shas.length === 0) {
    return { ok: true, rows: [], message: `Nothing to fix: ${branch.shortName} is up to date with ${branch.upstream}.` }
  }
  const merges = Number.parseInt((await git.raw(['rev-list', '--merges', '--count', range])).trim(), 10)
  if (merges > 0) {
    return {
      ok: false,
      message: `${range} contains ${merges} merge commit${merges === 1 ? '' : 's'}, which a rebase would flatten. Fix the subjects with \`git rebase -i --rebase-merges\` instead.`,
    }
  }

  let repoRoot: string
  let flagged: LintCommitResult[]
  try {
    repoRoot = (await git.revparse(['--show-toplevel'])).trim()
    if (!(await shouldLintSubjects(repoRoot))) {
      return { ok: false, message: 'Subject fixes target Conventional Commits, and this repo does not use that format (set `conventionalCommits: true` to opt in).' }
    }
    const context = await createAgentOperationContext({ repoRoot, surface: 'cli', signal })
    const lint = await runLint({ version: 1, range, severity: 'error' }, context)
    flagged = flaggedSubjects(lint.data.results)
  } catch (error) {
    return { ok: false, message: `Subject lint unavailable: ${first((error as Error).message)}` }
  }
  if (flagged.length === 0) {
    return { ok: true, rows: [], message: `All ${shas.length} outgoing subjects already follow Conventional Commits.` }
  }

  const planned = await getRebasePlanRows(git, shas[0])
  if (!planned.ok) {
    return { ok: false, message: planned.message }
  }

  const toFix = flagged.slice(0, MAX_SUBJECT_FIXES)
  const suggestions = new Map<string, string>()
  let failed = 0
  for (const commit of toFix) {
    if (signal?.aborted) break
    try {
      const message = await suggestCommitMessageForCommit(git, commit.sha, signal)
      if (message) suggestions.set(commit.sha, message)
      else failed++
    } catch {
      failed++
    }
  }

  const rows: RebasePlanRow[] = planned.rows.map((row) =>
    suggestions.has(row.sha) ? { ...row, action: 'reword', newMessage: suggestions.get(row.sha) } : row,
  )
  const skipped = flagged.length - toFix.length
  const notes = [
    failed ? `${failed} could not be drafted and stay as pick` : '',
    skipped > 0 ? `${skipped} more not drafted (limit ${MAX_SUBJECT_FIXES})` : '',
  ].filter(Boolean)

  if (suggestions.size === 0) {
    return { ok: false, message: `No subject suggestions could be drafted${notes.length ? ` (${notes.join('; ')})` : ''}. Check your provider config and try again.` }
  }
  return {
    ok: true,
    rows,
    message:
      `Rebase plan: ${suggestions.size} of ${flagged.length} bad subject${flagged.length === 1 ? '' : 's'} set to reword with a suggestion` +
      `${notes.length ? `; ${notes.join('; ')}` : ''}. Review, then enter to run.`,
  }
}
