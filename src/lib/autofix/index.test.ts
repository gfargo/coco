import { runAutoFix } from './index'
import { ReviewFeedbackItem } from '../../commands/review/config'
import { AutoFixConfig } from './types'

// Mock buildPrompt
jest.mock('./buildPrompt', () => ({
  buildPrompt: jest.fn().mockResolvedValue('mocked prompt'),
}))

// Mock all three adapters so we can inspect what key they receive.
// Each mock exposes a module-level `run` jest.fn() so tests can read calls.

jest.mock('./adapters/codex', () => {
  const run = jest.fn().mockResolvedValue(undefined)
  return {
    CodexAdapter: jest.fn().mockImplementation(() => ({ vendor: 'openai', envVar: 'OPENAI_API_KEY', run })),
    __mockRun: run,
  }
})

jest.mock('./adapters/claude', () => {
  const run = jest.fn().mockResolvedValue(undefined)
  return {
    ClaudeAdapter: jest.fn().mockImplementation(() => ({ vendor: 'anthropic', envVar: 'ANTHROPIC_API_KEY', run })),
    __mockRun: run,
  }
})

jest.mock('./adapters/gemini', () => {
  const run = jest.fn().mockResolvedValue(undefined)
  return {
    GeminiAdapter: jest.fn().mockImplementation(() => ({ vendor: 'google', envVar: 'GEMINI_API_KEY', run })),
    __mockRun: run,
  }
})

const item: ReviewFeedbackItem = {
  title: 'Missing null check',
  summary: 'The function does not handle null input',
  severity: 7,
  category: 'bug',
  filePath: 'src/foo.ts',
  side: 'RIGHT',
}

describe('runAutoFix', () => {
  let codexRun: jest.Mock
  let claudeRun: jest.Mock
  let geminiRun: jest.Mock
  let buildPrompt: jest.Mock

  beforeEach(async () => {
    jest.clearAllMocks()
    const codexModule = (await import('./adapters/codex')) as unknown as { __mockRun: jest.Mock }
    codexRun = codexModule.__mockRun
    codexRun.mockResolvedValue(undefined)
    const claudeModule = (await import('./adapters/claude')) as unknown as { __mockRun: jest.Mock }
    claudeRun = claudeModule.__mockRun
    claudeRun.mockResolvedValue(undefined)
    const geminiModule = (await import('./adapters/gemini')) as unknown as { __mockRun: jest.Mock }
    geminiRun = geminiModule.__mockRun
    geminiRun.mockResolvedValue(undefined)
    const promptModule = (await import('./buildPrompt')) as unknown as { buildPrompt: jest.Mock }
    buildPrompt = promptModule.buildPrompt
  })

  // ── Basic behaviour ────────────────────────────────────────────────────────

  it('is a no-op when autoFixTool is unset', async () => {
    const config: AutoFixConfig = {}

    await expect(runAutoFix(item, config, '/fake/repo')).resolves.toBeUndefined()
    expect(buildPrompt).not.toHaveBeenCalled()
    expect(codexRun).not.toHaveBeenCalled()
  })

  it('throws on unrecognized autoFixTool', async () => {
    const config: AutoFixConfig = { autoFixTool: 'unknown-tool' }

    await expect(runAutoFix(item, config, '/fake/repo')).rejects.toThrow('Unknown autoFixTool: "unknown-tool"')
  })

  it('calls run without options when autoFixToolOptions is unset', async () => {
    const config: AutoFixConfig = { autoFixTool: 'codex' }

    await runAutoFix(item, config, '/fake/repo')

    expect(buildPrompt).toHaveBeenCalledWith(item, '/fake/repo')
    expect(codexRun).toHaveBeenCalledWith('mocked prompt', undefined, undefined, undefined)
  })

  it('forwards autoFixToolOptions to the adapter', async () => {
    const options = { model: 'o4-mini' }
    const config: AutoFixConfig = { autoFixTool: 'codex', autoFixToolOptions: options }

    await runAutoFix(item, config, '/fake/repo')

    expect(codexRun).toHaveBeenCalledWith('mocked prompt', options, undefined, undefined)
  })

  // ── Vendor-match: matching provider passes the key through ─────────────────

  it('openai + codex — passes apiKey to adapter (vendor match)', async () => {
    const config: AutoFixConfig = {
      autoFixTool: 'codex',
      provider: 'openai',
      apiKey: 'sk-openai-key',
    }

    await runAutoFix(item, config, '/fake/repo')

    expect(codexRun).toHaveBeenCalledWith('mocked prompt', undefined, 'sk-openai-key', undefined)
  })

  it('anthropic + claude — passes apiKey to adapter (vendor match)', async () => {
    const config: AutoFixConfig = {
      autoFixTool: 'claude',
      provider: 'anthropic',
      apiKey: 'sk-ant-key',
    }

    await runAutoFix(item, config, '/fake/repo')

    expect(claudeRun).toHaveBeenCalledWith('mocked prompt', undefined, 'sk-ant-key', undefined)
  })

  it('gemini + gemini — passes apiKey to adapter (vendor match)', async () => {
    const config: AutoFixConfig = {
      autoFixTool: 'gemini',
      provider: 'gemini',
      apiKey: 'AIza-google-key',
    }

    await runAutoFix(item, config, '/fake/repo')

    expect(geminiRun).toHaveBeenCalledWith('mocked prompt', undefined, 'AIza-google-key', undefined)
  })

  // ── Vendor-mismatch: mismatched provider must NOT forward the key ──────────

  it('openai + gemini — does NOT pass the OpenAI key to gemini adapter (vendor mismatch)', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const config: AutoFixConfig = {
      autoFixTool: 'gemini',
      provider: 'openai',
      apiKey: 'sk-openai-key',
    }

    await runAutoFix(item, config, '/fake/repo')

    // The key passed to run must be undefined — the OpenAI key must not reach gemini
    expect(geminiRun).toHaveBeenCalledWith('mocked prompt', undefined, undefined, undefined)
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('openai'))
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('gemini'))

    consoleWarnSpy.mockRestore()
  })

  it('openai + claude — does NOT pass the OpenAI key to claude adapter (vendor mismatch)', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const config: AutoFixConfig = {
      autoFixTool: 'claude',
      provider: 'openai',
      apiKey: 'sk-openai-key',
    }

    await runAutoFix(item, config, '/fake/repo')

    expect(claudeRun).toHaveBeenCalledWith('mocked prompt', undefined, undefined, undefined)

    consoleWarnSpy.mockRestore()
  })

  it('anthropic + codex — does NOT pass the Anthropic key to codex adapter (vendor mismatch)', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const config: AutoFixConfig = {
      autoFixTool: 'codex',
      provider: 'anthropic',
      apiKey: 'sk-ant-key',
    }

    await runAutoFix(item, config, '/fake/repo')

    expect(codexRun).toHaveBeenCalledWith('mocked prompt', undefined, undefined, undefined)

    consoleWarnSpy.mockRestore()
  })

  it('anthropic + gemini — does NOT pass the Anthropic key to gemini adapter (vendor mismatch)', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const config: AutoFixConfig = {
      autoFixTool: 'gemini',
      provider: 'anthropic',
      apiKey: 'sk-ant-key',
    }

    await runAutoFix(item, config, '/fake/repo')

    expect(geminiRun).toHaveBeenCalledWith('mocked prompt', undefined, undefined, undefined)

    consoleWarnSpy.mockRestore()
  })

  it('gemini + codex — does NOT pass the Google key to codex adapter (vendor mismatch)', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const config: AutoFixConfig = {
      autoFixTool: 'codex',
      provider: 'gemini',
      apiKey: 'AIza-google-key',
    }

    await runAutoFix(item, config, '/fake/repo')

    expect(codexRun).toHaveBeenCalledWith('mocked prompt', undefined, undefined, undefined)

    consoleWarnSpy.mockRestore()
  })

  // ── Non-vendor providers must never forward keys ───────────────────────────

  it.each(['azure', 'bedrock', 'ollama', 'openrouter', 'deepseek', 'groq', 'xai'])(
    'provider %s + codex — does NOT pass an unrelated key to codex adapter',
    async (provider) => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

      const config: AutoFixConfig = {
        autoFixTool: 'codex',
        provider,
        apiKey: 'some-other-vendor-key',
      }

      await runAutoFix(item, config, '/fake/repo')

      // Key must not be forwarded
      expect(codexRun).toHaveBeenCalledWith('mocked prompt', undefined, undefined, undefined)

      // The unrecognized-provider warning branch must have fired with its
      // distinct "does not have a direct vendor mapping" message
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('does not have a direct vendor mapping')
      )

      consoleWarnSpy.mockRestore()
    }
  )

  // ── Explicit per-tool key wins regardless of provider ─────────────────────

  it('autoFixToolApiKey is used even when provider mismatches vendor', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const config: AutoFixConfig = {
      autoFixTool: 'gemini',
      provider: 'openai',
      apiKey: 'sk-openai-key',
      autoFixToolApiKey: 'AIza-explicit-google-key',
    }

    await runAutoFix(item, config, '/fake/repo')

    // Explicit key must arrive as the forceApiKey (4th) arg, not the apiKey (3rd) arg
    expect(geminiRun).toHaveBeenCalledWith('mocked prompt', undefined, undefined, 'AIza-explicit-google-key')
    // No warning is emitted when an explicit key is supplied — the user knows what they're doing
    expect(consoleWarnSpy).not.toHaveBeenCalled()

    consoleWarnSpy.mockRestore()
  })

  it('autoFixToolApiKey is used even when ambient GEMINI_API_KEY is already set', async () => {
    // This is the key regression: the old guard `if (apiKey && !env[this.envVar])`
    // would silently drop the explicit key when an ambient var was present.
    const config: AutoFixConfig = {
      autoFixTool: 'gemini',
      provider: 'openai',
      apiKey: 'sk-openai-key',
      autoFixToolApiKey: 'AIza-explicit-google-key',
    }

    await runAutoFix(item, config, '/fake/repo')

    // forceApiKey must be set so the adapter injects it regardless of ambient env
    expect(geminiRun).toHaveBeenCalledWith('mocked prompt', undefined, undefined, 'AIza-explicit-google-key')
  })

  it('autoFixToolApiKey takes precedence over apiKey even on a vendor match', async () => {
    const config: AutoFixConfig = {
      autoFixTool: 'codex',
      provider: 'openai',
      apiKey: 'sk-openai-key',
      autoFixToolApiKey: 'sk-explicit-tool-key',
    }

    await runAutoFix(item, config, '/fake/repo')

    expect(codexRun).toHaveBeenCalledWith('mocked prompt', undefined, undefined, 'sk-explicit-tool-key')
  })

  // ── Mismatch warning is emitted ────────────────────────────────────────────

  it('emits a warning on vendor mismatch', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const config: AutoFixConfig = {
      autoFixTool: 'gemini',
      provider: 'openai',
      apiKey: 'sk-openai-key',
    }

    await runAutoFix(item, config, '/fake/repo')

    expect(consoleWarnSpy).toHaveBeenCalled()

    consoleWarnSpy.mockRestore()
  })

  it('does NOT emit a warning when vendor matches', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    const config: AutoFixConfig = {
      autoFixTool: 'codex',
      provider: 'openai',
      apiKey: 'sk-openai-key',
    }

    await runAutoFix(item, config, '/fake/repo')

    expect(consoleWarnSpy).not.toHaveBeenCalled()

    consoleWarnSpy.mockRestore()
  })

  // ── Cross-vendor invariant ─────────────────────────────────────────────────
  // For every mismatched (provider, tool) combination, a key resolved for
  // provider X must NEVER be written into vendor Y's adapter run call.

  describe('cross-vendor invariant: key for provider X never reaches vendor Y', () => {
    const mismatchCases: Array<{ provider: string; tool: string; key: string }> = [
      { provider: 'openai', tool: 'claude', key: 'sk-openai-key' },
      { provider: 'openai', tool: 'gemini', key: 'sk-openai-key' },
      { provider: 'anthropic', tool: 'codex', key: 'sk-ant-key' },
      { provider: 'anthropic', tool: 'gemini', key: 'sk-ant-key' },
      { provider: 'gemini', tool: 'codex', key: 'AIza-google-key' },
      { provider: 'gemini', tool: 'claude', key: 'AIza-google-key' },
      { provider: 'azure', tool: 'codex', key: 'azure-api-key' },
      { provider: 'azure', tool: 'claude', key: 'azure-api-key' },
      { provider: 'azure', tool: 'gemini', key: 'azure-api-key' },
      { provider: 'bedrock', tool: 'codex', key: 'aws-key' },
      { provider: 'bedrock', tool: 'claude', key: 'aws-key' },
      { provider: 'bedrock', tool: 'gemini', key: 'aws-key' },
    ]

    it.each(mismatchCases)(
      'provider=$provider + tool=$tool: key is not forwarded',
      async ({ provider, tool, key }) => {
        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

        const config: AutoFixConfig = { autoFixTool: tool, provider, apiKey: key }
        await runAutoFix(item, config, '/fake/repo')

        const runMock =
          tool === 'codex' ? codexRun : tool === 'claude' ? claudeRun : geminiRun
        const callArgs = runMock.mock.calls[0]
        // Third arg is the provider-derived apiKey; fourth is the explicit forceApiKey.
        // Both must be undefined — no key from provider X must reach vendor Y's adapter.
        expect(callArgs[2]).toBeUndefined()
        expect(callArgs[3]).toBeUndefined()

        consoleWarnSpy.mockRestore()
      }
    )
  })
})
