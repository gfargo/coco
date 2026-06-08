/**
 * Low-risk issue mutations driven from the issue-triage TUI (#882
 * phase 4). Mirrors `pullRequestActions.ts`'s shape — each function
 * wraps a single `gh issue <verb>` invocation through the shared
 * runner indirection so tests can mock the shell-out cleanly.
 *
 * "Low risk" here means: reversible by re-invoking with the
 * opposite flag (`--add-label` ↔ `--remove-label`), or strictly
 * additive (comment). The destructive verbs (`close`, `reopen`,
 * `delete`) land in phase 5 alongside the PR-level destructive
 * mutations, all gated through the y-confirm path.
 */

import { defaultGhRunner, resolveGhActionError, type GhRunner } from './githubCli'

export type IssueActionResult = {
  ok: boolean
  message: string
  /** Bounded extra lines from a compacted gh error, when present. */
  details?: string[]
}

async function runGhAction(
  runner: GhRunner,
  args: string[],
  successMessage: (output: string) => IssueActionResult
): Promise<IssueActionResult> {
  try {
    return successMessage(await runner(args))
  } catch (error) {
    const { message, details } = await resolveGhActionError(error, runner)
    return {
      ok: false,
      message,
      ...(details && details.length ? { details } : {}),
    }
  }
}

export function commentIssue(
  issueNumber: number,
  body: string,
  runner: GhRunner = defaultGhRunner
): Promise<IssueActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Comment body required' })
  }
  return runGhAction(
    runner,
    ['issue', 'comment', String(issueNumber), '--body', body],
    (output) => ({
      ok: true,
      message: output.trim() || `Commented on issue #${issueNumber}`,
    })
  )
}

export function addIssueLabel(
  issueNumber: number,
  label: string,
  runner: GhRunner = defaultGhRunner
): Promise<IssueActionResult> {
  if (!label.trim()) {
    return Promise.resolve({ ok: false, message: 'Label name required' })
  }
  return runGhAction(
    runner,
    ['issue', 'edit', String(issueNumber), '--add-label', label],
    () => ({
      ok: true,
      message: `Added label '${label}' to issue #${issueNumber}`,
    })
  )
}

export function addIssueAssignee(
  issueNumber: number,
  assignee: string,
  runner: GhRunner = defaultGhRunner
): Promise<IssueActionResult> {
  if (!assignee.trim()) {
    return Promise.resolve({ ok: false, message: 'Assignee login required' })
  }
  return runGhAction(
    runner,
    ['issue', 'edit', String(issueNumber), '--add-assignee', assignee],
    () => ({
      ok: true,
      message: `Assigned ${assignee} to issue #${issueNumber}`,
    })
  )
}

/**
 * Destructive issue verbs (#882 phase 5). Both routed through the
 * y-confirm path in the workstation; the action functions themselves
 * make no extra guarantee — every gh-side error surfaces via the
 * standard `runGhAction` error wrapper.
 */
export function closeIssue(
  issueNumber: number,
  runner: GhRunner = defaultGhRunner
): Promise<IssueActionResult> {
  return runGhAction(
    runner,
    ['issue', 'close', String(issueNumber)],
    (output) => ({
      ok: true,
      message: output.trim() || `Closed issue #${issueNumber}`,
    })
  )
}

export function reopenIssue(
  issueNumber: number,
  runner: GhRunner = defaultGhRunner
): Promise<IssueActionResult> {
  return runGhAction(
    runner,
    ['issue', 'reopen', String(issueNumber)],
    (output) => ({
      ok: true,
      message: output.trim() || `Reopened issue #${issueNumber}`,
    })
  )
}
