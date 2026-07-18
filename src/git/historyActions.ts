import { execFile, spawn } from 'child_process'
import { SimpleGit } from 'simple-git'
import { BranchActionResult } from './branchActions'
import { rejectFlagLike } from './forgeArgGuards'
import { getInProgressOperationType } from './operationData'

function compactOutputLines(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function runAction(action: () => Promise<unknown>, successMessage: string): Promise<BranchActionResult> {
  try {
    await action()

    return {
      ok: true,
      message: successMessage,
    }
  } catch (error) {
    const lines = compactOutputLines((error as Error).message)

    return {
      ok: false,
      message: lines[0] || 'History action failed.',
      details: lines.slice(1, 6),
    }
  }
}

export type ResetMode = 'soft' | 'mixed' | 'hard'

export type HistoryCommitRef = {
  hash: string
  shortHash: string
  message: string
}

export type ReflogEntry = {
  selector: string
  hash: string
  subject: string
}

export type ClipboardRunner = (value: string) => Promise<void>
export type OpenUrlRunner = (url: string) => Promise<void>

function runCommandWithInput(command: string, args: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'ignore', 'ignore'],
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} exited with code ${code}`))
      }
    })
    child.stdin.end(input)
  })
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export async function defaultClipboardRunner(value: string): Promise<void> {
  const commands = process.platform === 'darwin'
    ? [{ command: 'pbcopy', args: [] }]
    : process.platform === 'win32'
      ? [{ command: 'clip', args: [] }]
      : [
        { command: 'wl-copy', args: [] },
        { command: 'xclip', args: ['-selection', 'clipboard'] },
        { command: 'xsel', args: ['--clipboard', '--input'] },
      ]

  const errors: string[] = []

  for (const command of commands) {
    try {
      await runCommandWithInput(command.command, command.args, value)
      return
    } catch (error) {
      errors.push((error as Error).message)
    }
  }

  throw new Error(errors[0] || 'No clipboard command is available.')
}

export async function defaultOpenUrlRunner(url: string): Promise<void> {
  if (process.platform === 'darwin') {
    await runCommand('open', [url])
    return
  }

  if (process.platform === 'win32') {
    await runCommand('cmd', ['/c', 'start', '', url])
    return
  }

  await runCommand('xdg-open', [url])
}

async function isHeadCommit(git: SimpleGit, commitHash: string): Promise<boolean> {
  const head = await git.revparse(['HEAD'])
  const normalizedHead = head.trim()
  const normalizedCommit = commitHash.trim()

  return normalizedHead === normalizedCommit || normalizedHead.startsWith(normalizedCommit)
}

export async function getInProgressOperation(git: SimpleGit): Promise<string | undefined> {
  const operation = await getInProgressOperationType(git)

  return operation === 'none' ? undefined : operation
}

async function guardNoInProgressOperation(git: SimpleGit): Promise<BranchActionResult | undefined> {
  const operation = await getInProgressOperation(git)

  if (!operation) {
    return undefined
  }

  return {
    ok: false,
    message: `Finish or abort the in-progress ${operation} before editing history.`,
  }
}

export async function amendHeadCommit(
  git: SimpleGit,
  selectedCommitHash: string | undefined
): Promise<BranchActionResult> {
  if (!selectedCommitHash || !(await isHeadCommit(git, selectedCommitHash))) {
    return {
      ok: false,
      message: 'Amend is limited to HEAD. Select the latest commit first.',
    }
  }

  return runAction(
    () => git.raw(['commit', '--amend', '--no-edit']),
    'Amended HEAD with staged changes'
  )
}

export async function rewordHeadCommit(
  git: SimpleGit,
  selectedCommitHash: string | undefined,
  message: string
): Promise<BranchActionResult> {
  const trimmedMessage = message.trim()

  if (!selectedCommitHash || !(await isHeadCommit(git, selectedCommitHash))) {
    return {
      ok: false,
      message: 'Reword is limited to HEAD. Select the latest commit first.',
    }
  }

  if (!trimmedMessage) {
    return {
      ok: false,
      message: 'Reword cancelled: empty message.',
    }
  }

  return runAction(
    () => git.raw(['commit', '--amend', '-m', trimmedMessage]),
    'Reworded HEAD commit'
  )
}

export function cherryPickCommit(
  git: SimpleGit,
  commit: HistoryCommitRef | undefined
): Promise<BranchActionResult> {
  if (!commit) {
    return Promise.resolve({
      ok: false,
      message: 'No commit selected.',
    })
  }

  return guardNoInProgressOperation(git).then((blocked) => (
    blocked || runAction(
      () => git.raw(['cherry-pick', commit.hash]),
      `Cherry-picked ${commit.shortHash}`
    )
  ))
}

/**
 * Cherry-pick a contiguous range (#1361 multi-select — history is
 * v-range only, no marks: a range is what "select a run of commits"
 * naturally means, and `git cherry-pick`'s own range syntax already
 * replays them in the right order in one command, so there's no
 * per-item loop to get wrong the way stash drop order was.
 *
 * `oldest^..newest` — `oldest` is chronologically first (deepest in
 * history) in the selected span, `newest` is chronologically last
 * (closest to HEAD); the caller is responsible for that ordering
 * (list display order is newest-first, so this is index-reversed from
 * what's on screen). A conflict stops the sequence exactly like a
 * single cherry-pick conflict — the existing conflict-recovery /
 * continue-operation surfaces handle cherry-pick-in-progress state
 * already, nothing range-specific needed there.
 */
export function cherryPickRange(
  git: SimpleGit,
  oldest: HistoryCommitRef,
  newest: HistoryCommitRef
): Promise<BranchActionResult> {
  if (oldest.hash === newest.hash) {
    return cherryPickCommit(git, newest)
  }

  return guardNoInProgressOperation(git).then((blocked) => (
    blocked || runAction(
      () => git.raw(['cherry-pick', `${oldest.hash}^..${newest.hash}`]),
      `Cherry-picked ${oldest.shortHash}..${newest.shortHash}`
    )
  ))
}

/**
 * Cherry-pick an explicit list of commits (#1670) — used when a v-range
 * span isn't a contiguous ancestor chain (e.g. rows interleaved from
 * other branches by the default `--all` history view), so `oldest^..newest`
 * range syntax would replay real intermediate ancestors the user never
 * saw. `commits` must already be oldest-first (git applies them in the
 * order given); the caller is responsible for reversing display order.
 */
export function cherryPickCommits(
  git: SimpleGit,
  commits: HistoryCommitRef[]
): Promise<BranchActionResult> {
  if (commits.length === 0) {
    return Promise.resolve({ ok: false, message: 'No commit selected.' })
  }
  if (commits.length === 1) {
    return cherryPickCommit(git, commits[0])
  }

  return guardNoInProgressOperation(git).then((blocked) => (
    blocked || runAction(
      () => git.raw(['cherry-pick', ...commits.map((c) => c.hash)]),
      `Cherry-picked ${commits.length} commits`
    )
  ))
}

/**
 * Materialize a single file's contents from a historical commit into the
 * working tree, leaving every other path untouched. Equivalent to
 * `git checkout <sha> -- <path>` for additions/modifications. When the
 * path no longer exists at <sha> (i.e. the commit deleted that file),
 * mirror the deletion in the worktree via `git rm --force`.
 *
 * Important: this overwrites the file in the working tree. The caller
 * is responsible for confirming with the user when the working tree
 * already has uncommitted changes to that path.
 */
export async function checkoutFileFromCommit(
  git: SimpleGit,
  sha: string,
  path: string
): Promise<BranchActionResult> {
  return checkoutOrDeleteFromRef(git, sha, path, sha.slice(0, 7))
}

export async function checkoutOrDeleteFromRef(
  git: SimpleGit,
  ref: string,
  path: string,
  label: string
): Promise<BranchActionResult> {
  // Verify the REF resolves before interpreting a cat-file failure as
  // "path deleted at ref" (#1383). The two failures were conflated: a
  // stale selector (e.g. `stash@{2}` held in workstation state after
  // the stash list changed) fell through to the destructive branch and
  // `git rm --force`d the user's file instead of surfacing the bad
  // revision.
  try {
    await git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  } catch {
    return {
      ok: false,
      message: `${label} no longer resolves — the ref may have changed. Refresh and retry.`,
    }
  }
  const exists = await pathExistsAtRef(git, ref, path)
  if (exists) {
    return runAction(
      () => git.raw(['checkout', ref, '--', path]),
      `Checked out ${path} from ${label}`
    )
  }
  return runAction(
    () => git.raw(['rm', '--force', '--quiet', '--', path]),
    `Removed ${path} (mirrors deletion from ${label})`
  )
}

async function pathExistsAtRef(
  git: SimpleGit,
  ref: string,
  path: string
): Promise<boolean> {
  try {
    await git.raw(['cat-file', '-e', `${ref}:${path}`])
    return true
  } catch {
    return false
  }
}

export function revertCommit(
  git: SimpleGit,
  commit: HistoryCommitRef | undefined
): Promise<BranchActionResult> {
  if (!commit) {
    return Promise.resolve({
      ok: false,
      message: 'No commit selected.',
    })
  }

  return guardNoInProgressOperation(git).then((blocked) => (
    blocked || runAction(
      () => git.raw(['revert', '--no-edit', commit.hash]),
      `Reverted ${commit.shortHash}`
    )
  ))
}

export function isResetMode(value: string): value is ResetMode {
  return ['soft', 'mixed', 'hard'].includes(value)
}

export function resetToCommit(
  git: SimpleGit,
  commit: HistoryCommitRef | undefined,
  mode: ResetMode
): Promise<BranchActionResult> {
  if (!commit) {
    return Promise.resolve({
      ok: false,
      message: 'No commit selected.',
    })
  }

  return guardNoInProgressOperation(git).then((blocked) => (
    blocked || runAction(
      () => git.raw(['reset', `--${mode}`, commit.hash]),
      `Reset current branch to ${commit.shortHash} with --${mode}`
    )
  )).then((result) => ({
    ...result,
    details: result.ok
      ? [
        'Recovery: use `git reflog` to find the previous HEAD.',
        'Then run `git reset --hard HEAD@{n}` if you need to undo this reset.',
      ]
      : result.details,
  }))
}

/**
 * Create a new local branch pointed at <commit>, without switching to it.
 *
 * This is the "create branch from cursored commit" history action — the
 * user types the new branch name into an input prompt and we run
 * `git branch <name> <sha>` (NOT `git switch -c`, which is what
 * `branchActions.createBranch` does for the create-branch-at-HEAD flow).
 * The split exists because GitKraken-style "create branch here" is
 * specifically about marking a historical commit, not about switching
 * onto a new working branch.
 *
 * Note for the inspector follow-up: workflow surfacing is driven by the
 * registry in `inkWorkflows.ts`, not a hardcoded action list — adding
 * `create-branch-here` there is enough for the inspector / palette to
 * pick this up.
 */
export function createBranchFromCommit(
  git: SimpleGit,
  name: string,
  commit: Pick<HistoryCommitRef, 'hash' | 'shortHash'> | undefined
): Promise<BranchActionResult> {
  const trimmedName = name.trim()

  if (!commit) {
    return Promise.resolve({
      ok: false,
      message: 'No commit selected.',
    })
  }

  if (!trimmedName) {
    return Promise.resolve({
      ok: false,
      message: 'Branch name required.',
    })
  }

  const nameError = rejectFlagLike(trimmedName, `Branch name '${trimmedName}'`)
  if (nameError) return Promise.resolve({ ok: false, message: nameError })

  return guardNoInProgressOperation(git).then((blocked) => (
    blocked || runAction(
      () => git.raw(['branch', trimmedName, commit.hash]),
      `Created branch ${trimmedName} at ${commit.shortHash}`
    )
  ))
}

/**
 * Create a lightweight tag pointed at <commit>.
 *
 * Mirrors `createBranchFromCommit` for the tag side: the user types a
 * tag name into an input prompt and we run `git tag <name> <sha>`
 * (lightweight, no `-a`/`-m`). Annotated tags remain available through
 * the existing `+` flow on the tags view; this is the per-commit
 * shortcut.
 */
export function createTagAtCommit(
  git: SimpleGit,
  name: string,
  commit: Pick<HistoryCommitRef, 'hash' | 'shortHash'> | undefined
): Promise<BranchActionResult> {
  const trimmedName = name.trim()

  if (!commit) {
    return Promise.resolve({
      ok: false,
      message: 'No commit selected.',
    })
  }

  if (!trimmedName) {
    return Promise.resolve({
      ok: false,
      message: 'Tag name required.',
    })
  }

  const nameError = rejectFlagLike(trimmedName, `Tag name '${trimmedName}'`)
  if (nameError) return Promise.resolve({ ok: false, message: nameError })

  return guardNoInProgressOperation(git).then((blocked) => (
    blocked || runAction(
      () => git.raw(['tag', trimmedName, commit.hash]),
      `Created tag ${trimmedName} at ${commit.shortHash}`
    )
  ))
}

/**
 * `git commit --fixup=<sha>` from the currently staged changes. The
 * caller pre-checks that something is staged (the runtime handler has
 * the worktree counts); git's own "nothing added" error still surfaces
 * as a fallback. Non-destructive — it's an ordinary commit whose
 * message marks it for a later autosquash.
 */
export function createFixupCommit(
  git: SimpleGit,
  commit: HistoryCommitRef | undefined
): Promise<BranchActionResult> {
  if (!commit) {
    return Promise.resolve({
      ok: false,
      message: 'No commit selected.',
    })
  }

  return guardNoInProgressOperation(git).then((blocked) => (
    blocked || runAction(
      () => git.raw(['commit', '--fixup', commit.hash]),
      `Created fixup for ${commit.shortHash} — will squash on the next autosquash rebase`
    )
  ))
}

/**
 * `git rebase -i --autosquash <target>^` with the sequence editor
 * disabled (`-c sequence.editor=true`), so git applies the generated
 * todo — fixups folded into their targets — without ever opening an
 * editor. `-c` keeps the override scoped to this one invocation instead
 * of mutating the shared SimpleGit env (which would silently break the
 * user-facing `i` interactive rebase). Fixup entries reuse the target's
 * message, so $GIT_EDITOR is never opened either.
 */
export function autosquashRebase(
  git: SimpleGit,
  commit: HistoryCommitRef | undefined
): Promise<BranchActionResult> {
  if (!commit) {
    return Promise.resolve({
      ok: false,
      message: 'No fixup target to squash into.',
    })
  }

  return guardNoInProgressOperation(git).then((blocked) => (
    blocked || runAction(
      () => git.raw(['-c', 'sequence.editor=true', 'rebase', '-i', '--autosquash', `${commit.hash}^`]),
      `Autosquashed fixups into ${commit.shortHash}`
    )
  )).then((result) => ({
    ...result,
    details: result.ok
      ? ['Recovery: `git reflog` holds the pre-rebase HEAD if you need it back.']
      : result.details,
  }))
}

export function startInteractiveRebase(
  git: SimpleGit,
  commit: HistoryCommitRef | undefined
): Promise<BranchActionResult> {
  if (!commit) {
    return Promise.resolve({
      ok: false,
      message: 'No commit selected.',
    })
  }

  return guardNoInProgressOperation(git).then((blocked) => (
    blocked || runAction(
      () => git.raw(['rebase', '-i', `${commit.hash}^`]),
      `Started interactive rebase from ${commit.shortHash}`
    )
  )).then((result) => ({
    ...result,
    details: result.ok
      ? [
        'Recovery: use `git rebase --abort` while the rebase is in progress.',
        'After completion, use `git reflog` to recover the previous HEAD if needed.',
      ]
      : result.details,
  }))
}

export const historyActionTestInternals = {
  compactOutputLines,
  getInProgressOperation,
  isHeadCommit,
}
