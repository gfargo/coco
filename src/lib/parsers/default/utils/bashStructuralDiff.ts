import { FileDiff } from '../../../types'
import {
  StructuralSymbol,
  summarizeStructuralDiff,
} from './structuralDiff'

/**
 * Bash / shell structural fast path.
 *
 * Shell scripts have no classes — only functions, in two forms:
 *   - POSIX:  `name() { … }`  (empty parens)
 *   - ksh/bash keyword:  `function name { … }` / `function name() { … }`
 *
 * Shell has no visibility marker, so every function is `exported: true`.
 * The POSIX form requires *empty* parens (`name()`), which a command or a
 * call never has, so control flow (`if`, `for`, `case …`), assignments
 * (`arr=()`), and subshells (`( … )`) don't false-match. Anything else
 * returns undefined and falls through to the LLM. Up to ~8 spaces of
 * leading whitespace is accepted; deeper lines bail.
 */

const BASH_EXTENSIONS = ['.sh', '.bash']

export function isBashFile(path: string): boolean {
  const lower = path.toLowerCase()
  return BASH_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function parseBashStructuralLine(line: string): StructuralSymbol | undefined {
  const trimmed = line.replace(/^[ \t]{0,8}/, '')
  const leftover = trimmed.replace(/^[ \t]+/, '')
  if (leftover !== trimmed) return undefined

  // `function name { … }` / `function name() { … }`.
  const keywordMatch = trimmed.match(/^function\s+([A-Za-z_][\w:.-]*)\s*(?:\(\s*\))?\s*\{?/)
  if (keywordMatch) return { name: keywordMatch[1], kind: 'function', exported: true }

  // POSIX `name() { … }` — empty parens are required so a call / command
  // (which never has them) can't trip the parser.
  const posixMatch = trimmed.match(/^([A-Za-z_][\w:.-]*)\s*\(\s*\)\s*\{?/)
  if (posixMatch) return { name: posixMatch[1], kind: 'function', exported: true }

  return undefined
}

export function summarizeBashStructuralDiff(fileDiff: FileDiff): string | undefined {
  if (!isBashFile(fileDiff.file)) return undefined
  return summarizeStructuralDiff(fileDiff, {
    label: 'Shell',
    parseLine: parseBashStructuralLine,
  })
}
