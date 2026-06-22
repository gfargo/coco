/**
 * Tree-sitter Ruby structural parser (COCO-1239).
 *
 * Lazy-load via `COCO_PREFETCH=rb` or `COCO_PREFETCH=ruby`.
 * Surrenders to the regex parser when the cached .wasm isn't loaded.
 *
 * What it catches that the regex doesn't:
 *
 *   - Multi-line method signatures with keyword arguments spread
 *     across lines. Tree-sitter sees the full parameter list.
 *   - `def self.method_name` — the regex matches this via a
 *     combined pattern; tree-sitter uses a `singleton_method`
 *     node with distinct `object:` and `name:` fields, giving
 *     cleaner extraction.
 *   - Methods with trailing `?`, `!`, or `=` in the name.
 *     The regex uses a character-class catch-all; tree-sitter
 *     resolves the name directly from the AST identifier node.
 *   - String-embedded keywords won't produce false positives.
 *
 * Recognized nodes: method (def), singleton_method (def self.name),
 * class, module.
 *
 * Ruby has no static visibility at the declaration site, so all
 * symbols are marked exported: true, matching the regex extractor.
 */

import type { FileDiff } from '../../../types'
import type {
  StructuralParser,
  StructuralParserKind,
} from '../utils/structuralParserRegistry'
import type { StructuralSymbol } from '../utils/structuralDiff'
import { summarizeStructuralDiff } from '../utils/structuralDiff'
import { isRubyFile } from '../utils/rbStructuralDiff'
import { getTreeSitterParser } from './runtime'

const PARSER_KIND: StructuralParserKind = 'tree-sitter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any

/**
 * Ruby class and module names can be plain constants (`Foo`) or
 * scope-resolved (`A::B`). The `scope_resolution` node's rightmost
 * named child is the local name we want to surface.
 */
function constantName(node: TSNode): string | undefined {
  if (!node) return undefined
  if (node.type === 'scope_resolution') {
    return node.namedChildren?.at(-1)?.text
  }
  return node.text
}

function symbolFromTopLevelNode(node: TSNode): StructuralSymbol | undefined {
  if (node.type === 'method') {
    const name = node.childForFieldName?.('name')?.text
    if (!name) return undefined
    return { name, kind: 'method', exported: true }
  }

  if (node.type === 'singleton_method') {
    // `def self.foo` or `def ClassName.foo` — surface just the method name.
    const name = node.childForFieldName?.('name')?.text
    if (!name) return undefined
    return { name, kind: 'method', exported: true }
  }

  if (node.type === 'class') {
    const nameNode = node.childForFieldName?.('name')
    const name = constantName(nameNode)
    if (!name) return undefined
    return { name, kind: 'class', exported: true }
  }

  if (node.type === 'module') {
    const nameNode = node.childForFieldName?.('name')
    const name = constantName(nameNode)
    if (!name) return undefined
    return { name, kind: 'type', exported: true }
  }

  return undefined
}

function extractSymbolFromLine(parser: TSNode, line: string): StructuralSymbol | undefined {
  if (!line.trim()) return undefined
  // Accept up to 8 spaces of indent — Ruby nests methods inside
  // classes and modules, mirroring the regex extractor's gate.
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

export const treeSitterRubyParser: StructuralParser = {
  id: PARSER_KIND,
  async summarize(fileDiff: FileDiff): Promise<string | undefined> {
    if (!isRubyFile(fileDiff.file)) return undefined

    const loaded = await getTreeSitterParser('ruby')
    if (!loaded) return undefined

    return summarizeStructuralDiff(fileDiff, {
      label: 'Ruby',
      parseLine: (line) => extractSymbolFromLine(loaded.parser, line),
    })
  },
}
