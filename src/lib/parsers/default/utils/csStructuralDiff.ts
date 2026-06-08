import { FileDiff } from '../../../types'
import {
  StructuralSymbol,
  summarizeStructuralDiff,
} from './structuralDiff'

/**
 * C# structural fast path (#933 phase 2).
 *
 * Recognizes class / interface / struct / record / enum and
 * methods. The "exported" flag tracks `public` / `protected` /
 * `internal` visibility — C#'s public surface markers.
 *
 * C# nests declarations inside namespaces/classes, so we accept up
 * to ~8 spaces (2 indent levels) of leading whitespace.
 */

const CS_EXTENSIONS = ['.cs']

const CS_MODIFIERS =
  /^(?:public|protected|internal|private|static|abstract|sealed|virtual|override|async|partial|readonly|unsafe|extern|new|volatile|ref)\s+/

const CS_CONTROL_FLOW = new Set([
  'if', 'for', 'foreach', 'while', 'switch', 'catch', 'return',
  'do', 'else', 'using', 'lock', 'fixed', 'throw', 'new', 'yield',
])

export function isCsFile(path: string): boolean {
  const lower = path.toLowerCase()
  return CS_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function parseCsStructuralLine(line: string): StructuralSymbol | undefined {
  const trimmed = line.replace(/^[ \t]{0,8}/, '')
  const leftover = trimmed.replace(/^[ \t]+/, '')
  if (leftover !== trimmed) return undefined

  // Attributes sit on their own line — `[Serializable]`.
  if (trimmed.startsWith('[')) return undefined

  let body = trimmed
  let exported = false
  for (;;) {
    const m = body.match(CS_MODIFIERS)
    if (!m) break
    if (
      m[0].startsWith('public') ||
      m[0].startsWith('protected') ||
      m[0].startsWith('internal')
    ) {
      exported = true
    }
    body = body.slice(m[0].length)
  }

  const classMatch = body.match(/^class\s+([A-Za-z_]\w*)/)
  if (classMatch) return { name: classMatch[1], kind: 'class', exported }

  const interfaceMatch = body.match(/^interface\s+([A-Za-z_]\w*)/)
  if (interfaceMatch) return { name: interfaceMatch[1], kind: 'interface', exported }

  const structMatch = body.match(/^struct\s+([A-Za-z_]\w*)/)
  if (structMatch) return { name: structMatch[1], kind: 'class', exported }

  const recordMatch = body.match(/^record\s+(?:class\s+|struct\s+)?([A-Za-z_]\w*)/)
  if (recordMatch) return { name: recordMatch[1], kind: 'class', exported }

  const enumMatch = body.match(/^enum\s+([A-Za-z_]\w*)/)
  if (enumMatch) return { name: enumMatch[1], kind: 'enum', exported }

  // Method: `returnType Name(...)`.
  const methodMatch = body.match(
    /^([A-Za-z_]\w*)[\w<>\[\].,\s?]*\s+([A-Za-z_]\w*)\s*\(/
  )
  if (methodMatch) {
    const returnTypeHead = methodMatch[1]
    const name = methodMatch[2]
    // A control-flow keyword in the return-type slot means this is a
    // statement (`return Foo()`, `throw Bar()`), not a declaration.
    if (CS_CONTROL_FLOW.has(returnTypeHead)) return undefined
    if (CS_CONTROL_FLOW.has(name)) return undefined
    return { name, kind: 'method', exported }
  }

  return undefined
}

export function summarizeCsStructuralDiff(fileDiff: FileDiff): string | undefined {
  if (!isCsFile(fileDiff.file)) return undefined
  return summarizeStructuralDiff(fileDiff, {
    label: 'C#',
    parseLine: parseCsStructuralLine,
  })
}
