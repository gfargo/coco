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
    cacheHits: 0,
    cacheLookups: 0,
    ...overrides,
  }
}

describe('renderUsageRows', () => {
  it('renders a diff-cache segment showing hit rate over lookups, alongside call count', () => {
    const lines = renderUsageRows(
      [row({ calls: 2, promptTokens: 100, avgMs: 400, cacheHits: 1, cacheLookups: 3 })],
      'call'
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('2 call')
    expect(lines[0]).toContain('diff-cache 33% (1/3)')
  })

  it('omits the diff-cache segment when the cache was never consulted', () => {
    const lines = renderUsageRows([row({ calls: 5, promptTokens: 100, avgMs: 200 })], 'call')
    expect(lines[0]).not.toContain('diff-cache')
  })

  it('renders a hits-only row with zero real calls', () => {
    const lines = renderUsageRows([row({ calls: 0, cacheHits: 2, cacheLookups: 2 })], 'call')
    expect(lines[0]).toContain('0 call')
    expect(lines[0]).toContain('diff-cache 100% (2/2)')
  })

  it('shows a prompt-cache hit-rate when cachedInputTokens is present', () => {
    const [line] = renderUsageRows([row({ cachedInputTokens: 800 })], 'call')
    expect(line).toContain('prompt-cache 80%')
  })

  it('omits the prompt-cache hit-rate entirely when no cache data was recorded', () => {
    const [line] = renderUsageRows([row({ cachedInputTokens: 0 })], 'call')
    expect(line).not.toContain('prompt-cache')
  })

  it('prefers the provider-reported inputTokens over the local promptTokens estimate as the denominator', () => {
    const [line] = renderUsageRows(
      [row({ cachedInputTokens: 500, inputTokens: 1000, promptTokens: 300 })],
      'call'
    )
    expect(line).toContain('prompt-cache 50%')
  })

  it('never reports a prompt-cache hit-rate above 100%, even when the local estimate undercounts the real denominator', () => {
    const [line] = renderUsageRows(
      [row({ cachedInputTokens: 1200, promptTokens: 1000, inputTokens: 0 })],
      'call'
    )
    expect(line).toContain('prompt-cache 100%')
    expect(line).not.toContain('120%')
  })

  it('renders both the diff-cache and prompt-cache segments together when both are present', () => {
    const [line] = renderUsageRows(
      [row({ cacheHits: 1, cacheLookups: 2, cachedInputTokens: 400, inputTokens: 800 })],
      'call'
    )
    expect(line).toContain('diff-cache 50% (1/2)')
    expect(line).toContain('prompt-cache 50%')
  })
})
