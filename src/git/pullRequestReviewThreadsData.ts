/**
 * Line-anchored PR review-thread fetcher (OSS-2403). Distinct from
 * `pullRequestDetailData.ts`'s `reviews` (one row per review submission,
 * no file/line anchor) — this pulls the `reviewThreads` GraphQL connection,
 * which groups inline comments by the file/line they're anchored to and
 * tracks resolved/outdated state per thread. GitHub only for now; other
 * forges stub this out in `forgeActions.ts`.
 */

import { defaultGhRunner, type GhRunner } from './githubCli'
import { sanitizePullRequestReviewThreads } from './forgeText'

export type PullRequestReviewThreadComment = {
  author?: string
  body: string
  createdAt: string
}

export type PullRequestReviewThread = {
  path: string
  line?: number
  originalLine?: number
  isResolved: boolean
  isOutdated: boolean
  diffHunk?: string
  comments: PullRequestReviewThreadComment[]
}

/**
 * Pagination ceilings for the GraphQL connections. Silent-truncation risk is
 * acceptable here — this is a read-only preview surface, not a full mirror —
 * but the constants are named so the caps are easy to find/raise later.
 */
const REVIEW_THREADS_PAGE_SIZE = 100
const REVIEW_THREAD_COMMENTS_PAGE_SIZE = 50

const REVIEW_THREADS_QUERY = `
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: ${REVIEW_THREADS_PAGE_SIZE}) {
          nodes {
            path
            line
            originalLine
            isResolved
            isOutdated
            diffHunk
            comments(first: ${REVIEW_THREAD_COMMENTS_PAGE_SIZE}) {
              nodes {
                author {
                  login
                }
                body
                createdAt
              }
            }
          }
        }
      }
    }
  }
`.trim()

function parseReviewThreadComments(value: unknown): PullRequestReviewThreadComment[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const raw = entry as Record<string, unknown>
    const author =
      raw.author && typeof raw.author === 'object' && 'login' in raw.author
        ? String((raw.author as { login: unknown }).login)
        : undefined
    return {
      author,
      body: typeof raw.body === 'string' ? raw.body : '',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    }
  })
}

function parseReviewThreads(value: unknown): PullRequestReviewThread[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const raw = entry as Record<string, unknown>
    const comments = raw.comments as Record<string, unknown> | undefined
    return {
      path: typeof raw.path === 'string' ? raw.path : '',
      line: typeof raw.line === 'number' ? raw.line : undefined,
      originalLine: typeof raw.originalLine === 'number' ? raw.originalLine : undefined,
      isResolved: Boolean(raw.isResolved),
      isOutdated: Boolean(raw.isOutdated),
      diffHunk: typeof raw.diffHunk === 'string' ? raw.diffHunk : undefined,
      comments: parseReviewThreadComments(comments?.nodes),
    }
  })
}

export type PullRequestReviewThreadsResult =
  | { ok: true; threads: PullRequestReviewThread[] }
  | { ok: false; message: string }

export async function getPullRequestReviewThreads(
  pullRequestNumber: number,
  runner: GhRunner = defaultGhRunner
): Promise<PullRequestReviewThreadsResult> {
  try {
    const output = await runner([
      'api',
      'graphql',
      '-f',
      `query=${REVIEW_THREADS_QUERY}`,
      '-F',
      'owner={owner}',
      '-F',
      'name={repo}',
      '-F',
      `number=${pullRequestNumber}`,
    ])
    const trimmed = output.trim()
    if (!trimmed) return { ok: true, threads: [] }

    const raw = JSON.parse(trimmed) as {
      data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: unknown } } } }
    }
    const nodes = raw.data?.repository?.pullRequest?.reviewThreads?.nodes
    const threads = parseReviewThreads(nodes)
    return { ok: true, threads: sanitizePullRequestReviewThreads(threads) }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
