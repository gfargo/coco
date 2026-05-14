import {
  formatIssueTriagePreview,
  formatPullRequestTriagePreview,
} from './previewPane'
import type { IssueListItem } from '../../git/issuesListData'
import type { PullRequestListItem } from '../../git/pullRequestListData'

const stripLine = (line: { text: string }) => line.text

describe('formatIssueTriagePreview', () => {
  it('returns a uniform empty-state message when nothing is cursored', () => {
    const lines = formatIssueTriagePreview(undefined).map(stripLine)
    expect(lines).toEqual(['Select an issue to preview.'])
  })

  it('renders the canonical fields when an issue is cursored', () => {
    const issue: IssueListItem = {
      number: 882,
      title: 'TUI shell · issue / PR triage workflow',
      url: 'https://github.com/gfargo/coco/issues/882',
      state: 'OPEN',
      author: 'gfargo',
      assignees: ['reviewer-a', 'reviewer-b'],
      labels: ['enhancement', 'tui'],
      comments: 3,
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    }

    const lines = formatIssueTriagePreview(issue).map(stripLine)

    expect(lines[0]).toContain('#882')
    expect(lines[0]).toContain('TUI shell · issue / PR triage workflow')
    expect(lines.some((l) => l.includes('open'))).toBe(true)
    expect(lines.some((l) => l.includes('gfargo'))).toBe(true)
    expect(lines.some((l) => l.includes('reviewer-a, reviewer-b'))).toBe(true)
    expect(lines.some((l) => l.includes('enhancement, tui'))).toBe(true)
    expect(lines.some((l) => l.includes('Comments: 3'))).toBe(true)
    expect(lines.some((l) => l.includes('2026-04-01'))).toBe(true)
    expect(lines.some((l) => l.includes('https://github.com/gfargo/coco/issues/882'))).toBe(true)
  })

  it('omits optional rows when the underlying fields are missing', () => {
    const issue: IssueListItem = {
      number: 1,
      title: 'minimal',
      url: 'u',
      state: 'CLOSED',
      createdAt: '',
      updatedAt: '',
    }

    const lines = formatIssueTriagePreview(issue).map(stripLine)

    expect(lines.some((l) => l.startsWith('Author:'))).toBe(false)
    expect(lines.some((l) => l.startsWith('Assigned:'))).toBe(false)
    expect(lines.some((l) => l.startsWith('Labels:'))).toBe(false)
    expect(lines.some((l) => l.startsWith('Comments:'))).toBe(false)
    expect(lines.some((l) => l.includes('closed'))).toBe(true)
  })
})

describe('formatPullRequestTriagePreview', () => {
  it('returns a uniform empty-state message when nothing is cursored', () => {
    const lines = formatPullRequestTriagePreview(undefined).map(stripLine)
    expect(lines).toEqual(['Select a pull request to preview.'])
  })

  it('renders the canonical fields when a PR is cursored', () => {
    const pr: PullRequestListItem = {
      number: 962,
      title: 'feat(commit-split): dedupe rescues',
      url: 'https://github.com/gfargo/coco/pull/962',
      state: 'OPEN',
      isDraft: false,
      headRefName: 'claude/x',
      baseRefName: 'main',
      author: 'gfargo',
      assignees: ['reviewer'],
      labels: ['enhancement'],
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      createdAt: '2026-05-14T00:00:00Z',
      updatedAt: '2026-05-14T00:00:00Z',
    }

    const lines = formatPullRequestTriagePreview(pr).map(stripLine)

    expect(lines[0]).toContain('#962')
    expect(lines[0]).toContain('feat(commit-split)')
    expect(lines.some((l) => l.includes('open'))).toBe(true)
    expect(lines.some((l) => l.includes('claude/x → main'))).toBe(true)
    expect(lines.some((l) => l.toLowerCase().includes('mergeable'))).toBe(true)
    expect(lines.some((l) => l.includes('approved'))).toBe(true)
    expect(lines.some((l) => l.includes('reviewer'))).toBe(true)
    expect(lines.some((l) => l.includes('enhancement'))).toBe(true)
    expect(lines.some((l) => l.includes('https://github.com/gfargo/coco/pull/962'))).toBe(true)
  })

  it('renders the draft state distinctly from open', () => {
    const pr: PullRequestListItem = {
      number: 5,
      title: 'wip',
      url: 'u',
      state: 'OPEN',
      isDraft: true,
      headRefName: 'wip',
      baseRefName: 'main',
      createdAt: '',
      updatedAt: '',
    }

    const lines = formatPullRequestTriagePreview(pr).map(stripLine)

    const stateLine = lines.find((l) => l.startsWith('State:'))
    expect(stateLine).toBeDefined()
    expect(stateLine).toContain('draft')
    expect(stateLine).not.toContain('open')
  })

  it('humanizes review decision underscores', () => {
    const pr: PullRequestListItem = {
      number: 5,
      title: 'wip',
      url: 'u',
      state: 'OPEN',
      isDraft: false,
      headRefName: 'h',
      baseRefName: 'm',
      reviewDecision: 'CHANGES_REQUESTED',
      createdAt: '',
      updatedAt: '',
    }

    const lines = formatPullRequestTriagePreview(pr).map(stripLine)

    expect(lines.some((l) => l.includes('changes requested'))).toBe(true)
    expect(lines.some((l) => l.includes('CHANGES_REQUESTED'))).toBe(false)
  })
})
