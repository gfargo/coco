/**
 * Tree-sitter C / C++ structural parser (COCO-1239).
 *
 * Handles both C (`.c`, `.h`) and C++ (`.cpp`, `.cc`, `.cxx`,
 * `.hpp`, `.hh`, `.hxx`) under the single `cpp` registry key,
 * mirroring the combined regex extractor. For C files the smaller
 * `tree-sitter-c` grammar is tried first; `tree-sitter-cpp` (a
 * superset of C) is the fallback so users who prefetch only C++
 * still get AST parsing for their `.c`/`.h` files.
 *
 * Lazy-load via `COCO_PREFETCH=c` / `COCO_PREFETCH=cpp`. Surrenders
 * to the regex parser when neither grammar is cached.
 *
 * What it catches that the regex doesn't:
 *
 *   - Pointer / reference qualifiers in return types. `int *foo()`
 *     is parsed as a function_definition with a pointer_declarator;
 *     the regex matches the surface text which can confuse the
 *     name extraction.
 *   - Qualified names (`Widget::draw`). The AST exposes `scope:` and
 *     `name:` fields independently, giving cleaner display.
 *   - String-embedded keywords (`"class Fake {}"`) won't trigger.
 *   - Template declarations. `template<typename T> void foo()` —
 *     the inner function_definition is surfaced with its name.
 *
 * Recognized C nodes: function_definition, struct_specifier,
 * enum_specifier, union_specifier, type_definition, preproc_def.
 *
 * Recognized C++ additions: class_specifier, namespace_definition,
 * template_declaration (wrapping the above).
 *
 * Static functions are not exported (translation-unit-local).
 */

import type { FileDiff } from '../../../types'
import type {
  StructuralParser,
  StructuralParserKind,
} from '../utils/structuralParserRegistry'
import type { StructuralSymbol } from '../utils/structuralDiff'
import { summarizeStructuralDiff } from '../utils/structuralDiff'
import { isCppFile } from '../utils/cppStructuralDiff'
import { getTreeSitterParser } from './runtime'

const PARSER_KIND: StructuralParserKind = 'tree-sitter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any

/** C-only extensions — prefer tree-sitter-c over tree-sitter-cpp. */
const C_ONLY_EXT = /\.[ch]$/i

/**
 * Recursively unwrap a declarator chain to find the innermost
 * identifier. Handles pointer_declarator, reference_declarator
 * (C++ refs), and function_declarator nesting.
 *
 * For qualified_identifier (`Widget::draw`), formats as
 * `scope::name` so the display matches the regex extractor.
 */
function nameFromDeclarator(node: TSNode): string | undefined {
  if (!node) return undefined

  switch (node.type) {
    case 'identifier':
    case 'type_identifier':
    case 'field_identifier':
      return node.text

    case 'function_declarator':
      return nameFromDeclarator(node.childForFieldName?.('declarator'))

    case 'pointer_declarator':
    case 'abstract_pointer_declarator':
    case 'reference_declarator':
      return nameFromDeclarator(
        node.childForFieldName?.('declarator') ?? node.namedChildren?.[0],
      )

    case 'qualified_identifier': {
      const scope = node.childForFieldName?.('scope')
      const name = node.childForFieldName?.('name')
      if (scope && name) return `${scope.text}::${name.text}`
      return name?.text
    }

    default:
      return undefined
  }
}

function isStaticStorage(node: TSNode): boolean {
  return node.namedChildren?.some(
    (c: TSNode) => c.type === 'storage_class_specifier' && c.text === 'static',
  ) ?? false
}

function symbolFromTopLevelNode(node: TSNode): StructuralSymbol | undefined {
  if (node.type === 'function_definition') {
    const exported = !isStaticStorage(node)
    const declarator = node.childForFieldName?.('declarator')
    const name = nameFromDeclarator(declarator)
    if (!name) return undefined
    return { name, kind: 'function', exported }
  }

  if (node.type === 'preproc_def') {
    const name = node.childForFieldName?.('name')?.text
    if (!name) return undefined
    return { name, kind: 'const', exported: true }
  }

  if (node.type === 'class_specifier') {
    const name = node.childForFieldName?.('name')?.text
    if (!name) return undefined
    return { name, kind: 'class', exported: true }
  }

  if (node.type === 'struct_specifier' || node.type === 'union_specifier') {
    const name = node.childForFieldName?.('name')?.text
    if (!name) return undefined
    return { name, kind: 'class', exported: true }
  }

  if (node.type === 'enum_specifier') {
    const name = node.childForFieldName?.('name')?.text
    if (!name) return undefined
    return { name, kind: 'enum', exported: true }
  }

  if (node.type === 'namespace_definition') {
    const name = node.childForFieldName?.('name')?.text
    if (!name) return undefined
    return { name, kind: 'type', exported: true }
  }

  // `template<…> class/struct/function` — surface the inner declaration.
  if (node.type === 'template_declaration') {
    const inner = node.namedChildren?.find(
      (c: TSNode) =>
        c.type === 'function_definition' ||
        c.type === 'class_specifier' ||
        c.type === 'struct_specifier',
    )
    return inner ? symbolFromTopLevelNode(inner) : undefined
  }

  // typedef struct / typedef enum
  if (node.type === 'type_definition') {
    const nameNode = node.namedChildren?.at(-1)
    if (!nameNode || nameNode.type !== 'type_identifier') return undefined
    return { name: nameNode.text, kind: 'type', exported: true }
  }

  return undefined
}

function extractSymbolFromLine(parser: TSNode, line: string): StructuralSymbol | undefined {
  if (!line.trim()) return undefined
  // Accept up to 8 spaces of indent — C++ namespaces and classes
  // nest, mirroring the regex extractor's gate.
  const indent = line.match(/^[\t ]*/)?.[0] ?? ''
  if (indent.length > 8) return undefined

  let tree: TSNode
  try {
    tree = parser.parse(line)
  } catch {
    return undefined
  }
  if (!tree) return undefined

  const sourceFile = tree.rootNode
  for (const child of sourceFile.namedChildren as TSNode[]) {
    const symbol = symbolFromTopLevelNode(child)
    if (symbol) return symbol
  }
  return undefined
}

export const treeSitterCCppParser: StructuralParser = {
  id: PARSER_KIND,
  async summarize(fileDiff: FileDiff): Promise<string | undefined> {
    if (!isCppFile(fileDiff.file)) return undefined

    // Prefer tree-sitter-c for .c/.h (smaller grammar, faster load).
    // Fall back to tree-sitter-cpp which is a superset and parses C fine.
    const isCOnly = C_ONLY_EXT.test(fileDiff.file)
    let loaded = isCOnly ? await getTreeSitterParser('c') : undefined
    if (!loaded) {
      loaded = await getTreeSitterParser('cpp')
    }
    if (!loaded) return undefined

    const lp = loaded
    return summarizeStructuralDiff(fileDiff, {
      label: 'C/C++',
      parseLine: (line) => extractSymbolFromLine(lp.parser, line),
    })
  },
}
