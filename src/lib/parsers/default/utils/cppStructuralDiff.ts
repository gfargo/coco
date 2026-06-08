import { FileDiff } from '../../../types'
import {
  StructuralSymbol,
  summarizeStructuralDiff,
} from './structuralDiff'

/**
 * C / C++ structural fast path (#933 phase 2). One combined parser
 * for both languages since they share most declaration syntax.
 *
 * Recognizes free functions, `Type::method(...)` definitions,
 * class / struct, enum, namespace, and `#define X`. C/C++ has no
 * single visibility marker at this granularity, so everything is
 * treated as "exported" EXCEPT `static` declarations (translation-
 * unit-local).
 *
 * C++ nests inside namespaces/classes, so we accept up to ~8 spaces
 * (2 indent levels) of leading whitespace.
 */

const CPP_EXTENSIONS = [
  '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx',
]

// Control-flow keywords that look call/declaration-like.
const CPP_CONTROL_FLOW = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof',
  'do', 'else', 'case', 'goto', 'new', 'delete', 'throw',
])

export function isCppFile(path: string): boolean {
  const lower = path.toLowerCase()
  return CPP_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function parseCppStructuralLine(line: string): StructuralSymbol | undefined {
  const trimmed = line.replace(/^[ \t]{0,8}/, '')
  const leftover = trimmed.replace(/^[ \t]+/, '')
  if (leftover !== trimmed) return undefined

  // Preprocessor #define — `#define NAME` (object- or function-like).
  const defineMatch = trimmed.match(/^#\s*define\s+([A-Za-z_]\w*)/)
  if (defineMatch) return { name: defineMatch[1], kind: 'const', exported: true }

  // Other preprocessor directives carry no structural symbol.
  if (trimmed.startsWith('#')) return undefined

  let body = trimmed
  let exported = true
  // Leading `static` makes a definition TU-local (not exported).
  // Strip other benign leading qualifiers so the matchers below see
  // the keyword / return type.
  for (;;) {
    const m = body.match(
      /^(?:static|inline|extern|virtual|explicit|constexpr|friend|template\s*<[^>]*>)\s+/
    )
    if (!m) break
    if (m[0].startsWith('static')) exported = false
    body = body.slice(m[0].length)
  }

  const namespaceMatch = body.match(/^namespace\s+([A-Za-z_]\w*)/)
  if (namespaceMatch) return { name: namespaceMatch[1], kind: 'type', exported }

  const classMatch = body.match(/^class\s+([A-Za-z_]\w*)/)
  if (classMatch) return { name: classMatch[1], kind: 'class', exported }

  // `struct Name {` — require a brace / inheritance / semicolon so
  // we don't match `struct Foo bar;` variable declarations as types.
  const structMatch = body.match(/^struct\s+([A-Za-z_]\w*)\s*(?:[:{]|$)/)
  if (structMatch) return { name: structMatch[1], kind: 'class', exported }

  const enumMatch = body.match(/^enum\s+(?:class\s+|struct\s+)?([A-Za-z_]\w*)/)
  if (enumMatch) return { name: enumMatch[1], kind: 'enum', exported }

  // `Type::method(...)` out-of-line member definition.
  const methodMatch = body.match(
    /^[A-Za-z_][\w<>:*&,\s]*?\b([A-Za-z_]\w*)::([A-Za-z_~]\w*)\s*\(/
  )
  if (methodMatch) {
    return { name: `${methodMatch[1]}::${methodMatch[2]}`, kind: 'method', exported }
  }

  // Free function: `returnType name(...)`. Require a return type
  // token before the name so bare calls (`foo();`) don't match.
  // Reject control-flow keywords in the name slot.
  const fnMatch = body.match(
    /^([A-Za-z_]\w*)[\w<>:*&,\s]*?[\s*&]([A-Za-z_]\w*)\s*\(/
  )
  if (fnMatch) {
    const returnTypeHead = fnMatch[1]
    const name = fnMatch[2]
    // A control-flow keyword in the return-type slot means this is a
    // statement (`return compute()`, `throw err()`), not a definition.
    if (CPP_CONTROL_FLOW.has(returnTypeHead)) return undefined
    if (CPP_CONTROL_FLOW.has(name)) return undefined
    return { name, kind: 'function', exported }
  }

  return undefined
}

export function summarizeCppStructuralDiff(fileDiff: FileDiff): string | undefined {
  if (!isCppFile(fileDiff.file)) return undefined
  return summarizeStructuralDiff(fileDiff, {
    label: 'C/C++',
    parseLine: parseCppStructuralLine,
  })
}
