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

export const AgentOperationSchema = z.enum(['commit-draft', 'review', 'changelog', 'recap', 'condense-diff', 'repo-context', 'blame', 'lint', 'conflict-resolve'])

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
    'Allow repository-defined prompts and executable commitlint configuration. Disabled by default for agent safety. Honored by: all operations, agent CLI only -- not present in the MCP input schema.',
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

/**
 * MCP-only variants that omit `trustRepositoryConfig`. MCP tools always
 * reject that option, so it never belongs in the schema an MCP client sees —
 * the agent CLI keeps the full schema above. See `AgentTaskInputSchema`.
 */
export const McpAgentOptionsSchema = AgentOptionsSchema.omit({ trustRepositoryConfig: true })

export const McpTaskInputSchema = z.object({
  version: z.literal(AGENT_PROTOCOL_VERSION).default(AGENT_PROTOCOL_VERSION),
  repo: z.string().min(1).optional(),
  source: ChangeSourceSchema.default({ kind: 'repository', scope: { type: 'staged' } }),
  options: McpAgentOptionsSchema.default({
    conventional: false,
    includeBranchName: false,
    previousCommitCount: 0,
    author: false,
  }),
}).strict()

/** Publish the MCP-facing request shape, before defaults are applied. */
export function createMcpAgentInputJsonSchema() {
  return z.toJSONSchema(McpTaskInputSchema, { io: 'input', target: 'draft-07' })
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

/**
 * MCP-only variant that omits `trustRepositoryConfig`. See
 * `McpTaskInputSchema` for why: MCP tools always reject the option, so it
 * never belongs in the schema an MCP client sees.
 */
export const McpCondenseDiffRequestSchema = CondenseDiffRequestSchema.omit({ trustRepositoryConfig: true })

/** Publish the MCP-facing condense-diff request shape. */
export function createMcpCondenseDiffInputJsonSchema() {
  return z.toJSONSchema(McpCondenseDiffRequestSchema, { io: 'input', target: 'draft-07' })
}

export type CondenseDiffLanguage = z.infer<typeof CondenseDiffLanguageSchema>
export type CondenseDiffRequest = z.infer<typeof CondenseDiffRequestSchema>
export type CondenseDiffData = z.infer<typeof CondenseDiffDataSchema>
export type CondenseDiffFileResult = z.infer<typeof CondenseDiffFileResultSchema>

export type AgentOperation = z.infer<typeof AgentOperationSchema>
export type AgentTaskInput = z.infer<typeof AgentTaskInputSchema>
export type AgentOptions = z.infer<typeof AgentOptionsSchema>
export type McpTaskInput = z.infer<typeof McpTaskInputSchema>
export type McpAgentOptions = z.infer<typeof McpAgentOptionsSchema>
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

// ─── repo-context operation ───────────────────────────────────────────────────

/**
 * Sections that can be included in a repo-context snapshot.
 * Callers opt in per section; omitted sections cost no git work.
 */
export const RepoContextSectionSchema = z.enum(['branch', 'status', 'history', 'conflicts', 'capabilities'])

/**
 * Request schema for `coco agent repo-context` and the MCP tool
 * `coco_repo_context`. A read-only, section-selectable structured snapshot
 * of repository state — no diff content, no LLM call, no API key required.
 * Every list in the response is bounded and reports totalCount + truncated.
 */
export const RepoContextRequestSchema = z.object({
  version: z.literal(AGENT_PROTOCOL_VERSION).default(AGENT_PROTOCOL_VERSION),
  repo: z.string().min(1).optional(),
  /**
   * Sections to include. Defaults to ['branch', 'status'] — the cheap,
   * most-used reads. Include 'history', 'conflicts', and 'capabilities'
   * only when needed to avoid paying for unused git work.
   */
  include: z.array(RepoContextSectionSchema).optional(),
  /**
   * Maximum number of history entries to return. Capped at 50.
   * Default: 20.
   */
  historyLimit: z.number().int().min(1).max(50).default(20),
}).strict()

/** Publish the caller-facing request shape, before defaults are applied. */
export function createRepoContextInputJsonSchema() {
  return z.toJSONSchema(RepoContextRequestSchema, { io: 'input', target: 'draft-07' })
}

// ─── Per-section sub-schemas ──────────────────────────────────────────────────

export const RepoContextFileEntrySchema = z.object({
  path: z.string(),
  /** X (index/staging area) status character from git status --porcelain */
  indexStatus: z.string(),
  /** Y (worktree) status character from git status --porcelain */
  worktreeStatus: z.string(),
  /** Number of lines added (rename-aware numstat). undefined if unavailable. */
  additions: z.number().int().optional(),
  /** Number of lines deleted (rename-aware numstat). undefined if unavailable. */
  deletions: z.number().int().optional(),
}).strict()

export const RepoContextStatusSchema = z.object({
  staged: z.array(RepoContextFileEntrySchema),
  unstaged: z.array(RepoContextFileEntrySchema),
  untracked: z.array(RepoContextFileEntrySchema),
  conflicted: z.array(RepoContextFileEntrySchema),
  counts: z.object({
    staged: z.number().int(),
    unstaged: z.number().int(),
    untracked: z.number().int(),
    conflicted: z.number().int(),
  }).strict(),
  truncated: z.boolean(),
  totalCount: z.number().int(),
}).strict()

export const RepoContextBranchSchema = z.object({
  current: z.string(),
  upstream: z.string().optional(),
  ahead: z.number().int().optional(),
  behind: z.number().int().optional(),
  detached: z.boolean(),
  defaultBranch: z.string().optional(),
}).strict()

export const RepoContextHistoryEntrySchema = z.object({
  sha: z.string(),
  subject: z.string(),
  author: z.string(),
  relativeDate: z.string(),
  refs: z.array(z.string()),
}).strict()

export const RepoContextHistorySchema = z.object({
  entries: z.array(RepoContextHistoryEntrySchema),
  totalCount: z.number().int(),
  truncated: z.boolean(),
}).strict()

export const RepoContextConflictsSchema = z.object({
  inProgress: z.boolean(),
  operation: z.enum(['none', 'merge', 'rebase', 'cherry-pick', 'revert']),
  files: z.array(RepoContextFileEntrySchema),
  regionCounts: z.object({
    totalCount: z.number().int(),
    truncated: z.boolean(),
  }).strict(),
  totalCount: z.number().int(),
  truncated: z.boolean(),
}).strict()

export const RepoContextCapabilitiesSchema = z.object({
  forge: z.string().optional(),
  hasCommitlintConfig: z.boolean(),
  isWorktree: z.boolean(),
  isShallow: z.boolean(),
}).strict()

export const RepoContextDataSchema = z.object({
  branch: RepoContextBranchSchema.optional(),
  status: RepoContextStatusSchema.optional(),
  history: RepoContextHistorySchema.optional(),
  conflicts: RepoContextConflictsSchema.optional(),
  capabilities: RepoContextCapabilitiesSchema.optional(),
}).strict()

export type RepoContextRequest = z.infer<typeof RepoContextRequestSchema>
export type RepoContextData = z.infer<typeof RepoContextDataSchema>
export type RepoContextBranch = z.infer<typeof RepoContextBranchSchema>
export type RepoContextStatus = z.infer<typeof RepoContextStatusSchema>
export type RepoContextHistoryEntry = z.infer<typeof RepoContextHistoryEntrySchema>
export type RepoContextHistory = z.infer<typeof RepoContextHistorySchema>
export type RepoContextConflicts = z.infer<typeof RepoContextConflictsSchema>
export type RepoContextCapabilities = z.infer<typeof RepoContextCapabilitiesSchema>
export type RepoContextFileEntry = z.infer<typeof RepoContextFileEntrySchema>
export type RepoContextSection = z.infer<typeof RepoContextSectionSchema>

// ─── blame operation ──────────────────────────────────────────────────────────

/**
 * Cost guardrails matching `coco blame --explain` (#OSS-1604): a naive
 * --explain would issue one LLM call per blamed sha. Both the CLI and the
 * `coco_blame` MCP tool batch into a single call, but still cap the input so
 * a huge file (or an un-narrowed `lines`) can't balloon the prompt/cost.
 */
export const MAX_BLAME_EXPLAIN_LINES = 400
export const MAX_BLAME_EXPLAIN_COMMITS = 25

/**
 * Request schema for the MCP tool `coco_blame`. Read-only: attributes each
 * line of a repo-relative file to its introducing commit. `explain: true`
 * additionally resolves the introducing commits and asks an LLM why each
 * range was written — this requires an API key for the configured provider.
 */
export const BlameRequestSchema = z.object({
  version: z.literal(AGENT_PROTOCOL_VERSION).default(AGENT_PROTOCOL_VERSION),
  repo: z.string().min(1).optional(),
  file: z.string().min(1).describe('Repo-relative path to blame.'),
  lines: z.string().min(1).optional().describe(
    'Restrict to a 1-based inclusive line range: "10:50", "10:" (open-ended), or "10" (single line). Omit for the whole file.',
  ),
  explain: z.boolean().default(false).describe(
    'Resolve each blamed commit and ask an LLM why the range was introduced. Requires an API key for the configured ' +
    `provider. Capped at ${MAX_BLAME_EXPLAIN_LINES} lines and ${MAX_BLAME_EXPLAIN_COMMITS} distinct commits per call.`,
  ),
}).strict()

/** Publish the caller-facing blame request shape, before defaults are applied. */
export function createBlameInputJsonSchema() {
  return z.toJSONSchema(BlameRequestSchema, { io: 'input', target: 'draft-07' })
}

export const BlameLineEntrySchema = z.object({
  lineNumber: z.number().int(),
  hash: z.string(),
  shortHash: z.string(),
  author: z.string(),
  content: z.string(),
}).strict()

export const BlameExplanationEntrySchema = z.object({
  hash: z.string(),
  author: z.string(),
  /** Line ranges attributed to this commit, e.g. "12-18, 25". */
  lines: z.string(),
  subject: z.string(),
  explanation: z.string(),
}).strict()

export const BlameDataSchema = z.object({
  path: z.string(),
  /** Present when `explain: false` (the default). */
  lines: z.array(BlameLineEntrySchema).optional(),
  /** Present when `explain: true`. */
  explanations: z.array(BlameExplanationEntrySchema).optional(),
  /** True when more distinct commits touched the range than `MAX_BLAME_EXPLAIN_COMMITS` allows. */
  truncated: z.boolean().optional(),
}).strict()

export type BlameRequest = z.infer<typeof BlameRequestSchema>
export type BlameData = z.infer<typeof BlameDataSchema>
export type BlameLineEntry = z.infer<typeof BlameLineEntrySchema>
export type BlameExplanationEntry = z.infer<typeof BlameExplanationEntrySchema>

// ─── lint operation ────────────────────────────────────────────────────────────

/**
 * Request schema for the MCP tool `coco_lint`. Read-only: validates the
 * subject/body of each commit in a range against coco's built-in
 * Conventional Commits rules. `since`/`range` are mutually exclusive; neither
 * enables `--fix` (rewriting commit history is not read-only, so it is never
 * exposed via MCP).
 */
export const LintRequestSchema = z.object({
  version: z.literal(AGENT_PROTOCOL_VERSION).default(AGENT_PROTOCOL_VERSION),
  repo: z.string().min(1).optional(),
  since: gitRevisionSchema.optional().describe(
    'Lint commits in `<since>..HEAD` instead of comparing against the default branch. Mutually exclusive with `range`.',
  ),
  range: gitRevisionSchema.optional().describe(
    'Lint an explicit commit range (e.g. "abc123..def456"). Mutually exclusive with `since`.',
  ),
  severity: z.enum(['error', 'warning']).default('error').describe(
    'A commit at/above this severity counts toward `summary.failing`.',
  ),
}).strict()

/** Publish the caller-facing lint request shape, before defaults are applied. */
export function createLintInputJsonSchema() {
  return z.toJSONSchema(LintRequestSchema, { io: 'input', target: 'draft-07' })
}

export const LintCommitResultSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  subject: z.string(),
  status: z.enum(['pass', 'warn', 'fail', 'skipped']),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
}).strict()

export const LintDataSchema = z.object({
  results: z.array(LintCommitResultSchema),
  summary: z.object({
    passing: z.number().int(),
    failing: z.number().int(),
    warning: z.number().int(),
    skipped: z.number().int(),
  }).strict(),
}).strict()

export type LintRequest = z.infer<typeof LintRequestSchema>
export type LintData = z.infer<typeof LintDataSchema>
export type LintCommitResult = z.infer<typeof LintCommitResultSchema>

// ─── conflict-resolve operation ────────────────────────────────────────────────

/**
 * Cost guardrails: cap the number of conflicted files and marker regions per
 * file that a single call processes, so a large mid-merge conflict set can't
 * balloon into an unbounded number of LLM calls.
 */
export const MAX_CONFLICT_RESOLVE_FILES = 50
export const DEFAULT_CONFLICT_RESOLVE_MAX_FILES = 10
export const MAX_CONFLICT_RESOLVE_REGIONS = 200
export const DEFAULT_CONFLICT_RESOLVE_MAX_REGIONS = 50

/**
 * Request schema for `coco agent conflict-resolve` and the MCP tool
 * `coco_conflict_resolve`. Read-only: proposes a per-region resolution for
 * each in-merge conflicted file without ever writing to disk -- proposals are
 * returned for the caller to review and apply through its own accept/edit/
 * reject flow (`applyConflictResolution` is never called by this operation).
 *
 * `options` deliberately omits `trustRepositoryConfig` (unlike
 * `AgentOptionsSchema`) rather than using an `Mcp*` variant like condense-diff
 * -- the `.strict()` parse already rejects it with `INVALID_INPUT` for both
 * the agent CLI and MCP callers, and this operation never reads
 * repository-defined prompt overrides, so there is nothing to trust either way.
 */
export const ConflictResolveRequestSchema = z.object({
  version: z.literal(AGENT_PROTOCOL_VERSION).default(AGENT_PROTOCOL_VERSION),
  repo: z.string().min(1).optional(),
  /** Repo-relative paths to restrict resolution to. Omit to process every conflicted file. */
  files: z.array(z.string().min(1)).optional(),
  options: z.object({
    language: z.string().min(1).max(100).optional().describe(
      'ISO language code or plain name (e.g. "en", "Spanish") reserved for parity with other operations\' options bag.',
    ),
    additionalContext: z.string().max(32 * 1024).optional().describe(
      'Extra free-text context reserved for parity with other operations\' options bag.',
    ),
  }).strict().default({}),
  maxFiles: z.number().int().min(1).max(MAX_CONFLICT_RESOLVE_FILES).default(DEFAULT_CONFLICT_RESOLVE_MAX_FILES).describe(
    'Maximum number of conflicted files to process in this call. Files beyond the cap are reported in `unresolved`.',
  ),
  maxRegions: z.number().int().min(1).max(MAX_CONFLICT_RESOLVE_REGIONS).default(DEFAULT_CONFLICT_RESOLVE_MAX_REGIONS).describe(
    'Maximum number of conflict regions to process per file. Regions beyond the cap are reported in `unresolved`.',
  ),
}).strict()

/** Publish the caller-facing conflict-resolve request shape, before defaults are applied. */
export function createConflictResolveInputJsonSchema() {
  return z.toJSONSchema(ConflictResolveRequestSchema, { io: 'input', target: 'draft-07' })
}

export const ConflictResolveConflictSchema = z.object({
  path: z.string(),
  /** 0-based ordinal of the region within the file, matching `ConflictRegion.index`. */
  regionIndex: z.number().int(),
  ours: z.array(z.string()),
  theirs: z.array(z.string()),
  /** diff3-style common-ancestor section, present only when the merge used `merge.conflictStyle=diff3`. */
  base: z.array(z.string()).optional(),
  proposal: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  rationale: z.string(),
  /** Digest of the whole file's content at read time, shared by every region proposed for that file. */
  digest: z.string(),
}).strict()

/**
 * A file or region that could not be resolved. `regionIndex: -1` marks a
 * whole-file skip (binary/unreadable content, or a `maxFiles` overflow);
 * a non-negative index marks a single region that overflowed `maxRegions`
 * or that the model failed to propose a resolution for.
 */
export const ConflictResolveUnresolvedSchema = z.object({
  path: z.string(),
  regionIndex: z.number().int(),
  reason: z.string(),
}).strict()

export const ConflictResolveDataSchema = z.object({
  conflicts: z.array(ConflictResolveConflictSchema),
  unresolved: z.array(ConflictResolveUnresolvedSchema),
}).strict()

export type ConflictResolveRequest = z.infer<typeof ConflictResolveRequestSchema>
export type ConflictResolveData = z.infer<typeof ConflictResolveDataSchema>
export type ConflictResolveConflict = z.infer<typeof ConflictResolveConflictSchema>
export type ConflictResolveUnresolved = z.infer<typeof ConflictResolveUnresolvedSchema>

// ─── commit-apply operation ───────────────────────────────────────────────────

/**
 * Request schema for the MCP tool `coco_commit_apply`. Only registered when
 * the server is started with `--allow-write`. Deliberately flat (not
 * wrapped in the versioned `AgentSuccessEnvelope`/`AgentTaskInput` shape used
 * by the generation tools) since this operation has no `source`/`options`
 * bag — it commits whatever is already staged.
 */
export const CommitApplyRequestSchema = z.object({
  version: z.literal(AGENT_PROTOCOL_VERSION).default(AGENT_PROTOCOL_VERSION),
  repo: z.string().min(1).optional(),
  title: z.string().min(1).describe('Commit subject line.'),
  body: z.string().optional().describe('Commit body, appended after a blank line.'),
  noVerify: z.boolean().default(false).describe('Skip pre-commit and commit-msg hooks (passes --no-verify to git commit).'),
}).strict()

export const CommitApplyDataSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  message: z.string(),
}).strict()

/** Publish the caller-facing commit-apply request schema. */
export function createCommitApplyInputJsonSchema() {
  return z.toJSONSchema(CommitApplyRequestSchema, { io: 'input', target: 'draft-07' })
}

export type CommitApplyRequest = z.infer<typeof CommitApplyRequestSchema>
export type CommitApplyData = z.infer<typeof CommitApplyDataSchema>
