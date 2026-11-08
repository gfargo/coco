import { compactGiteaError, type GiteaRunner } from './giteaCli'
import type { PullRequestActionResult } from './pullRequestActions'
import {
  isAnchorRejection,
  summarizeReviewCommentPosts,
  type CreateReviewOptions,
  type ReviewCommentInput,
  type ReviewCommentPostOutcome,
} from './pullRequestReviewComments'

function buildReviewComment(comment: ReviewCommentInput): Record<string, unknown> {
  const position = comment.side === 'LEFT' ? { old_position: comment.line } : { new_position: comment.line }
  return { path: comment.path, body: comment.body, ...position }
}

async function postFallbackNote(
  projectPath: string,
  pullRequestNumber: number,
  comment: ReviewCommentInput,
  runner: GiteaRunner
): Promise<void> {
  await runner(`repos/${projectPath}/issues/${pullRequestNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: `\`${comment.path}:${comment.line}\` — ${comment.body}` }),
  })
}

/**
 * Post inline PR review comments via Gitea/Forgejo's
 * `POST repos/{path}/pulls/{n}/reviews` (OSS-2407), the REST counterpart to
 * GitHub's single-call review (OSS-2406). Tries the whole batch as one
 * review first (the common case: every anchor lands); if Gitea rejects the
 * batch on anchor grounds, retries per-comment so the comments whose
 * anchors are valid still land, falling back to a plain issue comment
 * (carrying the location in the body) for whichever still can't anchor.
 */
export async function createGiteaReviewComments(
  projectPath: string,
  pullRequestNumber: number,
  comments: ReviewCommentInput[],
  options: CreateReviewOptions = {},
  runner: GiteaRunner
): Promise<PullRequestActionResult> {
  if (comments.length === 0) {
    return { ok: false, message: 'No inline review comments to post' }
  }

  const event = options.event ?? 'COMMENT'
  const body = options.body ?? `coco review: ${comments.length} inline finding${comments.length === 1 ? '' : 's'}.`

  try {
    await runner(`repos/${projectPath}/pulls/${pullRequestNumber}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ event, body, comments: comments.map(buildReviewComment) }),
    })
    return {
      ok: true,
      message: `Posted ${comments.length} inline review comment${comments.length === 1 ? '' : 's'} on pull request #${pullRequestNumber}`,
    }
  } catch (error) {
    if (!isAnchorRejection(error)) {
      return { ok: false, message: compactGiteaError((error as Error).message || '').message }
    }
  }

  const outcomes: ReviewCommentPostOutcome[] = []
  for (const comment of comments) {
    try {
      await runner(`repos/${projectPath}/pulls/${pullRequestNumber}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ event, body, comments: [buildReviewComment(comment)] }),
      })
      outcomes.push({ comment, status: 'posted' })
      continue
    } catch (error) {
      if (!isAnchorRejection(error)) {
        outcomes.push({ comment, status: 'failed', error: compactGiteaError((error as Error).message || '').message })
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
        error: compactGiteaError((fallbackError as Error).message || '').message,
      })
    }
  }

  return summarizeReviewCommentPosts(outcomes, `pull request #${pullRequestNumber}`)
}
