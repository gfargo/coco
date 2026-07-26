import type { UsageAggregate } from '../../lib/langchain/utils/usageLedger'
import { renderUsageRows } from './handler'

function row(overrides: Partial<UsageAggregate> = {}): UsageAggregate {
  return {
    key: 'commit',
    calls: 4,
    promptTokens: 1000,
    completionTokens: 200,
    cachedInputTokens: 0,
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
})
