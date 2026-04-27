import { PromptTemplate } from '@langchain/core/prompts'
import { spawn } from 'child_process'
import { formatPatch, parsePatch, StructuredPatch, StructuredPatchHunk } from 'diff'
import { z } from 'zod'
import { Arguments } from 'yargs'
import { Config } from '../../lib/config/types'
import { executeChainWithSchema } from '../../lib/langchain/utils/executeChainWithSchema'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { fileChangeParser } from '../../lib/parsers/default'
import { createFileChangeParserOptions } from '../../lib/parsers/default/utils/createFileChangeParserOptions'
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
        files: z.array(z.string()),
        hunks: z.array(z.string()),
      })
      .refine((group) => group.files.length > 0 || group.hunks.length > 0, {
        message: 'Each group must include at least one file or hunk',
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
      "files": ["relative/path.ts"],
      "hunks": ["relative/path.ts::hunk-1"]
    }}
  ]
}}

Rules:
- Use each staged file exactly once.
- If a file has hunk IDs and contains unrelated changes, assign every hunk ID exactly once instead of assigning the whole file.
- Do not list the same file in "files" when assigning that file through "hunks".
- Only use file paths listed in the staged file inventory.
- Only use hunk IDs listed in the staged hunk inventory.
- Prefer 2-5 commits unless the changes are truly all one topic.
- Keep commit titles concise and understandable.
- Do not invent files.

Staged file inventory:
{file_inventory}

Staged hunk inventory:
{hunk_inventory}

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
      const files = (group.files || []).map((file) => `- ${file}`).join('\n')
      const hunks = (group.hunks || []).map((hunk) => `- ${hunk}`).join('\n')
      const sections = [
        files ? `Files:\n${files}` : undefined,
        hunks ? `Hunks:\n${hunks}` : undefined,
      ].filter(Boolean)

      return `## ${index + 1}. ${group.title}${body}${rationale}\n\n${sections.join('\n\n')}`
    })
    .join('\n\n---\n\n')
}

type StagedHunk = {
  id: string
  filePath: string
  patch: StructuredPatch
  hunk: StructuredPatchHunk
  header: string
  preview: string
}

type HunkInventory = {
  hunks: StagedHunk[]
  byId: Map<string, StagedHunk>
  byFile: Map<string, StagedHunk[]>
}

function getStagedFileSet(changes: FileChange[]): Set<string> {
  return new Set(changes.map((change) => change.filePath))
}

function getGroupFiles(group: CommitSplitGroup): string[] {
  return group.files || []
}

function getGroupHunks(group: CommitSplitGroup): string[] {
  return group.hunks || []
}

function hunkHeader(hunk: StructuredPatchHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
}

function hunkPreview(hunk: StructuredPatchHunk): string {
  return hunk.lines
    .filter((line) => line.startsWith('+') || line.startsWith('-'))
    .slice(0, 6)
    .join('\n')
}

async function collectHunkInventory(
  staged: FileChange[],
  git: ReturnType<typeof import('../../lib/simple-git/getRepo').getRepo>
): Promise<HunkInventory> {
  const hunks: StagedHunk[] = []
  const byId = new Map<string, StagedHunk>()
  const byFile = new Map<string, StagedHunk[]>()

  for (const change of staged) {
    if (change.status !== 'modified') {
      continue
    }

    const diff = await git.diff(['--staged', '--', change.filePath])
    const [patch] = parsePatch(diff)

    if (!patch || patch.hunks.length === 0) {
      continue
    }

    patch.hunks.forEach((hunk, index) => {
      const stagedHunk = {
        id: `${change.filePath}::hunk-${index + 1}`,
        filePath: change.filePath,
        patch,
        hunk,
        header: hunkHeader(hunk),
        preview: hunkPreview(hunk),
      }

      hunks.push(stagedHunk)
      byId.set(stagedHunk.id, stagedHunk)
      byFile.set(change.filePath, [...(byFile.get(change.filePath) || []), stagedHunk])
    })
  }

  return { hunks, byId, byFile }
}

function formatHunkInventory(inventory: HunkInventory): string {
  if (inventory.hunks.length === 0) {
    return 'No hunk-level inventory available. Use file-level groups.'
  }

  return inventory.hunks
    .map((hunk) => {
      const preview = hunk.preview ? `\n${hunk.preview}` : ''
      return `- ${hunk.id}: ${hunk.header}${preview}`
    })
    .join('\n')
}

function validatePlanForStagedFiles(
  plan: CommitSplitPlan,
  staged: FileChange[],
  hunkInventory?: HunkInventory
): void {
  const stagedFiles = getStagedFileSet(staged)
  const seen = new Set<string>()
  const seenHunks = new Set<string>()
  const unknown: string[] = []
  const duplicate: string[] = []
  const unknownHunks: string[] = []
  const duplicateHunks: string[] = []

  plan.groups.forEach((group) => {
    getGroupFiles(group).forEach((file) => {
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

    getGroupHunks(group).forEach((hunkId) => {
      const hunk = hunkInventory?.byId.get(hunkId)
      if (!hunk) {
        unknownHunks.push(hunkId)
        return
      }

      if (seenHunks.has(hunkId)) {
        duplicateHunks.push(hunkId)
        return
      }

      seenHunks.add(hunkId)
    })
  })

  const hunkCoveredFiles = new Set([...seenHunks].map((hunkId) => hunkInventory?.byId.get(hunkId)?.filePath))
  const mixedFiles = [...seen].filter((file) => hunkCoveredFiles.has(file))
  const partiallyCoveredFiles = [...hunkCoveredFiles]
    .filter((file): file is string => Boolean(file))
    .filter((file) => {
      const fileHunks = hunkInventory?.byFile.get(file) || []
      return fileHunks.some((hunk) => !seenHunks.has(hunk.id))
    })
  const missing = [...stagedFiles].filter((file) => !seen.has(file) && !hunkCoveredFiles.has(file))

  if (
    unknown.length ||
    duplicate.length ||
    unknownHunks.length ||
    duplicateHunks.length ||
    mixedFiles.length ||
    partiallyCoveredFiles.length ||
    missing.length
  ) {
    throw new Error(
      [
        unknown.length ? `unknown files: ${unknown.join(', ')}` : undefined,
        duplicate.length ? `duplicate files: ${duplicate.join(', ')}` : undefined,
        unknownHunks.length ? `unknown hunks: ${unknownHunks.join(', ')}` : undefined,
        duplicateHunks.length ? `duplicate hunks: ${duplicateHunks.join(', ')}` : undefined,
        mixedFiles.length ? `files assigned both as whole files and hunks: ${mixedFiles.join(', ')}` : undefined,
        partiallyCoveredFiles.length
          ? `files with only some hunks assigned: ${partiallyCoveredFiles.join(', ')}`
          : undefined,
        missing.length ? `missing files: ${missing.join(', ')}` : undefined,
      ]
        .filter(Boolean)
        .join('; ')
    )
  }
}

function assertNoUnstagedOverlap(
  plan: CommitSplitPlan,
  changes: Awaited<ReturnType<typeof getChanges>>,
  hunkInventory?: HunkInventory
): void {
  const hunkFiles = new Set(
    plan.groups.flatMap((group) =>
      getGroupHunks(group)
        .map((hunkId) => hunkInventory?.byId.get(hunkId)?.filePath)
        .filter((file): file is string => Boolean(file))
    )
  )
  const plannedFiles = new Set(
    plan.groups
      .flatMap((group) => getGroupFiles(group))
      .filter((file) => !hunkFiles.has(file))
  )
  const overlapping = [...(changes.unstaged || []), ...(changes.untracked || [])]
    .map((change) => change.filePath)
    .filter((file) => plannedFiles.has(file))

  if (overlapping.length > 0) {
    throw new Error(
      `Cannot apply split plan because these files also have unstaged or untracked changes: ${overlapping.join(', ')}`
    )
  }
}

function buildPatchForHunks(hunks: StagedHunk[]): string {
  const byFile = new Map<string, StagedHunk[]>()

  hunks.forEach((hunk) => {
    byFile.set(hunk.filePath, [...(byFile.get(hunk.filePath) || []), hunk])
  })

  return [...byFile.values()]
    .map((fileHunks) => {
      const [firstHunk] = fileHunks
      return formatPatch({
        ...firstHunk.patch,
        hunks: fileHunks.map((hunk) => hunk.hunk),
      })
    })
    .join('\n')
}

async function applyPatchToIndex(
  patch: string,
  git: ReturnType<typeof import('../../lib/simple-git/getRepo').getRepo>
): Promise<void> {
  const cwd = await git.revparse(['--show-toplevel'])

  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['apply', '--cached', '-'], {
      cwd,
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Failed to apply hunk patch to index: ${stderr.trim()}`))
    })

    child.stdin.write(patch)
    child.stdin.end()
  })
}

async function applyCommitSplitPlan({
  plan,
  changes,
  hunkInventory,
  git,
  logger,
  noVerify,
}: {
  plan: CommitSplitPlan
  changes: Awaited<ReturnType<typeof getChanges>>
  hunkInventory: HunkInventory
  git: ReturnType<typeof import('../../lib/simple-git/getRepo').getRepo>
  logger: Logger
  noVerify: boolean
}): Promise<string> {
  validatePlanForStagedFiles(plan, changes.staged, hunkInventory)
  assertNoUnstagedOverlap(plan, changes, hunkInventory)

  await git.raw(['reset'])

  for (const group of plan.groups) {
    const groupFiles = getGroupFiles(group)
    const groupHunks = getGroupHunks(group).map((hunkId) => hunkInventory.byId.get(hunkId))

    if (groupFiles.length > 0) {
      await git.add(groupFiles)
    }

    if (groupHunks.length > 0) {
      const patch = buildPatchForHunks(groupHunks.filter((hunk): hunk is StagedHunk => Boolean(hunk)))
      await applyPatchToIndex(patch, git)
    }

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

  const hunkInventory = await collectHunkInventory(changes.staged, git)
  const summary = await fileChangeParser({
    changes: changes.staged,
    commit: '--staged',
    options: createFileChangeParserOptions({
      command: 'commit',
      tokenizer,
      git,
      llm,
      logger,
      provider: config.service.provider,
      model: String(config.service.model),
      service: config.service,
    }),
  })

  const fileInventory = changes.staged
    .map((change) => `- ${change.filePath}: ${change.status} - ${change.summary}`)
    .join('\n')
  const hunkInventoryText = formatHunkInventory(hunkInventory)

  const plan = await executeChainWithSchema<CommitSplitPlan>(
    CommitSplitPlanSchema,
    llm,
    COMMIT_SPLIT_PROMPT,
    {
      file_inventory: fileInventory,
      hunk_inventory: hunkInventoryText,
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

  validatePlanForStagedFiles(plan, changes.staged, hunkInventory)

  if (argv.apply) {
    return await applyCommitSplitPlan({
      plan,
      changes,
      hunkInventory,
      git,
      logger,
      noVerify: argv.noVerify || config.noVerify || false,
    })
  }

  return formatCommitSplitPlan(plan)
}
