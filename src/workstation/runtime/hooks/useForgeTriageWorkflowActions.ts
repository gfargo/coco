/**
 * Forge / PR / issue-triage workflow handlers — the next domain slice
 * extracted out of `useWorkflowAction.ts`'s inline `handlers` object
 * (#1765 follow-up, OSS-948).
 *
 * Not a hook, despite the sibling filename convention — same rationale as
 * `useSubmoduleRemoteWorkflowActions`: every entry here is a plain closure
 * rebuilt fresh on each `runWorkflowAction` dispatch, and none of these
 * twenty-one is referenced by identity anywhere else. Naming this
 * `useForgeTriage...` would trip `react-hooks/rules-of-hooks` at its call
 * site — it's invoked from inside `runWorkflowAction`'s body, itself
 * nested in a `React.useCallback`, not at `useWorkflowAction`'s top level.
 * A plain factory function reproduces the exact same
 * per-dispatch-fresh-closure behavior with no dependency-array machinery
 * to get wrong.
 *
 * Reproduced verbatim from the original inline entries — same guard
 * messages, same selection resolution off the filtered triage lists, same
 * cache-invalidation depth-tagging via `issuedAtDepth` (#1384: the
 * repo-frame depth captured at keystroke time, so a mutation that
 * resolves after a repo-frame push/pop still writes to — or is dropped
 * with — the frame that issued it). The post-handler orchestration
 * (status dispatch, history refresh, pending-item spinner) stays in
 * `useWorkflowAction.ts` and treats these results identically to every
 * other handler's.
 */
import { LogInkContextStatus, updateLogInkContextStatus } from '../../chrome/context'
import { forgeNouns } from '../../chrome/forgeNouns'
import { defaultOpenUrlRunner } from '../../../git/historyActions'
import { getForgeActions } from '../../../git/forgeActions'
import { clearGitHubListCache } from '../../../git/githubListCache'
import { isPullRequestMergeStrategy } from '../../../git/pullRequestActions'
import type { GitProviderType } from '../../../git/providerData'
import { getSelectedIssue, getSelectedPullRequestTriage } from '../selection'
import type { LogInkState } from '../inkViewModel'
import type { LogInkContext } from '../types'

export type ForgeTriageWorkflowHandlersDeps = {
  /** The resolved forge action bundle (issue / PR mutations). */
  forge: ReturnType<typeof getForgeActions>
  /** The active provider id (drives `forgeNouns` copy). */
  forgeProvider: GitProviderType | undefined
  state: LogInkState
  context: LogInkContext
  /** Raw prompt payload — title/body/comment/label/assignee/strategy text. */
  payload?: string
  /** Frame-aware context setter (used by the issue / PR cache-invalidation helpers). */
  setContext: (
    arg: LogInkContext | ((prev: LogInkContext) => LogInkContext),
    targetDepth?: number,
  ) => void
  /** Frame-aware context-status setter (paired with `setContext`). */
  setContextStatus: (
    arg: LogInkContextStatus | ((prev: LogInkContextStatus) => LogInkContextStatus),
    targetDepth?: number,
  ) => void
  /** Repo-frame depth captured at keystroke time (#1384) — see `useWorkflowAction`. */
  issuedAtDepth: number
}

export function createForgeTriageWorkflowHandlers(
  deps: ForgeTriageWorkflowHandlersDeps
): Record<string, () => Promise<{ ok: boolean; message: string } | undefined>> {
  const { forge, forgeProvider, state, context, payload, setContext, setContextStatus, issuedAtDepth } = deps

  // #882 phase 4 — post-mutation cache invalidation for the
  // issue / PR triage views. Each helper does two things:
  //   1. Clears the in-memory `context.issueList` /
  //      `context.pullRequestList` entry so the view's `useEffect`
  //      retriggers on the next render and the user sees their
  //      change reflected immediately.
  //   2. Wipes the disk cache so a follow-up `coco issues` /
  //      `coco prs` CLI call doesn't serve stale data from the
  //      5-minute TTL window. Sledgehammer rather than scalpel —
  //      clearing per (repo, filter) tuple would require more
  //      bookkeeping than the cache is worth.
  const invalidateIssueListCaches = (issueNumber?: number): void => {
    setContext((current) => {
      const next = { ...current, issueList: undefined }
      // Drop only the mutated issue's detail entry so other
      // hydrated entries survive — they're still accurate. When
      // no number is given (rare), wipe the whole detail map.
      if (current.issueDetailByNumber) {
        if (typeof issueNumber === 'number') {
          const trimmed = new Map(current.issueDetailByNumber)
          trimmed.delete(issueNumber)
          next.issueDetailByNumber = trimmed
        } else {
          next.issueDetailByNumber = undefined
        }
      }
      return next
    }, issuedAtDepth)
    setContextStatus(
      (current) => updateLogInkContextStatus(current, 'issueList', 'idle'),
      issuedAtDepth,
    )
    clearGitHubListCache()
  }
  const invalidatePullRequestListCaches = (pullRequestNumber?: number): void => {
    setContext((current) => {
      const next = { ...current, pullRequestList: undefined }
      if (current.pullRequestDetailByNumber) {
        if (typeof pullRequestNumber === 'number') {
          const trimmed = new Map(current.pullRequestDetailByNumber)
          trimmed.delete(pullRequestNumber)
          next.pullRequestDetailByNumber = trimmed
        } else {
          next.pullRequestDetailByNumber = undefined
        }
      }
      return next
    }, issuedAtDepth)
    setContextStatus(
      (current) => updateLogInkContextStatus(current, 'pullRequestList', 'idle'),
      issuedAtDepth,
    )
    clearGitHubListCache()
  }

  return {
    // #783 — full PR action panel handlers. Each wraps the matching
    // pullRequestActions verb. Strategy / body arrives via `payload`
    // — input prompts validate before they reach here, but the
    // strategy guard stays as a defensive belt-and-suspenders since
    // a future palette path could call us with a raw value.
    'create-pr': async () => {
      // The input-prompt submit handler validates non-empty title
      // already; this is the defensive belt-and-suspenders for
      // future palette callers passing in a raw payload.
      const nouns = forgeNouns(forgeProvider)
      const text = (payload || '').trim()
      if (!text) {
        return { ok: false, message: `${nouns.singular} title is required (first line of the prompt).` }
      }
      const lines = text.split('\n')
      const title = lines[0].trim()
      if (!title) {
        return { ok: false, message: `${nouns.singular} title cannot be blank.` }
      }
      // Body: lines 2+, with the leading blank line tolerated. Empty
      // body is allowed — the forge renders an empty body fine.
      const body = lines.slice(1).join('\n').replace(/^\n+/, '').trimEnd()
      const head = context.branches?.currentBranch || context.provider?.currentBranch
      const base = context.provider?.repository.defaultBranch
      if (!head) {
        return { ok: false, message: 'No current branch detected.' }
      }
      if (!base) {
        return { ok: false, message: `No default branch detected. Configure the ${nouns.name} remote.` }
      }
      return forge.createPullRequest({ base, head, title, body })
    },
    'merge-pr': async () => {
      const strategy = (payload || 'merge').toLowerCase()
      if (!isPullRequestMergeStrategy(strategy)) {
        return { ok: false, message: `Unknown merge strategy: ${strategy}. Use merge, squash, or rebase.` }
      }
      return forge.mergePullRequest(strategy)
    },
    'close-pr': async () => forge.closePullRequest(),
    'approve-pr': async () => forge.approvePullRequest(),
    'request-changes-pr': async () => {
      const body = payload?.trim()
      if (!body) return { ok: false, message: 'Review body required for change-request' }
      return forge.requestChangesPullRequest(body)
    },
    'comment-pr': async () => {
      const body = payload?.trim()
      if (!body) return { ok: false, message: 'Comment body required' }
      return forge.commentPullRequest(body)
    },
    // #882 phase 4 — triage-view low-risk mutations. Each picks
    // the cursored item from the *filtered* list (matching what
    // the user sees on screen), runs the corresponding `gh` action,
    // and on success clears both the in-memory context entry and
    // the disk cache so the next view entry refetches. Comment
    // is additive; label / assign are toggleable via re-invocation
    // with --remove-* (deferred to phase 5 as part of the y-confirm
    // suite). Open / yank don't mutate so they skip the
    // invalidation step entirely.
    'triage-issue-open': async () => {
      const issue = getSelectedIssue(state, context)
      if (!issue) return { ok: false, message: 'No issue under cursor' }
      try {
        await defaultOpenUrlRunner(issue.url)
        return { ok: true, message: `Opened ${issue.url}` }
      } catch (error) {
        return { ok: false, message: (error as Error).message }
      }
    },
    'triage-issue-comment': async () => {
      const body = payload?.trim()
      if (!body) return { ok: false, message: 'Comment body required' }
      const issue = getSelectedIssue(state, context)
      if (!issue) return { ok: false, message: 'No issue under cursor' }
      const result = await forge.commentIssue(issue.number, body)
      if (result.ok) invalidateIssueListCaches(issue.number)
      return result
    },
    'triage-issue-label': async () => {
      const label = payload?.trim()
      if (!label) return { ok: false, message: 'Label name required' }
      const issue = getSelectedIssue(state, context)
      if (!issue) return { ok: false, message: 'No issue under cursor' }
      const result = await forge.addIssueLabel(issue.number, label)
      if (result.ok) invalidateIssueListCaches(issue.number)
      return result
    },
    'triage-issue-assign': async () => {
      const assignee = payload?.trim()
      if (!assignee) return { ok: false, message: 'Assignee login required' }
      const issue = getSelectedIssue(state, context)
      if (!issue) return { ok: false, message: 'No issue under cursor' }
      const result = await forge.addIssueAssignee(issue.number, assignee)
      if (result.ok) invalidateIssueListCaches(issue.number)
      return result
    },
    'triage-pr-open': async () => {
      const pr = getSelectedPullRequestTriage(state, context)
      if (!pr) return { ok: false, message: 'No pull request under cursor' }
      try {
        await defaultOpenUrlRunner(pr.url)
        return { ok: true, message: `Opened ${pr.url}` }
      } catch (error) {
        return { ok: false, message: (error as Error).message }
      }
    },
    'triage-pr-comment': async () => {
      const body = payload?.trim()
      if (!body) return { ok: false, message: 'Comment body required' }
      const pr = getSelectedPullRequestTriage(state, context)
      if (!pr) return { ok: false, message: 'No pull request under cursor' }
      const result = await forge.commentPullRequestByNumber(pr.number, body)
      if (result.ok) invalidatePullRequestListCaches(pr.number)
      return result
    },
    'triage-pr-label': async () => {
      const label = payload?.trim()
      if (!label) return { ok: false, message: 'Label name required' }
      const pr = getSelectedPullRequestTriage(state, context)
      if (!pr) return { ok: false, message: 'No pull request under cursor' }
      const result = await forge.addPullRequestLabel(pr.number, label)
      if (result.ok) invalidatePullRequestListCaches(pr.number)
      return result
    },
    'triage-pr-assign': async () => {
      const assignee = payload?.trim()
      if (!assignee) return { ok: false, message: 'Assignee login required' }
      const pr = getSelectedPullRequestTriage(state, context)
      if (!pr) return { ok: false, message: 'No pull request under cursor' }
      const result = await forge.addPullRequestAssignee(pr.number, assignee)
      if (result.ok) invalidatePullRequestListCaches(pr.number)
      return result
    },
    // #882 phase 5 — destructive triage mutations. Each is gated
    // through the y-confirm path so the user sees a prompt before
    // anything ships. The runner reads the cursored item from the
    // filtered list at confirm-time; the cursor can't move while
    // the confirmation overlay is up so there's no stale-target
    // window. Cache invalidation matches the phase-4 pattern.
    'triage-issue-close': async () => {
      const issue = getSelectedIssue(state, context)
      if (!issue) return { ok: false, message: 'No issue under cursor' }
      const result = await forge.closeIssue(issue.number)
      if (result.ok) invalidateIssueListCaches(issue.number)
      return result
    },
    'triage-issue-reopen': async () => {
      const issue = getSelectedIssue(state, context)
      if (!issue) return { ok: false, message: 'No issue under cursor' }
      const result = await forge.reopenIssue(issue.number)
      if (result.ok) invalidateIssueListCaches(issue.number)
      return result
    },
    'triage-pr-merge': async () => {
      const strategy = payload?.trim()
      if (!strategy || !isPullRequestMergeStrategy(strategy)) {
        return {
          ok: false,
          message: `Unknown merge strategy: ${strategy}. Use merge, squash, or rebase.`,
        }
      }
      const pr = getSelectedPullRequestTriage(state, context)
      if (!pr) return { ok: false, message: 'No pull request under cursor' }
      const result = await forge.mergePullRequestByNumber(pr.number, strategy)
      if (result.ok) invalidatePullRequestListCaches(pr.number)
      return result
    },
    'triage-pr-close': async () => {
      const pr = getSelectedPullRequestTriage(state, context)
      if (!pr) return { ok: false, message: 'No pull request under cursor' }
      const result = await forge.closePullRequestByNumber(pr.number)
      if (result.ok) invalidatePullRequestListCaches(pr.number)
      return result
    },
    'triage-pr-approve': async () => {
      const pr = getSelectedPullRequestTriage(state, context)
      if (!pr) return { ok: false, message: 'No pull request under cursor' }
      const result = await forge.approvePullRequestByNumber(pr.number)
      if (result.ok) invalidatePullRequestListCaches(pr.number)
      return result
    },
    'triage-pr-request-changes': async () => {
      const body = payload?.trim()
      if (!body) return { ok: false, message: 'Review body required for change-request' }
      const pr = getSelectedPullRequestTriage(state, context)
      if (!pr) return { ok: false, message: 'No pull request under cursor' }
      const result = await forge.requestChangesPullRequestByNumber(pr.number, body)
      if (result.ok) invalidatePullRequestListCaches(pr.number)
      return result
    },
    // #1363 — `gh pr checkout <n>` for the cursored triage row. The
    // only triage verb that mutates LOCAL state (HEAD moves), so it
    // skips the list-cache invalidation (the PR itself is untouched)
    // and instead rides the checkout follow-ups in `useWorkflowAction`:
    // history refresh + cursor snap + silent context refresh, exactly
    // like `checkout-branch`.
    'triage-pr-checkout': async () => {
      // The PR-diff `C` path carries the viewed PR's number as the
      // payload (the triage cursor could drift if the list refetched
      // under the open diff); the triage-list `C` path omits it and
      // targets the cursored row.
      const payloadNumber = Number(payload)
      if (payload && Number.isInteger(payloadNumber) && payloadNumber > 0) {
        return forge.checkoutPullRequestByNumber(payloadNumber)
      }
      const pr = getSelectedPullRequestTriage(state, context)
      if (!pr) return { ok: false, message: 'No pull request under cursor' }
      return forge.checkoutPullRequestByNumber(pr.number)
    },
  }
}
