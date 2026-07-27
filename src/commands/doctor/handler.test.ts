import { renderUsageRows } from './handler'
import { UsageAggregate } from '../../lib/langchain/utils/usageLedger'

function row(overrides: Partial<UsageAggregate> = {}): UsageAggregate {
  return {
    key: 'summarize-large-file',
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalMs: 0,
    avgMs: 0,
    cacheHits: 0,
    cacheLookups: 0,
    ...overrides,
  }
}

describe('renderUsageRows', () => {
  it('renders a cache segment showing hit rate over lookups, alongside call count', () => {
    const lines = renderUsageRows(
      [row({ calls: 2, promptTokens: 100, avgMs: 400, cacheHits: 1, cacheLookups: 3 })],
      'call'
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('2 call')
    expect(lines[0]).toContain('cache 33% (1/3)')
  })

  it('omits the cache segment when the cache was never consulted', () => {
    const lines = renderUsageRows([row({ calls: 5, promptTokens: 100, avgMs: 200 })], 'call')
    expect(lines[0]).not.toContain('cache')
  })

  it('renders a hits-only row with zero real calls', () => {
    const lines = renderUsageRows([row({ calls: 0, cacheHits: 2, cacheLookups: 2 })], 'call')
    expect(lines[0]).toContain('0 call')
    expect(lines[0]).toContain('cache 100% (2/2)')
  })
})
