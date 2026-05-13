import { FileDiff } from '../../../types'
import {
  StructuralSymbol,
  summarizeStructuralDiff,
} from './structuralDiff'

/**
 * Go structural fast path (#883, phase 2).
 *
 * Recognizes top-level declarations: func (incl. method receivers),
 * type X struct / interface, var / const blocks. Exported is set
 * when the identifier starts with an uppercase letter (Go's
 * canonical export marker).
 *
 * Go has no leading indent at file scope and gofmt normalizes
 * the rest, so we keep the indent gate tight: only lines at
 * column 0 are recognized as top-level declarations. Methods on
 * receivers render as `Receiver.method()` to make the surface
 * change readable in the summary.
 */

const GO_EXTENSIONS = ['.go']

export function isGoFile(path: string): boolean {
  const lower = path.toLowerCase()
  return GO_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function isExportedGoName(name: string): boolean {
  // Go exports an identifier when its first character is upper-case
  // ASCII or a Unicode letter that's upper-case. Stick to ASCII —
  // Unicode identifiers exist but are vanishingly rare in idiomatic
  // Go and a misclassification on those is a non-issue.
  const first = name[0]
  return first >= 'A' && first <= 'Z'
}

export function parseGoStructuralLine(line: string): StructuralSymbol | undefined {
  // Top-level only.
  if (line.startsWith(' ') || line.startsWith('\t')) return undefined
  const body = line

  // Methods: `func (r *Receiver) Name(...) ...`
  const methodMatch = body.match(/^func\s*\(\s*\w+\s+\*?(\w+)\s*\)\s+([A-Za-z_][\w]*)/)
  if (methodMatch) {
    const display = `${methodMatch[1]}.${methodMatch[2]}`
    return { name: display, kind: 'method', exported: isExportedGoName(methodMatch[2]) }
  }

  // Plain functions: `func Name(...) ...`
  const fnMatch = body.match(/^func\s+([A-Za-z_][\w]*)\s*\(/)
  if (fnMatch) {
    return { name: fnMatch[1], kind: 'function', exported: isExportedGoName(fnMatch[1]) }
  }

  // type X struct / interface — surface as 'class' / 'interface'
  // respectively to align with how the shared renderer formats them.
  const structMatch = body.match(/^type\s+([A-Za-z_][\w]*)\s+struct\b/)
  if (structMatch) {
    return { name: structMatch[1], kind: 'class', exported: isExportedGoName(structMatch[1]) }
  }
  const interfaceMatch = body.match(/^type\s+([A-Za-z_][\w]*)\s+interface\b/)
  if (interfaceMatch) {
    return { name: interfaceMatch[1], kind: 'interface', exported: isExportedGoName(interfaceMatch[1]) }
  }
  // Other `type Foo = X` / `type Foo X` aliases.
  const typeAliasMatch = body.match(/^type\s+([A-Za-z_][\w]*)\s+/)
  if (typeAliasMatch) {
    return { name: typeAliasMatch[1], kind: 'type', exported: isExportedGoName(typeAliasMatch[1]) }
  }

  // var / const single-line declarations with an identifier. Block
  // forms (`var ( … )`) span multiple lines; we don't attempt to
  // promote the inner names — anything inside the parens is
  // indented, so the indent gate above already skips them.
  const varMatch = body.match(/^(?:var|const)\s+([A-Za-z_][\w]*)\s+/)
  if (varMatch) {
    return { name: varMatch[1], kind: 'const', exported: isExportedGoName(varMatch[1]) }
  }

  return undefined
}

export function summarizeGoStructuralDiff(fileDiff: FileDiff): string | undefined {
  if (!isGoFile(fileDiff.file)) return undefined
  return summarizeStructuralDiff(fileDiff, {
    label: 'Go',
    parseLine: parseGoStructuralLine,
  })
}
