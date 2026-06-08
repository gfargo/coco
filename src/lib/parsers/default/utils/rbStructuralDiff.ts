import { FileDiff } from '../../../types'
import {
  StructuralSymbol,
  summarizeStructuralDiff,
} from './structuralDiff'

/**
 * Ruby structural fast path (#933 phase 2).
 *
 * Recognizes `def` (method, including `def self.name`), `class`,
 * and `module`. Ruby has no static visibility marker at the
 * declaration site, so everything is marked exported: true. We
 * don't track `private`/`protected` state across lines — the LLM
 * is the fallback for nuance.
 *
 * Ruby nests heavily (methods inside classes inside modules), so we
 * accept up to ~8 spaces (2 indent levels) of leading whitespace.
 */

const RB_EXTENSIONS = ['.rb']

export function isRubyFile(path: string): boolean {
  const lower = path.toLowerCase()
  return RB_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function parseRubyStructuralLine(line: string): StructuralSymbol | undefined {
  const trimmed = line.replace(/^[ \t]{0,8}/, '')
  const leftover = trimmed.replace(/^[ \t]+/, '')
  if (leftover !== trimmed) return undefined

  // `def name` / `def self.name` / `def name(args)` / `def name?`.
  const defMatch = trimmed.match(
    /^def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/
  )
  if (defMatch) return { name: defMatch[1], kind: 'method', exported: true }

  // `class Name` — reject `class << self` singleton-class openers.
  const classMatch = trimmed.match(/^class\s+([A-Z]\w*)/)
  if (classMatch) return { name: classMatch[1], kind: 'class', exported: true }

  const moduleMatch = trimmed.match(/^module\s+([A-Z]\w*)/)
  if (moduleMatch) return { name: moduleMatch[1], kind: 'type', exported: true }

  return undefined
}

export function summarizeRubyStructuralDiff(fileDiff: FileDiff): string | undefined {
  if (!isRubyFile(fileDiff.file)) return undefined
  return summarizeStructuralDiff(fileDiff, {
    label: 'Ruby',
    parseLine: parseRubyStructuralLine,
  })
}
