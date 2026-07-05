import { PromptTemplate } from '@langchain/core/prompts'
import { spawn } from 'child_process'
import { formatPatch, parsePatch, StructuredPatch, StructuredPatchHunk } from 'diff'
import { Arguments } from 'yargs'
import { Config } from '../../lib/config/types'
import { LLMService } from '../../lib/langchain/types'
import { getLlm } from '../../lib/langchain/utils/getLlm'
import { fileChangeParser } from '../../lib/parsers/default'
import { createFileChangeParserOptions } from '../../lib/parsers/default/utils/createFileChangeParserOptions'
import { PreCommitHookError, createCommit } from '../../lib/simple-git/createCommit'
import { getChanges } from '../../lib/simple-git/getChanges'
import { getCurrentBranchName } from '../../lib/simple-git/getCurrentBranchName'
import { FileChange } from '../../lib/types'
import { hasCommitlintConfig } from '../../lib/utils/hasCommitlintConfig'
import { Logger } from '../../lib/utils/logger'
import { TokenCounter } from '../../lib/utils/tokenizer'
import { confirmPrompt } from '../../lib/ui/inquirerPrompts'
import {
    HookFailureRecoveryChoice,
    promptHookFailureRecovery,
} from '../../lib/ui/hookFailurePrompt'
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
    DuplicateRescueNote,
    formatPlanValidationIssuesError,
    getPlanValidationIssues,
    hasPlanValidationIssues,
} from './splitPlanValidation'

export { CommitSplitPlanSchema }
export type { CommitSplitPlan, CommitSplitGroup }

/**
 * Inline conventional-commits ruleset that gets spliced into the
 * split prompt's `commit_message_rules` slot when the user has
 * conventional commits enabled in config or via `--conventional`.
 *
 * This is the same ruleset used by the regular `coco commit`
 * conventional path (`CONVENTIONAL_TEMPLATE` in `./prompt.ts`),
 * adapted to apply per-group inside the split JSON output: every
 * `title` field in the plan must follow the spec, not just the
 * overall commit message.
 */
const CONVENTIONAL_COMMITS_RULES = `Each group's "title" MUST follow the Conventional Commits 1.0.0 spec:
- Format: <type>(<scope>)<!>: <subject>
- type is one of: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- scope is optional but encouraged when it adds clarity (file/module name)
- "!" before ":" marks a breaking change
- subject is imperative mood, no trailing period, <72 chars
- For breaking changes, the body must include a "BREAKING CHANGE:" footer explaining the break.`

export const COMMIT_SPLIT_PROMPT = PromptTemplate.fromTemplate(`You are helping split staged git changes into a small sequence of coherent commits.

Return ONLY valid JSON matching this schema:
{{
  "groups": [
    {{
      "title": "commit subject line",
      "body": "commit body (optional)",
      "rationale": "why these files belong together (internal; not the commit message)",
      "files": ["relative/path.ts"],
      "hunks": ["relative/path.ts::hunk-1"]
    }}
  ]
}}

Structural rules:
- Every staged file MUST be assigned exactly once across all groups, either via "files" OR via every one of its hunk IDs (never both).
- A SINGLE file is EITHER fully claimed via "files" (its name appears in one group's "files" array) OR fully claimed via "hunks" (every one of its hunk IDs is split across one or more groups). NEVER mix the two modes for the same file. If a file appears in any group's "files" array, that file's hunk IDs MUST NOT appear in any group's "hunks" array.
- If you assign any hunk for a file, you MUST assign EVERY hunk for that file across the groups — partial coverage is invalid.
- Do not list the same file in "files" of more than one group, and do not assign the same hunk ID to more than one group.
- Only use file paths listed in the staged file inventory. Do not invent files.
- Only use hunk IDs LITERALLY copied from the "Staged hunk inventory" section below. Do not invent or guess hunk IDs.
- If the hunk inventory says "No hunk-level inventory available" then EVERY group's "hunks" array MUST be empty (use only "files"). Do not write hunk IDs like "path::hunk-1" when no hunk inventory exists — those are not valid.
- Prefer 2-5 commits unless the changes are truly all one topic.
- Order the groups in the sequence they would logically be built — foundational changes first, consumers after. If group B uses a symbol, function, type, or file introduced in group A, A MUST appear before B in the array. The applier commits in array order, so this order becomes the git history. Example: a "feat: add helpers" group that introduces \`formatX()\` must come before a "feat: wire helpers into renderer" group that calls \`formatX()\`, even if the staged diff is presented in the opposite order. When two groups have no dependency relationship, prefer the one closer to a "scaffold" (types, config, new files) before the one closer to a "use site" (existing files modified to consume the new code).

Commit message style:
- Write each "title" in the imperative mood ("add", not "added"), under 72 chars.
- Avoid phrases like "this commit" / "this change" — refer to functions, variables, or classes by name in backticks.
- "body" is optional; when present, wrap at 72 chars and describe WHY the change exists, not what (the diff shows what).
{commit_message_rules}

{branch_name_context}

{commitlint_rules_context}

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

/**
 * Render the "the model listed this in more than one commit" notes
 * (#1462) captured by `detectDuplicateFileNotes`/`detectDuplicateHunkNotes`.
 * The dedupe rescue silently keeps the FIRST group's claim and drops the
 * rest, which otherwise produces a plan that passes validation cleanly
 * with no hint that a placement was auto-resolved. Uses group TITLES
 * (captured at detection time, before any group could be renumbered or
 * dropped by `dropEmptyGroups`) rather than group index numbers, which
 * can drift from what's actually printed in the final plan.
 */
export function formatDedupeWarnings(notes: DuplicateRescueNote[]): string {
  return notes
    .map((note) => {
      const dropped = note.droppedGroupTitles.join(', ')
      return `⚠ ${note.kind} ${note.id}: kept in "${note.keptGroupTitle}", dropped from "${dropped}" (model listed it in more than one commit)`
    })
    .join('\n')
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

/**
 * Apply-time drift check (#1396). The plan and its validation ran
 * against the snapshot taken at generation time, but `git add <file>`
 * stages whatever is on disk NOW — the workstation holds the plan
 * between preview and `y`-to-apply, and edits made in that window
 * (editor autosave, formatter, another session) would be committed
 * under the reviewed message with no guard firing (the snapshot's
 * `unstaged` list predates them).
 *
 * Scope mirrors `assertNoUnstagedOverlap`: only FILE-mode claims are
 * checked. Hunk-mode groups re-apply the recorded patches to the
 * index (`applyPatchToIndex`), so disk state doesn't feed them.
 *
 * Reads per-file index/working-tree codes from `status().files` — the
 * convenience arrays (`modified` etc.) conflate the two columns, and a
 * cleanly staged file would false-positive as a worktree edit.
 */
async function assertNoStagedDriftSincePlan(
  plan: CommitSplitPlan,
  hunkInventory: HunkInventory,
  git: ReturnType<typeof import('../../lib/simple-git/getRepo').getRepo>
): Promise<void> {
  const hunkFiles = new Set(
    plan.groups.flatMap((group) =>
      getGroupHunks(group)
        .map((hunkId) => hunkInventory.byId.get(hunkId)?.filePath)
        .filter((file): file is string => Boolean(file))
    )
  )
  const fileModeFiles = plan.groups
    .filter((group) => !group.unclaimed)
    .flatMap((group) => getGroupFiles(group))
    .filter((file) => !hunkFiles.has(file))
  if (fileModeFiles.length === 0) {
    return
  }

  const fresh = await git.status()
  const freshStaged = new Set<string>([
    ...fresh.staged,
    ...fresh.created,
    ...fresh.renamed.map((entry) =>
      typeof entry === 'string' ? entry : entry.to
    ),
  ])
  const worktreeEdited = new Set(
    (fresh.files || [])
      .filter((file) => {
        const wd = file.working_dir
        return wd && wd !== ' ' && wd !== '?'
      })
      .map((file) => file.path)
  )

  const unstagedSincePlan = fileModeFiles.filter((file) => !freshStaged.has(file))
  if (unstagedSincePlan.length > 0) {
    throw new Error(
      `Staged changes drifted since the plan was generated — no longer staged: ${unstagedSincePlan.join(', ')}. Regenerate the plan (r) and re-apply.`
    )
  }
  const editedSincePlan = fileModeFiles.filter((file) => worktreeEdited.has(file))
  if (editedSincePlan.length > 0) {
    throw new Error(
      `Files changed on disk since the plan was generated: ${editedSincePlan.join(', ')}. Applying would commit the drifted content under the reviewed message — regenerate the plan (r) and re-apply.`
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
  /**
   * Set when the applied plan was the single-group fallback returned
   * by the planner after exhausting its retry budget. Workstation
   * surfaces should prefix the success message with a fallback note
   * so the user knows the plan wasn't a real LLM split.
   */
  fallback?: import('./splitPlanGenerator').SplitPlanFallbackInfo
}

export async function applyCommitSplitPlan({
  plan,
  changes,
  hunkInventory,
  git,
  logger,
  noVerify,
  fallback,
  onHookFailure,
}: {
  plan: CommitSplitPlan
  changes: Awaited<ReturnType<typeof getChanges>>
  hunkInventory: HunkInventory
  git: ReturnType<typeof import('../../lib/simple-git/getRepo').getRepo>
  logger: Logger
  noVerify: boolean
  /**
   * Optional fallback descriptor from the planner. When set, the
   * returned `CommitSplitApplyResult.fallback` echoes it so the
   * runtime's apply-time success message can prefix a note about
   * the degraded plan.
   */
  fallback?: import('./splitPlanGenerator').SplitPlanFallbackInfo
  /**
   * Optional recovery callback invoked when a group's commit is
   * rejected by a pre-commit hook. Lets interactive CLI callers show
   * the hook output and prompt for retry/skip/abort — the same UX
   * regular `coco commit` already has. Omitted by non-interactive
   * callers (and always by the Workstation/Ink path, which can't run
   * blocking inquirer prompts): without it, a hook failure is simply
   * recorded and the loop moves on to the next group, matching the
   * pre-existing behavior.
   */
  onHookFailure?: (info: { title: string; hookOutput: string }) => Promise<HookFailureRecoveryChoice>
}): Promise<CommitSplitApplyResult> {
  validatePlanForStagedFiles(plan, changes.staged, hunkInventory)
  assertNoUnstagedOverlap(plan, changes, hunkInventory)
  await assertNoStagedDriftSincePlan(plan, hunkInventory, git)

  // Defensive: drop any group with empty files[] AND empty hunks[].
  // `dropEmptyGroups` runs in the generator's rescue chain but we
  // re-filter here so a direct caller (or a future rescue that
  // forgets to compose with dropEmptyGroups) can't hit the
  // "git commit with nothing staged" failure mode mid-loop after
  // the up-front `git reset` has already wiped the index.
  const applicableGroups = plan.groups.filter((group) => {
    // `unclaimed` groups are intentionally NOT committed (#1180): they
    // hold the files the plan couldn't confidently place. The up-front
    // `git reset` below unstages everything, and since these never get
    // re-added they simply stay in the worktree for the user to handle.
    // They still count as "claimed" for validatePlanForStagedFiles, so
    // that check (run above) passes.
    if (group.unclaimed) {
      return false
    }
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

  // The plan was built against the config-filtered staged list
  // (ignoredFiles / ignoredExtensions — lockfiles and sourcemaps by
  // default), but the up-front reset below unstages EVERYTHING. A
  // staged file that no group claims (because the filter hid it from
  // the planner) would silently end up unstaged and absent from every
  // commit — a divergence from regular `coco commit`, which commits
  // the whole index. Capture those paths now so they can be re-staged
  // after the loop, preserving the user's staging intent.
  const stagedBeforeReset = (await git.raw(['diff', '--cached', '--name-only', '-z']))
    .split('\0')
    .filter(Boolean)
  const plannedFiles = new Set<string>()
  for (const group of plan.groups) {
    for (const file of group.files || []) {
      plannedFiles.add(file)
    }
    for (const hunkId of group.hunks || []) {
      const hunk = hunkInventory.byId.get(hunkId)
      if (hunk) {
        plannedFiles.add(hunk.filePath)
      }
    }
  }
  const unplannedStaged = stagedBeforeReset.filter((file) => !plannedFiles.has(file))

  await git.raw(['reset'])

  logger.startSpinner(`Applying ${applicableGroups.length} commits…`)

  const commitHashes: string[] = []
  const failures: { title: string; reason: string; hookOutput?: string }[] = []
  let aborted = false

  // A failed group can leave its files sitting in the index (add
  // succeeded, commit rejected by a hook, patch half-applied, …). The
  // next group's add would then compound on top and its commit would
  // silently absorb the failed group's files under the wrong message.
  const clearIndexAfterFailure = async () => {
    try {
      await git.raw(['reset'])
    } catch {
      // Best-effort — if even reset fails the per-group catch will
      // surface whatever git is unhappy about on the next iteration.
    }
  }

  for (const group of applicableGroups) {
    const groupFiles = getGroupFiles(group)
    const groupHunks = getGroupHunks(group).map((hunkId) => hunkInventory.byId.get(hunkId))
    // Per-group override so "Skip hooks" only bypasses hooks for the
    // group that got stuck, not every remaining group in the plan.
    let groupNoVerify = noVerify

    // Loop so a Retry/Skip choice from `onHookFailure` can re-attempt
    // this same group's add + commit without falling through to the
    // next group.
    while (true) {
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
          break
        }

        // Avoid the literal string "undefined" in the commit body when
        // the LLM omitted the body field — fall back to title-only.
        const body = group.body ? `\n\n${group.body}` : ''
        await createCommit(`${group.title}${body}`.trim(), git, undefined, { noVerify: groupNoVerify })

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
          await clearIndexAfterFailure()
          break
        }
        commitHashes.push(newHead)
        previousHead = newHead
        logger.verbose(`Created split commit ${newHead.slice(0, 8)}: ${group.title}`, { color: 'green' })
        break
      } catch (error) {
        if (error instanceof PreCommitHookError && onHookFailure) {
          await clearIndexAfterFailure()
          const choice = await onHookFailure({ title: group.title, hookOutput: error.hookOutput })

          if (choice === 'retry') {
            continue
          }
          if (choice === 'skip') {
            groupNoVerify = true
            continue
          }

          // abort: stop processing remaining groups, but keep whatever
          // already landed so partial success is preserved and reported.
          failures.push({ title: group.title, reason: error.message, hookOutput: error.hookOutput })
          aborted = true
          break
        }

        failures.push({
          title: group.title,
          reason: error instanceof Error ? error.message : String(error),
          hookOutput: error instanceof PreCommitHookError ? error.hookOutput : undefined,
        })
        await clearIndexAfterFailure()
        break
      }
    }

    if (aborted) {
      break
    }
  }

  // Restore the staging intent for files the plan never saw (filtered
  // out by ignoredFiles / ignoredExtensions before planning). They were
  // staged when the user ran the split; leave them staged so the next
  // status/compose surface shows them instead of silently dropping
  // them into the unstaged pile.
  if (unplannedStaged.length > 0) {
    try {
      await git.raw(['add', '--', ...unplannedStaged])
    } catch {
      // Best-effort — a path may have vanished from disk mid-apply.
    }
  }
  const unplannedNote = unplannedStaged.length > 0
    ? ` ${unplannedStaged.length} staged file(s) the plan excluded by config (e.g. lockfiles) were re-staged — commit them separately.`
    : ''
  const abortedNote = aborted
    ? ' Stopped after the hook failure was aborted — remaining groups were not attempted.'
    : ''

  // If every group failed, throw — there's nothing to recover and
  // the caller needs a clear error path. Partial-success (some
  // groups landed, some failed) is returned with a warning summary
  // so the user keeps the work that did land.
  if (commitHashes.length === 0) {
    logger.stopSpinner('Split apply failed', { mode: 'fail', color: 'red' })
    const detail = failures.map((f) => `  - ${f.title}: ${f.reason}`).join('\n')
    throw new Error(
      `Split apply created zero commits across ${applicableGroups.length} group(s).${abortedNote}\n${detail}`
    )
  }

  if (failures.length > 0) {
    const partial = failures
      .map((f) => `${f.title} (${f.reason.split('\n')[0]})`)
      .join('; ')
    logger.stopSpinner(
      `${commitHashes.length} of ${applicableGroups.length} commits applied`,
      { mode: 'warn', color: 'yellow' }
    )
    return {
      commitHashes,
      message: `Created ${commitHashes.length} of ${applicableGroups.length} planned commit(s). Failed: ${partial}${unplannedNote}${abortedNote}`,
      fallback,
    }
  }

  logger.stopSpinner(
    `${commitHashes.length} commit${commitHashes.length === 1 ? '' : 's'} applied`,
    { mode: 'succeed', color: 'green' }
  )

  return {
    commitHashes,
    message: `Created ${commitHashes.length} split commit(s).${unplannedNote}`,
    fallback,
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
  planLlm,
  planService,
  signal,
}: {
  argv: Arguments<CommitOptions>
  config: Config & CommitOptions
  git: ReturnType<typeof import('../../lib/simple-git/getRepo').getRepo>
  logger: Logger
  tokenizer: TokenCounter
  /**
   * LLM for the diff-summary pre-pass. Typically the regular commit
   * or summarize model.
   */
  llm: ReturnType<typeof getLlm>
  /**
   * Optional dedicated LLM for the structured plan-generation step.
   * Defaults to `llm` when omitted. Wired by `handleCommitSplit` so
   * the `commitSplit` dynamic-model task can floor the planner at a
   * stronger model than the diff summarizer.
   */
  planLlm?: ReturnType<typeof getLlm>
  /** Service descriptor matching `planLlm` (for telemetry metadata). */
  planService?: LLMService
  /**
   * Optional user-cancellation signal — forwarded into the plan
   * generation LLM calls (workstation Esc). The diff-summary pre-pass
   * is not signal-aware yet; a cancel during it takes effect the
   * moment the plan step starts (pre-aborted signal check).
   */
  signal?: AbortSignal
}): Promise<
  | {
      plan: CommitSplitPlan
      context: CommitSplitPlanContext
      /**
       * Set when the planner returned the single-group fallback
       * instead of LLM output. Surfaces in apply / preview UIs so
       * users know to verify the combined commit message (or
       * re-roll the planner for another try).
       */
      fallback?: import('./splitPlanGenerator').SplitPlanFallbackInfo
      /**
       * Set when a dedupe rescue silently dropped a file/hunk
       * placement the model had also put in an earlier group (#1462).
       * Preview / apply UIs should show this alongside the plan so a
       * validation-clean split doesn't hide an auto-resolved placement.
       */
      dedupeWarnings?: DuplicateRescueNote[]
    }
  | { empty: true }
> {
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

  // Pull in the same prompt-context bits the regular `coco commit`
  // path honors so split commits match the user's project conventions:
  //
  //   - Conventional Commits ruleset (when configured) — applied per
  //     group's title field, not just the overall message
  //   - Current branch name (when includeBranchName isn't disabled)
  //     so the model can reference branch-scoped context
  //   - Commitlint rules — when the project has commitlint configured
  //     OR conventional mode is on, the rules get formatted into the
  //     prompt so the model produces titles that pass commitlint
  //     up-front (saves a retry cycle)
  //
  // Temperature / model selection are already inherited because
  // `llm` is `getLlm(provider, model, { service: commitService })`
  // — same instance regular `coco commit` uses.
  const useConventional = Boolean(config.conventionalCommits || argv.conventional)
  const commitMessageRules = useConventional
    ? `\n${CONVENTIONAL_COMMITS_RULES}`
    : ''

  const branchName = await getCurrentBranchName({ git })
  const includeBranchName = argv.includeBranchName !== undefined
    ? argv.includeBranchName
    : config.includeBranchName !== false
  const branchNameContext = includeBranchName && branchName
    ? `Current git branch name: ${branchName}`
    : ''

  let commitlintRulesContext = ''
  const hasCommitLintConfig = await hasCommitlintConfig()
  if (useConventional || hasCommitLintConfig) {
    try {
      const { getCommitlintRulesContext, checkCommitlintAvailability } = await import(
        '../../lib/utils/commitlintValidator'
      )
      const availability = checkCommitlintAvailability()
      if (availability.available) {
        commitlintRulesContext = await getCommitlintRulesContext()
      }
    } catch {
      // Commitlint integration is best-effort — a missing dep or a
      // bad config file shouldn't block the split. The model gets
      // the rules when we can pass them; otherwise it falls back to
      // the conventional-commits ruleset (or generic style).
    }
  }

  const resolvedPlanLlm = planLlm ?? llm
  const resolvedPlanModel = planService?.model ?? config.service.model

  logger.startSpinner('Generating split plan…')

  const { plan, fallback, dedupeWarnings } = await generateValidatedCommitSplitPlan({
    llm: resolvedPlanLlm,
    prompt: COMMIT_SPLIT_PROMPT,
    variables: {
      file_inventory: fileInventory,
      hunk_inventory: hunkInventoryText,
      summary,
      additional_context: argv.additional || '',
      commit_message_rules: commitMessageRules,
      branch_name_context: branchNameContext,
      commitlint_rules_context: commitlintRulesContext,
    },
    staged: changes.staged,
    hunkInventory,
    logger,
    tokenizer,
    metadata: {
      command: 'commit',
      provider: config.service.provider,
      model: String(resolvedPlanModel),
      conventional: useConventional,
    },
    maxAttempts: DEFAULT_MAX_PLAN_ATTEMPTS,
    // Honour `--strict-split` (CLI) or `strictSplit` (config). When set,
    // the planner reverts to the pre-#1005 behaviour of throwing on
    // exhaustion instead of returning the single-group fallback.
    strict: Boolean(argv.strictSplit ?? config.strictSplit),
    signal,
  })

  const groupCount = plan.groups.filter((g) => !g.unclaimed).length
  logger.stopSpinner(
    `Split plan ready (${groupCount} commit${groupCount === 1 ? '' : 's'})`,
    { mode: 'succeed', color: 'green' }
  )

  return { plan, context: { changes, hunkInventory }, fallback, dedupeWarnings }
}

export async function handleCommitSplit({
  argv,
  config,
  git,
  logger,
  tokenizer,
  llm,
  planLlm,
  planService,
  interactive,
}: {
  argv: Arguments<CommitOptions>
  config: Config & CommitOptions
  git: ReturnType<typeof import('../../lib/simple-git/getRepo').getRepo>
  logger: Logger
  tokenizer: TokenCounter
  llm: ReturnType<typeof getLlm>
  planLlm?: ReturnType<typeof getLlm>
  planService?: LLMService
  /**
   * Whether the CLI is running with an interactive prompt UI (matches
   * the caller's `INTERACTIVE` check). Threaded through so a group's
   * pre-commit-hook failure can offer the same Retry / Skip hooks /
   * Abort recovery regular `coco commit` has, and degrade to a
   * one-shot "fix and retry" message with no blocking prompt when
   * there's no TTY to answer it. Defaults to `false`.
   */
  interactive?: boolean
}): Promise<string> {
  const result = await prepareCommitSplitPlan({
    argv,
    config,
    git,
    logger,
    tokenizer,
    llm,
    planLlm,
    planService,
  })

  if ('empty' in result) {
    return 'No staged changes found.'
  }

  const { plan, context, fallback, dedupeWarnings } = result

  const onHookFailure = async ({
    title,
    hookOutput,
  }: {
    title: string
    hookOutput: string
  }): Promise<HookFailureRecoveryChoice> =>
    promptHookFailureRecovery({
      logger,
      header: `✖ Commit blocked by pre-commit hook — group: "${title}"`,
      hookOutput,
      interactive: Boolean(interactive),
    })

  // --plan: print the plan and exit (opt-out from the default apply prompt).
  if (argv.plan) {
    const lines: string[] = []
    if (fallback) {
      lines.push(
        `Note: showing the single-commit fallback plan (${fallback.reason}).`,
        'Re-run with a stronger model or use --strict-split to surface the planner error.',
        ''
      )
    }
    if (dedupeWarnings?.length) {
      lines.push(formatDedupeWarnings(dedupeWarnings), '')
    }
    lines.push(formatCommitSplitPlan(plan))
    return lines.join('\n')
  }

  // --apply: skip the confirmation prompt and apply directly.
  if (argv.apply) {
    const applied = await applyCommitSplitPlan({
      plan,
      changes: context.changes,
      hunkInventory: context.hunkInventory,
      git,
      logger,
      noVerify: argv.noVerify || config.noVerify || false,
      fallback,
      onHookFailure,
    })
    if (applied.fallback) {
      return [
        `Note: applied the single-commit fallback (${applied.fallback.reason}).`,
        applied.message,
      ].join('\n')
    }
    return applied.message
  }

  // Default: show the plan, then prompt the user to apply.
  if (fallback) {
    logger.log(
      `Note: showing the single-commit fallback plan (${fallback.reason}).\n` +
      'Re-run with a stronger model or use --strict-split to surface the planner error.\n'
    )
  }
  if (dedupeWarnings?.length) {
    logger.log(`${formatDedupeWarnings(dedupeWarnings)}\n`)
  }
  logger.log(formatCommitSplitPlan(plan))
  logger.log('') // blank line before the prompt

  const shouldApply = await confirmPrompt({
    message: `Apply these ${plan.groups.filter((g) => !g.unclaimed).length} commits?`,
    default: true,
  })

  if (!shouldApply) {
    return 'Plan saved — re-run with --apply to commit later, or --plan to print again.'
  }

  const applied = await applyCommitSplitPlan({
    plan,
    changes: context.changes,
    hunkInventory: context.hunkInventory,
    git,
    logger,
    noVerify: argv.noVerify || config.noVerify || false,
    fallback,
    onHookFailure,
  })
  if (applied.fallback) {
    return [
      `Note: applied the single-commit fallback (${applied.fallback.reason}).`,
      applied.message,
    ].join('\n')
  }
  return applied.message
}
