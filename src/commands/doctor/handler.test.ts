import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Config } from '../../lib/config/types'
import { Logger } from '../../lib/utils/logger'
import { recordUsage, resetUsageLedgerState, type UsageAggregate } from '../../lib/langchain/utils/usageLedger'
import { PRICES_AS_OF } from '../../lib/langchain/utils/pricing'
import { formatRowCost, renderCostReport, renderUsageRows } from './handler'

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
    estimatedCostUsd: 0,
    pricedCalls: 0,
    unpricedCalls: 0,
    cacheHits: 0,
    cacheLookups: 0,
    ...overrides,
  }
}

function createLogger(): Logger {
  return {
    log: jest.fn(),
    verbose: jest.fn(),
    setConfig: jest.fn(),
    error: jest.fn(),
    startTimer: jest.fn().mockReturnThis(),
    stopTimer: jest.fn().mockReturnThis(),
    startSpinner: jest.fn().mockReturnThis(),
    stopSpinner: jest.fn().mockReturnThis(),
  } as unknown as Logger
}

describe('formatRowCost', () => {
  it('shows a dash when the group has no priced calls, rather than a misleading $0.00', () => {
    expect(formatRowCost(row({ pricedCalls: 0, estimatedCostUsd: 0 }))).toBe('–')
  })

  it('formats a priced group to 4 decimal places', () => {
    expect(formatRowCost(row({ pricedCalls: 1, estimatedCostUsd: 5 }))).toBe('$5.0000')
    expect(formatRowCost(row({ pricedCalls: 2, estimatedCostUsd: 0.123456 }))).toBe('$0.1235')
  })
})

describe('renderUsageRows', () => {
  it('shows a token dash for a row with no prompt or completion tokens', () => {
    const [line] = renderUsageRows([row({ key: 'summarize', calls: 3, promptTokens: 0, completionTokens: 0 })], 'call')
    expect(line).toContain('summarize')
    expect(line).toContain('–')
  })

  it('renders tokens, call count, and cost for a priced row', () => {
    const [line] = renderUsageRows(
      [row({ key: 'commit', calls: 2, promptTokens: 100, completionTokens: 40, avgMs: 250, pricedCalls: 2, estimatedCostUsd: 1.5 })],
      'call'
    )
    expect(line).toContain('commit')
    expect(line).toContain('2')
    expect(line).toContain('100 in / 40 out tok')
    expect(line).toContain('$1.5000')
    expect(line).toContain('avg 250ms')
  })

  it('renders one line per row, preserving order', () => {
    const lines = renderUsageRows(
      [row({ key: 'a' }), row({ key: 'b' }), row({ key: 'c' })],
      'call'
    )
    expect(lines).toHaveLength(3)
    expect(lines.map((l) => l.trim().split(/\s+/)[0])).toEqual(['a', 'b', 'c'])
  })

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

describe('renderCostReport', () => {
  let dir: string
  let logPath: string
  const prevEnv = process.env.COCO_USAGE_LOG

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-doctor-cost-'))
    logPath = path.join(dir, 'usage.jsonl')
    process.env.COCO_USAGE_LOG = logPath
    resetUsageLedgerState()
  })

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.COCO_USAGE_LOG
    else process.env.COCO_USAGE_LOG = prevEnv
    resetUsageLedgerState()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function fixedModelConfig(): Config {
    return { service: { provider: 'openai', model: 'gpt-5.5' } } as unknown as Config
  }

  it('reports that recording is off when the ledger is empty and logging is disabled', () => {
    process.env.COCO_USAGE_LOG = '0'
    const logger = createLogger()
    renderCostReport(fixedModelConfig(), logger, false)

    const lines = (logger.log as jest.Mock).mock.calls.map((c) => c[0]).join('\n')
    expect(lines).toContain('Usage recording is off')
  })

  it('sums estimated cost across priced calls and labels it with the pricing date', () => {
    // gpt-5.5: $10/1M in, $30/1M out -> $10 + $30 = $40 for 1M/1M tokens
    recordUsage({ task: 'commit', model: 'gpt-5.5', promptTokens: 1_000_000, completionTokens: 1_000_000 })
    const logger = createLogger()
    renderCostReport(fixedModelConfig(), logger, false)

    const lines = (logger.log as jest.Mock).mock.calls.map((c) => c[0]).join('\n')
    expect(lines).toContain('Estimated cost: $40.0000')
    expect(lines).toContain(`prices as of ${PRICES_AS_OF}`)
  })

  it('notes unpriced calls separately instead of folding them into the total', () => {
    recordUsage({ task: 'commit', model: 'gpt-5.5', promptTokens: 1_000, completionTokens: 1_000 })
    recordUsage({ task: 'commit', model: 'some-unpriced-model', promptTokens: 1_000, completionTokens: 1_000 })
    const logger = createLogger()
    renderCostReport(fixedModelConfig(), logger, false)

    const lines = (logger.log as jest.Mock).mock.calls.map((c) => c[0]).join('\n')
    expect(lines).toContain('1 call(s) on unpriced models shown as tokens only')
  })

  it('shows a tokens-only note when nothing in the ledger priced out to a cost', () => {
    recordUsage({ task: 'commit', model: 'some-unpriced-model', promptTokens: 1_000, completionTokens: 1_000 })
    const logger = createLogger()
    renderCostReport(fixedModelConfig(), logger, false)

    const lines = (logger.log as jest.Mock).mock.calls.map((c) => c[0]).join('\n')
    expect(lines).toContain('No priced models in this ledger yet')
    expect(lines).not.toContain('Estimated cost:')
  })

  it('emits the same total cost and pricesAsOf date in the --json shape', () => {
    recordUsage({ task: 'commit', model: 'gpt-5.5', promptTokens: 1_000_000, completionTokens: 1_000_000 })
    const logger = createLogger()
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      renderCostReport(fixedModelConfig(), logger, true)
      expect(writeSpy).toHaveBeenCalledTimes(1)
      const payload = JSON.parse((writeSpy.mock.calls[0][0] as string).trim())
      expect(payload.usage.totalEstimatedCostUsd).toBeCloseTo(40, 10)
      expect(payload.usage.pricedCalls).toBe(1)
      expect(payload.usage.unpricedCalls).toBe(0)
      expect(payload.usage.pricesAsOf).toBe(PRICES_AS_OF)
    } finally {
      writeSpy.mockRestore()
    }
  })
})
