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
