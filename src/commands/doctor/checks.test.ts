import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Config } from '../../lib/config/types'
import { getOllamaStatus } from '../../lib/langchain/utils/ollamaStatus'
import { recordUsage, resetUsageLedgerState } from '../../lib/langchain/utils/usageLedger'
import {
    checkAuthentication,
    checkCacheHitRate,
    checkDynamicRouting,
    checkEndpointSupport,
    checkOllamaLiveness,
    checkProviderValidity,
    checkUsageBudget,
    Diagnostic,
} from './checks'

jest.mock('../../lib/langchain/utils/ollamaStatus', () => ({
  DEFAULT_OLLAMA_ENDPOINT: 'http://localhost:11434',
  getOllamaStatus: jest.fn(),
}))

const mockGetOllamaStatus = getOllamaStatus as jest.MockedFunction<typeof getOllamaStatus>

function ollamaConfig(overrides: Record<string, unknown> = {}): Config {
  return {
    service: {
      provider: 'ollama',
      model: 'llama3.1:8b',
      authentication: { type: 'None' },
      ...overrides,
    },
  } as unknown as Config
}

describe('checkProviderValidity', () => {
  function configWithProvider(provider: string): Config {
    return { service: { provider, model: 'some-model' } } as unknown as Config
  }

  it('produces no diagnostic for a valid provider', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity(configWithProvider('anthropic'), diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('produces no diagnostic when provider is absent', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity({ service: { model: 'gpt-4o' } } as unknown as Config, diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('produces no diagnostic when service block is absent', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity({} as Config, diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('flags an unknown provider with an error diagnostic', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity(configWithProvider('typo-provider'), diagnostics)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('error')
    expect(diagnostics[0].message).toContain('"typo-provider"')
    expect(diagnostics[0].autoFix).toBeUndefined()
  })

  it('suggests anthropic and provides autoFix for alias "claude"', () => {
    const raw = { service: { provider: 'claude', model: 'claude-opus-4-8' } }
    const config = raw as unknown as Config
    const diagnostics: Diagnostic[] = []
    checkProviderValidity(config, diagnostics)

    expect(diagnostics).toHaveLength(1)
    const [d] = diagnostics
    expect(d.severity).toBe('error')
    expect(d.message).toContain('"claude"')
    expect(d.message).toContain('"anthropic"')
    expect(d.fix).toContain('"anthropic"')
    expect(typeof d.autoFix).toBe('function')

    d.autoFix!(raw as Record<string, unknown>)
    expect((raw.service as Record<string, unknown>).provider).toBe('anthropic')
  })

  it('suggests openai for alias "gpt"', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity(configWithProvider('gpt'), diagnostics)
    expect(diagnostics[0].message).toContain('"openai"')
  })

  it('suggests openai for alias "chatgpt"', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity(configWithProvider('chatgpt'), diagnostics)
    expect(diagnostics[0].message).toContain('"openai"')
  })

  it('suggests gemini for alias "google"', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity(configWithProvider('google'), diagnostics)
    expect(diagnostics[0].message).toContain('"gemini"')
  })

  it('suggests bedrock for alias "aws"', () => {
    const diagnostics: Diagnostic[] = []
    checkProviderValidity(configWithProvider('aws'), diagnostics)
    expect(diagnostics[0].message).toContain('"bedrock"')
  })

  // #OSS-1623 — the OpenAI-compatible presets are first-class providers now,
  // so `coco doctor` must recognize them (not flag as "Unknown provider").
  it.each(['deepseek', 'groq', 'xai', 'together', 'fireworks', 'openrouter', 'lmstudio', 'vllm'])(
    'produces no diagnostic for the first-class provider "%s"',
    (provider) => {
      const diagnostics: Diagnostic[] = []
      checkProviderValidity(configWithProvider(provider), diagnostics)
      expect(diagnostics).toEqual([])
    }
  )
})

describe('checkAuthentication', () => {
  it('errors when a real provider (openai, no baseURL) has no authentication configured', () => {
    const config = {
      service: { provider: 'openai', model: 'gpt-4o', authentication: { type: 'None' } },
    } as unknown as Config
    const diagnostics: Diagnostic[] = []
    checkAuthentication(config, diagnostics)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('error')
    expect(diagnostics[0].message).toContain('requires authentication')
  })

  // #1610 — an OpenAI-compatible endpoint (baseURL set) is commonly
  // self-hosted/local and may have no auth at all (LM Studio, vLLM); that
  // shouldn't read as a broken config the way a keyless real OpenAI does.
  it('only warns when an OpenAI-compatible endpoint (baseURL set) has no authentication configured', () => {
    const config = {
      service: {
        provider: 'openai',
        model: 'local-model',
        baseURL: 'http://localhost:1234/v1',
        authentication: { type: 'None' },
      },
    } as unknown as Config
    const diagnostics: Diagnostic[] = []
    checkAuthentication(config, diagnostics)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warn')
    expect(diagnostics[0].message).toContain('http://localhost:1234/v1')
  })

  it('produces no diagnostic when a real provider has an API key', () => {
    const config = {
      service: {
        provider: 'openai',
        model: 'gpt-4o',
        authentication: { type: 'APIKey', credentials: { apiKey: 'sk-real-key' } },
      },
    } as unknown as Config
    const diagnostics: Diagnostic[] = []
    checkAuthentication(config, diagnostics)

    expect(diagnostics).toEqual([])
  })

  // #OSS-1623 — first-class OpenAI-compatible providers.
  it('errors when a hosted compat provider (groq) has no authentication configured', () => {
    const config = {
      service: { provider: 'groq', model: 'llama-3.3-70b-versatile', authentication: { type: 'None' } },
    } as unknown as Config
    const diagnostics: Diagnostic[] = []
    checkAuthentication(config, diagnostics)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('error')
    expect(diagnostics[0].message).toContain('requires authentication')
  })

  it('only warns when a no-auth local provider (lmstudio) has no authentication configured', () => {
    const config = {
      service: { provider: 'lmstudio', model: 'local-model', authentication: { type: 'None' } },
    } as unknown as Config
    const diagnostics: Diagnostic[] = []
    checkAuthentication(config, diagnostics)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warn')
  })

  it('only warns when a no-auth local provider (vllm) has no authentication configured', () => {
    const config = {
      service: { provider: 'vllm', model: 'local-model', authentication: { type: 'None' } },
    } as unknown as Config
    const diagnostics: Diagnostic[] = []
    checkAuthentication(config, diagnostics)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warn')
  })
})

describe('checkEndpointSupport', () => {
  function configWith(provider: string, extra: Record<string, unknown> = {}): Config {
    return { service: { provider, model: 'some-model', ...extra } } as unknown as Config
  }

  it('produces no diagnostic when endpoint is not set', () => {
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport(configWith('openai'), diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('produces no diagnostic when provider is ollama and endpoint is set', () => {
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport(configWith('ollama', { endpoint: 'http://localhost:11434' }), diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('warns when endpoint is set for openai (ignores it)', () => {
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport(configWith('openai', { endpoint: 'http://custom-host:8080' }), diagnostics)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warn')
    expect(diagnostics[0].message).toContain('"openai"')
    expect(diagnostics[0].fix).toContain('baseURL')
  })

  it('warns when endpoint is set for anthropic (ignores it)', () => {
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport(configWith('anthropic', { endpoint: 'http://custom-host:8080' }), diagnostics)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warn')
    expect(diagnostics[0].message).toContain('"anthropic"')
    expect(diagnostics[0].fix).toContain('baseURL')
  })

  it('warns when endpoint is set for a provider with no custom-host support', () => {
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport(configWith('gemini', { endpoint: 'http://custom-host:8080' }), diagnostics)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warn')
    expect(diagnostics[0].message).toContain('"gemini"')
    expect(diagnostics[0].fix).not.toContain('baseURL')
  })

  it('autoFix removes the stray endpoint field', () => {
    const raw = { service: { provider: 'openai', model: 'gpt-4o', endpoint: 'http://custom-host' } }
    const config = raw as unknown as Config
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport(config, diagnostics)

    expect(diagnostics).toHaveLength(1)
    expect(typeof diagnostics[0].autoFix).toBe('function')
    diagnostics[0].autoFix!(raw as Record<string, unknown>)
    expect((raw.service as Record<string, unknown>).endpoint).toBeUndefined()
  })

  it('produces no diagnostic when provider is absent', () => {
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport({ service: { model: 'gpt-4o', endpoint: 'http://x' } } as unknown as Config, diagnostics)
    expect(diagnostics).toEqual([])
  })

  // #OSS-1623 — compat providers use service.baseURL, same as openai/anthropic.
  it('warns when endpoint (not baseURL) is set for a first-class compat provider (groq)', () => {
    const diagnostics: Diagnostic[] = []
    checkEndpointSupport(configWith('groq', { endpoint: 'http://custom-host:8080' }), diagnostics)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warn')
    expect(diagnostics[0].fix).toContain('baseURL')
  })
})

describe('checkCacheHitRate', () => {
  let dir: string
  let logPath: string
  const prevEnv = process.env.COCO_USAGE_LOG

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-doctor-cache-'))
    logPath = path.join(dir, 'usage.jsonl')
    process.env.COCO_USAGE_LOG = logPath
  })

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.COCO_USAGE_LOG
    else process.env.COCO_USAGE_LOG = prevEnv
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('produces no diagnostic when the ledger is empty', () => {
    const diagnostics: Diagnostic[] = []
    checkCacheHitRate(diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('produces no diagnostic below the minimum lookup sample size', () => {
    for (let i = 0; i < 5; i++) {
      recordUsage({ task: 'summarize-large-file', model: 'gpt-4o', cacheHit: false })
    }
    const diagnostics: Diagnostic[] = []
    checkCacheHitRate(diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('produces no diagnostic when the hit rate is healthy', () => {
    for (let i = 0; i < 18; i++) {
      recordUsage({ task: 'summarize-large-file', model: 'gpt-4o', cacheHit: true })
    }
    for (let i = 0; i < 2; i++) {
      recordUsage({ task: 'summarize-large-file', model: 'gpt-4o', cacheHit: false })
    }
    const diagnostics: Diagnostic[] = []
    checkCacheHitRate(diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('warns when the hit rate is low across enough lookups', () => {
    for (let i = 0; i < 2; i++) {
      recordUsage({ task: 'summarize-large-file', model: 'gpt-4o', cacheHit: true })
    }
    for (let i = 0; i < 18; i++) {
      recordUsage({ task: 'summarize-directory-diff', model: 'gpt-4o', cacheHit: false })
    }
    const diagnostics: Diagnostic[] = []
    checkCacheHitRate(diagnostics)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warn')
    expect(diagnostics[0].message).toContain('10%')
    expect(diagnostics[0].fix).toContain('repo root')
  })

  it('ignores non-cache tasks when computing the rate', () => {
    for (let i = 0; i < 20; i++) {
      recordUsage({ task: 'commit', model: 'gpt-4o', promptTokens: 10 })
    }
    const diagnostics: Diagnostic[] = []
    checkCacheHitRate(diagnostics)
    expect(diagnostics).toEqual([])
  })
})

describe('checkOllamaLiveness', () => {
  afterEach(() => jest.clearAllMocks())

  it('is a no-op for non-Ollama providers (no network call)', async () => {
    const config = { service: { provider: 'openai', model: 'gpt-4o' } } as unknown as Config

    const diagnostics = await checkOllamaLiveness(config)

    expect(diagnostics).toEqual([])
    expect(mockGetOllamaStatus).not.toHaveBeenCalled()
  })

  it('errors with a serve hint when installed but the daemon is unreachable', async () => {
    mockGetOllamaStatus.mockResolvedValue({ reachable: false, installed: true, models: [] })

    const [diagnostic] = await checkOllamaLiveness(ollamaConfig())

    expect(diagnostic.severity).toBe('error')
    expect(diagnostic.message).toContain('not reachable')
    expect(diagnostic.fix).toContain('ollama serve')
  })

  it('errors with an install hint when Ollama is not installed', async () => {
    mockGetOllamaStatus.mockResolvedValue({ reachable: false, installed: false, models: [] })

    const [diagnostic] = await checkOllamaLiveness(ollamaConfig())

    expect(diagnostic.severity).toBe('error')
    expect(diagnostic.fix).toContain('ollama.com/download')
  })

  it('passes silently when the configured model is pulled', async () => {
    mockGetOllamaStatus.mockResolvedValue({
      reachable: true,
      installed: true,
      models: ['llama3.1:8b', 'qwen2.5-coder:7b'],
    })

    const diagnostics = await checkOllamaLiveness(ollamaConfig())

    expect(diagnostics).toEqual([])
  })

  it('tolerates the implicit :latest tag', async () => {
    mockGetOllamaStatus.mockResolvedValue({
      reachable: true,
      installed: true,
      models: ['llama3.1:latest'],
    })

    const diagnostics = await checkOllamaLiveness(ollamaConfig({ model: 'llama3.1' }))

    expect(diagnostics).toEqual([])
  })

  it('warns with a pull hint when the configured model is missing', async () => {
    mockGetOllamaStatus.mockResolvedValue({
      reachable: true,
      installed: true,
      models: ['llama3.2:3b'],
    })

    const [diagnostic] = await checkOllamaLiveness(ollamaConfig({ model: 'llama3.1:8b' }))

    expect(diagnostic.severity).toBe('warn')
    expect(diagnostic.message).toContain("'llama3.1:8b'")
    expect(diagnostic.fix).toBe('Pull it with `ollama pull llama3.1:8b`.')
  })

  it('resolves the commit-tier model for dynamic configs', async () => {
    mockGetOllamaStatus.mockResolvedValue({
      reachable: true,
      installed: true,
      models: ['llama3.2:3b'],
    })

    const [diagnostic] = await checkOllamaLiveness(
      ollamaConfig({ model: 'dynamic', dynamicModelPreference: 'balanced' }),
    )

    expect(diagnostic.severity).toBe('warn')
    // balanced commit tier for ollama is qwen2.5-coder:14b
    expect(diagnostic.message).toContain('qwen2.5-coder:14b')
    expect(diagnostic.message).toContain('dynamic → commit')
  })
})

describe('checkUsageBudget', () => {
  let dir: string
  let logPath: string
  const prevEnv = process.env.COCO_USAGE_LOG

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-budget-'))
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

  function budgetConfig(monthlyUsd?: number, warnAtPercent?: number): Config {
    return { telemetry: { budget: { monthlyUsd, warnAtPercent } } } as unknown as Config
  }

  it('is a no-op when no monthlyUsd cap is configured', () => {
    recordUsage({ task: 'commit', model: 'gpt-5.5', promptTokens: 1_000_000, completionTokens: 1_000_000 })
    const diagnostics: Diagnostic[] = []
    checkUsageBudget({ telemetry: {} } as unknown as Config, diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('is a no-op when spend is under warnAtPercent', () => {
    // gpt-5.5: $10/1M in, $30/1M out -> ~$4 for these tokens
    recordUsage({ task: 'commit', model: 'gpt-5.5', promptTokens: 100_000, completionTokens: 100_000 })
    const diagnostics: Diagnostic[] = []
    checkUsageBudget(budgetConfig(100, 80), diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('warns when spend is at or above warnAtPercent', () => {
    // gpt-5.5: $10/1M in, $30/1M out -> $10 + $30 = $40 for 1M/1M tokens
    recordUsage({ task: 'commit', model: 'gpt-5.5', promptTokens: 1_000_000, completionTokens: 1_000_000 })
    const diagnostics: Diagnostic[] = []
    checkUsageBudget(budgetConfig(50, 80), diagnostics)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warn')
    expect(diagnostics[0].message).toContain('$40.00')
    expect(diagnostics[0].message).toContain('$50')
  })

  it('defaults warnAtPercent to 80 when unset', () => {
    recordUsage({ task: 'commit', model: 'gpt-5.5', promptTokens: 1_000_000, completionTokens: 1_000_000 })
    const diagnostics: Diagnostic[] = []
    checkUsageBudget(budgetConfig(45), diagnostics)
    expect(diagnostics).toHaveLength(1)
  })

  it('does not false-warn when the ledger only has unpriced models', () => {
    recordUsage({ task: 'commit', model: 'some-unpriced-model', promptTokens: 1_000_000, completionTokens: 1_000_000 })
    const diagnostics: Diagnostic[] = []
    checkUsageBudget(budgetConfig(1, 1), diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('warns on any priced spend when monthlyUsd is 0 (not treated as disabled)', () => {
    recordUsage({ task: 'commit', model: 'gpt-5.5', promptTokens: 1_000, completionTokens: 1_000 })
    const diagnostics: Diagnostic[] = []
    checkUsageBudget(budgetConfig(0), diagnostics)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warn')
    expect(diagnostics[0].message).toContain('$0')
  })

  it('is a no-op when monthlyUsd is 0 and there is no priced spend yet', () => {
    const diagnostics: Diagnostic[] = []
    checkUsageBudget(budgetConfig(0), diagnostics)
    expect(diagnostics).toEqual([])
  })

  it('warns on any priced spend when monthlyUsd is negative', () => {
    recordUsage({ task: 'commit', model: 'gpt-5.5', promptTokens: 1_000, completionTokens: 1_000 })
    const diagnostics: Diagnostic[] = []
    checkUsageBudget(budgetConfig(-10), diagnostics)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0].severity).toBe('warn')
  })

  it('ignores records outside the current calendar month', () => {
    const oldTimestamp = new Date('2020-01-01T00:00:00Z').getTime()
    fs.writeFileSync(
      logPath,
      `${JSON.stringify({ t: oldTimestamp, task: 'commit', model: 'gpt-5.5', promptTokens: 1_000_000, completionTokens: 1_000_000 })}\n`
    )
    const diagnostics: Diagnostic[] = []
    checkUsageBudget(budgetConfig(1, 1), diagnostics)
    expect(diagnostics).toEqual([])
  })

  // The month boundary is computed in UTC, not the host's local time zone
  // (a prior version used `Date#getFullYear`/`getMonth`, which reads local
  // time). In UTC-12, both `now` and the record below fall in UTC March —
  // but their *local* dates straddle the Feb/Mar boundary, so a local-time
  // implementation would wrongly exclude the record as "last month" and
  // miss the warning entirely. This pins TZ to catch a regression back to
  // local-time methods.
  it('uses UTC (not host-local time) to decide "this calendar month"', () => {
    const prevTz = process.env.TZ
    process.env.TZ = 'Etc/GMT+12' // fixed UTC-12 offset, no DST
    jest.useFakeTimers().setSystemTime(new Date('2024-03-01T23:00:00Z')) // local: Mar 1, 11:00
    try {
      fs.writeFileSync(
        logPath,
        `${JSON.stringify({
          t: new Date('2024-03-01T10:00:00Z').getTime(), // local: Feb 29, 22:00
          task: 'commit',
          model: 'gpt-5.5',
          promptTokens: 1_000_000,
          completionTokens: 1_000_000,
        })}\n`
      )
      const diagnostics: Diagnostic[] = []
      checkUsageBudget(budgetConfig(1, 1), diagnostics)
      expect(diagnostics).toHaveLength(1)
    } finally {
      jest.useRealTimers()
      if (prevTz === undefined) delete process.env.TZ
      else process.env.TZ = prevTz
    }
  })
})

describe('checkDynamicRouting', () => {
  it('reports the routing-active info for a provider with a tracked catalog', () => {
    const diagnostics: Diagnostic[] = []
    checkDynamicRouting(
      { service: { provider: 'anthropic', model: 'dynamic' } } as unknown as Config,
      diagnostics
    )
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'info', message: expect.stringContaining('routing is active') })
    )
  })

  // #OSS-1623 — DeepSeek/Groq/etc. have no DYNAMIC_DEFAULTS row, so
  // `resolveDynamicModel` throws at runtime for any uncovered task. Doctor
  // must surface that before the user's first `coco commit`, not report a
  // false-positive "routing is active".
  it('flags an error for a first-class preset with no tracked catalog and no overrides', () => {
    const diagnostics: Diagnostic[] = []
    checkDynamicRouting(
      { service: { provider: 'deepseek', model: 'dynamic' } } as unknown as Config,
      diagnostics
    )
    const error = diagnostics.find((d) => d.severity === 'error')
    expect(error).toBeDefined()
    expect(error!.message).toContain('deepseek')
    expect(error!.message).toContain('commit')
    expect(diagnostics.some((d) => d.message.includes('routing is active'))).toBe(false)
  })

  it('does not flag an error when every task has a dynamicModels override', () => {
    const diagnostics: Diagnostic[] = []
    checkDynamicRouting(
      {
        service: {
          provider: 'deepseek',
          model: 'dynamic',
          dynamicModels: {
            summarize: 'deepseek-chat',
            commit: 'deepseek-chat',
            commitSplit: 'deepseek-chat',
            changelog: 'deepseek-chat',
            review: 'deepseek-chat',
            recap: 'deepseek-chat',
            repair: 'deepseek-chat',
            largeDiff: 'deepseek-chat',
            blameExplain: 'deepseek-chat',
          },
        },
      } as unknown as Config,
      diagnostics
    )
    expect(diagnostics.some((d) => d.severity === 'error')).toBe(false)
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'info', message: expect.stringContaining('routing is active') })
    )
  })
})
