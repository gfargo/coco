import { encoding_for_model } from 'tiktoken'
import { getTikToken, getTokenCounter, getTokenCounterForProvider } from './tokenizer'

// Real tiktoken encoding is deterministic but not test-friendly to assert
// on directly; stub it with a simple length-based encoder so the tests
// exercise only the provider/correction-factor routing in tokenizer.ts.
// `encoding_for_model` mimics the real library by throwing for any model id
// outside a small known set, so the fallback path in tokenizer.ts is
// actually exercised (#1592) rather than masked by an always-succeeding mock.
const KNOWN_MODELS = new Set(['gpt-4o', 'gpt-4'])
jest.mock('tiktoken', () => ({
  encoding_for_model: jest.fn((modelName: string) => {
    if (!KNOWN_MODELS.has(modelName)) {
      throw new Error(`Unknown model: ${modelName}`)
    }
    return { encode: (text: string) => Array.from({ length: text.length }) }
  }),
  get_encoding: jest.fn((encoding: string) => ({
    encode: (text: string) => Array.from({ length: text.length + (encoding === 'o200k_base' ? 100 : 200) }),
  })),
}))

describe('getTokenCounterForProvider', () => {
  const SAMPLE = 'const x = 1;'

  it('openai uses the real tiktoken count with no correction factor', async () => {
    const base = await getTokenCounter('gpt-4o')
    const counter = await getTokenCounterForProvider('openai', 'gpt-4o')
    expect(counter(SAMPLE)).toBe(base(SAMPLE))
  })

  it('azure uses the real tiktoken count with no correction factor', async () => {
    const base = await getTokenCounter('gpt-4o')
    const counter = await getTokenCounterForProvider('azure', 'gpt-4o')
    expect(counter(SAMPLE)).toBe(base(SAMPLE))
  })

  it('anthropic applies its correction factor over the gpt-4o baseline', async () => {
    const base = await getTokenCounter('gpt-4o')
    const counter = await getTokenCounterForProvider('anthropic', 'claude-3-5-sonnet-latest')
    expect(counter(SAMPLE)).toBe(Math.ceil(base(SAMPLE) * 1.2))
  })

  it('gemini applies its correction factor over the gpt-4o baseline', async () => {
    const base = await getTokenCounter('gpt-4o')
    const counter = await getTokenCounterForProvider('gemini', 'gemini-2.5-flash')
    expect(counter(SAMPLE)).toBe(Math.ceil(base(SAMPLE) * 1.1))
  })

  it('mistral applies its correction factor over the gpt-4o baseline', async () => {
    const base = await getTokenCounter('gpt-4o')
    const counter = await getTokenCounterForProvider('mistral', 'mistral-small-latest')
    expect(counter(SAMPLE)).toBe(Math.ceil(base(SAMPLE) * 1.15))
  })

  it('ollama applies its correction factor over the gpt-4o baseline', async () => {
    const base = await getTokenCounter('gpt-4o')
    const counter = await getTokenCounterForProvider('ollama', 'llama3')
    expect(counter(SAMPLE)).toBe(Math.ceil(base(SAMPLE) * 1.2))
  })

  describe('bedrock model-family sniffing', () => {
    it('picks the claude factor for an anthropic.* model id', async () => {
      const base = await getTokenCounter('gpt-4o')
      const counter = await getTokenCounterForProvider(
        'bedrock',
        'anthropic.claude-3-5-sonnet-20241022-v2:0'
      )
      expect(counter(SAMPLE)).toBe(Math.ceil(base(SAMPLE) * 1.2))
    })

    it('picks the llama factor for a meta.llama3* model id', async () => {
      const base = await getTokenCounter('gpt-4o')
      const counter = await getTokenCounterForProvider(
        'bedrock',
        'meta.llama3-1-70b-instruct-v1:0'
      )
      expect(counter(SAMPLE)).toBe(Math.ceil(base(SAMPLE) * 1.2))
    })

    it('picks the mistral factor for a mistral.* model id', async () => {
      const base = await getTokenCounter('gpt-4o')
      const counter = await getTokenCounterForProvider(
        'bedrock',
        'mistral.mistral-large-2407-v1:0'
      )
      expect(counter(SAMPLE)).toBe(Math.ceil(base(SAMPLE) * 1.15))
    })

    it('falls back to the default factor for an unrecognized model id', async () => {
      const base = await getTokenCounter('gpt-4o')
      const counter = await getTokenCounterForProvider('bedrock', 'custom-model-arn')
      expect(counter(SAMPLE)).toBe(Math.ceil(base(SAMPLE) * 1.15))
    })
  })

  it('falls back to factor 1 for an unregistered provider without throwing', async () => {
    const base = await getTokenCounter('gpt-4o')
    const counter = await getTokenCounterForProvider('unknown-provider', 'some-model')
    expect(counter(SAMPLE)).toBe(base(SAMPLE))
  })

  describe('unknown model ids for tiktoken-native providers (#1592)', () => {
    it('does not throw for an OpenAI-compatible baseURL model id', async () => {
      await expect(
        getTokenCounterForProvider('openai', 'meta-llama/llama-3-70b-instruct')
      ).resolves.toEqual(expect.any(Function))
    })

    it('does not throw for an Azure custom deployment name', async () => {
      await expect(getTokenCounterForProvider('azure', 'my-gpt4-deploy')).resolves.toEqual(
        expect.any(Function)
      )
    })

    it('still produces a working counter after falling back', async () => {
      const counter = await getTokenCounterForProvider('openai', 'meta-llama/llama-3-70b-instruct')
      expect(counter(SAMPLE)).toBeGreaterThan(0)
    })

    it('falls back to o200k_base for a newer-looking OpenAI id (gpt-5.x)', async () => {
      const tokenizer = await getTikToken('gpt-5.4-mini' as never)
      expect(tokenizer.encode(SAMPLE).length).toBe(SAMPLE.length + 100)
    })

    // PR #1646 review: a name-based regex can't positively identify every
    // "newest" OpenAI id in advance, nor an Azure custom deployment alias
    // (which has no relation to its backing model string) at all — so the
    // unmatched default is o200k_base, the more common recent encoding,
    // rather than a narrow allowlist that both cases would fall through.
    it('falls back to o200k_base for an OpenAI id newer than the pinned tiktoken release (gpt-4.1)', async () => {
      const tokenizer = await getTikToken('gpt-4.1' as never)
      expect(tokenizer.encode(SAMPLE).length).toBe(SAMPLE.length + 100)
    })

    it('falls back to o200k_base for an Azure custom deployment alias', async () => {
      const tokenizer = await getTikToken('my-gpt4-deploy' as never)
      expect(tokenizer.encode(SAMPLE).length).toBe(SAMPLE.length + 100)
    })

    it('falls back to o200k_base for a non-OpenAI-shaped id (no worse an approximation than cl100k_base)', async () => {
      const tokenizer = await getTikToken('meta-llama/llama-3-70b-instruct' as never)
      expect(tokenizer.encode(SAMPLE).length).toBe(SAMPLE.length + 100)
    })

    it('still falls back to cl100k_base for a legacy pre-o200k OpenAI id (gpt-3.5)', async () => {
      const tokenizer = await getTikToken('gpt-3.5-turbo' as never)
      expect(tokenizer.encode(SAMPLE).length).toBe(SAMPLE.length + 200)
    })
  })

  // Regression (#1641): every getTikToken call constructed a fresh
  // WASM-backed encoder and never freed it — an unbounded leak across the
  // life of a long-running workstation session. Encoders are now memoized
  // per model name; 'gpt-4' is unused elsewhere in this file so the call
  // count below isn't polluted by other tests sharing the module-level cache.
  describe('encoder memoization (#1641)', () => {
    const encodingForModelMock = encoding_for_model as jest.MockedFunction<typeof encoding_for_model>

    it('only instantiates the underlying encoder once across repeated getTikToken calls for the same model', async () => {
      const callsBefore = encodingForModelMock.mock.calls.filter((call) => call[0] === 'gpt-4').length

      await getTikToken('gpt-4' as never)
      await getTikToken('gpt-4' as never)
      await getTikToken('gpt-4' as never)

      const callsAfter = encodingForModelMock.mock.calls.filter((call) => call[0] === 'gpt-4').length
      expect(callsAfter - callsBefore).toBe(1)
    })

    it('reuses the cached encoder across getTokenCounterForProvider calls for a non-tiktoken-native provider', async () => {
      const callsBefore = encodingForModelMock.mock.calls.filter((call) => call[0] === 'gpt-4o').length

      await getTokenCounterForProvider('anthropic', 'claude-3-5-sonnet-latest')
      await getTokenCounterForProvider('anthropic', 'claude-3-5-sonnet-latest')
      await getTokenCounterForProvider('gemini', 'gemini-2.5-flash')

      // All three route to the shared 'gpt-4o' baseline encoder — at most
      // one more instantiation than whatever ran before this test (the
      // very first 'gpt-4o' call anywhere in this file), never one per call.
      const callsAfter = encodingForModelMock.mock.calls.filter((call) => call[0] === 'gpt-4o').length
      expect(callsAfter - callsBefore).toBeLessThanOrEqual(1)
    })
  })
})
