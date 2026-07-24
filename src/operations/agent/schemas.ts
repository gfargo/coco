import { z } from 'zod'

import { ReviewFeedbackItemSchema } from '../../commands/review/config'

export const AGENT_PROTOCOL_VERSION = 1 as const
export const MAX_AGENT_CONTEXT_BYTES = 2 * 1024 * 1024

export const AgentOperationSchema = z.enum(['commit-draft', 'review', 'changelog', 'recap'])

const gitRevisionSchema = z.string().min(1).refine(
  (revision) => !revision.startsWith('-') && !revision.includes('\0'),
  'Git revisions must not start with an option prefix or contain NUL bytes.',
).meta({
  pattern: '^(?!-)[^\\u0000]+$',
})

const repositoryScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('staged') }).strict(),
  z.object({ type: z.literal('worktree') }).strict(),
  z.object({
    type: z.literal('branch'),
    base: gitRevisionSchema,
    head: gitRevisionSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('range'),
    from: gitRevisionSchema,
    to: gitRevisionSchema,
  }).strict(),
])

const providedProvenanceSchema = z.object({
  headRevision: z.string().min(1).optional(),
  generatedBy: z.string().min(1).max(200).optional(),
}).strict()

const providedFileShape = {
  path: z.string().min(1),
  oldPath: z.string().min(1).optional(),
  status: z.enum(['modified', 'renamed', 'added', 'deleted', 'untracked', 'unknown']),
}

// A union keeps the patch-or-summary requirement visible to JSON Schema clients;
// a Zod refinement would enforce it only after the request reached coco.
const providedFileSchema = z.union([
  z.object({
    ...providedFileShape,
    patch: z.string().max(MAX_AGENT_CONTEXT_BYTES),
    summary: z.string().max(MAX_AGENT_CONTEXT_BYTES).optional(),
  }).strict(),
  z.object({
    ...providedFileShape,
    patch: z.string().max(MAX_AGENT_CONTEXT_BYTES).optional(),
    summary: z.string().max(MAX_AGENT_CONTEXT_BYTES),
  }).strict(),
])

export const ChangeSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('repository'),
    scope: repositoryScopeSchema.default({ type: 'staged' }),
  }).strict(),
  z.object({
    kind: z.literal('patch'),
    patch: z.string().min(1).max(MAX_AGENT_CONTEXT_BYTES),
    baseRevision: z.string().min(1).optional(),
    headRevision: z.string().min(1).optional(),
  }).strict(),
  z.object({
    kind: z.literal('files'),
    files: z.array(providedFileSchema).min(1).max(500),
    provenance: providedProvenanceSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('summary'),
    summary: z.string().min(1).max(MAX_AGENT_CONTEXT_BYTES),
    files: z.array(z.object({
      path: z.string().min(1),
      status: z.enum(['modified', 'renamed', 'added', 'deleted', 'untracked', 'unknown']).optional(),
    }).strict()).max(500).optional(),
    provenance: providedProvenanceSchema.optional(),
  }).strict(),
])

export const AgentOptionsSchema = z.object({
  language: z.string().min(1).max(100).optional(),
  additionalContext: z.string().max(32 * 1024).optional(),
  conventional: z.boolean().default(false),
  includeBranchName: z.boolean().default(false),
  previousCommitCount: z.number().int().min(0).max(20).default(0),
  author: z.boolean().default(false),
  timeframe: z.string().min(1).max(100).optional(),
  trustRepositoryConfig: z.boolean().default(false).describe(
    'Allow repository-defined prompts and executable commitlint configuration. Disabled by default for agent safety.',
  ),
}).strict()

export const AgentTaskInputSchema = z.object({
  version: z.literal(AGENT_PROTOCOL_VERSION).default(AGENT_PROTOCOL_VERSION),
  repo: z.string().min(1).optional(),
  source: ChangeSourceSchema.default({ kind: 'repository', scope: { type: 'staged' } }),
  options: AgentOptionsSchema.default({
    conventional: false,
    includeBranchName: false,
    previousCommitCount: 0,
    author: false,
    trustRepositoryConfig: false,
  }),
}).strict()

/** Publish the caller-facing request shape, before defaults are applied. */
export function createAgentInputJsonSchema() {
  return z.toJSONSchema(AgentTaskInputSchema, { io: 'input', target: 'draft-07' })
}

export const SourceMetadataSchema = z.object({
  kind: z.enum(['repository', 'patch', 'files', 'summary']),
  digest: z.string(),
  repositoryHead: z.string().optional(),
  verification: z.enum(['repository-derived', 'head-matched', 'provided-unverified']),
}).strict()

export const CommitDraftDataSchema = z.object({
  title: z.string(),
  body: z.string(),
  formatted: z.string(),
  validationErrors: z.array(z.string()),
}).strict()

export const ReviewDataSchema = z.object({
  findings: z.array(ReviewFeedbackItemSchema),
}).strict()

export const ChangelogDataSchema = z.object({
  title: z.string(),
  content: z.string(),
}).strict()

export const RecapDataSchema = z.object({
  title: z.string(),
  summary: z.string(),
}).strict()

export const AgentErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  details: z.unknown().optional(),
}).strict()

export function createAgentSuccessSchema<T extends z.ZodType>(operation: AgentOperation, data: T) {
  return z.object({
    version: z.literal(AGENT_PROTOCOL_VERSION),
    ok: z.literal(true),
    operation: z.literal(operation),
    status: z.literal('completed'),
    data,
    warnings: z.array(z.string()),
    meta: SourceMetadataSchema,
  }).strict()
}

export function createAgentFailureSchema(operation: AgentOperation) {
  return z.object({
    version: z.literal(AGENT_PROTOCOL_VERSION),
    ok: z.literal(false),
    operation: z.literal(operation),
    error: AgentErrorSchema,
  }).strict()
}

export function createAgentOutputSchema<T extends z.ZodType>(operation: AgentOperation, data: T) {
  return z.discriminatedUnion('ok', [
    createAgentSuccessSchema(operation, data),
    createAgentFailureSchema(operation),
  ])
}

/**
 * MCP SDK 1.x only publishes top-level object output schemas. This object
 * preserves the same discriminated envelope and validates the conditional
 * fields at runtime while remaining visible through tools/list.
 */
export function createAgentMcpOutputSchema<T extends z.ZodType>(operation: AgentOperation, data: T) {
  const successJsonSchema = z.toJSONSchema(createAgentSuccessSchema(operation, data))
  const failureJsonSchema = z.toJSONSchema(createAgentFailureSchema(operation))
  delete successJsonSchema.$schema
  delete failureJsonSchema.$schema

  return z.object({
    version: z.literal(AGENT_PROTOCOL_VERSION),
    ok: z.boolean(),
    operation: z.literal(operation),
    status: z.literal('completed').optional(),
    data: data.optional(),
    warnings: z.array(z.string()).optional(),
    meta: SourceMetadataSchema.optional(),
    error: AgentErrorSchema.optional(),
  }).strict().superRefine((value, context) => {
    if (value.ok) {
      if (!value.status || value.data === undefined || !value.warnings || !value.meta || value.error) {
        context.addIssue({
          code: 'custom',
          message: 'Successful agent output must include status, data, warnings, and meta only.',
        })
      }
      return
    }
    if (!value.error || value.status || value.data !== undefined || value.warnings || value.meta) {
      context.addIssue({
        code: 'custom',
        message: 'Failed agent output must include only the versioned error envelope.',
      })
    }
  }).meta({
    oneOf: [successJsonSchema, failureJsonSchema],
  })
}

export const AgentFailureEnvelopeSchema = z.object({
  version: z.literal(AGENT_PROTOCOL_VERSION),
  ok: z.literal(false),
  operation: AgentOperationSchema,
  error: AgentErrorSchema,
}).strict()

export type AgentOperation = z.infer<typeof AgentOperationSchema>
export type AgentTaskInput = z.infer<typeof AgentTaskInputSchema>
export type AgentOptions = z.infer<typeof AgentOptionsSchema>
export type ChangeSource = z.infer<typeof ChangeSourceSchema>
export type SourceMetadata = z.infer<typeof SourceMetadataSchema>
export type CommitDraftData = z.infer<typeof CommitDraftDataSchema>
export type ReviewData = z.infer<typeof ReviewDataSchema>
export type ChangelogData = z.infer<typeof ChangelogDataSchema>
export type RecapData = z.infer<typeof RecapDataSchema>

export type AgentSuccessEnvelope<T> = {
  version: typeof AGENT_PROTOCOL_VERSION
  ok: true
  operation: AgentOperation
  status: 'completed'
  data: T
  warnings: string[]
  meta: SourceMetadata
}

export type AgentFailureEnvelope = z.infer<typeof AgentFailureEnvelopeSchema>
