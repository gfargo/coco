import type { IssueActionResult } from './issueActions'

/**
 * Bitbucket Server / Data Center has no built-in issue tracker — issue
 * tracking is a separate Jira integration, not part of the `rest/api/1.0`
 * surface this forge otherwise uses. Every mutation here is a graceful,
 * explicit "unsupported" rather than a dead-ending REST call, mirroring how
 * `bitbucketServerListData.ts` / `bitbucketServerDetailData.ts` handle issue
 * reads.
 */

const UNSUPPORTED_MESSAGE = 'Issues are not supported on Bitbucket Server (no built-in issue tracker).'

export function createBitbucketServerIssue(): Promise<IssueActionResult> {
  return Promise.resolve({ ok: false, message: UNSUPPORTED_MESSAGE })
}

export function commentBitbucketServerIssue(): Promise<IssueActionResult> {
  return Promise.resolve({ ok: false, message: UNSUPPORTED_MESSAGE })
}

export function addBitbucketServerIssueLabel(): Promise<IssueActionResult> {
  return Promise.resolve({ ok: false, message: UNSUPPORTED_MESSAGE })
}

export function addBitbucketServerIssueAssignee(): Promise<IssueActionResult> {
  return Promise.resolve({ ok: false, message: UNSUPPORTED_MESSAGE })
}

export function closeBitbucketServerIssue(): Promise<IssueActionResult> {
  return Promise.resolve({ ok: false, message: UNSUPPORTED_MESSAGE })
}

export function reopenBitbucketServerIssue(): Promise<IssueActionResult> {
  return Promise.resolve({ ok: false, message: UNSUPPORTED_MESSAGE })
}
