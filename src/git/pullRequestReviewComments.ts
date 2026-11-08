import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { GhRunner, defaultGhRunner, runGhAction } from './githubCli'
import type { PullRequestActionResult } from './pullRequestActions'

export type ReviewCommentInput = {
  /** Repo-relative file path (no leading `./`). */
  path: string
  /** 1-based line number; must land inside the PR's diff or GitHub 422s the whole review. */
  line: number
  side?: 'LEFT' | 'RIGHT'
  /**
   * Start of a multi-line range, when a finding spans more than one line.
   * GitHub's payload builder ignores this today; Bitbucket's single-line
   * `inline` model can't express a range at all, so its adapter (OSS-2407)
   * treats `startLine !== line` as unsupported rather than guessing an anchor.
   */
  startLine?: number
  body: string
}

export type CreateReviewOptions = {
  /**
   * `COMMENT` (default) publishes immediately. Omitting `event` creates a
   * `PENDING` draft review that only the author can see — the exact
   * "silently does nothing" failure this feature exists to avoid.
   */
  event?: 'COMMENT' | 'REQUEST_CHANGES'
  /** GitHub requires a non-empty review body alongside COMMENT/REQUEST_CHANGES. */
  body?: string
}

/**
 * Post inline PR review comments via a single
 * `POST repos/{owner}/{repo}/pulls/{n}/reviews` call (OSS-2406). There is no
 * `gh pr review --comments-json` equivalent, so this goes through `gh api`
 * directly — the first such call in this codebase (every other GitHub action
 * wraps `gh pr <verb>`). The JSON payload travels via a temp file (`--input
 * <file>`), same reasoning as `createPullRequest`'s `--body-file`: a
 * `comments[]` array of objects isn't expressible with `-f`/`-F` field flags,
 * and `defaultGhRunner` has no stdin plumbing for `--input -`.
 */
export async function createPullRequestReviewComments(
  pullRequestNumber: number,
  comments: ReviewCommentInput[],
  options: CreateReviewOptions = {},
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestActionResult> {
  if (comments.length === 0) {
    return { ok: false, message: 'No inline review comments to post' }
  }

  const commentCount = comments.length
  const payload = {
    event: options.event ?? 'COMMENT',
    body: options.body ?? `coco review: ${commentCount} inline finding${commentCount === 1 ? '' : 's'}.`,
    comments: comments.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: comment.side ?? 'RIGHT',
      body: comment.body,
    })),
  }

  const bodyDir = mkdtempSync(join(tmpdir(), 'coco-review-'))
  const bodyFile = join(bodyDir, 'review.json')
  try {
    writeFileSync(bodyFile, JSON.stringify(payload), 'utf8')
    return await runGhAction(
      runner,
      ['api', `repos/{owner}/{repo}/pulls/${pullRequestNumber}/reviews`, '--method', 'POST', '--input', bodyFile],
      () => ({
        ok: true,
        message: `Posted ${commentCount} inline review comment${commentCount === 1 ? '' : 's'} on pull request #${pullRequestNumber}`,
      })
    )
  } finally {
    rmSync(bodyDir, { recursive: true, force: true })
  }
}

/**
 * True when a thrown forge error looks like a rejected inline anchor (the
 * line/position isn't part of the diff) rather than some other failure
 * (auth, network, rate limit). Shared by every non-GitHub provider (OSS-2407)
 * so each can fall back to a plain PR/MR-level note per-comment instead of
 * aborting the whole review post.
 *
 * Checks both a `.status` property (Gitea/Bitbucket/Bitbucket Server fetch
 * errors carry one; Bitbucket Cloud returns 400, not 422, for a bad anchor)
 * and the error text (glab's `execFile` errors carry only `stderr`, no
 * status), and matches broadly on 4xx rather than literal 422 since GitLab's
 * "position is invalid" wording varies by version.
 */
export function isAnchorRejection(error: unknown): boolean {
  const err = error as { status?: number; stderr?: unknown; message?: string }
  if (err?.status === 400 || err?.status === 409 || err?.status === 422) return true
  const text = (typeof err?.stderr === 'string' && err.stderr) || err?.message || ''
  return /\b(400|409|422)\b|position is invalid|not part of the diff|must be part of/i.test(text)
}

/** Per-comment outcome of an inline review post, folded into one result by `summarizeReviewCommentPosts`. */
export type ReviewCommentPostOutcome = {
  comment: ReviewCommentInput
  status: 'posted' | 'fallback' | 'unsupported' | 'failed'
  /** Present for 'fallback' (why the anchor was rejected), 'unsupported', and 'failed'. */
  error?: string
}

/**
 * Fold per-comment outcomes into one `PullRequestActionResult`. `ok: true` as
 * soon as at least one comment landed — inline or as a fallback note — since
 * a partial post is still progress; `ok: false` only when nothing landed, so
 * the caller's whole-blob-comment fallback (`handler.ts`) engages. Mirrors
 * `handler.ts`'s existing "any inline-post failure falls back to the
 * whole-blob comment" semantics, but at the per-comment grain the other
 * forges need (OSS-2407).
 */
export function summarizeReviewCommentPosts(
  outcomes: ReviewCommentPostOutcome[],
  label: string
): PullRequestActionResult {
  const posted = outcomes.filter((outcome) => outcome.status === 'posted').length
  const fallback = outcomes.filter((outcome) => outcome.status === 'fallback').length
  const unsupported = outcomes.filter((outcome) => outcome.status === 'unsupported').length
  const failed = outcomes.filter((outcome) => outcome.status === 'failed').length
  const landed = posted + fallback

  const nonPosted = outcomes.filter((outcome) => outcome.status !== 'posted')
  const details = nonPosted
    .map((outcome) => `${outcome.comment.path}:${outcome.comment.line} — ${outcome.status}${outcome.error ? `: ${outcome.error}` : ''}`)
    .slice(0, 8)

  if (landed === 0) {
    return {
      ok: false,
      message: `Could not post any inline review comments on ${label}.`,
      ...(details.length ? { details } : {}),
    }
  }

  const parts: string[] = [`${posted} inline`]
  if (fallback > 0) parts.push(`${fallback} as a plain note (anchor rejected)`)
  if (unsupported > 0) parts.push(`${unsupported} unsupported`)
  if (failed > 0) parts.push(`${failed} failed`)

  return {
    ok: true,
    message: `Posted ${parts.join(', ')} on ${label}.`,
    ...(details.length ? { details } : {}),
  }
}
