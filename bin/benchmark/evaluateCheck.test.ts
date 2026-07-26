import { BenchResult, DEFAULT_CHECK_TOLERANCES, evaluateCheck } from './evaluateCheck'

function makeResult(overrides: Partial<BenchResult> & Pick<BenchResult, 'fixture'>): BenchResult {
  return {
    fileCount: 1,
    approxTokens: 100,
    durationMs: 100,
    llmCalls: 1,
    llmTotalMs: 100,
    llmTotalPromptTokens: 100,
    ...overrides,
  }
}

describe('evaluateCheck', () => {
  it('passes when llmCalls matches the baseline cold row', () => {
    const baseline = [makeResult({ fixture: 'medium', llmCalls: 6, pass: 'cold' })]
    const results = [makeResult({ fixture: 'medium', llmCalls: 6 })]

    const { ok, entries } = evaluateCheck(results, baseline)

    expect(ok).toBe(true)
    expect(entries[0].status).toBe('ok')
  })

  it('passes when llmCalls decreases from the baseline', () => {
    const baseline = [makeResult({ fixture: 'medium', llmCalls: 6, pass: 'cold' })]
    const results = [makeResult({ fixture: 'medium', llmCalls: 4 })]

    const { ok, entries } = evaluateCheck(results, baseline)

    expect(ok).toBe(true)
    expect(entries[0].status).toBe('ok')
  })

  it('flags a regression when llmCalls increases past the baseline cold row', () => {
    const baseline = [makeResult({ fixture: 'medium', llmCalls: 6, pass: 'cold' })]
    const results = [makeResult({ fixture: 'medium', llmCalls: 7 })]

    const { ok, entries } = evaluateCheck(results, baseline)

    expect(ok).toBe(false)
    expect(entries[0].status).toBe('regression')
    expect(entries[0].message).toContain('llmCalls regressed 6 -> 7')
  })

  it('matches against the baseline cold row, not the warm row, when both are present', () => {
    const baseline = [
      makeResult({ fixture: 'medium', llmCalls: 6, durationMs: 8000, pass: 'cold' }),
      makeResult({ fixture: 'medium', llmCalls: 0, durationMs: 4, pass: 'warm' }),
    ]
    // A --check run has no `pass` field; if it accidentally matched the
    // warm row (llmCalls: 0), any nonzero cold llmCalls would look like
    // a regression relative to 0.
    const results = [makeResult({ fixture: 'medium', llmCalls: 6, durationMs: 8000 })]

    const { ok, entries } = evaluateCheck(results, baseline)

    expect(ok).toBe(true)
    expect(entries[0].baselineLlmCalls).toBe(6)
  })

  it('treats durationMs drift as a warning, not a failure', () => {
    const baseline = [makeResult({ fixture: 'large', llmCalls: 7, durationMs: 10000, pass: 'cold' })]
    const results = [makeResult({ fixture: 'large', llmCalls: 7, durationMs: 20000 })]

    const { ok, entries } = evaluateCheck(results, baseline)

    expect(ok).toBe(true)
    expect(entries[0].status).toBe('warning')
    expect(entries[0].message).toContain('durationMs drifted')
  })

  it('ignores durationMs drift below the absolute floor even if the percentage is large', () => {
    const baseline = [makeResult({ fixture: 'tiny', llmCalls: 0, durationMs: 1, pass: 'cold' })]
    const results = [makeResult({ fixture: 'tiny', llmCalls: 0, durationMs: 50 })]

    const { ok, entries } = evaluateCheck(results, baseline, DEFAULT_CHECK_TOLERANCES)

    expect(ok).toBe(true)
    expect(entries[0].status).toBe('ok')
  })

  it('warns instead of failing when a fixture has no baseline row', () => {
    const results = [makeResult({ fixture: 'brand-new', llmCalls: 3 })]

    const { ok, entries } = evaluateCheck(results, [])

    expect(ok).toBe(true)
    expect(entries[0].status).toBe('warning')
    expect(entries[0].message).toContain('no baseline row')
  })

  it('warns instead of failing when there is no baseline at all', () => {
    const results = [makeResult({ fixture: 'medium', llmCalls: 6 })]

    const { ok, entries } = evaluateCheck(results, undefined)

    expect(ok).toBe(true)
    expect(entries[0].status).toBe('warning')
  })
})
