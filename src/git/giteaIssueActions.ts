import { runGiteaAction, resolveGiteaLabelId, type GiteaRunner } from './giteaCli'
import { rejectFlagLike, rejectUnsafeUsername } from './forgeArgGuards'
import type { CreateIssueInput, IssueActionResult } from './issueActions'

/**
 * Gitea/Forgejo issue mutations via the REST API v1. Mirrors
 * `bitbucketIssueActions.ts` — each wraps a single Gitea REST call through the
 * runner indirection. `runner` is a host-bound `GiteaRunner` (see
 * `giteaCli.ts`'s `makeGiteaRunner`).
 */

export function createGiteaIssue(
  projectPath: string,
  input: CreateIssueInput,
  runner: GiteaRunner
): Promise<IssueActionResult> {
  if (!input.title.trim()) return Promise.resolve({ ok: false, message: 'Issue title required' })
  return runGiteaAction(
    runner,
    `repos/${projectPath}/issues`,
    'POST',
    { title: input.title, body: input.body },
    (out) => {
      const issue = out.trim() ? (JSON.parse(out) as { html_url?: string }) : undefined
      const url = issue?.html_url
      return { ok: true, message: url ? `Created issue: ${url}` : 'Created issue', url }
    }
  )
}

export function commentGiteaIssue(
  projectPath: string,
  issueNumber: number,
  body: string,
  runner: GiteaRunner
): Promise<IssueActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Comment body required' })
  return runGiteaAction(
    runner,
    `repos/${projectPath}/issues/${issueNumber}/comments`,
    'POST',
    { body },
    () => ({ ok: true, message: `Commented on issue #${issueNumber}` })
  )
}

/**
 * Gitea's "add label to issue" endpoint takes label IDs, not names, so this
 * resolves the name to an ID via the repo's label list first.
 */
export async function addGiteaIssueLabel(
  projectPath: string,
  issueNumber: number,
  label: string,
  runner: GiteaRunner
): Promise<IssueActionResult> {
  if (!label.trim()) return { ok: false, message: 'Label name required' }
  const bad = rejectFlagLike(label, 'Label')
  if (bad) return { ok: false, message: bad }

  const lookup = await resolveGiteaLabelId(projectPath, label, runner)
  if (lookup.status === 'not-found') {
    return { ok: false, message: `Label '${label}' not found on this repository. Create it in Gitea first.` }
  }
  if (lookup.status === 'error') {
    return { ok: false, message: `Could not verify label '${label}': ${lookup.message}` }
  }

  return runGiteaAction(
    runner,
    `repos/${projectPath}/issues/${issueNumber}/labels`,
    'POST',
    { labels: [lookup.id] },
    () => ({ ok: true, message: `Added label '${label}' to issue #${issueNumber}` })
  )
}

export function addGiteaIssueAssignee(
  projectPath: string,
  issueNumber: number,
  assignee: string,
  runner: GiteaRunner
): Promise<IssueActionResult> {
  if (!assignee.trim()) return Promise.resolve({ ok: false, message: 'Assignee username required' })
  const bad = rejectUnsafeUsername(assignee)
  if (bad) return Promise.resolve({ ok: false, message: bad })

  return runGiteaAction(
    runner,
    `repos/${projectPath}/issues/${issueNumber}`,
    'PATCH',
    { assignees: [assignee] },
    () => ({ ok: true, message: `Assigned ${assignee} to issue #${issueNumber}` })
  )
}

export function closeGiteaIssue(
  projectPath: string,
  issueNumber: number,
  runner: GiteaRunner
): Promise<IssueActionResult> {
  return runGiteaAction(
    runner,
    `repos/${projectPath}/issues/${issueNumber}`,
    'PATCH',
    { state: 'closed' },
    () => ({ ok: true, message: `Closed issue #${issueNumber}` })
  )
}

export function reopenGiteaIssue(
  projectPath: string,
  issueNumber: number,
  runner: GiteaRunner
): Promise<IssueActionResult> {
  return runGiteaAction(
    runner,
    `repos/${projectPath}/issues/${issueNumber}`,
    'PATCH',
    { state: 'open' },
    () => ({ ok: true, message: `Reopened issue #${issueNumber}` })
  )
}
