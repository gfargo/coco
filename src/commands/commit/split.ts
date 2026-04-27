import { PromptTemplate } from '@langchain/core/prompts'
import { z } from 'zod'
import { Arguments } from 'yargs'
import { Config } from '../../lib/config/types'
import { executeChainWithSchema } from '../../lib/langchain/utils/executeChainWithSchema'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { fileChangeParser } from '../../lib/parsers/default'
import { createCommit } from '../../lib/simple-git/createCommit'
import { getChanges } from '../../lib/simple-git/getChanges'
import { FileChange } from '../../lib/types'
import { Logger } from '../../lib/utils/logger'
import { TokenCounter } from '../../lib/utils/tokenizer'
import { CommitOptions } from './config'

export const CommitSplitPlanSchema = z.object({
  groups: z
    .array(
      z.object({
        title: z.string().min(1),
        body: z.string().optional(),
        rationale: z.string().optional(),
        files: z.array(z.string()).min(1),
      })
    )
    .min(1),
})

export type CommitSplitPlan = z.infer<typeof CommitSplitPlanSchema>
export type CommitSplitGroup = CommitSplitPlan['groups'][number]

const COMMIT_SPLIT_PROMPT = PromptTemplate.fromTemplate(`You are helping split staged git changes into a small sequence of coherent commits.

Return ONLY valid JSON matching this schema:
{{
  "groups": [
    {{
      "title": "conventional commit style title",
      "body": "commit body",
      "rationale": "why these files belong together",
      "files": ["relative/path.ts"]
    }}
  ]
}}

Rules:
- Use each staged file exactly once.
- Only use file paths listed in the staged file inventory.
- Prefer 2-5 commits unless the changes are truly all one topic.
- Keep commit titles concise and understandable.
- Do not invent files.

Staged file inventory:
{file_inventory}

Condensed staged diff:
{summary}

Additional context:
{additional_context}`)

export function isCommitSplitCommand(argv: Arguments<CommitOptions>): boolean {
  return Boolean(argv.split || argv.plan || argv.apply || argv._.includes('split'))
}

export function formatCommitSplitPlan(plan: CommitSplitPlan): string {
  return plan.groups
    .map((group, index) => {
      const body = group.body ? `\n\n${group.body}` : ''
      const rationale = group.rationale ? `\n\nRationale: ${group.rationale}` : ''
      const files = group.files.map((file) => `- ${file}`).join('\n')
      return `## ${index + 1}. ${group.title}${body}${rationale}\n\nFiles:\n${files}`
    })
    .join('\n\n---\n\n')
}

function getStagedFileSet(changes: FileChange[]): Set<string> {
  return new Set(changes.map((change) => change.filePath))
}

function validatePlanForStagedFiles(plan: CommitSplitPlan, staged: FileChange[]): void {
  const stagedFiles = getStagedFileSet(staged)
  const seen = new Set<string>()
  const unknown: string[] = []
  const duplicate: string[] = []

  plan.groups.forEach((group) => {
    group.files.forEach((file) => {
      if (!stagedFiles.has(file)) {
        unknown.push(file)
        return
      }

      if (seen.has(file)) {
        duplicate.push(file)
        return
      }

      seen.add(file)
    })
  })

  const missing = [...stagedFiles].filter((file) => !seen.has(file))

  if (unknown.length || duplicate.length || missing.length) {
    throw new Error(
      [
        unknown.length ? `unknown files: ${unknown.join(', ')}` : undefined,
        duplicate.length ? `duplicate files: ${duplicate.join(', ')}` : undefined,
        missing.length ? `missing files: ${missing.join(', ')}` : undefined,
      ]
        .filter(Boolean)
        .join('; ')
    )
  }
}

function assertNoUnstagedOverlap(plan: CommitSplitPlan, changes: Awaited<ReturnType<typeof getChanges>>): void {
  const plannedFiles = new Set(plan.groups.flatMap((group) => group.files))
  const overlapping = [...(changes.unstaged || []), ...(changes.untracked || [])]
    .map((change) => change.filePath)
    .filter((file) => plannedFiles.has(file))

  if (overlapping.length > 0) {
    throw new Error(
      `Cannot apply split plan because these files also have unstaged or untracked changes: ${overlapping.join(', ')}`
    )
  }
}

async function applyCommitSplitPlan({
  plan,
  changes,
  git,
  logger,
  noVerify,
}: {
  plan: CommitSplitPlan
  changes: Awaited<ReturnType<typeof getChanges>>
  git: ReturnType<typeof import('../../lib/simple-git/getRepo').getRepo>
  logger: Logger
  noVerify: boolean
}): Promise<string> {
  validatePlanForStagedFiles(plan, changes.staged)
  assertNoUnstagedOverlap(plan, changes)

  await git.raw(['reset'])

  for (const group of plan.groups) {
    await git.add(group.files)
    await createCommit(`${group.title}\n\n${group.body}`.trim(), git, undefined, { noVerify })
    logger.verbose(`Created split commit: ${group.title}`, { color: 'green' })
  }

  return `Created ${plan.groups.length} split commit(s).`
}

export async function handleCommitSplit({
  argv,
  config,
  git,
  logger,
  tokenizer,
  llm,
}: {
  argv: Arguments<CommitOptions>
  config: Config & CommitOptions
  git: ReturnType<typeof import('../../lib/simple-git/getRepo').getRepo>
  logger: Logger
  tokenizer: TokenCounter
  llm: ReturnType<typeof getLlm>
}): Promise<string> {
  const changes = await getChanges({
    git,
    options: {
      ignoredFiles: config.ignoredFiles || undefined,
      ignoredExtensions: config.ignoredExtensions || undefined,
    },
  })

  if (changes.staged.length === 0) {
    return 'No staged changes found.'
  }

  const summary = await fileChangeParser({
    changes: changes.staged,
    commit: '--staged',
    options: {
      tokenizer,
      git,
      llm,
      logger,
      maxTokens: config.service.tokenLimit,
      minTokensForSummary: config.service.minTokensForSummary,
      maxFileTokens: config.service.maxFileTokens,
      maxConcurrent: config.service.maxConcurrent,
    },
  })

  const fileInventory = changes.staged
    .map((change) => `- ${change.filePath}: ${change.status} - ${change.summary}`)
    .join('\n')

  const plan = await executeChainWithSchema<CommitSplitPlan>(
    CommitSplitPlanSchema,
    llm,
    COMMIT_SPLIT_PROMPT,
    {
      file_inventory: fileInventory,
      summary,
      additional_context: argv.additional || '',
    },
    {
      logger,
      tokenizer,
      metadata: {
        task: 'commit-split-plan',
        command: 'commit',
        provider: config.service.provider,
        model: String(config.service.model),
      },
    }
  )

  validatePlanForStagedFiles(plan, changes.staged)

  if (argv.apply) {
    return await applyCommitSplitPlan({
      plan,
      changes,
      git,
      logger,
      noVerify: argv.noVerify || config.noVerify || false,
    })
  }

  return formatCommitSplitPlan(plan)
}
