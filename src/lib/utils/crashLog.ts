import * as fs from 'node:fs'
import * as path from 'node:path'
import { BUILD_VERSION } from '../buildInfo'
import { getCocoCacheDir } from './cocoPaths'

/**
 * Crash records for the workstation (#2206). A render or effect error, or an
 * unhandled rejection, used to end the session with a one-line message and no
 * stack unless `--verbose` was set. This writes the stack to a file in the user
 * cache directory so it can be read, and can save the commit draft that was in
 * progress so a crash does not take it along.
 *
 * Best effort by design: it runs while something else has already gone wrong,
 * so it never throws. The files are owner-only (0600 in a 0700 directory): an
 * error message can quote repository paths, and a draft is the user's own text.
 * Nothing but the error, the build and the platform is recorded: no prompts,
 * diffs, environment or arguments.
 */

export type CrashSource = 'render' | 'unhandledRejection' | 'uncaughtException'

export type CrashRecordInput = {
  source: CrashSource
  error: unknown
  /** React's component stack for a render error. */
  componentStack?: string
  /** A commit message that was being composed, saved beside the log. */
  draft?: string
  /** Test seam. Defaults to the current time. */
  now?: Date
}

export type CrashRecord = {
  logPath?: string
  draftPath?: string
}

/** How many crash logs and saved drafts are kept; the oldest are removed. */
export const CRASH_LOGS_KEPT = 10

export function getCrashLogDir(): string {
  return getCocoCacheDir('crashes')
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`
  try {
    return typeof error === 'string' ? error : JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** The one-line form of an error for a status line or a terminal message. */
export function summarizeError(error: unknown): string {
  const text = error instanceof Error ? error.message || error.name : String(error)
  return text.split('\n')[0].trim() || 'Unknown error'
}

function prune(dir: string, prefix: string): void {
  const names = fs.readdirSync(dir).filter((name) => name.startsWith(prefix)).sort()
  for (const stale of names.slice(0, Math.max(0, names.length - CRASH_LOGS_KEPT))) {
    try {
      fs.unlinkSync(path.join(dir, stale))
    } catch {
      // Already gone.
    }
  }
}

export function writeCrashLog(input: CrashRecordInput): CrashRecord {
  try {
    const dir = getCrashLogDir()
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const when = input.now ?? new Date()
    // Sorts by time, and has no characters a filesystem rejects.
    const stamp = when.toISOString().replace(/[:.]/g, '-')
    const record: CrashRecord = {}

    const lines = [
      `coco ${BUILD_VERSION}`,
      `time:     ${when.toISOString()}`,
      `source:   ${input.source}`,
      `node:     ${process.version}`,
      `platform: ${process.platform} ${process.arch}`,
      '',
      describeError(input.error),
    ]
    if (input.componentStack?.trim()) lines.push('', 'Component stack:', input.componentStack.replace(/^\n+/, ''))
    const logPath = path.join(dir, `crash-${stamp}.log`)
    fs.writeFileSync(logPath, `${lines.join('\n')}\n`, { mode: 0o600 })
    record.logPath = logPath
    prune(dir, 'crash-')

    if (input.draft?.trim()) {
      const draftPath = path.join(dir, `draft-${stamp}.txt`)
      fs.writeFileSync(draftPath, input.draft, { mode: 0o600 })
      record.draftPath = draftPath
      prune(dir, 'draft-')
    }
    return record
  } catch {
    return {}
  }
}
