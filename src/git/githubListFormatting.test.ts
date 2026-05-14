import chalk from 'chalk'
import { formatIssueList, formatPullRequestList } from './githubListFormatting'
import type { IssueListItem } from './issuesListData'
import type { PullRequestListItem } from './pullRequestListData'

// Strip ANSI escapes for shape assertions — color is rendered via chalk
// and we only want to assert on the visible content.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;]*m/g
const strip = (s: string) => s.replace(ANSI_RE, '')

describe('formatIssueList', () => {
  const baseIssue = (overrides: Partial<IssueListItem> = {}): IssueListItem => ({
    number: 882,
    title: 'TUI shell · issue / PR triage workflow',
    url: 'https://github.com/gfargo/coco/issues/882',
    state: 'OPEN',
    author: 'gfargo',
    assignees: [],
    labels: ['enhancement'],
    comments: 0,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  })

  it('renders empty-state copy when there are no issues', () => {
    expect(strip(formatIssueList([]))).toBe('No issues match the current filter.')
  })

  it('renders one row per issue with number, state, author, and title', () => {
    const output = strip(formatIssueList([baseIssue()]))
    expect(output).toContain('#882')
    expect(output).toContain('open')
    expect(output).toContain('gfargo')
    expect(output).toContain('TUI shell · issue / PR triage workflow')
    expect(output).toContain('[enhancement]')
  })

  it('shows a comment count when greater than zero', () => {
    const output = strip(formatIssueList([baseIssue({ comments: 5 })]))
    expect(output).toContain('5c')
  })

  it('omits comment count when zero or missing', () => {
    const output = strip(formatIssueList([baseIssue({ comments: 0 })]))
    expect(output).not.toMatch(/\d+c/)
  })

  it('color-codes state', () => {
    const openRow = formatIssueList([baseIssue({ state: 'OPEN' })])
    const closedRow = formatIssueList([baseIssue({ state: 'CLOSED' })])
    expect(openRow).toContain(chalk.green('open'))
    expect(closedRow).toContain(chalk.red('closed'))
  })
})

describe('formatPullRequestList', () => {
  const basePr = (overrides: Partial<PullRequestListItem> = {}): PullRequestListItem => ({
    number: 962,
    title: 'feat(commit-split): dedupe rescues',
    url: 'https://github.com/gfargo/coco/pull/962',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'feature/x',
    baseRefName: 'main',
    author: 'gfargo',
    assignees: [],
    labels: [],
    reviewDecision: undefined,
    mergeable: undefined,
    mergeStateStatus: undefined,
    createdAt: '2026-05-14T00:00:00Z',
    updatedAt: '2026-05-14T00:00:00Z',
    ...overrides,
  })

  it('renders empty-state copy when there are no PRs', () => {
    expect(strip(formatPullRequestList([]))).toBe('No pull requests match the current filter.')
  })

  it('renders one row per PR with the core triage fields', () => {
    const output = strip(formatPullRequestList([basePr()]))
    expect(output).toContain('#962')
    expect(output).toContain('open')
    expect(output).toContain('gfargo')
    expect(output).toContain('feature/x')
    expect(output).toContain('feat(commit-split): dedupe rescues')
  })

  it('shows draft state for draft PRs', () => {
    const output = strip(formatPullRequestList([basePr({ isDraft: true })]))
    expect(output).toContain('draft')
    expect(output).not.toMatch(/\bopen\b/)
  })

  it('renders the approval glyph for approved PRs', () => {
    const output = formatPullRequestList([basePr({ reviewDecision: 'APPROVED' })])
    expect(output).toContain(chalk.green('✓'))
  })

  it('renders the changes-requested glyph for blocked PRs', () => {
    const output = formatPullRequestList([basePr({ reviewDecision: 'CHANGES_REQUESTED' })])
    expect(output).toContain(chalk.red('✗'))
  })

  it('truncates long head branch names', () => {
    const longBranch = 'feature/this-is-a-very-long-branch-name-that-should-truncate'
    const output = strip(formatPullRequestList([basePr({ headRefName: longBranch })]))
    expect(output).toContain('…')
  })
})
