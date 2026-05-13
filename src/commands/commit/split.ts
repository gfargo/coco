import { PromptTemplate } from '@langchain/core/prompts'
import { spawn } from 'child_process'
import { formatPatch, parsePatch, StructuredPatch, StructuredPatchHunk } from 'diff'
import { Arguments } from 'yargs'
import { Config } from '../../lib/config/types'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { fileChangeParser } from '../../lib/parsers/default'
import { createFileChangeParserOptions } from '../../lib/parsers/default/utils/createFileChangeParserOptions'
import { createCommit } from '../../lib/simple-git/createCommit'
import { getChanges } from '../../lib/simple-git/getChanges'
import { FileChange } from '../../lib/types'
import { Logger } from '../../lib/utils/logger'
import { TokenCounter } from '../../lib/utils/tokenizer'
import { CommitOptions } from './config'
import {
  DEFAULT_MAX_PLAN_ATTEMPTS,
  generateValidatedCommitSplitPlan,
} from './splitPlanGenerator'
import {
  CommitSplitGroup,
  CommitSplitPlan,
  CommitSplitPlanSchema,
} from './splitPlanTypes'
import {
  formatPlanValidationIssuesError,
  getPlanValidationIssues,
  hasPlanValidationIssues,
} from './splitPlanValidation'

export { CommitSplitPlanSchema }
export type { CommitSplitPlan, CommitSplitGroup }

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
- Every staged file MUST be assigned exactly once across all groups, either via "files" OR via every one of its hunk IDs (never both).
- A SINGLE file is EITHER fully claimed via "files" (its name appears in one group's "files" array) OR fully claimed via "hunks" (every one of its hunk IDs is split across one or more groups). NEVER mix the two modes for the same file. If a file appears in any group's "files" array, that file's hunk IDs MUST NOT appear in any group's "hunks" array.
- If you assign any hunk for a file, you MUST assign EVERY hunk for that file across the groups — partial coverage is invalid.
- Do not list the same file in "files" of more than one group, and do not assign the same hunk ID to more than one group.
- Only use file paths listed in the staged file inventory. Do not invent files.
- Only use hunk IDs LITERALLY copied from the "Staged hunk inventory" section below. Do not invent or guess hunk IDs.
- If the hunk inventory says "No hunk-level inventory available" then EVERY group's "hunks" array MUST be empty (use only "files"). Do not write hunk IDs like "path::hunk-1" when no hunk inventory exists — those are not valid.
- Prefer 2-5 commits unless the changes are truly all one topic.
- Keep commit titles concise and understandable.

Staged file inventory:
{file_inventory}

Staged hunk inventory:
{hunk_inventory}

Condensed staged diff:
{summary}

Additional context:
{additional_context}

Feedback on previous attempt (fix every item before responding):
{previous_attempt_feedback}`)

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

export type HunkInventory = {
  hunks: StagedHunk[]
  byId: Map<string, StagedHunk>
  byFile: Map<string, StagedHunk[]>
}

/**
 * Snapshot of the staged-state context needed to apply a previously-
 * generated split plan without re-running the plan generator. The
 * workstation flow holds onto this between the plan preview and the
 * `y` to apply, so the executed split matches exactly what the user
 * reviewed — no LLM re-roll between preview and execution.
 */
export type CommitSplitPlanContext = {
  changes: Awaited<ReturnType<typeof getChanges>>
  hunkInventory: HunkInventory
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
  const issues = getPlanValidationIssues(plan, staged, hunkInventory)
  if (hasPlanValidationIssues(issues)) {
    throw new Error(formatPlanValidationIssuesError(issues))
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

/**
 * Result of applying a split plan. Distinguishes the no-op case
 * (`message` only) from the actually-created-commits case
 * (`commitHashes` populated) so the workstation surface can render
 * an accurate "N commits landed" message and skip the post-apply
 * `git rev-list` round-trip.
 */
export type CommitSplitApplyResult = {
  /** SHA of every commit created by this apply, in order. */
  commitHashes: string[]
  /** Human-readable summary, suitable for the CLI handler / status line. */
  message: string
}

export async function applyCommitSplitPlan({
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
}): Promise<CommitSplitApplyResult> {
  validatePlanForStagedFiles(plan, changes.staged, hunkInventory)
  assertNoUnstagedOverlap(plan, changes, hunkInventory)

  // Defensive: drop any group with empty files[] AND empty hunks[].
  // `dropEmptyGroups` runs in the generator's rescue chain but we
  // re-filter here so a direct caller (or a future rescue that
  // forgets to compose with dropEmptyGroups) can't hit the
  // "git commit with nothing staged" failure mode mid-loop after
  // the up-front `git reset` has already wiped the index.
  const applicableGroups = plan.groups.filter((group) => {
    const fileCount = (group.files || []).length
    const hunkCount = (group.hunks || []).length
    return fileCount + hunkCount > 0
  })
  if (applicableGroups.length === 0) {
    throw new Error('Split plan has no applicable groups (every group was empty).')
  }

  // Capture HEAD up-front so we can verify each commit actually
  // advanced the tip — silent no-op commits (empty index, hook
  // returning success without committing, etc.) get caught and
  // surface as a loud error instead of returning a misleading
  // "Created N commits" message when zero commits actually landed.
  let previousHead: string
  try {
    previousHead = (await git.revparse(['HEAD'])).trim()
  } catch (error) {
    // Brand-new repo with no commits — `git revparse HEAD` fails.
    // Use the empty-tree sentinel so the post-commit comparison
    // still detects "no change".
    previousHead = 'EMPTY'
  }

  await git.raw(['reset'])

  const commitHashes: string[] = []
  const failures: { title: string; reason: string }[] = []

  for (const group of applicableGroups) {
    const groupFiles = getGroupFiles(group)
    const groupHunks = getGroupHunks(group).map((hunkId) => hunkInventory.byId.get(hunkId))

    try {
      if (groupFiles.length > 0) {
        await git.add(groupFiles)
      }

      if (groupHunks.length > 0) {
        const patch = buildPatchForHunks(groupHunks.filter((hunk): hunk is StagedHunk => Boolean(hunk)))
        await applyPatchToIndex(patch, git)
      }

      // Sanity-check the staged set before committing — if everything
      // got dropped (e.g. .gitignore filtered all the group's files,
      // or the paths point at things that don't exist on disk), git
      // commit would throw "nothing to commit" mid-loop. Surface a
      // clearer error instead.
      const status = await git.status()
      const stagedAfterAdd = status.staged.length + status.created.length + status.renamed.length
      if (stagedAfterAdd === 0) {
        failures.push({
          title: group.title,
          reason: `git add succeeded but nothing ended up staged — paths may not exist on disk or be gitignored. files=[${groupFiles.join(', ')}]`,
        })
        continue
      }

      // Avoid the literal string "undefined" in the commit body when
      // the LLM omitted the body field — fall back to title-only.
      const body = group.body ? `\n\n${group.body}` : ''
      await createCommit(`${group.title}${body}`.trim(), git, undefined, { noVerify })

      // Verify the commit actually advanced HEAD. Some hooks can
      // exit success without committing (e.g. `--no-verify`-mode
      // hooks misconfigured to skip silently). If HEAD didn't move,
      // we didn't create a commit — record it as a failure instead
      // of returning a misleading success.
      const newHead = (await git.revparse(['HEAD'])).trim()
      if (newHead === previousHead) {
        failures.push({
          title: group.title,
          reason: 'git commit returned success but HEAD did not advance — commit may have been silently skipped',
        })
        continue
      }
      commitHashes.push(newHead)
      previousHead = newHead
      logger.verbose(`Created split commit ${newHead.slice(0, 8)}: ${group.title}`, { color: 'green' })
    } catch (error) {
      failures.push({
        title: group.title,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // If every group failed, throw — there's nothing to recover and
  // the caller needs a clear error path. Partial-success (some
  // groups landed, some failed) is returned with a warning summary
  // so the user keeps the work that did land.
  if (commitHashes.length === 0) {
    const detail = failures.map((f) => `  - ${f.title}: ${f.reason}`).join('\n')
    throw new Error(
      `Split apply created zero commits across ${applicableGroups.length} group(s).\n${detail}`
    )
  }

  if (failures.length > 0) {
    const partial = failures
      .map((f) => `${f.title} (${f.reason.split('\n')[0]})`)
      .join('; ')
    return {
      commitHashes,
      message: `Created ${commitHashes.length} of ${applicableGroups.length} planned commit(s). Failed: ${partial}`,
    }
  }

  return {
    commitHashes,
    message: `Created ${commitHashes.length} split commit(s).`,
  }
}

/**
 * Generate a validated commit split plan against the current staged
 * state. Pure plan generation — no formatting, no apply, no side
 * effects on the index. Returns the structured plan plus the context
 * (`changes` + `hunkInventory`) needed to apply it later via
 * `applyCommitSplitPlan`.
 *
 * Used by:
 *   - `handleCommitSplit` (the CLI handler — formats the plan into
 *     markdown for stdout or applies it directly when `argv.apply`).
 *   - `runCommitSplitPlanWorkflow` (the workstation workflow — returns
 *     the structured plan so the overlay can render it group-by-group
 *     and pass the same plan to apply without re-rolling the LLM).
 *
 * The split between "generate the plan" and "apply the plan" is what
 * lets the workstation guarantee the executed split matches the
 * previewed plan exactly. Re-running the generator between preview
 * and apply would risk drift (small LLM nondeterminism, staged-state
 * changes the user didn't intend, etc.).
 */
export async function prepareCommitSplitPlan({
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
}): Promise<{ plan: CommitSplitPlan; context: CommitSplitPlanContext } | { empty: true }> {
  const changes = await getChanges({
    git,
    options: {
      ignoredFiles: config.ignoredFiles || undefined,
      ignoredExtensions: config.ignoredExtensions || undefined,
    },
  })

  if (changes.staged.length === 0) {
    return { empty: true }
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

  const { plan } = await generateValidatedCommitSplitPlan({
    llm,
    prompt: COMMIT_SPLIT_PROMPT,
    variables: {
      file_inventory: fileInventory,
      hunk_inventory: hunkInventoryText,
      summary,
      additional_context: argv.additional || '',
    },
    staged: changes.staged,
    hunkInventory,
    logger,
    tokenizer,
    metadata: {
      command: 'commit',
      provider: config.service.provider,
      model: String(config.service.model),
    },
    maxAttempts: DEFAULT_MAX_PLAN_ATTEMPTS,
  })

  return { plan, context: { changes, hunkInventory } }
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
  const result = await prepareCommitSplitPlan({ argv, config, git, logger, tokenizer, llm })

  if ('empty' in result) {
    return 'No staged changes found.'
  }

  const { plan, context } = result

  if (argv.apply) {
    const applied = await applyCommitSplitPlan({
      plan,
      changes: context.changes,
      hunkInventory: context.hunkInventory,
      git,
      logger,
      noVerify: argv.noVerify || config.noVerify || false,
    })
    return applied.message
  }

  return formatCommitSplitPlan(plan)
}
