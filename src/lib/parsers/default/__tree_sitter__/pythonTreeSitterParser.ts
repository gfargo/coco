/**
 * Tree-sitter Python structural parser (#933 phase 3).
 *
 * First lazy-loaded language. Mirrors `tsTreeSitterParser.ts` —
 * per-line AST extraction, surrenders gracefully when the .wasm
 * isn't cached so the regex parser handles the fallback.
 *
 * Lazy-load path: the parser surrenders silently when the
 * Python .wasm isn't cached locally. Users opt into the
 * download via `COCO_PREFETCH=py` (or `python`); after that the
 * cached file is reused forever and tree-sitter takes over for
 * `.py` / `.pyi` files.
 *
 * What it catches that the regex doesn't:
 *
 *   - Multi-line function signatures (`def foo(\n  a,\n  b\n):`).
 *     The regex looks at the first line; tree-sitter sees the
 *     full def including its parameter list.
 *   - Decorators attached to their target (the regex skips
 *     decorator lines on the assumption the next def carries
 *     the signal, but loses the chained-decorator nuance).
 *   - Class bodies. The regex extractor refuses to look inside
 *     classes (indented `def` is skipped); tree-sitter could
 *     surface methods on the cursored class.
 *   - String-embedded keywords. Same AST-awareness gain as the
 *     TS extractor.
 *
 * For phase 3 we focus on the parity case (top-level defs +
 * classes) so the lazy-load infrastructure is the load-bearing
 * deliverable. Phase 1.2-style polish (multi-line / decorators /
 * methods) layers on once the infrastructure is proven.
 */

import type { FileDiff } from '../../../types'
import type {
  StructuralParser,
  StructuralParserKind,
} from '../utils/structuralParserRegistry'
import type { StructuralSymbol } from '../utils/structuralDiff'
import { summarizeStructuralDiff } from '../utils/structuralDiff'
import { isPythonFile } from '../utils/pythonStructuralDiff'
import { getTreeSitterParser } from './runtime'

const PARSER_KIND: StructuralParserKind = 'tree-sitter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any

/**
 * Convert a recognized top-level Python AST node into a typed
 * structural symbol. Returns undefined for nodes the regex
 * extractor would also miss (or that we explicitly defer) so
 * the registry chain can fall through cleanly.
 */
function symbolFromTopLevelNode(node: TSNode): StructuralSymbol | undefined {
  if (node.type === 'function_definition') {
    const name = nameOfChild(node, 'name')
    if (!name) return undefined
    return {
      name,
      kind: 'function',
      // Python convention: underscore-prefixed = not public.
      exported: !name.startsWith('_'),
    }
  }

  if (node.type === 'class_definition') {
    const name = nameOfChild(node, 'name')
    if (!name) return undefined
    return {
      name,
      kind: 'class',
      exported: !name.startsWith('_'),
    }
  }

  // Decorated definitions wrap a function_definition or
  // class_definition inside a `decorated_definition` node. The
  // actual definition is one of the named children; recurse.
  if (node.type === 'decorated_definition') {
    const inner = node.namedChildren.find(
      (c: TSNode) => c.type === 'function_definition' || c.type === 'class_definition',
    )
    if (!inner) return undefined
    return symbolFromTopLevelNode(inner)
  }

  // Module-level ALL_CAPS assignments — matches the regex
  // extractor's behavior. `TIMEOUT = 30` etc.
  if (node.type === 'expression_statement') {
    const assignment = node.namedChildren.find((c: TSNode) => c.type === 'assignment')
    if (!assignment) return undefined
    const lhs = assignment.childForFieldName?.('left')
    if (!lhs || lhs.type !== 'identifier') return undefined
    const name = lhs.text
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return undefined
    return { name, kind: 'const', exported: true }
  }

  // PEP 695 type alias: `type Handler = Callable[[str], int]`.
  // Surfaces as a `type_alias_statement` in the Python grammar.
  if (node.type === 'type_alias_statement') {
    const lhs = node.namedChildren.find((c: TSNode) => c.type === 'type')
    const identifier = lhs?.namedChildren?.find((c: TSNode) => c.type === 'identifier')
    if (!identifier) return undefined
    const name = identifier.text
    return { name, kind: 'type', exported: !name.startsWith('_') }
  }

  return undefined
}

function nameOfChild(node: TSNode, fieldName: string): string | undefined {
  const child = node.childForFieldName?.(fieldName)
  return child?.text
}

/**
 * Per-line extractor. Strict module-scope (column-0) only — the
 * regex extractor enforces the same gate and we keep parity for
 * phase 3. Indented lines are body content and get returned as
 * undefined.
 */
function extractSymbolFromLine(parser: TSNode, line: string): StructuralSymbol | undefined {
  if (!line.trim()) return undefined
  if (line.startsWith(' ') || line.startsWith('\t')) return undefined

  let tree: TSNode
  try {
    tree = parser.parse(line)
  } catch {
    return undefined
  }
  if (!tree) return undefined

  const moduleNode = tree.rootNode
  for (const child of moduleNode.namedChildren as TSNode[]) {
    const symbol = symbolFromTopLevelNode(child)
    if (symbol) return symbol
  }
  return undefined
}

export const treeSitterPythonParser: StructuralParser = {
  id: PARSER_KIND,
  async summarize(fileDiff: FileDiff): Promise<string | undefined> {
    if (!isPythonFile(fileDiff.file)) return undefined

    const loaded = await getTreeSitterParser('python')
    if (!loaded) return undefined

    return summarizeStructuralDiff(fileDiff, {
      label: 'Python',
      parseLine: (line) => extractSymbolFromLine(loaded.parser, line),
    })
  },
}
