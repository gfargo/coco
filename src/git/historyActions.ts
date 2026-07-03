import { execFile, spawn } from 'child_process'
import { SimpleGit } from 'simple-git'
import { BranchActionResult } from './branchActions'
import { getInProgressOperationType } from './operationData'
import { buildProviderUrl, getProviderOverview } from './providerData'

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

export async function copyCommitHash(
  commit: HistoryCommitRef | undefined,
  clipboard: ClipboardRunner = defaultClipboardRunner
): Promise<BranchActionResult> {
  if (!commit) {
    return {
      ok: false,
      message: 'No commit selected.',
    }
  }

  return runAction(
    () => clipboard(commit.hash),
    `Copied commit hash ${commit.shortHash}`
  )
}

export async function copyCommitMessage(
  commit: HistoryCommitRef | undefined,
  clipboard: ClipboardRunner = defaultClipboardRunner
): Promise<BranchActionResult> {
  if (!commit) {
    return {
      ok: false,
      message: 'No commit selected.',
    }
  }

  return runAction(
    () => clipboard(commit.message),
    `Copied commit message ${commit.shortHash}`
  )
}

function normalizeRemoteUrl(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim().replace(/\.git$/, '')
  const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/)

  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`
  }

  // Match the remote URL exactly as the user has configured it in
  // git — including legacy http:// remotes still in use on some
  // self-hosted GitHub Enterprise / GitLab installations. We only
  // pass the URL through; coco never fetches it. Upgrading the user's
  // remote to https isn't our call. DevSkim DS137138 doesn't apply.
  // DevSkim: ignore DS137138
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed
  }

  return undefined
}

export async function getRemoteCommitUrl(
  git: SimpleGit,
  commitHash: string,
  remote = 'origin'
): Promise<string | undefined> {
  try {
    const provider = await getProviderOverview(git)

    if (provider.repository.remote === remote) {
      return buildProviderUrl(provider.repository, {
        type: 'commit',
        commit: commitHash,
      })
    }
  } catch {
    // Fall back to direct remote URL parsing for older mocks and unsupported providers.
  }

  const remoteUrl = await git.raw(['remote', 'get-url', remote])
  const webUrl = normalizeRemoteUrl(remoteUrl)

  return webUrl ? `${webUrl}/commit/${commitHash}` : undefined
}

export async function openCommitOnRemote(
  git: SimpleGit,
  commit: HistoryCommitRef | undefined,
  openUrl: OpenUrlRunner = defaultOpenUrlRunner
): Promise<BranchActionResult> {
  if (!commit) {
    return {
      ok: false,
      message: 'No commit selected.',
    }
  }

  try {
    const url = await getRemoteCommitUrl(git, commit.hash)

    if (!url) {
      return {
        ok: false,
        message: 'Could not infer a web URL for origin.',
      }
    }

    await openUrl(url)

    return {
      ok: true,
      message: `Opened ${commit.shortHash}`,
      details: [url],
    }
  } catch (error) {
    return {
      ok: false,
      message: (error as Error).message,
    }
  }
}

export async function compareCommits(
  git: SimpleGit,
  from: HistoryCommitRef | undefined,
  to: HistoryCommitRef | undefined
): Promise<BranchActionResult> {
  if (!from || !to) {
    return {
      ok: false,
      message: 'Select two commits to compare.',
    }
  }

  try {
    const output = await git.raw(['diff', '--stat', '--color=never', `${from.hash}..${to.hash}`])
    const lines = compactOutputLines(output)

    return {
      ok: true,
      message: `Compared ${from.shortHash}..${to.shortHash}`,
      details: lines.length ? lines.slice(0, 8) : ['No file changes in range.'],
    }
  } catch (error) {
    return {
      ok: false,
      message: (error as Error).message,
    }
  }
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

export function parseReflog(output: string): ReflogEntry[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [selector, hash, subject] = line.split('\x1f')

      return {
        selector,
        hash,
        subject,
      }
    })
}

export async function getReflogEntries(git: SimpleGit, limit = 8): Promise<ReflogEntry[]> {
  return parseReflog(await git.raw([
    'reflog',
    '--date=short',
    `--max-count=${limit}`,
    '--pretty=format:%gd%x1f%h%x1f%gs',
  ]))
}

export const historyActionTestInternals = {
  compactOutputLines,
  getInProgressOperation,
  isHeadCommit,
  normalizeRemoteUrl,
}
