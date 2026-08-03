import { z } from 'zod'

import { ReviewFeedbackItemSchema } from '../../commands/review/config'

export const AGENT_PROTOCOL_VERSION = 1 as const
export const MAX_AGENT_CONTEXT_BYTES = 2 * 1024 * 1024
/**
 * Upper bound for `condense-diff`'s `budget.tokens`. Tokens and bytes are
 * different units (a token is ~3-4 bytes for English/code text), so this is
 * deliberately its own constant rather than a reuse of the byte-oriented
 * `MAX_AGENT_CONTEXT_BYTES` — it just happens to use the same generous
 * order-of-magnitude ceiling to reject obviously-invalid requests.
 */
export const MAX_CONDENSE_BUDGET_TOKENS = 2_000_000
export const MAX_CONVENTIONS_BYTES = 24 * 1024

export const AgentOperationSchema = z.enum(['commit-draft', 'review', 'changelog', 'recap', 'condense-diff'])

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
  language: z.string().min(1).max(100).optional().describe(
    'ISO language code or plain name (e.g. "en", "Spanish") for generated output. Honored by: all operations.',
  ),
  additionalContext: z.string().max(32 * 1024).optional().describe(
    'Extra free-text context appended to the prompt (e.g. ticket description, scope notes). Honored by: all operations.',
  ),
  conventional: z.boolean().default(false).describe(
    'Constrain generated commit message to the Conventional Commits specification. Honored by: commit-draft. Ignored by other operations.',
  ),
  includeBranchName: z.boolean().default(false).describe(
    'Include the current branch name as context when generating the commit message. Honored by: commit-draft. Ignored by other operations.',
  ),
  previousCommitCount: z.number().int().min(0).max(20).default(0).describe(
    'Number of preceding commits to include as context for the commit message. Honored by: commit-draft. Ignored by other operations.',
  ),
  author: z.boolean().default(false).describe(
    'Include author attribution when it is present in the supplied context. Honored by: changelog. Ignored by other operations.',
  ),
  timeframe: z.string().min(1).max(100).optional().describe(
    'Human-readable window for the summary, e.g. "last week" or "yesterday". Honored by: recap. Ignored by other operations.',
  ),
  trustRepositoryConfig: z.boolean().default(false).describe(
    'Allow repository-defined prompts and executable commitlint configuration. Disabled by default for agent safety. Honored by: all operations (agent CLI only; MCP rejects this option).',
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

export const ConventionsMetadataSchema = z.object({
  digest: z.string(),
  files: z.array(z.string()),
}).strict()

export const SourceMetadataSchema = z.object({
  kind: z.enum(['repository', 'patch', 'files', 'summary']),
  digest: z.string(),
  repositoryHead: z.string().optional(),
  verification: z.enum(['repository-derived', 'head-matched', 'provided-unverified']),
  conventions: ConventionsMetadataSchema.optional(),
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

// ─── condense-diff operation ──────────────────────────────────────────────────

/**
 * Language identifiers accepted by the condense-diff operation.
 * Mirrors `StructuralLanguageId` in the parser registry without
 * importing from `lib/` (keeps the schema layer independent).
 */
export const CondenseDiffLanguageSchema = z.enum([
  'ts', 'js', 'py', 'rs', 'go', 'java', 'cpp', 'cs', 'rb', 'php', 'kt', 'swift', 'lua', 'bash',
])

/**
 * Request schema for `coco agent condense-diff` and the MCP tool
 * `coco_condense_diff`. This is a distinct schema from `AgentTaskInputSchema`
 * because condense carries extra fields (budget, mode, languages, model) that
 * the four generation operations do not need, and those operations carry an
 * `options` bag that condense does not use.
 *
 * `source` reuses the full `ChangeSourceSchema` (so digest/provenance metadata
 * behaves identically across operations), but only the `repository` and
 * `patch` kinds carry per-file unified-diff text that can be structurally
 * condensed. `runCondenseDiff` rejects `summary`/`files` sources at runtime
 * with `UNSUPPORTED_SOURCE` rather than silently misparsing their prose/
 * metadata shape as diff content.
 */
export const CondenseDiffRequestSchema = z.object({
  version: z.literal(AGENT_PROTOCOL_VERSION).default(AGENT_PROTOCOL_VERSION),
  repo: z.string().min(1).optional(),
  source: ChangeSourceSchema.default({ kind: 'repository', scope: { type: 'staged' } }),
  budget: z.object({
    tokens: z.number().int().min(1).max(MAX_CONDENSE_BUDGET_TOKENS),
  }).strict(),
  /**
   * `structural` (default): use tree-sitter / regex extractors — deterministic,
   * no LLM call, no API key required.
   * `summary`: invoke an LLM for prose summarization (currently returns
   * UNSUPPORTED_MODE; reserved for a future extension).
   */
  mode: z.enum(['structural', 'summary']).default('structural'),
  /** Restrict structural extraction to a subset of languages. Omit to process all. */
  languages: z.array(CondenseDiffLanguageSchema).optional(),
  /**
   * Target model for tokenization. Used ONLY to select the correct
   * tiktoken encoding for budget math — no LLM call is made in
   * `structural` mode. Defaults to `gpt-4o` when omitted.
   */
  model: z.string().optional(),
  /**
   * Target provider for tokenization (governs the correction factor
   * applied when the provider does not use tiktoken natively).
   * Defaults to `openai` when omitted.
   */
  provider: z.string().optional(),
  trustRepositoryConfig: z.boolean().default(false).describe(
    'Allow repository-defined prompts and executable commitlint configuration. Disabled by default for agent safety.',
  ),
}).strict()

/** Per-file outcome reported in the `files` array of the condense result. */
export const CondenseDiffFileResultSchema = z.object({
  path: z.string(),
  language: z.string().optional(),
  /**
   * What strategy was applied to this file:
   * - `structural`: tree-sitter or regex extractor succeeded.
   * - `trivial`: trivial-shape shortcut (pure add/delete/rename/binary).
   * - `line-based`: no structural extraction available; raw diff kept.
   * - `omitted`: file was dropped to stay within the token budget.
   */
  applied: z.enum(['structural', 'trivial', 'line-based', 'omitted']),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
}).strict()

export const CondenseDiffDataSchema = z.object({
  condensed: z.string(),
  metrics: z.object({
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    /** Fraction reduced: 1 - (outputTokens / inputTokens). 0 when no reduction. */
    reductionRatio: z.number(),
    filesIncluded: z.number().int(),
    filesOmitted: z.number().int(),
    /** Which condensation strategy produced the final result. */
    strategy: z.enum(['structural', 'summary']),
  }).strict(),
  files: z.array(CondenseDiffFileResultSchema),
}).strict()

/** Publish the caller-facing condense-diff request schema. */
export function createCondenseDiffInputJsonSchema() {
  return z.toJSONSchema(CondenseDiffRequestSchema, { io: 'input', target: 'draft-07' })
}

export type CondenseDiffLanguage = z.infer<typeof CondenseDiffLanguageSchema>
export type CondenseDiffRequest = z.infer<typeof CondenseDiffRequestSchema>
export type CondenseDiffData = z.infer<typeof CondenseDiffDataSchema>
export type CondenseDiffFileResult = z.infer<typeof CondenseDiffFileResultSchema>

export type AgentOperation = z.infer<typeof AgentOperationSchema>
export type AgentTaskInput = z.infer<typeof AgentTaskInputSchema>
export type AgentOptions = z.infer<typeof AgentOptionsSchema>
export type ChangeSource = z.infer<typeof ChangeSourceSchema>
export type SourceMetadata = z.infer<typeof SourceMetadataSchema>
export type ConventionsMetadata = z.infer<typeof ConventionsMetadataSchema>
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
