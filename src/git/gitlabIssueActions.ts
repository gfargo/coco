import { defaultGlabRunner, resolveGlabActionError, type GlabRunner } from './glabCli'
import { rejectFlagLike, rejectUnsafeUsername } from './forgeArgGuards'
import type { IssueActionResult } from './issueActions'

/**
 * GitLab issue mutations, the glab counterparts to `issueActions.ts`. Each wraps
 * a single `glab issue <verb>` invocation through the runner indirection so
 * tests can mock the shell-out. glab infers the project from the repo remote and
 * the issue from the IID. Verb/flag choices follow the glab CLI and are
 * contract-locked by the arg-builder tests; smoke-test against a live GitLab
 * before relying on them.
 */

async function runGlabAction(
  runner: GlabRunner,
  args: string[],
  onSuccess: (output: string) => IssueActionResult
): Promise<IssueActionResult> {
  try {
    return onSuccess(await runner(args))
  } catch (error) {
    const { message, details } = await resolveGlabActionError(error, runner)
    return { ok: false, message, ...(details && details.length ? { details } : {}) }
  }
}

export function commentGitLabIssue(
  issueNumber: number,
  body: string,
  runner: GlabRunner = defaultGlabRunner
): Promise<IssueActionResult> {
  if (!body.trim()) {
    return Promise.resolve({ ok: false, message: 'Comment body required' })
  }
  return runGlabAction(
    runner,
    ['issue', 'note', String(issueNumber), `--message=${body}`],
    (output) => ({
      ok: true,
      message: output.trim() || `Commented on issue #${issueNumber}`,
    })
  )
}

export function addGitLabIssueLabel(
  issueNumber: number,
  label: string,
  runner: GlabRunner = defaultGlabRunner
): Promise<IssueActionResult> {
  if (!label.trim()) {
    return Promise.resolve({ ok: false, message: 'Label name required' })
  }
  const bad = rejectFlagLike(label, 'Label')
  if (bad) return Promise.resolve({ ok: false, message: bad })
  return runGlabAction(
    runner,
    ['issue', 'update', String(issueNumber), `--label=${label}`],
    () => ({
      ok: true,
      message: `Added label '${label}' to issue #${issueNumber}`,
    })
  )
}

export function addGitLabIssueAssignee(
  issueNumber: number,
  assignee: string,
  runner: GlabRunner = defaultGlabRunner
): Promise<IssueActionResult> {
  if (!assignee.trim()) {
    return Promise.resolve({ ok: false, message: 'Assignee username required' })
  }
  const bad = rejectUnsafeUsername(assignee)
  if (bad) return Promise.resolve({ ok: false, message: bad })
  return runGlabAction(
    runner,
    // `+` prefix ADDS to existing assignees; a bare username would replace them.
    ['issue', 'update', String(issueNumber), `--assignee=+${assignee}`],
    () => ({
      ok: true,
      message: `Assigned ${assignee} to issue #${issueNumber}`,
    })
  )
}

export function closeGitLabIssue(
  issueNumber: number,
  runner: GlabRunner = defaultGlabRunner
): Promise<IssueActionResult> {
  return runGlabAction(runner, ['issue', 'close', String(issueNumber)], (output) => ({
    ok: true,
    message: output.trim() || `Closed issue #${issueNumber}`,
  }))
}

export function reopenGitLabIssue(
  issueNumber: number,
  runner: GlabRunner = defaultGlabRunner
): Promise<IssueActionResult> {
  return runGlabAction(runner, ['issue', 'reopen', String(issueNumber)], (output) => ({
    ok: true,
    message: output.trim() || `Reopened issue #${issueNumber}`,
  }))
}
