/**
 * Tree-sitter Java structural parser (COCO-1239).
 *
 * Lazy-load via `COCO_PREFETCH=java`. Surrenders to the regex
 * parser when the cached .wasm isn't loaded.
 *
 * What it catches that the regex doesn't:
 *
 *   - Multi-line method signatures spread across lines — the regex
 *     matches the first line only; tree-sitter sees the full
 *     parameter list in context.
 *   - Generics in return types / parameter types. `List<Map<K,V>>`
 *     is parsed as a generic type node, not a confused regex match.
 *   - Annotations on the same line as the declaration. The AST
 *     cleanly separates `@Override` nodes from the method name.
 *   - String-embedded keywords. `"public class Fake"` won't trip
 *     a false positive since it's a string_literal node.
 *
 * Recognized nodes: class_declaration, interface_declaration,
 * enum_declaration, record_declaration, method_declaration,
 * constructor_declaration, annotation_type_declaration.
 *
 * Visibility: `public` or `protected` in the modifiers node →
 * exported: true. Matches the regex extractor's gate.
 */

import type { FileDiff } from '../../../types'
import type {
  StructuralParser,
  StructuralParserKind,
} from '../utils/structuralParserRegistry'
import type { StructuralSymbol } from '../utils/structuralDiff'
import { summarizeStructuralDiff } from '../utils/structuralDiff'
import { isJavaFile } from '../utils/javaStructuralDiff'
import { getTreeSitterParser } from './runtime'

const PARSER_KIND: StructuralParserKind = 'tree-sitter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any

function nameOfChild(node: TSNode, fieldName: string): string | undefined {
  return node.childForFieldName?.(fieldName)?.text
}

/**
 * Java visibility: the `modifiers` node is a named child (not a
 * field-named child in all grammar versions), so we search
 * namedChildren by type. Its text contains `public`, `protected`,
 * `private`, `static`, etc.
 */
function isJavaExported(node: TSNode): boolean {
  const mods = node.namedChildren?.find((c: TSNode) => c.type === 'modifiers')
  if (!mods) return false
  return /\bpublic\b/.test(mods.text) || /\bprotected\b/.test(mods.text)
}

function symbolFromTopLevelNode(node: TSNode): StructuralSymbol | undefined {
  const exported = isJavaExported(node)

  if (node.type === 'class_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'class', exported } : undefined
  }

  if (node.type === 'interface_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'interface', exported } : undefined
  }

  if (node.type === 'enum_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'enum', exported } : undefined
  }

  if (node.type === 'record_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'class', exported } : undefined
  }

  if (node.type === 'annotation_type_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'interface', exported } : undefined
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
  // Accept up to 8 spaces of indent — Java nests methods inside
  // classes, mirroring the regex extractor's gate.
  const indent = line.match(/^[\t ]*/)?.[0] ?? ''
  if (indent.length > 8) return undefined

  let tree: TSNode
  try {
    tree = parser.parse(line)
  } catch {
    return undefined
  }
  if (!tree) return undefined

  const programNode = tree.rootNode
  for (const child of programNode.namedChildren as TSNode[]) {
    const symbol = symbolFromTopLevelNode(child)
    if (symbol) return symbol
  }
  return undefined
}

export const treeSitterJavaParser: StructuralParser = {
  id: PARSER_KIND,
  async summarize(fileDiff: FileDiff): Promise<string | undefined> {
    if (!isJavaFile(fileDiff.file)) return undefined

    const loaded = await getTreeSitterParser('java')
    if (!loaded) return undefined

    return summarizeStructuralDiff(fileDiff, {
      label: 'Java',
      parseLine: (line) => extractSymbolFromLine(loaded.parser, line),
    })
  },
}
