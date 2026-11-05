import { SimpleGit } from 'simple-git'
import { createAgentOperationContext } from '../operations/agent/context'
import { generateAgentReview, runLint } from '../operations/agent/generate'
import { AgentTaskInputSchema, type AgentTaskInput, type LintCommitResult, type ReviewData } from '../operations/agent/schemas'
import { loadConfig } from '../lib/config/utils/loadConfig'
import { commitlintImpliesConventional } from '../lib/utils/hasCommitlintConfig'
import type { BranchActionResult } from './branchActions'
import type { BranchRef } from './branchData'

/** Severity at or above which a finding is reported as blocking-grade in the summary line. */
export const OUTGOING_REVIEW_HIGH_SEVERITY = 7

type ReviewFinding = ReviewData['findings'][number]

const ONE_LINE_LIMIT = 160

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > ONE_LINE_LIMIT ? `${flat.slice(0, ONE_LINE_LIMIT - 1)}…` : flat
}

/** Findings sorted most severe first, then by title so the order is stable. */
export function sortFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort((a, b) => b.severity - a.severity || a.title.localeCompare(b.title))
}

export type ReviewOutcome = { findings: ReviewFinding[] } | { error: string }
export type LintOutcome = { results: LintCommitResult[] } | { error: string }

/** Subjects that break the Conventional Commits rules, in commit order. */
export function flaggedSubjects(results: LintCommitResult[]): LintCommitResult[] {
  return results.filter((result) => result.status === 'fail' || result.status === 'warn')
}

function subjectLine(result: LintCommitResult): string {
  const problems = [...result.errors, ...result.warnings].map(oneLine).join('; ')
  return `Subject ${result.shortSha} ${oneLine(result.subject)}: ${problems}`
}

/**
 * Compose the result-panel lines and one-line summary from the review and the
 * subject lint. Either half may be unavailable without hiding the other; the
 * lint half is `undefined` when the repo doesn't use Conventional Commits.
 */
export function formatOutgoingReview(
  branch: string,
  upstream: string,
  commitCount: number,
  review: ReviewOutcome,
  lint?: LintOutcome,
): BranchActionResult {
  const commits = `${commitCount} outgoing commit${commitCount === 1 ? '' : 's'}`
  const parts: string[] = []
  const details: string[] = []
  let anyResult = false
  let allClean = true

  if ('error' in review) {
    parts.push(`review unavailable (${review.error})`)
    allClean = false
  } else {
    anyResult = true
    const { findings } = review
    if (findings.length === 0) {
      parts.push('no review findings')
    } else {
      allClean = false
      const high = findings.filter((finding) => finding.severity >= OUTGOING_REVIEW_HIGH_SEVERITY).length
      parts.push(
        `${findings.length} finding${findings.length === 1 ? '' : 's'}` +
          `${high ? `, ${high} high severity (${OUTGOING_REVIEW_HIGH_SEVERITY}+)` : ''}`,
      )
      for (const finding of sortFindings(findings)) {
        const where = finding.filePath ? ` (${finding.filePath})` : ''
        details.push(`[${finding.severity}] ${oneLine(finding.title)}${where}: ${oneLine(finding.summary)}`)
      }
    }
  }

  if (lint) {
    if ('error' in lint) {
      parts.push(`subject lint unavailable (${lint.error})`)
      allClean = false
    } else {
      anyResult = true
      const flagged = flaggedSubjects(lint.results)
      if (flagged.length === 0) {
        parts.push('all subjects follow Conventional Commits')
      } else {
        allClean = false
        parts.push(`${flagged.length} of ${lint.results.length} subject${lint.results.length === 1 ? '' : 's'} break Conventional Commits`)
        details.push(...flagged.map(subjectLine))
      }
    }
  }

  const tail = allClean ? 'Press P to push.' : anyResult ? 'Nothing was pushed.' : 'You can still push with P.'
  return {
    ok: anyResult,
    message: `Reviewed ${commits} on ${branch} (${upstream}..${branch}): ${parts.join('; ')}. ${tail}`,
    ...(details.length ? { details } : {}),
  }
}

async function runReview(input: AgentTaskInput, context: Awaited<ReturnType<typeof createAgentOperationContext>>): Promise<ReviewOutcome> {
  try {
    const result = await generateAgentReview(input, context)
    if (result.status !== 'completed') {
      return { error: 'the review was only planned, not run' }
    }
    return { findings: result.data.findings }
  } catch (error) {
    return { error: (error as Error).message.split('\n')[0] }
  }
}

async function runSubjectLint(range: string, context: Awaited<ReturnType<typeof createAgentOperationContext>>): Promise<LintOutcome> {
  try {
    const result = await runLint({ version: 1, range, severity: 'error' }, context)
    return { results: result.data.results }
  } catch (error) {
    return { error: (error as Error).message.split('\n')[0] }
  }
}

/**
 * Whether outgoing subjects should be linted: only when the repo uses
 * Conventional Commits (explicit `conventionalCommits`, else a commitlint
 * config that requires it, #2130). Otherwise the built-in rules would flag
 * every subject in a repo that never followed that format.
 */
export async function shouldLintSubjects(repoRoot: string): Promise<boolean> {
  const config = loadConfig<Record<string, unknown>, Record<string, unknown>>({}, { cwd: repoRoot })
  const explicit = (config as { conventionalCommits?: boolean }).conventionalCommits
  return explicit !== undefined ? explicit : commitlintImpliesConventional()
}

/**
 * Review the commits `branch` would push (`<upstream>..<branch>`) and lint
 * their subjects (#2216). Read-only: it never pushes, so the caller decides
 * afterwards. Any failure (no LLM configured, provider unreachable) comes
 * back as a non-ok or partial result rather than a throw, and a review
 * failure never hides the subject lint.
 */
export async function reviewOutgoingRange(
  git: SimpleGit,
  branch: BranchRef,
  signal?: AbortSignal,
): Promise<BranchActionResult> {
  if (branch.type !== 'local') {
    return { ok: false, message: 'Only local branches can be reviewed before pushing.' }
  }
  if (!branch.upstream) {
    return {
      ok: false,
      message: `${branch.shortName} has no upstream, so there is no outgoing range to review. Push it first, or run \`coco review\` on the range.`,
    }
  }

  const range = `${branch.upstream}..${branch.shortName}`
  let commitCount: number
  try {
    commitCount = Number.parseInt((await git.raw(['rev-list', '--count', range])).trim(), 10)
  } catch (error) {
    return { ok: false, message: `Could not read ${range}: ${(error as Error).message.split('\n')[0]}` }
  }
  if (!Number.isFinite(commitCount) || commitCount === 0) {
    return { ok: true, message: `Nothing to push: ${branch.shortName} is up to date with ${branch.upstream}.` }
  }

  try {
    const input: AgentTaskInput = AgentTaskInputSchema.parse({
      source: { kind: 'repository', scope: { type: 'range', from: branch.upstream, to: branch.shortName } },
    }) as AgentTaskInput
    const repoRoot = (await git.revparse(['--show-toplevel'])).trim()
    const context = await createAgentOperationContext({ repoRoot, surface: 'cli', signal })
    const [review, lint] = await Promise.all([
      runReview(input, context),
      (await shouldLintSubjects(repoRoot)) ? runSubjectLint(range, context) : Promise.resolve(undefined),
    ])
    return formatOutgoingReview(branch.shortName, branch.upstream, commitCount, review, lint)
  } catch (error) {
    return {
      ok: false,
      message: `Review unavailable: ${(error as Error).message.split('\n')[0]}. You can still push with P.`,
    }
  }
}
