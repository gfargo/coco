import { SimpleGit } from 'simple-git'
import { createAgentOperationContext } from '../operations/agent/context'
import { generateAgentRecap } from '../operations/agent/generate'
import { AgentTaskInputSchema, type AgentTaskInput } from '../operations/agent/schemas'
import type { BranchActionResult } from './branchActions'

const first = (text: string) => text.split('\n')[0]

/** Split a model summary into non-empty lines for the result panel. */
export function summaryLines(summary: string): string[] {
  return summary
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
}

/**
 * Summarize what `head` adds over `base` (#2217): the three-dot range
 * `base...head`, the same comparison a pull request shows, run through the
 * recap generator. Read-only. Failures (no provider configured, unreadable
 * range) come back as a non-ok result rather than a throw.
 */
export async function summarizeCompareRange(
  git: SimpleGit,
  baseRef: string,
  headRef: string,
  signal?: AbortSignal,
): Promise<BranchActionResult> {
  if (baseRef === headRef) {
    return { ok: false, message: `Base and head are both ${baseRef}. Move the cursor to a different branch to summarize it against the base.` }
  }

  let ahead: number
  try {
    ahead = Number.parseInt((await git.raw(['rev-list', '--count', `${baseRef}..${headRef}`])).trim(), 10)
  } catch (error) {
    return { ok: false, message: `Could not read ${baseRef}...${headRef}: ${first((error as Error).message)}` }
  }
  if (!Number.isFinite(ahead) || ahead === 0) {
    return { ok: true, message: `${headRef} has no commits that ${baseRef} lacks, so there is nothing to summarize.` }
  }

  try {
    const input = AgentTaskInputSchema.parse({
      source: { kind: 'repository', scope: { type: 'branch', base: baseRef, head: headRef } },
    }) as AgentTaskInput
    const repoRoot = (await git.revparse(['--show-toplevel'])).trim()
    const context = await createAgentOperationContext({ repoRoot, surface: 'cli', signal })
    const result = await generateAgentRecap(input, context)
    if (result.status !== 'completed') {
      return { ok: false, message: 'Summary unavailable: the recap was only planned, not run.' }
    }
    const { title, summary } = result.data
    return {
      ok: true,
      message: `${headRef} vs ${baseRef} (${ahead} commit${ahead === 1 ? '' : 's'}): ${title}`,
      details: summaryLines(summary),
    }
  } catch (error) {
    return { ok: false, message: `Summary unavailable: ${first((error as Error).message)}` }
  }
}
