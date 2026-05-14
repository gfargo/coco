/**
 * Tree-sitter TS / TSX / JS structural parser (#933 phase 1.1).
 *
 * Plugs into the structural parser registry as the priority parser
 * for `ts` and `js`. Returns undefined when the .wasm files aren't
 * loaded, surrendering to the regex parser in the chain — the user-
 * facing behavior matches the regex case when tree-sitter is
 * unavailable.
 *
 * What it catches that the regex doesn't:
 *
 *   - Arrow-function exports (`export const foo = () => { }`)
 *     The regex captures `foo` as a `const`; tree-sitter sees the
 *     arrow function value and classifies it as a function so the
 *     summary reads `foo()` instead of `const foo`.
 *   - String-embedded keywords. A line like `const x = "function fake() {}"`
 *     trips the regex into a false positive; tree-sitter knows the
 *     `function` keyword is inside a string literal and skips it.
 *   - JSX-in-TSX. The TSX grammar parses `<Component prop={value} />`
 *     cleanly while the regex would see nothing.
 *
 * What stays the same:
 *
 *   - Output shape — produces the same `StructuralSymbol[]` the
 *     regex parser does, fed through the shared
 *     `summarizeStructuralDiff` scaffolding. Caller sees identical
 *     summary text for cases both extractors handle.
 *   - Per-line operation. We parse each `+` / `-` line as a
 *     standalone snippet. Tree-sitter recovers gracefully from the
 *     incomplete code (missing function body, dangling commas)
 *     because it always returns a partial parse with ERROR nodes
 *     mixed in. Multi-line declarations are NOT yet handled — phase
 *     1.2 will reconstruct the after-state for that. Today the
 *     regex fallback covers any case tree-sitter misses on a single
 *     line.
 */

import type { FileDiff } from '../../../types'
import type {
  StructuralParser,
  StructuralParserKind,
} from '../utils/structuralParserRegistry'
import type { StructuralSymbol } from '../utils/structuralDiff'
import { summarizeStructuralDiff } from '../utils/structuralDiff'
import { detectTsLanguage } from '../utils/tsStructuralDiff'
import { getTreeSitterParser, type TreeSitterLanguageId } from './runtime'

const PARSER_KIND: StructuralParserKind = 'tree-sitter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any

/**
 * Map a coco language identifier (the `'ts'`/`'js'` from the
 * registry) to the tree-sitter grammar to use. TSX files prefer
 * the tsx grammar; everything else uses the typescript grammar
 * (which handles plain JS too — tree-sitter-typescript is a
 * superset).
 */
function grammarFor(filePath: string): TreeSitterLanguageId {
  return filePath.toLowerCase().endsWith('.tsx') ||
    filePath.toLowerCase().endsWith('.jsx')
    ? 'tsx'
    : 'typescript'
}

/**
 * Walk an export_statement / lexical_declaration / function_declaration
 * / class_declaration / interface_declaration / type_alias_declaration
 * / enum_declaration node and produce a `StructuralSymbol` describing
 * it.
 *
 * Returns undefined when the node isn't a recognized top-level
 * declaration kind. The caller falls back to the regex parser via
 * the registry chain in that case.
 */
function symbolFromTopLevelNode(node: TSNode): StructuralSymbol | undefined {
  // `export_statement` wraps the actual declaration. Recurse one
  // level in and tag the result as exported.
  if (node.type === 'export_statement') {
    // `export default` — the declaration may be anonymous.
    if (node.text.startsWith('export default')) {
      return defaultExportSymbol(node)
    }
    const inner = node.namedChildren.find((c: TSNode) => c.type !== 'export_clause')
    if (!inner) return undefined
    const sym = symbolFromTopLevelNode(inner)
    if (!sym) return undefined
    return { ...sym, exported: true }
  }

  if (node.type === 'function_declaration') {
    const name = nameOfChild(node, 'name') || nameOfChild(node, 'identifier')
    if (!name) return undefined
    return { name, kind: 'function', exported: false }
  }

  if (node.type === 'class_declaration') {
    const name = nameOfChild(node, 'name')
    if (!name) return undefined
    return { name, kind: 'class', exported: false }
  }

  if (node.type === 'interface_declaration') {
    const name = nameOfChild(node, 'name')
    if (!name) return undefined
    return { name, kind: 'interface', exported: false }
  }

  if (node.type === 'type_alias_declaration') {
    const name = nameOfChild(node, 'name')
    if (!name) return undefined
    return { name, kind: 'type', exported: false }
  }

  if (node.type === 'enum_declaration') {
    const name = nameOfChild(node, 'name')
    if (!name) return undefined
    return { name, kind: 'enum', exported: false }
  }

  // `lexical_declaration` is `const`/`let` (and `var_declaration`
  // for `var`). Walk to the first variable_declarator. If its value
  // is an arrow function or function expression, classify the
  // binding as a function — this is the marquee improvement over
  // the regex extractor.
  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    const declarator = node.namedChildren.find(
      (c: TSNode) => c.type === 'variable_declarator',
    )
    if (!declarator) return undefined
    const nameNode = declarator.namedChildren.find((c: TSNode) => c.type === 'identifier')
    if (!nameNode) return undefined
    const name = nameNode.text
    const value = declarator.namedChildren.find(
      (c: TSNode) => c.type === 'arrow_function' || c.type === 'function_expression' ||
        c.type === 'function',
    )
    if (value) {
      return { name, kind: 'function', exported: false }
    }
    return { name, kind: 'const', exported: false }
  }

  return undefined
}

function defaultExportSymbol(node: TSNode): StructuralSymbol {
  // `export default function foo` / `export default class Foo`
  // carry an inner declaration whose name we can use; anonymous
  // defaults (`export default function () {}`, `export default {}`)
  // get the literal `default` name. Walk one level in to look.
  const inner = node.namedChildren.find((c: TSNode) => c.type !== 'export_clause')
  if (inner) {
    if (inner.type === 'function_declaration' || inner.type === 'class_declaration') {
      const named = nameOfChild(inner, 'name')
      if (named) return { name: named, kind: 'default', exported: true }
    }
  }
  return { name: 'default', kind: 'default', exported: true }
}

function nameOfChild(node: TSNode, fieldName: string): string | undefined {
  const child = node.childForFieldName?.(fieldName) ||
    node.namedChildren.find((c: TSNode) => c.type === 'identifier' || c.type === 'type_identifier')
  return child?.text
}

/**
 * Per-line extractor. Parses the line as TS source, walks the
 * first-level children, returns the symbol for the first
 * recognized top-level declaration.
 *
 * Tree-sitter's error recovery means a partial line like
 * `export function foo(input: string,` parses cleanly into a
 * function_declaration with the parameters available. We don't
 * fail on incomplete input.
 */
function extractSymbolFromLine(parser: TSNode, line: string): StructuralSymbol | undefined {
  // Empty / whitespace-only — no symbol.
  if (!line.trim()) return undefined
  // Lines starting with whitespace are body lines, not top-level —
  // matches the regex extractor's `leadingIndent > 1` gate. We're
  // strict here so we don't surface method names from inside a
  // class body as if they were top-level functions.
  if (line.startsWith(' ') || line.startsWith('\t')) return undefined

  let tree: TSNode
  try {
    tree = parser.parse(line)
  } catch {
    return undefined
  }
  if (!tree) return undefined

  const program = tree.rootNode
  for (const child of program.namedChildren as TSNode[]) {
    const symbol = symbolFromTopLevelNode(child)
    if (symbol) return symbol
  }
  return undefined
}

/**
 * The actual parser instance. Captures the loaded tree-sitter
 * Parser in a closure so the per-line callback the shared
 * `summarizeStructuralDiff` calls is sync — required because the
 * scaffolding walks the diff synchronously once it has the
 * callback.
 */
export const treeSitterTsParser: StructuralParser = {
  id: PARSER_KIND,
  async summarize(fileDiff: FileDiff): Promise<string | undefined> {
    const language = detectTsLanguage(fileDiff.file)
    if (!language) return undefined

    const loaded = await getTreeSitterParser(grammarFor(fileDiff.file))
    if (!loaded) return undefined

    return summarizeStructuralDiff(fileDiff, {
      label: language === 'ts' ? 'TypeScript' : 'JavaScript',
      parseLine: (line) => extractSymbolFromLine(loaded.parser, line),
    })
  },
}
