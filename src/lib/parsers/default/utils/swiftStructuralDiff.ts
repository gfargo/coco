import { FileDiff } from '../../../types'
import {
  StructuralSymbol,
  summarizeStructuralDiff,
} from './structuralDiff'

/**
 * Swift structural fast path.
 *
 * Recognizes top-level declarations on a single line: `func` (including
 * `static`/`class` methods and generic `func name<T>(`), `class`, `struct`,
 * `enum`, `protocol`, `extension`, and `actor`. Maps each onto the nearest
 * shared symbol kind:
 *   - `struct`    → `type`      (no dedicated struct kind)
 *   - `protocol`  → `interface`
 *   - `extension` → `impl`
 *   - `actor`     → `class`
 *
 * Swift puts attributes (`@objc`, `@MainActor(…)`) and access/behavior
 * modifiers (`public`, `final`, `static`, `class`, …) before the keyword,
 * so we strip those first. `class`/`static` are only stripped when they
 * front a member declaration (`class func`, `static let`) — never a real
 * `class Name`. We mark `private` / `fileprivate` declarations
 * `exported: false` (cosmetic today).
 *
 * Up to ~8 spaces (2 indent levels) of leading whitespace is accepted so
 * nested members register; deeper lines bail to the LLM fallback.
 */

const SWIFT_EXTENSIONS = ['.swift']

// Leading attributes / modifiers stripped before the keyword. `class` and
// `static` are stripped only when they precede a member keyword, so a real
// `class Name` is never mistaken for the `class func`/`class var` modifier.
const SWIFT_MODIFIER =
  /^(?:@[A-Za-z_]\w*(?:\([^)]*\))?|public|private|fileprivate|internal|open|final|override|mutating|nonmutating|required|convenience|lazy|weak|unowned|dynamic|indirect|nonisolated|static|class(?=\s+(?:func|var|let|subscript|init)))\s+/

// Declaration keywords that must never be read as a type name (guards
// against e.g. `class func foo` slipping into the `class Name` matcher).
const SWIFT_DECL_KEYWORDS = new Set([
  'func', 'var', 'let', 'init', 'deinit', 'subscript', 'case', 'associatedtype', 'typealias',
])

export function isSwiftFile(path: string): boolean {
  const lower = path.toLowerCase()
  return SWIFT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function parseSwiftStructuralLine(line: string): StructuralSymbol | undefined {
  const trimmed = line.replace(/^[ \t]{0,8}/, '')
  const leftover = trimmed.replace(/^[ \t]+/, '')
  if (leftover !== trimmed) return undefined

  // Strip leading attributes + modifiers, recording visibility.
  let body = trimmed
  let exported = true
  for (;;) {
    const m = body.match(SWIFT_MODIFIER)
    if (!m) break
    if (/^(?:private|fileprivate)\b/.test(m[0])) exported = false
    body = body.slice(m[0].length)
  }

  // `func name(` / `func name<T>(`.
  const funcMatch = body.match(/^func\s+([A-Za-z_]\w*)\s*[(<]/)
  if (funcMatch) return { name: funcMatch[1], kind: 'function', exported }

  const protocolMatch = body.match(/^protocol\s+([A-Za-z_]\w*)/)
  if (protocolMatch) return { name: protocolMatch[1], kind: 'interface', exported }

  const extensionMatch = body.match(/^extension\s+([A-Za-z_][\w.]*)/)
  if (extensionMatch) return { name: extensionMatch[1], kind: 'impl', exported }

  const enumMatch = body.match(/^(?:indirect\s+)?enum\s+([A-Za-z_]\w*)/)
  if (enumMatch) return { name: enumMatch[1], kind: 'enum', exported }

  const structMatch = body.match(/^struct\s+([A-Za-z_]\w*)/)
  if (structMatch) return { name: structMatch[1], kind: 'type', exported }

  const actorMatch = body.match(/^actor\s+([A-Za-z_]\w*)/)
  if (actorMatch) return { name: actorMatch[1], kind: 'class', exported }

  const classMatch = body.match(/^class\s+([A-Za-z_]\w*)/)
  if (classMatch && !SWIFT_DECL_KEYWORDS.has(classMatch[1])) {
    return { name: classMatch[1], kind: 'class', exported }
  }

  return undefined
}

export function summarizeSwiftStructuralDiff(fileDiff: FileDiff): string | undefined {
  if (!isSwiftFile(fileDiff.file)) return undefined
  return summarizeStructuralDiff(fileDiff, {
    label: 'Swift',
    parseLine: parseSwiftStructuralLine,
  })
}
