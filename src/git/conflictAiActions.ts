import { Arguments } from 'yargs'
import { PromptTemplate } from '@langchain/core/prompts'
import { SimpleGit } from 'simple-git'
import { z } from 'zod'
import { CommitOptions } from '../commands/commit/config'
import { LLMModel } from '../lib/langchain/types'
import { LangChainCancelledError } from '../lib/langchain/errors'
import {
  getApiKeyForModel,
  getModelAndProviderFromConfig,
} from '../lib/langchain/utils'
import { createSchemaParser } from '../lib/langchain/utils/createSchemaParser'
import { resolveDynamicService } from '../lib/langchain/utils/dynamicModels'
import { executeChain } from '../lib/langchain/utils/executeChain'
import { getLlm } from '../lib/langchain/utils/getLlm'
import { loadConfig } from '../lib/config/utils/loadConfig'
import { Logger } from '../lib/utils/logger'
import type { ConflictRegion } from './conflictRegionActions'

/**
 * AI conflict resolution (#1369) — the LLM half of the `M` workflow.
 *
 * Takes the parsed conflict regions of ONE file and asks the model for
 * a proposed resolution per region, returned as structured JSON.
 * Proposals are NEVER auto-applied: the conflicts surface renders them
 * and each lands behind an explicit accept (y) / edit (e) / reject (n)
 * — the `pendingAiDraft` philosophy.
 *
 * Cancellation follows the README convention: the caller owns an
 * `AbortController`, the signal threads into `executeChain`, and an
 * abort surfaces as `cancelled: true` rather than an error.
 */

export type ConflictResolutionProposal = {
  /** Ordinal of the region (at parse time) this proposal targets. */
  regionIndex: number
  /** Proposed replacement for the whole marker block. */
  resolution: string
  /** One-to-two sentence explanation of the choice. */
  rationale: string
}

export type ConflictResolutionResult =
  | { ok: true; proposals: ConflictResolutionProposal[]; message: string }
  | { ok: false; message: string; details?: string[]; cancelled?: boolean }

const ProposalsSchema = z.object({
  proposals: z.array(
    z.object({
      region: z.number().describe('The region number this resolution is for'),
      resolution: z
        .string()
        .describe('The exact final text that replaces the whole conflict block'),
      rationale: z.string().describe('Brief explanation of how the sides were reconciled'),
    })
  ),
})

const CONFLICT_PROMPT_TEMPLATE = `You are resolving git merge conflicts in the file \`{path}\` during a {operation}.

For each conflict region below, produce the final resolved text that should replace the ENTIRE conflict block (both sides and all markers). Preserve the surrounding code style and indentation exactly. When both sides made compatible changes, combine them; when they contradict, prefer the change that is consistent with the rest of the region and explain the choice.

Rules:
- Return one proposal per region, numbered to match.
- The resolution must contain NO conflict markers.
- Do not invent code beyond what is needed to reconcile the two sides.

{conflicts}

{format_instructions}`

/** Serialize regions into the prompt's conflict section. */
function formatRegions(regions: ConflictRegion[]): string {
  return regions
    .map((region) => {
      const parts = [
        `### Region ${region.index} (lines ${region.startLine}-${region.endLine})`,
        `--- ours (${region.oursLabel || 'current'}) ---`,
        region.ours.join('\n'),
      ]
      if (region.base) {
        parts.push('--- base (common ancestor) ---', region.base.join('\n'))
      }
      parts.push(`--- theirs (${region.theirsLabel || 'incoming'}) ---`, region.theirs.join('\n'))
      return parts.join('\n')
    })
    .join('\n\n')
}

type ConflictWorkflowArgv = Arguments<CommitOptions>

function createConflictWorkflowArgv(): ConflictWorkflowArgv {
  return {
    $0: 'coco',
    _: ['commit'],
    interactive: false,
    verbose: false,
    version: false,
    help: false,
    mode: 'stdout',
    openInEditor: false,
    ignoredFiles: [],
    ignoredExtensions: [],
    withPreviousCommits: 0,
    conventional: false,
    includeBranchName: false,
    noVerify: false,
  } as unknown as ConflictWorkflowArgv
}

export async function runConflictResolutionWorkflow(input: {
  git?: SimpleGit
  path: string
  regions: ConflictRegion[]
  /** In-progress operation label ('merge' / 'rebase' / …) for the prompt. */
  operation: string
  signal?: AbortSignal
}): Promise<ConflictResolutionResult> {
  if (input.regions.length === 0) {
    return { ok: false, message: 'No conflict regions to resolve.' }
  }

  const config = loadConfig<CommitOptions, ConflictWorkflowArgv>(createConflictWorkflowArgv())
  const key = getApiKeyForModel(config)
  const { provider } = getModelAndProviderFromConfig(config)
  const service = resolveDynamicService(config, 'commit')

  if (config.service.authentication.type !== 'None' && !key) {
    return {
      ok: false,
      message: 'No API key configured. Set one via env or .coco.config.json first.',
    }
  }

  try {
    const llm = await getLlm(provider, service.model as LLMModel, { ...config, service })
    // `any`: @langchain/core bundles its own zod copy, so the parser's
    // inferred output type is `unknown` against the project's zod and
    // fails executeChain's `Runnable<any, T>` constraint. Same
    // established workaround as `commands/changelog/handler.ts`; the
    // real output type is pinned by the executeChain<T> call below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parser: any = createSchemaParser(ProposalsSchema)
    const prompt = PromptTemplate.fromTemplate(CONFLICT_PROMPT_TEMPLATE)

    const raw = await executeChain<z.infer<typeof ProposalsSchema>>({
      llm,
      prompt,
      variables: {
        path: input.path,
        operation: input.operation === 'none' ? 'merge' : input.operation,
        conflicts: formatRegions(input.regions),
        format_instructions: parser.getFormatInstructions(),
      },
      parser,
      logger: new Logger({ silent: true }),
      signal: input.signal,
      metadata: {
        task: 'conflict-resolution',
        command: 'workstation',
        provider,
        model: String(service.model),
      },
    })

    // Keep only proposals that target a real region, one per region
    // (first wins on duplicates).
    const byRegion = new Map<number, ConflictResolutionProposal>()
    for (const proposal of raw.proposals) {
      const region = input.regions.find((candidate) => candidate.index === proposal.region)
      if (!region || byRegion.has(region.index)) continue
      byRegion.set(region.index, {
        regionIndex: region.index,
        resolution: proposal.resolution,
        rationale: proposal.rationale,
      })
    }
    const proposals = [...byRegion.values()].sort((a, b) => a.regionIndex - b.regionIndex)
    if (proposals.length === 0) {
      return { ok: false, message: 'The model returned no usable proposals — try again.' }
    }
    return {
      ok: true,
      proposals,
      message: `${proposals.length} of ${input.regions.length} region${
        input.regions.length === 1 ? '' : 's'
      } have proposals`,
    }
  } catch (error) {
    if (error instanceof LangChainCancelledError) {
      return { ok: false, cancelled: true, message: 'Conflict resolution cancelled.' }
    }
    const lines = (error as Error).message.split('\n').map((line) => line.trim()).filter(Boolean)
    return {
      ok: false,
      message: lines[0] || 'Conflict resolution failed.',
      details: lines.slice(1, 5),
    }
  }
}

export const conflictAiTestInternals = {
  formatRegions,
  ProposalsSchema,
}
