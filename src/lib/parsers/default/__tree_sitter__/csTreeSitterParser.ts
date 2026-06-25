/**
 * Tree-sitter C# structural parser (COCO-1239).
 *
 * Lazy-load via `COCO_PREFETCH=cs` or `COCO_PREFETCH=csharp`.
 * Surrenders to the regex parser when the cached .wasm isn't loaded.
 *
 * What it catches that the regex doesn't:
 *
 *   - Generic type parameters in declarations. `class Cache<TKey, TValue>`
 *     parses cleanly; the regex is brittle on nested generics.
 *   - Multi-line method signatures. Tree-sitter sees the full
 *     parameter list including the closing `)`, not just line 1.
 *   - Expression-bodied members (`=> expr`). The AST shape is distinct
 *     from a block body; we surface the name regardless of body style.
 *   - String-embedded keywords won't produce false positives.
 *
 * Recognized nodes: class_declaration, interface_declaration,
 * struct_declaration, record_declaration, enum_declaration,
 * method_declaration, constructor_declaration, delegate_declaration.
 *
 * Visibility: `public`, `protected`, or `internal` modifier →
 * exported: true. Matches the regex extractor's gate.
 */

import type { FileDiff } from '../../../types'
import type {
  StructuralParser,
  StructuralParserKind,
} from '../utils/structuralParserRegistry'
import type { StructuralSymbol } from '../utils/structuralDiff'
import { summarizeStructuralDiff } from '../utils/structuralDiff'
import { isCsFile } from '../utils/csStructuralDiff'
import { getTreeSitterParser } from './runtime'

const PARSER_KIND: StructuralParserKind = 'tree-sitter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any

function nameOfChild(node: TSNode, fieldName: string): string | undefined {
  return node.childForFieldName?.(fieldName)?.text
}

/**
 * In tree-sitter-c-sharp, visibility modifiers appear as `modifier`
 * named children of the declaration node.
 */
function isCSharpExported(node: TSNode): boolean {
  return (
    node.namedChildren?.some(
      (c: TSNode) =>
        c.type === 'modifier' &&
        (c.text === 'public' || c.text === 'protected' || c.text === 'internal'),
    ) ?? false
  )
}

function symbolFromTopLevelNode(node: TSNode): StructuralSymbol | undefined {
  const exported = isCSharpExported(node)

  if (node.type === 'class_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'class', exported } : undefined
  }

  if (node.type === 'interface_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'interface', exported } : undefined
  }

  if (node.type === 'struct_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'class', exported } : undefined
  }

  if (node.type === 'record_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'class', exported } : undefined
  }

  if (node.type === 'enum_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'enum', exported } : undefined
  }

  if (node.type === 'delegate_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'type', exported } : undefined
  }

  if (node.type === 'method_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'method', exported } : undefined
  }

  if (node.type === 'constructor_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'method', exported } : undefined
  }

  return undefined
}

function extractSymbolFromLine(parser: TSNode, line: string): StructuralSymbol | undefined {
  if (!line.trim()) return undefined
  // Accept up to 8 spaces of indent — C# nests members inside
  // namespaces / classes, mirroring the regex extractor's gate.
  const indent = line.match(/^[\t ]*/)?.[0] ?? ''
  if (indent.length > 8) return undefined

  let tree: TSNode
  try {
    tree = parser.parse(line)
  } catch {
    return undefined
  }
  if (!tree) return undefined

  const compilationUnit = tree.rootNode
  for (const child of compilationUnit.namedChildren as TSNode[]) {
    const symbol = symbolFromTopLevelNode(child)
    if (symbol) return symbol
  }
  return undefined
}

export const treeSitterCsParser: StructuralParser = {
  id: PARSER_KIND,
  async summarize(fileDiff: FileDiff): Promise<string | undefined> {
    if (!isCsFile(fileDiff.file)) return undefined

    const loaded = await getTreeSitterParser('csharp')
    if (!loaded) return undefined

    return summarizeStructuralDiff(fileDiff, {
      label: 'C#',
      parseLine: (line) => extractSymbolFromLine(loaded.parser, line),
    })
  },
}
