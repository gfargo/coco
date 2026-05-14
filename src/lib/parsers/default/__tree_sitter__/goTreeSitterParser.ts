/**
 * Tree-sitter Go structural parser (#933 phase 6).
 *
 * Lazy-load via `COCO_PREFETCH=go` (or `golang`). Surrenders when
 * the cached .wasm isn't loaded. Same shape as the Rust + Python
 * parsers from phases 5 + 3.
 *
 * What it catches that the regex doesn't:
 *
 *   - Method receivers expressed via type parameters. The regex
 *     pulls `(r *Receiver)` patterns out of one line; tree-sitter
 *     resolves the full `parameter_declaration → pointer_type →
 *     type_identifier` shape regardless of whitespace / formatting.
 *   - Block-form var/const declarations. `var ( foo = 1 \n bar = 2 \n )`
 *     parses to a `var_declaration` with multiple `var_spec`
 *     children; the regex skips these entirely because it only
 *     recognizes single-line forms.
 *   - String-embedded keywords. AST awareness.
 *
 * Recognized top-level items: function_declaration,
 * method_declaration, type_declaration (struct / interface / alias),
 * var_declaration (single-line + block), const_declaration
 * (single-line + block).
 *
 * Methods render as `Receiver.method` to match the regex
 * extractor's existing convention.
 */

import type { FileDiff } from '../../../types'
import type {
  StructuralParser,
  StructuralParserKind,
} from '../utils/structuralParserRegistry'
import type { StructuralSymbol } from '../utils/structuralDiff'
import { summarizeStructuralDiff } from '../utils/structuralDiff'
import { isGoFile } from '../utils/goStructuralDiff'
import { getTreeSitterParser } from './runtime'

const PARSER_KIND: StructuralParserKind = 'tree-sitter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any

/**
 * Go export convention: first character is uppercase ASCII →
 * exported. The regex extractor uses the same gate; we mirror
 * it for parity.
 */
function isExportedGoName(name: string): boolean {
  const first = name[0]
  return first >= 'A' && first <= 'Z'
}

function nameOfChild(node: TSNode, fieldName: string): string | undefined {
  const child = node.childForFieldName?.(fieldName)
  return child?.text
}

/**
 * Walk a method_declaration's receiver to extract the type name
 * for the `Receiver.method` display. Receiver shape:
 *
 *   receiver: (parameter_list
 *               (parameter_declaration
 *                 name: identifier?
 *                 type: pointer_type | type_identifier))
 *
 * Returns just the bare type name (drops the `*` for pointer
 * receivers).
 */
function receiverTypeName(node: TSNode): string | undefined {
  const receiver = node.childForFieldName?.('receiver')
  if (!receiver) return undefined
  const param = receiver.namedChildren?.find(
    (c: TSNode) => c.type === 'parameter_declaration',
  )
  if (!param) return undefined
  const typeNode = param.childForFieldName?.('type')
  if (!typeNode) return undefined
  if (typeNode.type === 'pointer_type') {
    return typeNode.namedChildren?.[0]?.text
  }
  return typeNode.text
}

/**
 * Pick a meaningful symbol out of a type_declaration. Go has
 * three top-level type shapes that matter to us:
 *   - `type Foo struct { ... }` → class-like
 *   - `type Foo interface { ... }` → interface
 *   - `type Foo = X` / `type Foo Other` → type alias
 *
 * Each appears as a `type_spec` inside the type_declaration.
 */
function symbolFromTypeDeclaration(node: TSNode): StructuralSymbol | undefined {
  const spec = node.namedChildren?.find((c: TSNode) => c.type === 'type_spec' || c.type === 'type_alias')
  if (!spec) return undefined
  const name = nameOfChild(spec, 'name')
  if (!name) return undefined
  const typeNode = spec.childForFieldName?.('type')
  const exported = isExportedGoName(name)
  if (typeNode?.type === 'struct_type') {
    return { name, kind: 'class', exported }
  }
  if (typeNode?.type === 'interface_type') {
    return { name, kind: 'interface', exported }
  }
  return { name, kind: 'type', exported }
}

/**
 * Extract a symbol from a var_declaration or const_declaration —
 * single-line OR block form. The block form wraps multiple
 * var_specs; we surface the first one. Multi-symbol blocks are
 * unusual enough that one summary entry suffices.
 *
 * Both var and const render with the `const` structural kind to
 * mirror the regex extractor's behavior. If we ever want to
 * differentiate them in the summary text, the call sites already
 * pass the discriminator and can be extended without changing
 * this signature.
 */
function symbolFromVarOrConst(node: TSNode): StructuralSymbol | undefined {
  const spec = node.namedChildren?.find(
    (c: TSNode) => c.type === 'var_spec' || c.type === 'const_spec',
  )
  if (!spec) return undefined
  const nameNode = spec.namedChildren?.find((c: TSNode) => c.type === 'identifier')
  if (!nameNode) return undefined
  const name = nameNode.text
  return { name, kind: 'const', exported: isExportedGoName(name) }
}

function symbolFromTopLevelNode(node: TSNode): StructuralSymbol | undefined {
  if (node.type === 'function_declaration') {
    const name = nameOfChild(node, 'name')
    if (!name) return undefined
    return { name, kind: 'function', exported: isExportedGoName(name) }
  }

  if (node.type === 'method_declaration') {
    const methodName = nameOfChild(node, 'name')
    if (!methodName) return undefined
    const receiver = receiverTypeName(node)
    const display = receiver ? `${receiver}.${methodName}` : methodName
    return { name: display, kind: 'method', exported: isExportedGoName(methodName) }
  }

  if (node.type === 'type_declaration') {
    return symbolFromTypeDeclaration(node)
  }

  if (node.type === 'var_declaration' || node.type === 'const_declaration') {
    return symbolFromVarOrConst(node)
  }

  return undefined
}

function extractSymbolFromLine(parser: TSNode, line: string): StructuralSymbol | undefined {
  if (!line.trim()) return undefined
  // Strict module-scope only — Go is gofmt-formatted, no leading
  // indent on top-level declarations.
  if (line.startsWith(' ') || line.startsWith('\t')) return undefined

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

export const treeSitterGoParser: StructuralParser = {
  id: PARSER_KIND,
  async summarize(fileDiff: FileDiff): Promise<string | undefined> {
    if (!isGoFile(fileDiff.file)) return undefined

    const loaded = await getTreeSitterParser('go')
    if (!loaded) return undefined

    return summarizeStructuralDiff(fileDiff, {
      label: 'Go',
      parseLine: (line) => extractSymbolFromLine(loaded.parser, line),
    })
  },
}
