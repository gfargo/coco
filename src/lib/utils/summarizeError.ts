import { homedir } from 'node:os'

/** Default cap for one summarized error, in characters. */
export const DEFAULT_ERROR_SUMMARY_LENGTH = 100

// CSI sequences (colors, cursor moves) and OSC sequences (titles, hyperlinks).
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
// C0 controls and DEL, except tab/newline/carriage return which split lines below.
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const SEVERITY_PREFIX = /^(?:fatal|error|warning):\s*/i

export type SummarizeErrorOptions = {
  /** Used when the error has no message. Defaults to "unknown error". */
  fallback?: string
  /** Hard cap in characters; a longer summary ends in an ellipsis. */
  maxLength?: number
}

/**
 * Reduce an error to one clean, bounded line fit for a status bar (#2166).
 *
 * Raw git and fs errors are multi-line (`fatal: ...` then `hint:` prose), can
 * carry ANSI codes and `\r`, and may name long absolute paths. Shown as-is in
 * a fixed-height footer they overflow it and push any recovery hint out of
 * view. This keeps the first meaningful line, drops the `fatal:` / `error:`
 * prefix, strips control sequences, shortens the home directory to `~`, and
 * caps the length. The full error still belongs in logs and JSON output.
 */
export function summarizeError(error: unknown, options: SummarizeErrorOptions = {}): string {
  const { fallback = 'unknown error', maxLength = DEFAULT_ERROR_SUMMARY_LENGTH } = options
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''

  const lines = raw
    .replace(ANSI_PATTERN, '')
    .replace(CONTROL_PATTERN, '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  // Git's `hint:` lines are advice, not the cause: prefer the first line that is not one.
  const line = lines.find((candidate) => !/^hint:/i.test(candidate)) ?? lines[0]

  let summary = line ?? ''
  while (SEVERITY_PREFIX.test(summary)) summary = summary.replace(SEVERITY_PREFIX, '')
  const home = homedir()
  if (home && home !== '/' && summary.includes(home)) summary = summary.split(home).join('~')
  summary = summary.trim() || fallback

  return summary.length > maxLength ? `${summary.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…` : summary
}
