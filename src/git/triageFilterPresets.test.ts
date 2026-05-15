import {
  cycleIssueFilterPreset,
  cyclePullRequestFilterPreset,
  ISSUE_FILTER_LABELS,
  ISSUE_FILTER_PRESETS,
  issueFilterForPreset,
  PULL_REQUEST_FILTER_LABELS,
  PULL_REQUEST_FILTER_PRESETS,
  pullRequestFilterForPreset,
} from './triageFilterPresets'

describe('issue filter presets', () => {
  it('cycles through every preset in declaration order then wraps', () => {
    const visited: string[] = []
    let current = ISSUE_FILTER_PRESETS[0]
    for (let i = 0; i < ISSUE_FILTER_PRESETS.length + 1; i++) {
      visited.push(current)
      current = cycleIssueFilterPreset(current)
    }
    expect(visited).toEqual([...ISSUE_FILTER_PRESETS, ISSUE_FILTER_PRESETS[0]])
  })

  it('has a label for every preset (no implicit default)', () => {
    for (const preset of ISSUE_FILTER_PRESETS) {
      expect(ISSUE_FILTER_LABELS[preset]).toBeTruthy()
    }
  })

  it.each(ISSUE_FILTER_PRESETS)(
    'maps %s to a filter object with at least one knob set',
    (preset) => {
      const filter = issueFilterForPreset(preset)
      const knobs = Object.values(filter).filter((v) => v !== undefined && v !== '')
      expect(knobs.length).toBeGreaterThan(0)
    }
  )

  it('mine implies state=open + assignee=@me', () => {
    expect(issueFilterForPreset('mine')).toEqual({ state: 'open', assignee: '@me' })
  })

  it('assigned maps to assignee=@me without forcing a state', () => {
    expect(issueFilterForPreset('assigned')).toEqual({ assignee: '@me' })
  })
})

describe('pull request filter presets', () => {
  it('cycles through every preset in declaration order then wraps', () => {
    const visited: string[] = []
    let current = PULL_REQUEST_FILTER_PRESETS[0]
    for (let i = 0; i < PULL_REQUEST_FILTER_PRESETS.length + 1; i++) {
      visited.push(current)
      current = cyclePullRequestFilterPreset(current)
    }
    expect(visited).toEqual([...PULL_REQUEST_FILTER_PRESETS, PULL_REQUEST_FILTER_PRESETS[0]])
  })

  it('has a label for every preset', () => {
    for (const preset of PULL_REQUEST_FILTER_PRESETS) {
      expect(PULL_REQUEST_FILTER_LABELS[preset]).toBeTruthy()
    }
  })

  it('mine implies state=open + author=@me (not assignee)', () => {
    // PRs are work people POST, so "mine" means "I authored it".
    // Distinct from `assigned` which means assignee=@me.
    expect(pullRequestFilterForPreset('mine')).toEqual({ state: 'open', author: '@me' })
    expect(pullRequestFilterForPreset('assigned')).toEqual({ assignee: '@me' })
  })

  it('draft forces state=open + draft=true', () => {
    expect(pullRequestFilterForPreset('draft')).toEqual({ state: 'open', draft: true })
  })

  it('merged maps to state=merged (distinct from closed)', () => {
    expect(pullRequestFilterForPreset('merged')).toEqual({ state: 'merged' })
    expect(pullRequestFilterForPreset('closed')).toEqual({ state: 'closed' })
  })
})
