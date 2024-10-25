import { ajv } from '../src/lib/ajv'
import { DEFAULT_CONFIG } from '../src/lib/config/constants'
import { DEFAULT_ANTHROPIC_LLM_SERVICE, DEFAULT_OLLAMA_LLM_SERVICE, DEFAULT_OPENAI_LLM_SERVICE } from '../src/lib/langchain/utils'
import { schema } from '../src/lib/schema'

const sampleOpenAI = {
  ...DEFAULT_CONFIG,
  service: DEFAULT_OPENAI_LLM_SERVICE,
}

const sampleOllama = {
  ...DEFAULT_CONFIG,
  service: DEFAULT_OLLAMA_LLM_SERVICE,
}

const sampleAnthropic = {
  ...DEFAULT_CONFIG,
  service: DEFAULT_ANTHROPIC_LLM_SERVICE,
}

describe('validate schema.json', () => {
  const validate = ajv.compile(schema)

  it('should validate the OpenAI schema', () => {
    const valid = validate(sampleOpenAI)
    expect(valid).toBe(true)
    if (!valid) {
      console.log(validate.errors)
    }
  })

  it('should validate the Ollama schema', () => {
    const valid = validate(sampleOllama)
    expect(valid).toBe(true)
    if (!valid) {
      console.log(validate.errors)
    }
  })

  it('should validate the Anthropic schema', () => {
    const valid = validate(sampleAnthropic)
    expect(valid).toBe(true)
    if (!valid) {
      console.log(validate.errors)
    }
  })
})
