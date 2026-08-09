import type { IssueActionResult } from './issueActions'

/**
 * Azure DevOps Repos has no built-in "issue" concept — work is tracked
 * through Work Items, a structurally different API (`_apis/wit`, WIQL
 * queries, custom field schemas per process template) with no 1:1 mapping to
 * the title/body/labels/assignees shape the other forges' issue actions
 * share. Every mutation here is a graceful, explicit "unsupported" rather
 * than a guessed lossy mapping, mirroring `bitbucketServerIssueActions.ts`
 * (Bitbucket Server has the same no-native-issue-tracker gap).
 */

const UNSUPPORTED_MESSAGE =
  'Azure DevOps tracks Work Items, not issues — coco does not map them yet (no 1:1 shape).'

export function createAzureDevOpsIssue(): Promise<IssueActionResult> {
  return Promise.resolve({ ok: false, message: UNSUPPORTED_MESSAGE })
}

export function commentAzureDevOpsIssue(): Promise<IssueActionResult> {
  return Promise.resolve({ ok: false, message: UNSUPPORTED_MESSAGE })
}

export function addAzureDevOpsIssueLabel(): Promise<IssueActionResult> {
  return Promise.resolve({ ok: false, message: UNSUPPORTED_MESSAGE })
}

export function addAzureDevOpsIssueAssignee(): Promise<IssueActionResult> {
  return Promise.resolve({ ok: false, message: UNSUPPORTED_MESSAGE })
}

export function closeAzureDevOpsIssue(): Promise<IssueActionResult> {
  return Promise.resolve({ ok: false, message: UNSUPPORTED_MESSAGE })
}

export function reopenAzureDevOpsIssue(): Promise<IssueActionResult> {
  return Promise.resolve({ ok: false, message: UNSUPPORTED_MESSAGE })
}
