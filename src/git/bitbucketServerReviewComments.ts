import { compactBitbucketServerError, splitBitbucketServerPath, type BitbucketServerRunner } from './bitbucketServerCli'
import type { PullRequestActionResult } from './pullRequestActions'
import {
  isAnchorRejection,
  summarizeReviewCommentPosts,
  type CreateReviewOptions,
  type ReviewCommentInput,
  type ReviewCommentPostOutcome,
} from './pullRequestReviewComments'

/** Bitbucket Server's native line-anchor equivalent of Cloud's `inline` object. */
function buildAnchor(comment: ReviewCommentInput) {
  return {
    path: comment.path,
    line: comment.line,
    lineType: comment.side === 'LEFT' ? 'REMOVED' : 'ADDED',
    fileType: comment.side === 'LEFT' ? 'FROM' : 'TO',
    diffType: 'EFFECTIVE',
  }
}

async function postFallbackNote(
  projectKey: string,
  repoSlug: string,
  pullRequestNumber: number,
  comment: ReviewCommentInput,
  runner: BitbucketServerRunner
): Promise<void> {
  await runner(`projects/${projectKey}/repos/${repoSlug}/pull-requests/${pullRequestNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text: `\`${comment.path}:${comment.line}\` — ${comment.body}` }),
  })
}

/**
 * Post inline PR comments via Bitbucket Server / Data Center's
 * `POST projects/{key}/repos/{slug}/pull-requests/{n}/comments` with an
 * `anchor` object (OSS-2407) — Server has no `inline` key (that's Cloud's
 * vocabulary); `anchor` is its native equivalent. No batch "review"
 * endpoint here either, so each comment is its own POST, posted serially. A
 * comment whose anchor the server rejects falls back to a plain comment
 * carrying the location in the body.
 */
export async function createBitbucketServerReviewComments(
  projectPath: string,
  pullRequestNumber: number,
  comments: ReviewCommentInput[],
  options: CreateReviewOptions = {},
  runner: BitbucketServerRunner
): Promise<PullRequestActionResult> {
  if (comments.length === 0) {
    return { ok: false, message: 'No inline review comments to post' }
  }
  const parts = splitBitbucketServerPath(projectPath)
  if (!parts) {
    return { ok: false, message: 'No Bitbucket Server project resolved' }
  }

  const outcomes: ReviewCommentPostOutcome[] = []
  for (const comment of comments) {
    try {
      await runner(`projects/${parts.projectKey}/repos/${parts.repoSlug}/pull-requests/${pullRequestNumber}/comments`, {
        method: 'POST',
        body: JSON.stringify({ text: comment.body, anchor: buildAnchor(comment) }),
      })
      outcomes.push({ comment, status: 'posted' })
      continue
    } catch (error) {
      if (!isAnchorRejection(error)) {
        outcomes.push({
          comment,
          status: 'failed',
          error: compactBitbucketServerError((error as Error).message || '').message,
        })
        continue
      }
    }

    try {
      await postFallbackNote(parts.projectKey, parts.repoSlug, pullRequestNumber, comment, runner)
      outcomes.push({ comment, status: 'fallback' })
    } catch (fallbackError) {
      outcomes.push({
        comment,
        status: 'failed',
        error: compactBitbucketServerError((fallbackError as Error).message || '').message,
      })
    }
  }

  // Bitbucket Server has no review-level "request changes" state; mirror
  // the Cloud adapter's prefixed trailing-comment pattern.
  if (options.event === 'REQUEST_CHANGES' && options.body) {
    try {
      await runner(`projects/${parts.projectKey}/repos/${parts.repoSlug}/pull-requests/${pullRequestNumber}/comments`, {
        method: 'POST',
        body: JSON.stringify({ text: `Requested changes: ${options.body}` }),
      })
    } catch {
      // Best-effort trailing note — the per-comment outcomes above already
      // summarize the review post.
    }
  }

  return summarizeReviewCommentPosts(outcomes, `pull request #${pullRequestNumber}`)
}
