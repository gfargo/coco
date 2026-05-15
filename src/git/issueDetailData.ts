/**
 * Per-item issue detail fetcher (#882 inspector hydration). The list
 * payload from `gh issue list` deliberately omits bodies and
 * comments to keep the list fetch cheap; this module fills those in
 * on demand when the user rests the cursor on a specific issue.
 *
 * Called from the workstation runtime with a debounced timer so
 * rapid j/k navigation doesn't spam `gh`. Results land in a
 * `Map<number, IssueDetail>` cache on `LogInkContext` keyed by
 * issue number, so cursoring back to a previously-fetched item
 * shows instantly.
 */

import { defaultGhRunner, type GhRunner } from './githubCli'

export type IssueComment = {
  author?: string
  body: string
  createdAt: string
}

export type IssueDetail = {
  number: number
  body: string
  comments: IssueComment[]
}

/**
 * `gh issue view <#> --json` field list. Kept separate from the
 * list-view field list since the detail view only needs the
 * fields that the list payload doesn't already carry.
 */
export const ISSUE_DETAIL_JSON_FIELDS = ['number', 'body', 'comments'].join(',')

function parseIssueComments(value: unknown): IssueComment[] {
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

function parseIssueDetail(output: string): IssueDetail | undefined {
  const trimmed = output.trim()
  if (!trimmed) return undefined

  const raw = JSON.parse(trimmed) as Record<string, unknown>
  if (typeof raw.number !== 'number') return undefined

  return {
    number: raw.number,
    body: typeof raw.body === 'string' ? raw.body : '',
    comments: parseIssueComments(raw.comments),
  }
}

export type IssueDetailResult =
  | { ok: true; detail: IssueDetail }
  | { ok: false; message: string }

export async function getIssueDetail(
  issueNumber: number,
  runner: GhRunner = defaultGhRunner
): Promise<IssueDetailResult> {
  try {
    const output = await runner([
      'issue',
      'view',
      String(issueNumber),
      '--json',
      ISSUE_DETAIL_JSON_FIELDS,
    ])
    const detail = parseIssueDetail(output)
    if (!detail) {
      return { ok: false, message: `Empty response from gh for issue #${issueNumber}` }
    }
    return { ok: true, detail }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
