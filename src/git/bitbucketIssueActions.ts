import { defaultBitbucketRunner, runBitbucketAction, type BitbucketRunner } from './bitbucketCli'
import { rejectUnsafeUsername } from './forgeArgGuards'
import type { IssueActionResult } from './issueActions'

/**
 * Bitbucket issue mutations via the REST API v2. Mirrors `gitlabIssueActions.ts`
 * — each wraps a single Bitbucket REST call through the runner indirection.
 *
 * Bitbucket Cloud issues have `status` (not `state`), a single `assignee`
 * (not an array), and no labels — only `kind` (bug/enhancement/proposal/task)
 * and `priority`. `addBitbucketIssueLabel` is intentionally unsupported; see
 * the comment inline.
 */

export function commentBitbucketIssue(
  projectPath: string,
  issueNumber: number,
  body: string,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<IssueActionResult> {
  if (!body.trim()) return Promise.resolve({ ok: false, message: 'Comment body required' })
  return runBitbucketAction(
    runner,
    `repositories/${projectPath}/issues/${issueNumber}/comments`,
    'POST',
    { content: { raw: body } },
    () => ({ ok: true, message: `Commented on issue #${issueNumber}` })
  )
}

/**
 * Bitbucket issues have no free-form labels — they use `kind` and `priority`
 * fields instead. Return an informative error rather than silently doing nothing.
 */
export function addBitbucketIssueLabel(): Promise<IssueActionResult> {
  return Promise.resolve({
    ok: false,
    message: 'Issue labels are not supported on Bitbucket Cloud. Use `kind` (bug/enhancement/proposal/task) or `priority` instead.',
  })
}

export function addBitbucketIssueAssignee(
  projectPath: string,
  issueNumber: number,
  assignee: string,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<IssueActionResult> {
  if (!assignee.trim()) return Promise.resolve({ ok: false, message: 'Assignee username required' })
  const bad = rejectUnsafeUsername(assignee)
  if (bad) return Promise.resolve({ ok: false, message: bad })

  return runBitbucketAction(
    runner,
    `repositories/${projectPath}/issues/${issueNumber}`,
    'PUT',
    { assignee: { nickname: assignee } },
    () => ({ ok: true, message: `Assigned ${assignee} to issue #${issueNumber}` })
  )
}

export function closeBitbucketIssue(
  projectPath: string,
  issueNumber: number,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<IssueActionResult> {
  return runBitbucketAction(
    runner,
    `repositories/${projectPath}/issues/${issueNumber}`,
    'PUT',
    { status: 'resolved' },
    () => ({ ok: true, message: `Closed issue #${issueNumber}` })
  )
}

export function reopenBitbucketIssue(
  projectPath: string,
  issueNumber: number,
  runner: BitbucketRunner = defaultBitbucketRunner
): Promise<IssueActionResult> {
  return runBitbucketAction(
    runner,
    `repositories/${projectPath}/issues/${issueNumber}`,
    'PUT',
    { status: 'open' },
    () => ({ ok: true, message: `Reopened issue #${issueNumber}` })
  )
}
