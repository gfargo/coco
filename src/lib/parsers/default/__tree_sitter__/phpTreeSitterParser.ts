/**
 * Tree-sitter PHP structural parser (COCO-1239).
 *
 * Lazy-load via `COCO_PREFETCH=php`. Surrenders to the regex parser
 * when the cached .wasm isn't loaded.
 *
 * Grammar note: we use the `tree-sitter-php_only` WASM (stored
 * locally as `tree-sitter-php.wasm`) which parses pure PHP code
 * without the enclosing HTML document. This means diff lines like
 * `public function foo() {` are parsed directly, without needing
 * a leading `<?php` tag.
 *
 * What it catches that the regex doesn't:
 *
 *   - Named arguments and typed parameters spread across multiple
 *     lines. Tree-sitter sees the full parameter list.
 *   - Intersection types and union types in type hints (`A&B`,
 *     `A|B`) which contain `|`/`&` that can confuse regex patterns.
 *   - PHP 8 attributes (`#[Attribute(...)]`) that may span lines;
 *     the regex skips single-line attributes but multi-line ones
 *     could confuse it. The AST separates attribute nodes cleanly.
 *   - String-embedded keywords won't produce false positives.
 *
 * Recognized nodes: function_definition (free functions),
 * method_declaration (class methods), class_declaration,
 * interface_declaration, trait_declaration, enum_declaration.
 *
 * Visibility: `public` or `protected` modifier → exported: true.
 * `private` → exported: false. No modifier (free function) → true.
 */

import type { FileDiff } from '../../../types'
import type {
  StructuralParser,
  StructuralParserKind,
} from '../utils/structuralParserRegistry'
import type { StructuralSymbol } from '../utils/structuralDiff'
import { summarizeStructuralDiff } from '../utils/structuralDiff'
import { isPhpFile } from '../utils/phpStructuralDiff'
import { getTreeSitterParser } from './runtime'

const PARSER_KIND: StructuralParserKind = 'tree-sitter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any

function nameOfChild(node: TSNode, fieldName: string): string | undefined {
  return node.childForFieldName?.(fieldName)?.text
}

/**
 * PHP visibility in tree-sitter-php: `visibility_modifier` children
 * with text `public`, `protected`, or `private`. Free functions have
 * no modifier and default to exported.
 */
function isPhpExported(node: TSNode): boolean {
  const vis = node.namedChildren?.find(
    (c: TSNode) => c.type === 'visibility_modifier',
  )
  if (!vis) return true // free function / no modifier → exported
  return vis.text !== 'private'
}

function symbolFromTopLevelNode(node: TSNode): StructuralSymbol | undefined {
  if (node.type === 'function_definition') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'function', exported: true } : undefined
  }

  if (node.type === 'method_declaration') {
    const name = nameOfChild(node, 'name')
    if (!name) return undefined
    return { name, kind: 'method', exported: isPhpExported(node) }
  }

  if (node.type === 'class_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'class', exported: true } : undefined
  }

  if (node.type === 'interface_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'interface', exported: true } : undefined
  }

  if (node.type === 'trait_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'trait', exported: true } : undefined
  }

  if (node.type === 'enum_declaration') {
    const name = nameOfChild(node, 'name')
    return name ? { name, kind: 'enum', exported: true } : undefined
  }

  return undefined
}

function extractSymbolFromLine(parser: TSNode, line: string): StructuralSymbol | undefined {
  if (!line.trim()) return undefined
  // Accept up to 8 spaces of indent — PHP nests methods inside
  // classes/traits, mirroring the regex extractor's gate.
  const indent = line.match(/^[\t ]*/)?.[0] ?? ''
  if (indent.length > 8) return undefined

  // Skip the opening PHP tag line — it carries no structural symbol.
  if (/^<\?(?:php|=)/i.test(line.trim())) return undefined

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

export const treeSitterPhpParser: StructuralParser = {
  id: PARSER_KIND,
  async summarize(fileDiff: FileDiff): Promise<string | undefined> {
    if (!isPhpFile(fileDiff.file)) return undefined

    const loaded = await getTreeSitterParser('php')
    if (!loaded) return undefined

    return summarizeStructuralDiff(fileDiff, {
      label: 'PHP',
      parseLine: (line) => extractSymbolFromLine(loaded.parser, line),
    })
  },
}
