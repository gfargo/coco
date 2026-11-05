import { SimpleGit } from 'simple-git'
import { createAgentOperationContext } from '../operations/agent/context'
import { generateAgentReview } from '../operations/agent/generate'
import { AgentTaskInputSchema, type AgentTaskInput, type ReviewData } from '../operations/agent/schemas'
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

/** Turn review findings into the result-panel lines and a one-line summary. */
export function formatOutgoingReview(
  branch: string,
  upstream: string,
  commitCount: number,
  findings: ReviewFinding[],
): BranchActionResult {
  const commits = `${commitCount} outgoing commit${commitCount === 1 ? '' : 's'}`
  if (findings.length === 0) {
    return { ok: true, message: `Reviewed ${commits} on ${branch} (${upstream}..${branch}): no findings. Press P to push.` }
  }
  const high = findings.filter((finding) => finding.severity >= OUTGOING_REVIEW_HIGH_SEVERITY).length
  const sorted = sortFindings(findings)
  return {
    ok: true,
    message:
      `Reviewed ${commits} on ${branch}: ${findings.length} finding${findings.length === 1 ? '' : 's'}` +
      `${high ? `, ${high} high severity (${OUTGOING_REVIEW_HIGH_SEVERITY}+)` : ''}. Nothing was pushed.`,
    details: sorted.map((finding) => {
      const where = finding.filePath ? ` (${finding.filePath})` : ''
      return `[${finding.severity}] ${oneLine(finding.title)}${where}: ${oneLine(finding.summary)}`
    }),
  }
}

/**
 * Review the commits `branch` would push (`<upstream>..<branch>`) and return
 * the findings for the result panel (#2216). Read-only: it never pushes, so
 * the caller decides afterwards. Any failure (no LLM configured, provider
 * unreachable) comes back as a non-ok result rather than a throw, so the
 * push menu stays usable.
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
    const result = await generateAgentReview(input, context)
    if (result.status !== 'completed') {
      return { ok: false, message: 'Review unavailable: the review was only planned, not run.' }
    }
    return formatOutgoingReview(branch.shortName, branch.upstream, commitCount, result.data.findings)
  } catch (error) {
    return {
      ok: false,
      message: `Review unavailable: ${(error as Error).message.split('\n')[0]}. You can still push with P.`,
    }
  }
}
