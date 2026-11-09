import { compactBitbucketError, type BitbucketRunner } from './bitbucketCli'
import type { PullRequestActionResult } from './pullRequestActions'
import {
  isAnchorRejection,
  summarizeReviewCommentPosts,
  type CreateReviewOptions,
  type ReviewCommentInput,
  type ReviewCommentPostOutcome,
} from './pullRequestReviewComments'

/** Bitbucket Cloud's `inline` anchor is a single line — a finding spanning a range has no faithful anchor. */
function isUnsupportedAnchor(comment: ReviewCommentInput): boolean {
  if (!Number.isInteger(comment.line) || comment.line <= 0) return true
  return comment.startLine !== undefined && comment.startLine !== comment.line
}

async function postFallbackNote(
  projectPath: string,
  pullRequestNumber: number,
  comment: ReviewCommentInput,
  runner: BitbucketRunner
): Promise<void> {
  await runner(`repositories/${projectPath}/pullrequests/${pullRequestNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content: { raw: `\`${comment.path}:${comment.line}\` — ${comment.body}` } }),
  })
}

/**
 * Post inline PR comments via Bitbucket Cloud's
 * `POST repositories/{path}/pullrequests/{n}/comments` with an `inline`
 * object (OSS-2407) — Bitbucket Cloud has no batch "review" endpoint, so
 * each comment is its own POST, posted serially. A comment whose line/range
 * `inline` can't express (multi-line) is skipped before any HTTP call, with
 * a per-comment "not supported" outcome rather than a guessed anchor; a
 * comment whose anchor Bitbucket rejects (400, not 422, for this forge)
 * falls back to a plain comment carrying the location in the body.
 */
export async function createBitbucketReviewComments(
  projectPath: string,
  pullRequestNumber: number,
  comments: ReviewCommentInput[],
  options: CreateReviewOptions = {},
  runner: BitbucketRunner
): Promise<PullRequestActionResult> {
  if (comments.length === 0) {
    return { ok: false, message: 'No inline review comments to post' }
  }

  const outcomes: ReviewCommentPostOutcome[] = []
  for (const comment of comments) {
    if (isUnsupportedAnchor(comment)) {
      outcomes.push({
        comment,
        status: 'unsupported',
        error: 'Multi-line inline review comments are not supported for Bitbucket yet.',
      })
      continue
    }

    const inline = comment.side === 'LEFT' ? { path: comment.path, from: comment.line } : { path: comment.path, to: comment.line }
    try {
      await runner(`repositories/${projectPath}/pullrequests/${pullRequestNumber}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: { raw: comment.body }, inline }),
      })
      outcomes.push({ comment, status: 'posted' })
      continue
    } catch (error) {
      if (!isAnchorRejection(error)) {
        outcomes.push({ comment, status: 'failed', error: compactBitbucketError((error as Error).message || '').message })
        continue
      }
    }

    try {
      await postFallbackNote(projectPath, pullRequestNumber, comment, runner)
      outcomes.push({ comment, status: 'fallback' })
    } catch (fallbackError) {
      outcomes.push({
        comment,
        status: 'failed',
        error: compactBitbucketError((fallbackError as Error).message || '').message,
      })
    }
  }

  // Bitbucket Cloud has no review-level "request changes" state; mirror
  // `requestChangesBitbucketPullRequestByNumber`'s prefixed-comment pattern.
  if (options.event === 'REQUEST_CHANGES' && options.body) {
    try {
      await runner(`repositories/${projectPath}/pullrequests/${pullRequestNumber}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content: { raw: `Requested changes: ${options.body}` } }),
      })
    } catch {
      // Best-effort trailing note — the per-comment outcomes above already
      // summarize the review post.
    }
  }

  return summarizeReviewCommentPosts(outcomes, `pull request #${pullRequestNumber}`)
}
