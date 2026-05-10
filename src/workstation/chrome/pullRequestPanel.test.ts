import {
  buildPullRequestCheckRows,
  formatPullRequestChecksSummary,
  formatPullRequestReviewsSummary,
  formatPullRequestStateLine,
  normalizePullRequestCheckStatus,
  pullRequestCheckGlyph,
  summarizePullRequestChecks,
  summarizePullRequestReviews,
} from './pullRequestPanel'

describe('normalizePullRequestCheckStatus', () => {
  it('treats IN_PROGRESS / QUEUED / PENDING (no conclusion) as pending', () => {
    expect(normalizePullRequestCheckStatus({ name: 'a', status: 'IN_PROGRESS' })).toBe('pending')
    expect(normalizePullRequestCheckStatus({ name: 'a', status: 'QUEUED' })).toBe('pending')
    expect(normalizePullRequestCheckStatus({ name: 'a', status: 'PENDING' })).toBe('pending')
  })

  it('promotes failure conclusions even when status is COMPLETED', () => {
    expect(normalizePullRequestCheckStatus({ name: 'a', status: 'COMPLETED', conclusion: 'FAILURE' })).toBe('failure')
    expect(normalizePullRequestCheckStatus({ name: 'a', status: 'COMPLETED', conclusion: 'ERROR' })).toBe('failure')
    expect(normalizePullRequestCheckStatus({ name: 'a', status: 'COMPLETED', conclusion: 'TIMED_OUT' })).toBe('failure')
    expect(normalizePullRequestCheckStatus({ name: 'a', status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' })).toBe('failure')
  })

  it('maps SUCCESS / NEUTRAL / SKIPPED / CANCELLED conclusions', () => {
    expect(normalizePullRequestCheckStatus({ name: 'a', conclusion: 'SUCCESS' })).toBe('success')
    expect(normalizePullRequestCheckStatus({ name: 'a', conclusion: 'NEUTRAL' })).toBe('neutral')
    expect(normalizePullRequestCheckStatus({ name: 'a', conclusion: 'SKIPPED' })).toBe('skipped')
    expect(normalizePullRequestCheckStatus({ name: 'a', conclusion: 'CANCELLED' })).toBe('skipped')
  })

  it('falls back to pending for unknown signals', () => {
    expect(normalizePullRequestCheckStatus({ name: 'a' })).toBe('pending')
    expect(normalizePullRequestCheckStatus({ name: 'a', conclusion: 'MYSTERY' })).toBe('pending')
  })
})

describe('pullRequestCheckGlyph', () => {
  it('uses Unicode glyphs by default and ASCII fallbacks under ascii mode', () => {
    expect(pullRequestCheckGlyph('success')).toBe('✓')
    expect(pullRequestCheckGlyph('failure')).toBe('✗')
    expect(pullRequestCheckGlyph('pending')).toBe('◌')

    expect(pullRequestCheckGlyph('success', { ascii: true })).toBe('+')
    expect(pullRequestCheckGlyph('failure', { ascii: true })).toBe('x')
    expect(pullRequestCheckGlyph('pending', { ascii: true })).toBe('.')
  })
})

describe('summarizePullRequestChecks', () => {
  it('counts each normalized status across the rollup', () => {
    const summary = summarizePullRequestChecks([
      { name: 'lint', conclusion: 'SUCCESS' },
      { name: 'test', conclusion: 'SUCCESS' },
      { name: 'build', status: 'IN_PROGRESS' },
      { name: 'flaky', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'optional', conclusion: 'SKIPPED' },
    ])
    expect(summary).toEqual({
      total: 5, success: 2, failure: 1, pending: 1, neutral: 0, skipped: 1,
    })
  })

  it('returns a zeroed summary for missing rollup', () => {
    expect(summarizePullRequestChecks(undefined).total).toBe(0)
  })
})

describe('formatPullRequestChecksSummary', () => {
  it('hides zero-count categories so the line stays scannable', () => {
    const summary = summarizePullRequestChecks([
      { name: 'lint', conclusion: 'SUCCESS' },
      { name: 'test', conclusion: 'SUCCESS' },
      { name: 'build', status: 'IN_PROGRESS' },
    ])
    expect(formatPullRequestChecksSummary(summary)).toBe('3 checks · 2 ✓ · 1 ◌')
  })

  it('falls back to "No status checks" when total is zero', () => {
    expect(formatPullRequestChecksSummary(summarizePullRequestChecks([]))).toBe('No status checks reported')
  })
})

describe('buildPullRequestCheckRows', () => {
  it('produces one row per check with glyph + normalized status + detail', () => {
    const rows = buildPullRequestCheckRows([
      { name: 'lint', conclusion: 'SUCCESS' },
      { name: 'build', status: 'IN_PROGRESS' },
    ])
    expect(rows).toEqual([
      { glyph: '✓', name: 'lint', status: 'success', detail: 'success' },
      { glyph: '◌', name: 'build', status: 'pending', detail: 'in_progress' },
    ])
  })
})

describe('summarizePullRequestReviews', () => {
  it('counts per-state reviews and exposes the GraphQL decision label', () => {
    const summary = summarizePullRequestReviews(
      [
        { state: 'APPROVED' },
        { state: 'APPROVED' },
        { state: 'COMMENTED' },
        { state: 'CHANGES_REQUESTED' },
        { state: 'DISMISSED' },
      ],
      'APPROVED'
    )
    expect(summary).toEqual({
      total: 5,
      approved: 2,
      changesRequested: 1,
      commented: 1,
      dismissed: 1,
      pending: 0,
      decisionLabel: 'APPROVED',
    })
  })
})

describe('formatPullRequestReviewsSummary', () => {
  it('renders per-state counts plus the decision label', () => {
    const summary = summarizePullRequestReviews(
      [{ state: 'APPROVED' }, { state: 'COMMENTED' }],
      'APPROVED'
    )
    expect(formatPullRequestReviewsSummary(summary))
      .toBe('2 reviews · 1 approved · 1 commented · decision: approved')
  })

  it('uses the decision label even when no reviews exist', () => {
    const summary = summarizePullRequestReviews([], 'REVIEW_REQUIRED')
    expect(formatPullRequestReviewsSummary(summary)).toBe('No reviews · review required')
  })

  it('omits the decision suffix when no reviews and no decision', () => {
    expect(formatPullRequestReviewsSummary(summarizePullRequestReviews([])))
      .toBe('No reviews submitted')
  })
})

describe('formatPullRequestStateLine', () => {
  it('appends draft + mergeable for open PRs', () => {
    expect(formatPullRequestStateLine({
      number: 1, title: 't', url: 'u',
      state: 'OPEN', isDraft: true, headRefName: 'h', baseRefName: 'b',
      mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
    })).toBe('OPEN · draft · mergeable')
  })

  it('surfaces merge-state warnings when the PR is dirty / blocked / behind', () => {
    expect(formatPullRequestStateLine({
      number: 1, title: 't', url: 'u',
      state: 'OPEN', isDraft: false, headRefName: 'h', baseRefName: 'b',
      mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY',
    })).toBe('OPEN · conflicting · dirty')
  })

  it('returns just the state for merged / closed PRs', () => {
    expect(formatPullRequestStateLine({
      number: 1, title: 't', url: 'u',
      state: 'MERGED', isDraft: false, headRefName: 'h', baseRefName: 'b',
      mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
    })).toBe('MERGED')
  })
})
