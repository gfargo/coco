import { getTokenCounter, getTokenCounterForProvider } from './tokenizer'

// Real tiktoken encoding is deterministic but not test-friendly to assert
// on directly; stub it with a simple length-based encoder so the tests
// exercise only the provider/correction-factor routing in tokenizer.ts.
jest.mock('tiktoken', () => ({
  encoding_for_model: jest.fn(() => ({
    encode: (text: string) => Array.from({ length: text.length }),
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
})
