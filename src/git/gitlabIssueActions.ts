import { defaultGlabRunner, runGlabAction, type GlabRunner } from './glabCli'
import { rejectUnsafeLabel, rejectUnsafeUsername } from './forgeArgGuards'
import type { CreateIssueInput, IssueActionResult } from './issueActions'

/**
 * GitLab issue mutations, the glab counterparts to `issueActions.ts`. Each wraps
 * a single `glab issue <verb>` invocation through the runner indirection so
 * tests can mock the shell-out. glab infers the project from the repo remote and
 * the issue from the IID. Verb/flag choices follow the glab CLI and are
 * contract-locked by the arg-builder tests; smoke-test against a live GitLab
 * before relying on them.
 */

function parseCreatedIssueUrl(output: string): string | undefined {
  return output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('https://'))
}

export function createGitLabIssue(
  input: CreateIssueInput,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<IssueActionResult> {
  if (!input.title.trim()) {
    return Promise.resolve({ ok: false, message: 'Issue title required' })
  }
  return runGlabAction(
    runner,
    ['issue', 'create', `--title=${input.title}`, `--description=${input.body}`, '--yes'],
    (output) => {
      const url = parseCreatedIssueUrl(output)
      return {
        ok: true,
        message: url ? `Created issue: ${url}` : 'Created issue',
        url,
      }
    },
    hostname
  )
}

export function commentGitLabIssue(
  issueNumber: number,
  body: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
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
    }),
    hostname
  )
}

export function addGitLabIssueLabel(
  issueNumber: number,
  label: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<IssueActionResult> {
  if (!label.trim()) {
    return Promise.resolve({ ok: false, message: 'Label name required' })
  }
  const bad = rejectUnsafeLabel(label)
  if (bad) return Promise.resolve({ ok: false, message: bad })
  return runGlabAction(
    runner,
    ['issue', 'update', String(issueNumber), `--label=${label}`],
    () => ({
      ok: true,
      message: `Added label '${label}' to issue #${issueNumber}`,
    }),
    hostname
  )
}

export function addGitLabIssueAssignee(
  issueNumber: number,
  assignee: string,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
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
    }),
    hostname
  )
}

export function closeGitLabIssue(
  issueNumber: number,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<IssueActionResult> {
  return runGlabAction(
    runner,
    ['issue', 'close', String(issueNumber)],
    (output) => ({
      ok: true,
      message: output.trim() || `Closed issue #${issueNumber}`,
    }),
    hostname
  )
}

export function reopenGitLabIssue(
  issueNumber: number,
  runner: GlabRunner = defaultGlabRunner,
  hostname?: string
): Promise<IssueActionResult> {
  return runGlabAction(
    runner,
    ['issue', 'reopen', String(issueNumber)],
    (output) => ({
      ok: true,
      message: output.trim() || `Reopened issue #${issueNumber}`,
    }),
    hostname
  )
}
