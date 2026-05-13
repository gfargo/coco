/**
 * Shared rendering / scaffolding for language-aware structural
 * extractors (#883). Each language module supplies a per-line
 * symbol parser; this module owns the diff walking, the
 * added/removed/updated bucketing, and the summary formatting so
 * the per-language modules stay focused on language-specific
 * recognition.
 */

import { FileDiff } from '../../../types'

export type StructuralSymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'const'
  | 'enum'
  | 'default'
  | 'method'
  | 'impl'
  | 'trait'
  | 'module'

export type StructuralSymbol = {
  /**
   * Display name. For methods on a known receiver, render as
   * `Receiver::name` (Rust) / `Receiver.name` (Python). The
   * per-language parser owns that choice — the shared renderer
   * just prints what it gets.
   */
  name: string
  kind: StructuralSymbolKind
  exported: boolean
}

const MAX_SYMBOLS_PER_BUCKET = 8

export type StructuralLineParser = (line: string) => StructuralSymbol | undefined

export type StructuralDiffSummaryOptions = {
  /** Human label, e.g. "TypeScript" / "Python". Appears in the summary's leading clause. */
  label: string
  /** Per-line parser for this language. */
  parseLine: StructuralLineParser
}

/**
 * Walk a unified diff and emit a templated summary when at least
 * one top-level symbol changes. Returns undefined when the diff
 * has no body changes (caller falls through to nothing) or no
 * structural signals (caller falls through to the LLM so paragraph-
 * only / cosmetic edits keep their full-fidelity summary).
 */
export function summarizeStructuralDiff(
  fileDiff: FileDiff,
  options: StructuralDiffSummaryOptions,
): string | undefined {
  const added = new Map<string, StructuralSymbol>()
  const removed = new Map<string, StructuralSymbol>()
  let addedLines = 0
  let removedLines = 0

  for (const line of fileDiff.diff.split('\n')) {
    if (isPatchHeader(line)) continue
    if (line.startsWith('+')) {
      addedLines++
      const symbol = options.parseLine(line.slice(1))
      if (symbol) added.set(keyOf(symbol), symbol)
    } else if (line.startsWith('-')) {
      removedLines++
      const symbol = options.parseLine(line.slice(1))
      if (symbol) removed.set(keyOf(symbol), symbol)
    }
  }

  if (addedLines === 0 && removedLines === 0) return undefined
  if (added.size === 0 && removed.size === 0) return undefined

  const updatedKeys = new Set([...added.keys()].filter((k) => removed.has(k)))
  const pureAdded = [...added.values()].filter((s) => !updatedKeys.has(keyOf(s)))
  const pureRemoved = [...removed.values()].filter((s) => !updatedKeys.has(keyOf(s)))
  const updated = [...updatedKeys].map((k) => added.get(k) as StructuralSymbol)

  const parts: string[] = [`Updated ${options.label} \`${fileDiff.file}\``]
  if (pureAdded.length) parts.push(`added: ${formatSymbolList(pureAdded)}`)
  if (pureRemoved.length) parts.push(`removed: ${formatSymbolList(pureRemoved)}`)
  if (updated.length) parts.push(`signature change: ${formatSymbolList(updated)}`)
  parts.push(`+${addedLines}/-${removedLines} lines`)

  return `${parts.join('. ')}.`
}

export function isPatchHeader(line: string): boolean {
  return (
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('@@') ||
    line.startsWith('new file mode') ||
    line.startsWith('deleted file mode') ||
    line.startsWith('similarity index') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('Binary files ')
  )
}

function keyOf(symbol: StructuralSymbol): string {
  return `${symbol.kind}:${symbol.name}`
}

function formatSymbolList(symbols: StructuralSymbol[]): string {
  const labeled = symbols.map((s) => formatSymbol(s))
  if (labeled.length <= MAX_SYMBOLS_PER_BUCKET) return labeled.join(', ')
  const shown = labeled.slice(0, MAX_SYMBOLS_PER_BUCKET)
  const remainder = labeled.length - shown.length
  return `${shown.join(', ')} (+${remainder} more)`
}

function formatSymbol(symbol: StructuralSymbol): string {
  // Functions / methods / default-exports read most naturally as
  // `name()`. Everything else gets a kind prefix to disambiguate.
  if (
    symbol.kind === 'function' ||
    symbol.kind === 'default' ||
    symbol.kind === 'method'
  ) {
    return `${symbol.name}()`
  }
  return `${symbol.kind} ${symbol.name}`
}
