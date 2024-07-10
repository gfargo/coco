import fs from 'fs'

// List of available OpenAI models
const openaiModels = [
  'gpt-3.5-turbo',
  'gpt-3.5-turbo-16k',
  'gpt-4',
  'gpt-4-32k',
  'gpt-4-turbo',
  'gpt-4-turbo-preview',
  'gpt-4o',
  'gpt-4o-2024-05-13',
]

// List of available Ollama models
const ollamaModels = [
  'orca-mini',
  'orca-mini:13b',
  'orca2',
  'aya:8b',
  'aya:35b',
  'mistral',
  'codegemma',
  'codegemma:7b-code',
  'codellama',
  'llama2',
  'llama2-uncensored',
  'llama2:13b',
  'llama2:70b',
  'llama3',
  'llama3:70b',
  'phi3',
  'phi3:mini',
  'phi3:medium',
  'qwen2',
  'qwen2:1.5b',
  'qwen2:0.5b',
]

// Define the JSON schema
const schema = {
  $id: 'http://git-co.co/schema.json',
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  properties: {
    service: {
      description: 'The LLM provider to use',
      default: 'openai',
      enum: ['openai', 'ollama'],
    },
    model: {
      type: 'string',
      description: 'The LLM model to use',
      default: 'gpt-4o',
      oneOf: [
        {
          if: { $ref: '#/definitions/is-openai' },
          then: { enum: openaiModels },
        },
        {
          if: { $ref: '#/definitions/is-ollama' },
          then: { enum: ollamaModels },
        },
      ],
    },
    tokenLimit: {
      type: 'number',
      description: 'Maximum number of tokens for the commit message',
      default: 500,
    },
    verbose: {
      type: 'boolean',
      description: 'Verbose output',
      default: false,
    },
    prompt: {
      type: 'string',
      description: 'Prompt for the LLM service',
      default: 'What are the changes in this commit?',
    },
    temperature: {
      type: 'number',
      description:
        'Controls randomness in GPT-3 output. Lower values yield focused output; higher values offer diversity',
      default: 0.4,
    },
    mode: {
      type: 'string',
      description: 'Preferred output method for generated commit messages',
      enum: ['stdout', 'interactive'],
      default: 'stdout',
    },
    summarizePrompt: {
      type: 'string',
      description: 'GPT-3 prompt for summarizing large files',
      default: 'Summarize the changes in this large file:',
    },
    ignoredFiles: {
      type: 'array',
      description: 'Paths of files to be excluded when generating commit messages',
      items: {
        type: 'string',
      },
      default: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'],
    },
    ignoredExtensions: {
      type: 'array',
      description: 'File extensions to be excluded when generating commit messages',
      items: {
        type: 'string',
      },
      default: ['.map', '.lock'],
    },
    defaultBranch: {
      type: 'string',
      description: 'Default branch for the repository',
      default: 'main',
    },
  },
  required: ['service', 'model'],
  allOf: [
    {
      if: {
        properties: { service: { const: 'openai' } },
      },
      then: {
        properties: {
          model: { enum: openaiModels },
          openAIApiKey: {
            type: 'string',
            description: 'Your OpenAI API key',
            default: null,
          },
          endpoint: false,
        },
        required: ['openAIApiKey'],
        not: {
          required: ['endpoint'],
        },
      },
    },
    {
      if: {
        properties: { service: { const: 'ollama' } },
      },
      then: {
        properties: {
          model: { enum: ollamaModels },
          openAIApiKey: false,
          endpoint: {
            type: 'string',
            description: 'The endpoint to use for the LLM service',
          },
        },
        not: {
          required: ['openAIApiKey'],
        },
        required: ['endpoint'],
      },
    },
  ],
  definitions: {
    'is-openai': {
      properties: {
        service: { enum: ['openai'] },
      },
      required: ['service'],
    },
    'is-ollama': {
      properties: {
        service: { enum: ['ollama'] },
      },
      required: ['service'],
    },
    'ollama-requires-endpoint': {
      anyOf: [{ not: { $ref: '#/definitions/is-openai' } }, { required: ['endpoint'] }],
    },
  },
}

// Add model definitions to the schema
schema.definitions['openai-models'] = {
  enum: openaiModels,
}

schema.definitions['ollama-models'] = {
  enum: ollamaModels,
}

// Update the model property with conditional logic
schema.properties.model = {
  type: 'string',
  description: 'The LLM model to use',
  default: 'gpt-4o',
  oneOf: [
    {
      if: { $ref: '#/definitions/is-openai' },
      then: { enum: schema.definitions['openai-models'].enum },
    },
    {
      if: { $ref: '#/definitions/is-ollama' },
      then: { enum: schema.definitions['ollama-models'].enum },
    },
  ],
}

console.log('Generating schema.json...')

// Write the schema to a file with error handling
try {
  // write the schema to a file
  fs.writeFileSync('schema.json', JSON.stringify(schema, null, 2))

  // write the schema variable out to a typescript file in /src/lib/schema.ts
  fs.writeFileSync(
    'src/lib/schema.ts',
    `// this file is auto-generated by the 'build:schema' script
export const SCHEMA_PUBLIC_URL = ${JSON.stringify(schema.$id)}
export const schema = ${JSON.stringify(schema, null, 2)}`
  )

  console.log('schema.json & schema.ts generated successfully!')
} catch (error) {
  console.error('Error generating schema.json:', error)
}
