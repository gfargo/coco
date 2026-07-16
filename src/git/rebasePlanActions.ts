import { execFile } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { SimpleGit } from 'simple-git'
import { BranchActionResult } from './branchActions'
import { getInProgressOperationType } from './operationData'

/**
 * In-TUI interactive rebase (#1359).
 *
 * The workstation's rebase surface edits a todo list as first-person UI
 * state and this module turns it into a real `git rebase -i` run without
 * ever opening an editor:
 *
 *   - GIT_SEQUENCE_EDITOR is `cp <generated-todo>` so git applies exactly
 *     the plan the user built (git invokes the sequence editor as
 *     `<editor> <todo-path>` through sh, so `cp 'src'` becomes
 *     `cp 'src' <todo-path>` — POSIX sh is present even in Git for
 *     Windows). The rebase itself is spawned via execFile with a scoped
 *     env rather than through simple-git: simple-git's unsafe-editor
 *     protection rejects `-c sequence.editor=` overrides, and mutating
 *     the shared instance's env would leak into every other command.
 *   - GIT_EDITOR is `true`, so `squash` folds messages using git's
 *     prepared concatenation and nothing ever blocks on a prompt;
 *   - `reword` is expressed as `pick` + `exec git commit --amend -F
 *     <message-file>` — the reword text travels via a file, never argv,
 *     so quoting/injection is a non-issue.
 *
 * Conflicts behave like any other rebase: git exits non-zero mid-run,
 * the repo is left in the in-progress state, and the existing conflicts
 * view (`gx`) + continue/abort operations take over.
 */

export type RebaseTodoAction = 'pick' | 'squash' | 'fixup' | 'drop' | 'reword' | 'edit'

export type RebasePlanRow = {
  sha: string
  shortSha: string
  subject: string
  author: string
  date: string
  action: RebaseTodoAction
  /** Replacement subject/body for `reword` rows. */
  newMessage?: string
}

const PLAN_FORMAT = '%H%x1f%h%x1f%an%x1f%ad%x1f%s'

/**
 * Load the todo candidates for rebasing from `base`'s parent: every
 * commit in `base^..HEAD`, oldest first (todo order). Fails cleanly on
 * a root commit — `--root` rebases are out of scope for the surface.
 */
export async function getRebasePlanRows(
  git: SimpleGit,
  baseSha: string
): Promise<{ ok: true; rows: RebasePlanRow[] } | { ok: false; message: string }> {
  try {
    await git.raw(['rev-parse', '--verify', `${baseSha}^`])
  } catch {
    return { ok: false, message: 'Cannot rebase from the root commit.' }
  }

  try {
    const raw = await git.raw([
      'log',
      '--reverse',
      '--date=short',
      `--pretty=format:${PLAN_FORMAT}`,
      `${baseSha}^..HEAD`,
    ])
    const rows = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line): RebasePlanRow => {
        const [sha, shortSha, author, date, subject] = line.split('\x1f')
        return { sha, shortSha, author, date, subject, action: 'pick' }
      })
    if (rows.length === 0) {
      return { ok: false, message: 'No commits between the selected commit and HEAD.' }
    }
    return { ok: true, rows }
  } catch (error) {
    return { ok: false, message: (error as Error).message.split('\n')[0] || 'Failed to load rebase plan.' }
  }
}

export type RebaseTodoBuild =
  | { ok: true; todo: string; rewordMessages: Array<{ sha: string; message: string }> }
  | { ok: false; message: string }

/**
 * Pure todo assembly + validation. Reword rows become `pick` + `exec`
 * pairs (see module header); message files are referenced by a
 * placeholder the executor substitutes once it knows the temp paths.
 */
export function buildRebaseTodo(rows: RebasePlanRow[]): RebaseTodoBuild {
  if (rows.length === 0) {
    return { ok: false, message: 'Rebase plan is empty.' }
  }
  const surviving = rows.filter((row) => row.action !== 'drop')
  if (surviving.length === 0) {
    return { ok: false, message: 'Every commit is dropped — abort the rebase instead.' }
  }
  const firstSurviving = surviving[0]
  if (firstSurviving.action === 'squash' || firstSurviving.action === 'fixup') {
    return { ok: false, message: `The first kept commit (${firstSurviving.shortSha}) has nothing above it to squash into.` }
  }
  for (const row of rows) {
    if (row.action === 'reword' && !row.newMessage?.trim()) {
      return { ok: false, message: `Reword for ${row.shortSha} has no message.` }
    }
  }

  const rewordMessages: Array<{ sha: string; message: string }> = []
  const lines = rows.map((row) => {
    if (row.action === 'drop') {
      return `drop ${row.sha} ${row.subject}`
    }
    if (row.action === 'reword') {
      rewordMessages.push({ sha: row.sha, message: row.newMessage!.trim() })
      return [
        `pick ${row.sha} ${row.subject}`,
        `exec git commit --amend -F {{reword:${row.sha}}}`,
      ].join('\n')
    }
    return `${row.action} ${row.sha} ${row.subject}`
  })
  return { ok: true, todo: `${lines.join('\n')}\n`, rewordMessages }
}

/**
 * Execute the plan. Writes the generated todo (and any reword message
 * files) to a temp dir, points the sequence editor at `cp <todo>`, and
 * runs `git rebase -i <oldest>^`. The temp dir is removed afterwards
 * EXCEPT when the rebase stopped mid-run (conflict / edit) — a pending
 * `exec git commit --amend -F` line may still need its message file, so
 * cleanup would break the continue path.
 */
const execFileAsync = promisify(execFile)

/**
 * Injectable spawn seam for tests. The default runs the real git binary
 * in `cwd` with the scoped editor env merged over the process env.
 */
export type RebaseRunner = (
  args: string[],
  options: { cwd: string; env: Record<string, string | undefined> }
) => Promise<unknown>

const defaultRebaseRunner: RebaseRunner = async (args, options) => {
  try {
    return await execFileAsync('git', args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch (error) {
    // execFile errors lead with the echoed command; git's actual
    // complaint lives on stderr. Re-throw with stderr first so the
    // caller's message extraction reads the real reason.
    const stderr = (error as { stderr?: string }).stderr
    if (typeof stderr === 'string' && stderr.trim()) {
      throw new Error(stderr)
    }
    throw error
  }
}

export async function executeRebasePlan(
  git: SimpleGit,
  rows: RebasePlanRow[],
  runner: RebaseRunner = defaultRebaseRunner
): Promise<BranchActionResult> {
  const operation = await getInProgressOperationType(git)
  if (operation !== 'none') {
    return { ok: false, message: `Finish or abort the in-progress ${operation} first.` }
  }

  const build = buildRebaseTodo(rows)
  if (!build.ok) {
    return { ok: false, message: build.message }
  }

  const dir = mkdtempSync(join(tmpdir(), 'coco-rebase-'))
  let todo = build.todo
  for (const reword of build.rewordMessages) {
    const file = join(dir, `reword-${reword.sha}.txt`)
    writeFileSync(file, `${reword.message}\n`)
    // The exec line runs through sh from the repo root — quote the path.
    todo = todo.replace(`{{reword:${reword.sha}}}`, `'${file}'`)
  }
  const todoFile = join(dir, 'todo')
  writeFileSync(todoFile, todo)

  const keptCount = rows.filter((row) => row.action !== 'drop').length
  try {
    const workdir = (await git.revparse(['--show-toplevel'])).trim()
    await runner(['rebase', '-i', `${rows[0].sha}^`], {
      cwd: workdir,
      env: {
        ...process.env,
        GIT_SEQUENCE_EDITOR: `cp '${todoFile}'`,
        GIT_EDITOR: 'true',
      },
    })
    const postOperation = await getInProgressOperationType(git)
    if (postOperation !== 'none') {
      // Exit 0 doesn't mean done — `edit`/`break` stop the rebase mid-run
      // too. Keep the temp dir: a later `reword` row's `exec ... -F` line
      // still needs its message file on `git rebase --continue`.
      return {
        ok: false,
        message: 'Rebase paused for editing — finish the stopped step, then continue.',
        details: ['Resolve/edit in the conflicts view (gx), then continue — or abort the operation to unwind.'],
      }
    }

    rmSync(dir, { recursive: true, force: true })
    return {
      ok: true,
      message: `Rebase applied — ${keptCount} of ${rows.length} commits kept`,
      details: ['Recovery: `git reflog` holds the pre-rebase HEAD if you need it back.'],
    }
  } catch (error) {
    const lines = (error as Error).message
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const stopped = /CONFLICT|could not apply|Stopped at/i.test((error as Error).message)
    if (!stopped) {
      rmSync(dir, { recursive: true, force: true })
    }
    return {
      ok: false,
      message: stopped
        ? `Rebase stopped: ${lines.find((line) => /CONFLICT|could not apply|Stopped at/i.test(line)) || lines[0]}`
        : lines[0] || 'Rebase failed.',
      details: stopped
        ? ['Resolve in the conflicts view (gx), then continue — or abort the operation to unwind.']
        : lines.slice(1, 5),
    }
  }
}
