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

describe('hydrated triage preview sections (inspector hydration follow-up)', () => {
  const issue = {
    number: 882,
    title: 't',
    url: 'u',
    state: 'OPEN',
    createdAt: '',
    updatedAt: '',
    comments: 2,
  }

  it('issue preview shows "Loading…" hint when no detail is cached AND comments > 0', () => {
    const lines = formatIssueTriagePreview(issue).map(stripLine)
    expect(lines.some((l) => l.toLowerCase().includes('loading'))).toBe(true)
  })

  it('issue preview omits the loading hint when there are zero comments', () => {
    const lines = formatIssueTriagePreview({ ...issue, comments: 0 }).map(stripLine)
    expect(lines.some((l) => l.toLowerCase().includes('loading'))).toBe(false)
  })

  it('issue preview renders body excerpt + comments when detail is provided', () => {
    const detail = {
      number: 882,
      body: 'First line.\n\nSecond paragraph.\nThird line.',
      comments: [
        { author: 'reviewer-a', body: 'taking a look', createdAt: '2026-05-15T00:00:00Z' },
        { author: 'reviewer-b', body: 'lgtm', createdAt: '2026-05-15T01:00:00Z' },
      ],
    }
    const lines = formatIssueTriagePreview(issue, detail).map(stripLine)

    expect(lines).toContain('Body')
    expect(lines).toContain('First line.')
    expect(lines.some((l) => l.startsWith('Comments ('))).toBe(true)
    expect(lines.some((l) => l.includes('@reviewer-a'))).toBe(true)
    expect(lines.some((l) => l.includes('@reviewer-b'))).toBe(true)
    // Loading hint disappears once detail lands.
    expect(lines.some((l) => l.toLowerCase().includes('loading'))).toBe(false)
  })

  it('issue preview shows a truncation trailer when the body exceeds the maxLines cap', () => {
    const bigBody = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n')
    const detail = { number: 1, body: bigBody, comments: [] }
    const lines = formatIssueTriagePreview(
      { ...issue, comments: 0 },
      detail
    ).map(stripLine)

    expect(lines.some((l) => l.includes('more line'))).toBe(true)
  })

  const pr = {
    number: 962,
    title: 't',
    url: 'u',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'h',
    baseRefName: 'm',
    createdAt: '',
    updatedAt: '',
  }

  it('PR preview shows a loading hint pre-hydration', () => {
    const lines = formatPullRequestTriagePreview(pr).map(stripLine)
    expect(lines.some((l) => l.toLowerCase().includes('loading'))).toBe(true)
  })

  it('PR preview renders body + checks + reviews + comments when detail is provided', () => {
    const detail = {
      number: 962,
      body: 'Fixes the dedupe rescue gap.',
      comments: [
        { author: 'commenter', body: 'thanks', createdAt: '2026-05-15T00:00:00Z' },
      ],
      reviews: [
        { author: 'reviewer-a', state: 'APPROVED', body: 'lgtm', submittedAt: '2026-05-15T00:00:00Z' },
        { author: 'reviewer-b', state: 'CHANGES_REQUESTED', body: 'fix x', submittedAt: '2026-05-15T00:00:00Z' },
      ],
      statusCheckRollup: [
        { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
      ],
    }
    const lines = formatPullRequestTriagePreview(pr, detail).map(stripLine)

    expect(lines).toContain('Body')
    expect(lines).toContain('Fixes the dedupe rescue gap.')

    expect(lines.some((l) => l.startsWith('Checks ('))).toBe(true)
    expect(lines.some((l) => l.includes('1 pass'))).toBe(true)
    expect(lines.some((l) => l.includes('1 fail'))).toBe(true)

    expect(lines.some((l) => l.startsWith('Reviews ('))).toBe(true)
    expect(lines.some((l) => l.includes('@reviewer-a (approved)'))).toBe(true)
    expect(lines.some((l) => l.includes('@reviewer-b (changes requested)'))).toBe(true)

    expect(lines.some((l) => l.startsWith('Comments ('))).toBe(true)
    expect(lines.some((l) => l.includes('@commenter'))).toBe(true)
  })

  it('PR preview omits empty hydrated sections', () => {
    const detail = {
      number: 962,
      body: '',
      comments: [],
      reviews: [],
      statusCheckRollup: [],
    }
    const lines = formatPullRequestTriagePreview(pr, detail).map(stripLine)

    expect(lines).not.toContain('Body')
    expect(lines.some((l) => l.startsWith('Comments ('))).toBe(false)
    expect(lines.some((l) => l.startsWith('Reviews ('))).toBe(false)
    expect(lines.some((l) => l.startsWith('Checks ('))).toBe(false)
  })

  it('comments section truncates to the most recent N + summarizes the rest', () => {
    const detail = {
      number: 1,
      body: '',
      comments: Array.from({ length: 7 }, (_, i) => ({
        author: `reviewer-${i}`,
        body: `comment ${i}`,
        createdAt: '',
      })),
    }
    const lines = formatIssueTriagePreview(
      { ...issue, comments: 7 },
      detail
    ).map(stripLine)

    // Last 3 visible.
    expect(lines.some((l) => l.includes('@reviewer-6'))).toBe(true)
    expect(lines.some((l) => l.includes('@reviewer-5'))).toBe(true)
    expect(lines.some((l) => l.includes('@reviewer-4'))).toBe(true)
    // Older ones summarized.
    expect(lines.some((l) => l.includes('earlier comment'))).toBe(true)
    expect(lines.some((l) => l.includes('@reviewer-0'))).toBe(false)
  })

  it('reviews section truncates to the most recent 5 + summarizes the rest (#1589)', () => {
    const detail = {
      number: 1,
      body: '',
      comments: [],
      statusCheckRollup: [],
      reviews: Array.from({ length: 20 }, (_, i) => ({
        author: `reviewer-${i}`,
        state: 'APPROVED',
        body: `review ${i}`,
        submittedAt: '',
      })),
    }
    const lines = formatPullRequestTriagePreview(pr, detail).map(stripLine)

    expect(lines.some((l) => l.startsWith('Reviews (20)'))).toBe(true)
    // Last 5 visible.
    for (let i = 15; i < 20; i++) {
      expect(lines.some((l) => l.includes(`@reviewer-${i}`))).toBe(true)
    }
    // Older ones summarized, not individually rendered.
    expect(lines.some((l) => l.includes('15 earlier review'))).toBe(true)
    expect(lines.some((l) => l.includes('@reviewer-0 '))).toBe(false)
  })
})
