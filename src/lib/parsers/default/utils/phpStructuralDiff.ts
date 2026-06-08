import { FileDiff } from '../../../types'
import {
  StructuralSymbol,
  summarizeStructuralDiff,
} from './structuralDiff'

/**
 * PHP structural fast path (#933 phase 2).
 *
 * Recognizes free `function`, methods inside classes
 * (`[visibility] function name`), and class / interface / trait /
 * enum declarations. The "exported" flag follows PHP visibility:
 * `public` / `protected` / no modifier ⇒ exported; `private` ⇒ not
 * exported.
 *
 * PHP nests methods inside classes, so we accept up to ~8 spaces
 * (2 indent levels) of leading whitespace. The leading `<?php` tag
 * carries no symbol.
 */

const PHP_EXTENSIONS = ['.php']

const PHP_MODIFIERS =
  /^(?:public|protected|private|static|final|abstract|readonly)\s+/

export function isPhpFile(path: string): boolean {
  const lower = path.toLowerCase()
  return PHP_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function parsePhpStructuralLine(line: string): StructuralSymbol | undefined {
  const trimmed = line.replace(/^[ \t]{0,8}/, '')
  const leftover = trimmed.replace(/^[ \t]+/, '')
  if (leftover !== trimmed) return undefined

  // Attributes (PHP 8) sit on their own line — `#[Attribute]`.
  if (trimmed.startsWith('#[')) return undefined

  let body = trimmed
  let exported = true
  let sawFunctionModifier = false
  for (;;) {
    const m = body.match(PHP_MODIFIERS)
    if (!m) break
    if (m[0].startsWith('private')) exported = false
    sawFunctionModifier = true
    body = body.slice(m[0].length)
  }

  // `function name(...)` — a method when preceded by a visibility
  // modifier, otherwise a free function.
  const fnMatch = body.match(/^function\s+&?\s*([A-Za-z_]\w*)\s*\(/)
  if (fnMatch) {
    return {
      name: fnMatch[1],
      kind: sawFunctionModifier ? 'method' : 'function',
      exported,
    }
  }

  const classMatch = body.match(/^class\s+([A-Za-z_]\w*)/)
  if (classMatch) return { name: classMatch[1], kind: 'class', exported: true }

  const interfaceMatch = body.match(/^interface\s+([A-Za-z_]\w*)/)
  if (interfaceMatch) return { name: interfaceMatch[1], kind: 'interface', exported: true }

  const traitMatch = body.match(/^trait\s+([A-Za-z_]\w*)/)
  if (traitMatch) return { name: traitMatch[1], kind: 'trait', exported: true }

  const enumMatch = body.match(/^enum\s+([A-Za-z_]\w*)/)
  if (enumMatch) return { name: enumMatch[1], kind: 'enum', exported: true }

  return undefined
}

export function summarizePhpStructuralDiff(fileDiff: FileDiff): string | undefined {
  if (!isPhpFile(fileDiff.file)) return undefined
  return summarizeStructuralDiff(fileDiff, {
    label: 'PHP',
    parseLine: parsePhpStructuralLine,
  })
}
