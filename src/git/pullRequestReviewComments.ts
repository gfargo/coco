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
