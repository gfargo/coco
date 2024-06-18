import fs from 'fs'
import Ajv from 'ajv'
// import addFormats from 'ajv-formats'

const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  strictTypes: false,
})

// Load the schema
const schema = JSON.parse(fs.readFileSync('schema.json', 'utf8'))

// Sample instance to validate
const sampleOpenAI = {
  // $schema: 'http://git-co.co/schema.json',
  service: 'openai',
  model: 'gpt-4',
  openAIApiKey: 'sk-default-api-key',
  tokenLimit: 1024,
  defaultBranch: 'main',
  mode: 'interactive',
}

const sampleOllama = {
  // $schema: 'http://git-co.co/schema.json',
  service: 'ollama',
  model: 'llama3',
  endpoint: 'http://localhost:11434',
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
})
