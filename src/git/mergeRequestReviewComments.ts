import { defaultGlabRunner, compactGlabError, type GlabRunner } from './glabCli'
import type { PullRequestActionResult } from './pullRequestActions'
import {
  isAnchorRejection,
  summarizeReviewCommentPosts,
  type CreateReviewOptions,
  type ReviewCommentInput,
  type ReviewCommentPostOutcome,
} from './pullRequestReviewComments'

const enc = encodeURIComponent

type DiffRefs = { base_sha?: string; start_sha?: string; head_sha?: string }

/**
 * GitLab anchors a discussion position to the three SHAs of the merge
 * request's current diff (`base_sha`/`start_sha`/`head_sha`), not just a line
 * number — fetched fresh per post since a stale set 404s the discussion
 * create.
 */
async function resolveDiffRefs(
  projectPath: string,
  mergeRequestNumber: number,
  runner: GlabRunner
): Promise<DiffRefs | undefined> {
  const out = (await runner(['api', `projects/${enc(projectPath)}/merge_requests/${mergeRequestNumber}`])).trim()
  if (!out) return undefined
  const mr = JSON.parse(out) as { diff_refs?: DiffRefs }
  return mr.diff_refs
}

function buildDiscussionArgs(
  projectPath: string,
  mergeRequestNumber: number,
  comment: ReviewCommentInput,
  refs: Required<DiffRefs>
): string[] {
  const args = [
    'api',
    '--method', 'POST',
    `projects/${enc(projectPath)}/merge_requests/${mergeRequestNumber}/discussions`,
    '-f', `body=${comment.body}`,
    '-f', 'position[position_type]=text',
    '-f', `position[base_sha]=${refs.base_sha}`,
    '-f', `position[start_sha]=${refs.start_sha}`,
    '-f', `position[head_sha]=${refs.head_sha}`,
  ]
  if (comment.side === 'LEFT') {
    args.push('-f', `position[old_path]=${comment.path}`, '-f', `position[old_line]=${comment.line}`)
  } else {
    args.push('-f', `position[new_path]=${comment.path}`, '-f', `position[new_line]=${comment.line}`)
  }
  return args
}

function fallbackNoteArgs(mergeRequestNumber: number, comment: ReviewCommentInput): string[] {
  return [
    'mr', 'note', 'create', String(mergeRequestNumber),
    `--message=\`${comment.path}:${comment.line}\` — ${comment.body}`,
  ]
}

/**
 * Post inline MR review comments via GitLab's discussions API (OSS-2407),
 * the glab counterpart to `createPullRequestReviewComments` (GitHub,
 * OSS-2406). GitLab has no single-call "review with comments" endpoint, so
 * each comment is its own `POST .../discussions` call, posted serially so a
 * fully-rejected batch probes auth only once (not once per comment) and so
 * tests get a deterministic call order. A comment whose anchor GitLab
 * rejects (4xx) falls back to a plain MR note carrying the location in the
 * body, rather than aborting the rest of the batch.
 */
export async function createMergeRequestReviewComments(
  projectPath: string,
  mergeRequestNumber: number,
  comments: ReviewCommentInput[],
  options: CreateReviewOptions = {},
  runner: GlabRunner = defaultGlabRunner
): Promise<PullRequestActionResult> {
  if (comments.length === 0) {
    return { ok: false, message: 'No inline review comments to post' }
  }

  let refs: DiffRefs | undefined
  try {
    refs = await resolveDiffRefs(projectPath, mergeRequestNumber, runner)
  } catch {
    refs = undefined
  }
  if (!refs?.base_sha || !refs?.start_sha || !refs?.head_sha) {
    return { ok: false, message: `Could not resolve diff refs for merge request !${mergeRequestNumber}` }
  }
  const resolvedRefs = { base_sha: refs.base_sha, start_sha: refs.start_sha, head_sha: refs.head_sha }

  const outcomes: ReviewCommentPostOutcome[] = []
  for (const comment of comments) {
    try {
      await runner(buildDiscussionArgs(projectPath, mergeRequestNumber, comment, resolvedRefs))
      outcomes.push({ comment, status: 'posted' })
      continue
    } catch (error) {
      if (!isAnchorRejection(error)) {
        outcomes.push({ comment, status: 'failed', error: compactGlabError((error as Error).message || '').message })
        continue
      }
    }

    try {
      await runner(fallbackNoteArgs(mergeRequestNumber, comment))
      outcomes.push({ comment, status: 'fallback' })
    } catch (fallbackError) {
      outcomes.push({
        comment,
        status: 'failed',
        error: compactGlabError((fallbackError as Error).message || '').message,
      })
    }
  }

  // GitLab has no review-level "request changes" state; mirror the
  // current-branch/by-number MR actions by posting a prefixed note.
  if (options.event === 'REQUEST_CHANGES' && options.body) {
    try {
      await runner(['mr', 'note', 'create', String(mergeRequestNumber), `--message=Requested changes: ${options.body}`])
    } catch {
      // Best-effort trailing note — the per-comment outcomes above already
      // summarize the review post.
    }
  }

  return summarizeReviewCommentPosts(outcomes, `merge request !${mergeRequestNumber}`)
}
