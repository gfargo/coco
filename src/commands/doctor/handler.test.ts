import type { UsageAggregate } from '../../lib/langchain/utils/usageLedger'
import { renderUsageRows } from './handler'

function row(overrides: Partial<UsageAggregate> = {}): UsageAggregate {
  return {
    key: 'commit',
    calls: 4,
    promptTokens: 1000,
    completionTokens: 200,
    cachedInputTokens: 0,
    inputTokens: 0,
    totalMs: 400,
    avgMs: 100,
    ...overrides,
  }
}

describe('renderUsageRows', () => {
  it('shows a cache hit-rate when cachedInputTokens is present', () => {
    const [line] = renderUsageRows([row({ cachedInputTokens: 800 })], 'call')
    expect(line).toContain('cache 80%')
  })

  it('omits the hit-rate entirely when no cache data was recorded', () => {
    const [line] = renderUsageRows([row({ cachedInputTokens: 0 })], 'call')
    expect(line).not.toContain('cache')
  })

  it('prefers the provider-reported inputTokens over the local promptTokens estimate as the denominator', () => {
    const [line] = renderUsageRows(
      [row({ cachedInputTokens: 500, inputTokens: 1000, promptTokens: 300 })],
      'call'
    )
    expect(line).toContain('cache 50%')
  })

  it('never reports a hit-rate above 100%, even when the local estimate undercounts the real denominator', () => {
    const [line] = renderUsageRows(
      [row({ cachedInputTokens: 1200, promptTokens: 1000, inputTokens: 0 })],
      'call'
    )
    expect(line).toContain('cache 100%')
    expect(line).not.toContain('120%')
  })
})
