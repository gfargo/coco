import { z } from 'zod'

import {
    AgentOptionsSchema,
    AgentTaskInputSchema,
    AGENT_PROTOCOL_VERSION,
    ChangelogDataSchema,
    ChangeSourceSchema,
    CommitApplyDataSchema,
    CommitApplyRequestSchema,
    CondenseDiffDataSchema,
    CondenseDiffRequestSchema,
    ConflictResolveDataSchema,
    ConflictResolveRequestSchema,
    createAgentInputJsonSchema,
    createAgentMcpOutputSchema,
    createAgentOutputSchema,
    createCommitApplyInputJsonSchema,
    createCondenseDiffInputJsonSchema,
    createConflictResolveInputJsonSchema,
    createMcpAgentInputJsonSchema,
    createMcpCondenseDiffInputJsonSchema,
    createRepoContextInputJsonSchema,
    DEFAULT_CONFLICT_RESOLVE_MAX_FILES,
    DEFAULT_CONFLICT_RESOLVE_MAX_REGIONS,
    MAX_AGENT_CONTEXT_BYTES,
    MAX_CONDENSE_BUDGET_TOKENS,
    MAX_CONFLICT_RESOLVE_FILES,
    MAX_CONFLICT_RESOLVE_REGIONS,
    McpCondenseDiffRequestSchema,
    McpTaskInputSchema,
    RepoContextDataSchema,
    RepoContextRequestSchema,
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
  it('documents every option field with a non-empty applicability description', () => {
    const jsonSchema = createAgentInputJsonSchema() as unknown as {
      properties: {
        options: {
          properties: Record<string, { description?: string }>
        }
      }
    }
    const optionProps = jsonSchema.properties.options.properties
    const fields = Object.keys(AgentOptionsSchema.shape)

    for (const field of fields) {
      expect(optionProps[field]?.description?.length ?? 0).toBeGreaterThan(0)
      expect(optionProps[field]?.description).toContain('Honored by:')
    }
  })
})

describe('McpTaskInputSchema', () => {
  it('applies the same safe defaults as AgentTaskInputSchema, minus trustRepositoryConfig', () => {
    expect(McpTaskInputSchema.parse({})).toEqual({
      version: AGENT_PROTOCOL_VERSION,
      source: { kind: 'repository', scope: { type: 'staged' } },
      options: {
        conventional: false,
        includeBranchName: false,
        previousCommitCount: 0,
        author: false,
      },
    })
  })

  it('rejects a stray trustRepositoryConfig field (strict schema)', () => {
    expect(McpTaskInputSchema.safeParse({ options: { trustRepositoryConfig: true } }).success).toBe(false)
    expect(McpTaskInputSchema.safeParse({ options: { trustRepositoryConfig: false } }).success).toBe(false)
  })

  it('omits trustRepositoryConfig from the published JSON schema while the CLI schema keeps it', () => {
    const mcpJsonSchema = createMcpAgentInputJsonSchema() as unknown as {
      properties: { options: { properties: Record<string, unknown> } }
    }
    const cliJsonSchema = createAgentInputJsonSchema() as unknown as {
      properties: { options: { properties: Record<string, unknown> } }
    }

    expect(mcpJsonSchema.properties.options.properties).not.toHaveProperty('trustRepositoryConfig')
    expect(cliJsonSchema.properties.options.properties).toHaveProperty('trustRepositoryConfig')
    expect(mcpJsonSchema).not.toEqual(cliJsonSchema)
  })
})

describe('McpCondenseDiffRequestSchema', () => {
  it('rejects a stray trustRepositoryConfig field (strict schema)', () => {
    expect(McpCondenseDiffRequestSchema.safeParse({
      source: { kind: 'summary', summary: 'changed' },
      budget: { tokens: 1000 },
      trustRepositoryConfig: false,
    }).success).toBe(false)
  })

  it('omits trustRepositoryConfig from the published JSON schema while the CLI schema keeps it', () => {
    const mcpJsonSchema = createMcpCondenseDiffInputJsonSchema() as unknown as {
      properties: Record<string, unknown>
    }
    const cliJsonSchema = createCondenseDiffInputJsonSchema() as unknown as {
      properties: Record<string, unknown>
    }

    expect(mcpJsonSchema.properties).not.toHaveProperty('trustRepositoryConfig')
    expect(cliJsonSchema.properties).toHaveProperty('trustRepositoryConfig')
    expect(mcpJsonSchema).not.toEqual(cliJsonSchema)
  })

  it('accepts a valid request without trustRepositoryConfig', () => {
    const result = McpCondenseDiffRequestSchema.safeParse({
      source: { kind: 'summary', summary: 'changed' },
      budget: { tokens: 1000 },
    })
    expect(result.success).toBe(true)
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

describe('CondenseDiffRequestSchema', () => {
  it('applies safe defaults (structural mode, staged source)', () => {
    const result = CondenseDiffRequestSchema.parse({ budget: { tokens: 2000 } })
    expect(result).toEqual({
      version: 1,
      source: { kind: 'repository', scope: { type: 'staged' } },
      budget: { tokens: 2000 },
      mode: 'structural',
      trustRepositoryConfig: false,
    })
  })

  it('requires the budget field', () => {
    expect(CondenseDiffRequestSchema.safeParse({}).success).toBe(false)
    expect(CondenseDiffRequestSchema.safeParse({ budget: { tokens: 0 } }).success).toBe(false)
  })

  it('enforces budget.tokens min=1 and max=MAX_CONDENSE_BUDGET_TOKENS', () => {
    expect(CondenseDiffRequestSchema.safeParse({ budget: { tokens: 1 } }).success).toBe(true)
    expect(CondenseDiffRequestSchema.safeParse({ budget: { tokens: MAX_CONDENSE_BUDGET_TOKENS } }).success).toBe(true)
    expect(CondenseDiffRequestSchema.safeParse({ budget: { tokens: MAX_CONDENSE_BUDGET_TOKENS + 1 } }).success).toBe(false)
  })

  it('rejects unknown fields (strict)', () => {
    expect(CondenseDiffRequestSchema.safeParse({ budget: { tokens: 1000 }, unexpected: true }).success).toBe(false)
    expect(CondenseDiffRequestSchema.safeParse({ budget: { tokens: 1000, extra: true } }).success).toBe(false)
  })

  it('accepts optional model, provider, and languages fields', () => {
    const result = CondenseDiffRequestSchema.parse({
      budget: { tokens: 500 },
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
      languages: ['ts', 'py'],
    })
    expect(result.model).toBe('claude-3-5-sonnet')
    expect(result.provider).toBe('anthropic')
    expect(result.languages).toEqual(['ts', 'py'])
  })

  it('rejects invalid language identifiers', () => {
    expect(CondenseDiffRequestSchema.safeParse({
      budget: { tokens: 500 },
      languages: ['not-a-lang'],
    }).success).toBe(false)
  })

  it('publishes a caller-facing JSON Schema with required budget field', () => {
    const json = createCondenseDiffInputJsonSchema() as unknown as {
      properties: { budget: { properties: { tokens: Record<string, unknown> } } }
    }
    expect(json).toMatchObject({ type: 'object' })
    expect(json.properties.budget.properties.tokens).toMatchObject({ type: 'integer', minimum: 1 })
  })

  it('produces a condense-diff output envelope with oneOf metadata in MCP schema', () => {
    const jsonSchema = z.toJSONSchema(
      createAgentMcpOutputSchema('condense-diff', CondenseDiffDataSchema)
    ) as { type?: string; oneOf?: Array<Record<string, unknown>> }

    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.oneOf).toHaveLength(2)
    expect(jsonSchema.oneOf?.[0]).toMatchObject({
      properties: { ok: { const: true }, operation: { const: 'condense-diff' } },
    })
    expect(jsonSchema.oneOf?.[1]).toMatchObject({
      properties: { ok: { const: false }, operation: { const: 'condense-diff' } },
    })
  })
})

describe('RepoContextRequestSchema', () => {
  it('applies safe defaults (version, historyLimit, no include)', () => {
    const result = RepoContextRequestSchema.parse({})
    expect(result).toEqual({
      version: AGENT_PROTOCOL_VERSION,
      historyLimit: 20,
    })
    // include is absent from defaults — it is optional
    expect(result).not.toHaveProperty('include')
  })

  it('accepts an explicit include array with all valid sections', () => {
    const result = RepoContextRequestSchema.parse({
      include: ['branch', 'status', 'history', 'conflicts', 'capabilities'],
    })
    expect(result.include).toEqual(['branch', 'status', 'history', 'conflicts', 'capabilities'])
  })

  it('rejects invalid section names', () => {
    expect(RepoContextRequestSchema.safeParse({ include: ['invalid-section'] }).success).toBe(false)
  })

  it('enforces historyLimit min=1 and max=50', () => {
    expect(RepoContextRequestSchema.safeParse({ historyLimit: 1 }).success).toBe(true)
    expect(RepoContextRequestSchema.safeParse({ historyLimit: 50 }).success).toBe(true)
    expect(RepoContextRequestSchema.safeParse({ historyLimit: 0 }).success).toBe(false)
    expect(RepoContextRequestSchema.safeParse({ historyLimit: 51 }).success).toBe(false)
  })

  it('rejects unknown fields (strict)', () => {
    expect(RepoContextRequestSchema.safeParse({ unexpected: true }).success).toBe(false)
  })

  it('publishes a caller-facing JSON Schema with optional fields', () => {
    const json = createRepoContextInputJsonSchema() as unknown as {
      type: string
      properties: Record<string, unknown>
    }
    expect(json.type).toBe('object')
    expect(json.properties).toHaveProperty('include')
    expect(json.properties).toHaveProperty('historyLimit')
    expect(json.properties).toHaveProperty('repo')
  })

  it('produces a repo-context output envelope with oneOf metadata in MCP schema', () => {
    const jsonSchema = z.toJSONSchema(
      createAgentMcpOutputSchema('repo-context', RepoContextDataSchema)
    ) as { type?: string; oneOf?: Array<Record<string, unknown>> }

    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.oneOf).toHaveLength(2)
    expect(jsonSchema.oneOf?.[0]).toMatchObject({
      properties: { ok: { const: true }, operation: { const: 'repo-context' } },
    })
    expect(jsonSchema.oneOf?.[1]).toMatchObject({
      properties: { ok: { const: false }, operation: { const: 'repo-context' } },
    })
  })
})

describe('ConflictResolveRequestSchema', () => {
  it('applies safe defaults (version, options, maxFiles, maxRegions, no files filter)', () => {
    const result = ConflictResolveRequestSchema.parse({})
    expect(result).toEqual({
      version: AGENT_PROTOCOL_VERSION,
      options: {},
      maxFiles: DEFAULT_CONFLICT_RESOLVE_MAX_FILES,
      maxRegions: DEFAULT_CONFLICT_RESOLVE_MAX_REGIONS,
    })
    expect(result).not.toHaveProperty('files')
  })

  it('enforces maxFiles min=1 and max=MAX_CONFLICT_RESOLVE_FILES', () => {
    expect(ConflictResolveRequestSchema.safeParse({ maxFiles: 1 }).success).toBe(true)
    expect(ConflictResolveRequestSchema.safeParse({ maxFiles: MAX_CONFLICT_RESOLVE_FILES }).success).toBe(true)
    expect(ConflictResolveRequestSchema.safeParse({ maxFiles: 0 }).success).toBe(false)
    expect(ConflictResolveRequestSchema.safeParse({ maxFiles: MAX_CONFLICT_RESOLVE_FILES + 1 }).success).toBe(false)
  })

  it('enforces maxRegions min=1 and max=MAX_CONFLICT_RESOLVE_REGIONS', () => {
    expect(ConflictResolveRequestSchema.safeParse({ maxRegions: 1 }).success).toBe(true)
    expect(ConflictResolveRequestSchema.safeParse({ maxRegions: MAX_CONFLICT_RESOLVE_REGIONS }).success).toBe(true)
    expect(ConflictResolveRequestSchema.safeParse({ maxRegions: 0 }).success).toBe(false)
    expect(ConflictResolveRequestSchema.safeParse({ maxRegions: MAX_CONFLICT_RESOLVE_REGIONS + 1 }).success).toBe(false)
  })

  it('accepts an optional files filter and options bag', () => {
    const result = ConflictResolveRequestSchema.parse({
      files: ['a.ts', 'b.ts'],
      options: { language: 'es', additionalContext: 'prefer ours on lockfiles' },
    })
    expect(result.files).toEqual(['a.ts', 'b.ts'])
    expect(result.options).toEqual({ language: 'es', additionalContext: 'prefer ours on lockfiles' })
  })

  it('rejects unknown fields (strict)', () => {
    expect(ConflictResolveRequestSchema.safeParse({ unexpected: true }).success).toBe(false)
  })

  it('rejects trustRepositoryConfig inside options (strict) so MCP and CLI callers both get INVALID_INPUT', () => {
    expect(ConflictResolveRequestSchema.safeParse({
      options: { trustRepositoryConfig: true },
    }).success).toBe(false)
  })

  it('publishes a caller-facing JSON Schema with optional fields', () => {
    const json = createConflictResolveInputJsonSchema() as unknown as {
      type: string
      properties: Record<string, unknown>
    }
    expect(json.type).toBe('object')
    expect(json.properties).toHaveProperty('files')
    expect(json.properties).toHaveProperty('maxFiles')
    expect(json.properties).toHaveProperty('maxRegions')
    expect(json.properties).not.toHaveProperty('trustRepositoryConfig')
  })

  it('produces a conflict-resolve output envelope with oneOf metadata in MCP schema', () => {
    const jsonSchema = z.toJSONSchema(
      createAgentMcpOutputSchema('conflict-resolve', ConflictResolveDataSchema)
    ) as { type?: string; oneOf?: Array<Record<string, unknown>> }

    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.oneOf).toHaveLength(2)
    expect(jsonSchema.oneOf?.[0]).toMatchObject({
      properties: { ok: { const: true }, operation: { const: 'conflict-resolve' } },
    })
    expect(jsonSchema.oneOf?.[1]).toMatchObject({
      properties: { ok: { const: false }, operation: { const: 'conflict-resolve' } },
    })
  })
})

describe('CommitApplyRequestSchema', () => {
  it('requires a non-empty title', () => {
    expect(CommitApplyRequestSchema.safeParse({}).success).toBe(false)
    expect(CommitApplyRequestSchema.safeParse({ title: '' }).success).toBe(false)
    expect(CommitApplyRequestSchema.safeParse({ title: 'feat: add thing' }).success).toBe(true)
  })

  it('defaults noVerify to false and accepts an optional body', () => {
    const parsed = CommitApplyRequestSchema.parse({ title: 'feat: add thing' })
    expect(parsed.noVerify).toBe(false)
    expect(parsed.body).toBeUndefined()

    const withBody = CommitApplyRequestSchema.parse({ title: 'feat: add thing', body: 'Details.', noVerify: true })
    expect(withBody.body).toBe('Details.')
    expect(withBody.noVerify).toBe(true)
  })

  it('rejects unknown fields (strict)', () => {
    expect(CommitApplyRequestSchema.safeParse({ title: 'x', unexpected: true }).success).toBe(false)
  })

  it('publishes a caller-facing JSON Schema', () => {
    const json = createCommitApplyInputJsonSchema() as unknown as {
      type: string
      properties: Record<string, unknown>
    }
    expect(json.type).toBe('object')
    expect(json.properties).toHaveProperty('title')
    expect(json.properties).toHaveProperty('body')
    expect(json.properties).toHaveProperty('noVerify')
    expect(json.properties).toHaveProperty('repo')
  })

  it('CommitApplyDataSchema validates the flat sha/shortSha/message shape', () => {
    expect(CommitApplyDataSchema.safeParse({
      sha: 'abc123def456',
      shortSha: 'abc123d',
      message: 'feat: add thing',
    }).success).toBe(true)
    expect(CommitApplyDataSchema.safeParse({ sha: 'abc' }).success).toBe(false)
  })
})
