/**
 * Sanitize untrusted forge-authored text before it reaches the terminal.
 *
 * MR/issue/PR titles, bodies, comments, author names, labels, and branch names
 * come from the GitHub/GitLab APIs and are rendered into the CLI output and the
 * Ink TUI — interleaved with coco's own chalk/ANSI, so the render layer can't
 * just be stripped. A hostile author can embed ANSI / control sequences to wipe
 * scrollback, spoof triage rows (fake "approved", impersonate an MR number),
 * rewrite the terminal title, or drive OSC 52 clipboard writes. We strip
 * control bytes here, at the data boundary, so every downstream surface (both
 * forges, CLI and TUI) only ever renders inert text.
 *
 * Control bytes stripped: C0 (0x00-0x1f, includes ESC 0x1b and CR) and DEL/C1
 * (0x7f-0x9f). The multi-line variant preserves the newline (0x0a) so body and
 * comment paragraphs survive; the inline variant strips everything for
 * single-line cells (titles, authors, branches, labels) where a stray newline
 * would also break the row layout.
 */
import type { PullRequestListItem } from './pullRequestListData'
import type { IssueListItem } from './issuesListData'
import type { PullRequestDetail } from './pullRequestDetailData'
import type { IssueComment, IssueDetail } from './issueDetailData'
import type { PullRequestInfo } from './pullRequestData'

function isControl(codePoint: number, keepNewline: boolean): boolean {
  if (keepNewline && codePoint === 0x0a) return false
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)
}

function strip(value: string, keepNewline: boolean): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0)
    if (code !== undefined && isControl(code, keepNewline)) continue
    out += ch
  }
  return out
}

/** Strip all control bytes — single-line fields (title, author, branch, label, url). */
export function stripControl(value: string): string {
  return strip(value, false)
}

/** Strip control bytes but keep newlines — multi-line fields (body, comment). */
export function stripControlMultiline(value: string): string {
  return strip(value.replace(/\r\n?/g, '\n'), true)
}

function clean(value: string | undefined): string | undefined {
  return value === undefined ? undefined : stripControl(value)
}

function cleanArray(values: string[] | undefined): string[] | undefined {
  return values?.map(stripControl)
}

export function sanitizePullRequestListItem(item: PullRequestListItem): PullRequestListItem {
  return {
    ...item,
    title: stripControl(item.title),
    url: stripControl(item.url),
    headRefName: stripControl(item.headRefName),
    baseRefName: stripControl(item.baseRefName),
    author: clean(item.author),
    assignees: cleanArray(item.assignees),
    labels: cleanArray(item.labels),
  }
}

export function sanitizeIssueListItem(item: IssueListItem): IssueListItem {
  return {
    ...item,
    title: stripControl(item.title),
    url: stripControl(item.url),
    author: clean(item.author),
    assignees: cleanArray(item.assignees),
    labels: cleanArray(item.labels),
  }
}

function sanitizeComment(comment: IssueComment): IssueComment {
  return { ...comment, author: clean(comment.author), body: stripControlMultiline(comment.body) }
}

export function sanitizePullRequestDetail(detail: PullRequestDetail): PullRequestDetail {
  return {
    ...detail,
    body: stripControlMultiline(detail.body),
    comments: detail.comments.map(sanitizeComment),
    reviews: detail.reviews.map((review) => ({
      ...review,
      author: clean(review.author),
      body: stripControlMultiline(review.body),
    })),
  }
}

export function sanitizeIssueDetail(detail: IssueDetail): IssueDetail {
  return {
    ...detail,
    body: stripControlMultiline(detail.body),
    comments: detail.comments.map(sanitizeComment),
  }
}

export function sanitizePullRequestInfo(info: PullRequestInfo): PullRequestInfo {
  return {
    ...info,
    title: stripControl(info.title),
    url: stripControl(info.url),
    headRefName: stripControl(info.headRefName),
    baseRefName: stripControl(info.baseRefName),
    body: info.body === undefined ? undefined : stripControlMultiline(info.body),
    author: clean(info.author),
  }
}
