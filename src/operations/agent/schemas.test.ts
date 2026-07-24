import { z } from 'zod'

import {
    AgentTaskInputSchema,
    AGENT_PROTOCOL_VERSION,
    ChangelogDataSchema,
    ChangeSourceSchema,
    createAgentInputJsonSchema,
    createAgentMcpOutputSchema,
    createAgentOutputSchema,
    MAX_AGENT_CONTEXT_BYTES
} from './schemas'

const meta = {
  kind: 'summary' as const,
  digest: 'sha256:abc',
  verification: 'provided-unverified' as const,
}

const changelog = { title: 'Release', content: 'Added agent support.' }

describe('AgentTaskInputSchema', () => {
  it('applies the safe staged-source and option defaults', () => {
    expect(AgentTaskInputSchema.parse({})).toEqual({
      version: AGENT_PROTOCOL_VERSION,
      source: { kind: 'repository', scope: { type: 'staged' } },
      options: {
        conventional: false,
        includeBranchName: false,
        previousCommitCount: 0,
        author: false,
        trustRepositoryConfig: false,
      },
    })
    expect(ChangeSourceSchema.parse({ kind: 'repository' })).toEqual({
      kind: 'repository',
      scope: { type: 'staged' },
    })
  })

  it.each([
    [{ unexpected: true }],
    [{ options: { unexpected: true } }],
    [{ source: { kind: 'repository', unexpected: true } }],
    [{ source: { kind: 'repository', scope: { type: 'staged', unexpected: true } } }],
    [{ source: { kind: 'patch', patch: 'diff', unexpected: true } }],
    [{ source: { kind: 'files', files: [{ path: 'a.ts', status: 'modified', summary: 'changed', unexpected: true }] } }],
    [{ source: { kind: 'summary', summary: 'changed', provenance: { generatedBy: 'agent', unexpected: true } } }],
  ])('rejects unknown input fields: %j', (input) => {
    expect(AgentTaskInputSchema.safeParse(input).success).toBe(false)
  })

  it.each([
    { type: 'branch', base: '--output=/tmp/pwned' },
    { type: 'branch', base: 'main\0evil' },
    { type: 'branch', base: 'main', head: '-HEAD' },
    { type: 'range', from: '-main', to: 'HEAD' },
    { type: 'range', from: 'main', to: 'HEAD\0suffix' },
  ])('rejects unsafe repository revisions: %j', (scope) => {
    expect(ChangeSourceSchema.safeParse({ kind: 'repository', scope }).success).toBe(false)
  })

  it('enforces the 2 MiB limits on supplied context fields', () => {
    const atLimit = 'x'.repeat(MAX_AGENT_CONTEXT_BYTES)
    const overLimit = `${atLimit}x`

    expect(ChangeSourceSchema.safeParse({ kind: 'patch', patch: atLimit }).success).toBe(true)
    expect(ChangeSourceSchema.safeParse({ kind: 'patch', patch: overLimit }).success).toBe(false)
    expect(ChangeSourceSchema.safeParse({ kind: 'summary', summary: atLimit }).success).toBe(true)
    expect(ChangeSourceSchema.safeParse({ kind: 'summary', summary: overLimit }).success).toBe(false)
    expect(ChangeSourceSchema.safeParse({
      kind: 'files',
      files: [{ path: 'a.ts', status: 'modified', patch: overLimit }],
    }).success).toBe(false)
  })

  it('requires every supplied file to include a patch or summary', () => {
    expect(ChangeSourceSchema.safeParse({
      kind: 'files',
      files: [{ path: 'a.ts', status: 'modified' }],
    }).success).toBe(false)
  })

  it('publishes the caller-facing defaults and safety constraints', () => {
    const jsonSchema = createAgentInputJsonSchema() as unknown as {
      required?: string[]
      properties: {
        options: { required?: string[] }
        source: { oneOf: Array<Record<string, unknown>> }
      }
    }

    expect(jsonSchema.required).toBeUndefined()
    expect(jsonSchema.properties.options.required).toBeUndefined()

    const repository = jsonSchema.properties.source.oneOf[0] as {
      required: string[]
      properties: {
        scope: {
          oneOf: Array<{
            properties: Record<string, { pattern?: string }>
          }>
        }
      }
    }
    expect(repository.required).toEqual(['kind'])
    expect(repository.properties.scope.oneOf[2].properties.base.pattern).toBe(
      '^(?!-)[^\\u0000]+$',
    )

    const files = jsonSchema.properties.source.oneOf[2] as {
      properties: {
        files: {
          items: { anyOf: Array<{ required: string[] }> }
        }
      }
    }
    expect(files.properties.files.items.anyOf.map((entry) => entry.required)).toEqual([
      ['path', 'status', 'patch'],
      ['path', 'status', 'summary'],
    ])
  })
})

describe('agent output schemas', () => {
  const schema = createAgentOutputSchema('changelog', ChangelogDataSchema)
  const success = {
    version: AGENT_PROTOCOL_VERSION,
    ok: true as const,
    operation: 'changelog' as const,
    status: 'completed' as const,
    data: changelog,
    warnings: [],
    meta,
  }
  const failure = {
    version: AGENT_PROTOCOL_VERSION,
    ok: false as const,
    operation: 'changelog' as const,
    error: { code: 'GENERATION_FAILED', message: 'no result', retryable: false },
  }

  it('accepts only the matching success and failure envelopes', () => {
    expect(schema.parse(success)).toEqual(success)
    expect(schema.parse(failure)).toEqual(failure)
    expect(schema.safeParse({ ...success, error: failure.error }).success).toBe(false)
    expect(schema.safeParse({ ...failure, data: changelog }).success).toBe(false)
    expect(schema.safeParse({ ...success, operation: 'review' }).success).toBe(false)
  })

  it('keeps MCP output top-level-object compatible while enforcing discrimination', () => {
    const mcpSchema = createAgentMcpOutputSchema('changelog', ChangelogDataSchema)

    expect(mcpSchema.parse(success)).toEqual(success)
    expect(mcpSchema.parse(failure)).toEqual(failure)
    expect(mcpSchema.safeParse({ ...success, error: failure.error }).success).toBe(false)
    expect(mcpSchema.safeParse({ ...failure, status: 'completed' }).success).toBe(false)
  })

  it('publishes success/failure oneOf metadata in the MCP JSON schema', () => {
    const jsonSchema = z.toJSONSchema(createAgentMcpOutputSchema('changelog', ChangelogDataSchema)) as {
      type?: string
      oneOf?: Array<Record<string, unknown>>
    }

    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.oneOf).toHaveLength(2)
    expect(jsonSchema.oneOf?.[0]).toMatchObject({
      properties: { ok: { const: true }, operation: { const: 'changelog' } },
      required: expect.arrayContaining(['status', 'data', 'warnings', 'meta']),
    })
    expect(jsonSchema.oneOf?.[1]).toMatchObject({
      properties: { ok: { const: false }, operation: { const: 'changelog' } },
      required: expect.arrayContaining(['error']),
    })
  })
})
