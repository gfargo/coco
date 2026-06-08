import { FileDiff } from '../../../types'
import {
  StructuralSymbol,
  summarizeStructuralDiff,
} from './structuralDiff'

/**
 * Java structural fast path (#933 phase 2).
 *
 * Recognizes top-level / member declarations: class / interface /
 * enum / record, and methods. The "exported" flag tracks `public`
 * / `protected` visibility — Java's public surface markers.
 *
 * Java nests declarations inside classes, so unlike Rust we accept
 * up to ~8 spaces (2 indent levels) of leading whitespace. Anything
 * deeper is almost certainly inside a method body.
 */

const JAVA_EXTENSIONS = ['.java']

// Keywords that can precede a declaration and don't change the
// symbol name. `public` / `protected` are pulled out separately to
// set the exported flag; the rest are just stripped.
const JAVA_MODIFIERS =
  /^(?:public|protected|private|static|final|abstract|synchronized|native|strictfp|default|sealed|non-sealed|transient|volatile)\s+/

// Control-flow / statement keywords that look method-like (e.g.
// `if (...)`, `return foo()`) — never structural declarations.
const JAVA_CONTROL_FLOW = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'do',
  'else', 'try', 'finally', 'throw', 'synchronized', 'assert', 'yield',
])

export function isJavaFile(path: string): boolean {
  const lower = path.toLowerCase()
  return JAVA_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function parseJavaStructuralLine(line: string): StructuralSymbol | undefined {
  const trimmed = line.replace(/^[ \t]{0,8}/, '')
  const leftover = trimmed.replace(/^[ \t]+/, '')
  if (leftover !== trimmed) return undefined

  // Annotations sit on their own line — skip them entirely.
  if (trimmed.startsWith('@')) return undefined

  let body = trimmed
  let exported = false
  // Strip leading modifiers, recording public/protected as exported.
  for (;;) {
    const m = body.match(JAVA_MODIFIERS)
    if (!m) break
    if (m[0].startsWith('public') || m[0].startsWith('protected')) exported = true
    body = body.slice(m[0].length)
  }

  const classMatch = body.match(/^class\s+([A-Za-z_$][\w$]*)/)
  if (classMatch) return { name: classMatch[1], kind: 'class', exported }

  const interfaceMatch = body.match(/^interface\s+([A-Za-z_$][\w$]*)/)
  if (interfaceMatch) return { name: interfaceMatch[1], kind: 'interface', exported }

  const enumMatch = body.match(/^enum\s+([A-Za-z_$][\w$]*)/)
  if (enumMatch) return { name: enumMatch[1], kind: 'enum', exported }

  const recordMatch = body.match(/^record\s+([A-Za-z_$][\w$]*)/)
  if (recordMatch) return { name: recordMatch[1], kind: 'class', exported }

  // Method: `returnType name(...)`. The return type may carry
  // generics / arrays. We require the line to look like a signature
  // (a `(` after the name) and reject control-flow keywords in the
  // name position.
  const methodMatch = body.match(
    /^([A-Za-z_$][\w$]*)[\w$<>\[\].,\s?]*\s+([A-Za-z_$][\w$]*)\s*\(/
  )
  if (methodMatch) {
    const returnTypeHead = methodMatch[1]
    const name = methodMatch[2]
    // A control-flow keyword in the return-type slot means this is a
    // statement (`return foo()`, `throw bar()`), not a declaration.
    if (JAVA_CONTROL_FLOW.has(returnTypeHead)) return undefined
    if (JAVA_CONTROL_FLOW.has(name)) return undefined
    return { name, kind: 'method', exported }
  }

  return undefined
}

export function summarizeJavaStructuralDiff(fileDiff: FileDiff): string | undefined {
  if (!isJavaFile(fileDiff.file)) return undefined
  return summarizeStructuralDiff(fileDiff, {
    label: 'Java',
    parseLine: parseJavaStructuralLine,
  })
}
