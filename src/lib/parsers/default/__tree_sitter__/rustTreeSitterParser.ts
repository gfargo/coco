/**
 * Tree-sitter Rust structural parser (#933 phase 5).
 *
 * Mirrors the Python parser from phase 3 — per-line AST extraction,
 * lazy-load via `COCO_PREFETCH=rs` (or `rust`), surrenders to the
 * regex parser when the cached .wasm isn't loaded.
 *
 * What it catches that the regex doesn't:
 *
 *   - Visibility-modifier variants beyond the simple `pub`. Tree-
 *     sitter sees `pub(crate)`, `pub(super)`, `pub(in path)` as
 *     `visibility_modifier` nodes regardless of inner form; the
 *     regex hand-codes the patterns.
 *   - Generic parameters on impl blocks. `impl<T: Trait> Widget<T>`
 *     parses to an `impl_item` with type_arguments; the regex
 *     extractor matches the surface text but is brittle on
 *     nested generics with commas.
 *   - String-embedded keywords. AST-aware — `"pub fn fake() {}"`
 *     inside a string literal doesn't trip a false positive.
 *   - Const-fn / async-fn / unsafe-fn / extern-fn variants. The
 *     `function_item` node carries `modifiers` we can recognize
 *     without rebuilding the regex for each combination.
 *
 * Recognized top-level items: function_item, struct_item,
 * enum_item, trait_item, impl_item (with optional `trait: for type`),
 * type_item (type aliases), const_item / static_item (ALL_CAPS),
 * mod_item.
 *
 * Parity with the regex extractor today; richer features (signature
 * deltas, generic constraint surface) land as polish.
 */

import type { FileDiff } from '../../../types'
import type {
  StructuralParser,
  StructuralParserKind,
} from '../utils/structuralParserRegistry'
import type { StructuralSymbol } from '../utils/structuralDiff'
import { summarizeStructuralDiff } from '../utils/structuralDiff'
import { isRustFile } from '../utils/rustStructuralDiff'
import { getTreeSitterParser } from './runtime'

const PARSER_KIND: StructuralParserKind = 'tree-sitter'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSNode = any

function hasVisibilityModifier(node: TSNode): boolean {
  return Boolean(
    node.namedChildren?.find((c: TSNode) => c.type === 'visibility_modifier'),
  )
}

function nameOfTypeIdentifier(node: TSNode): string | undefined {
  const child = node.childForFieldName?.('name')
  return child?.text
}

/**
 * Resolve an impl_item's display name. Two shapes:
 *
 *   - `impl Widget { ... }`         → just `Widget`
 *   - `impl Renderable for Widget`  → `Renderable for Widget`
 *
 * tree-sitter exposes both `trait:` (optional) and `type:` fields.
 */
function formatImplName(node: TSNode): string | undefined {
  const typeNode = node.childForFieldName?.('type')
  if (!typeNode) return undefined
  const typeName = typeNode.text
  const traitNode = node.childForFieldName?.('trait')
  if (traitNode) {
    return `${traitNode.text} for ${typeName}`
  }
  return typeName
}

function symbolFromTopLevelNode(node: TSNode): StructuralSymbol | undefined {
  const exported = hasVisibilityModifier(node)

  if (node.type === 'function_item') {
    const name = nameOfTypeIdentifier(node)
    if (!name) return undefined
    return { name, kind: 'function', exported }
  }

  if (node.type === 'struct_item') {
    const name = nameOfTypeIdentifier(node)
    if (!name) return undefined
    return { name, kind: 'class', exported }
  }

  if (node.type === 'enum_item') {
    const name = nameOfTypeIdentifier(node)
    if (!name) return undefined
    return { name, kind: 'enum', exported }
  }

  if (node.type === 'trait_item') {
    const name = nameOfTypeIdentifier(node)
    if (!name) return undefined
    return { name, kind: 'trait', exported }
  }

  if (node.type === 'impl_item') {
    const display = formatImplName(node)
    if (!display) return undefined
    return { name: display, kind: 'impl', exported }
  }

  if (node.type === 'type_item') {
    const name = nameOfTypeIdentifier(node)
    if (!name) return undefined
    return { name, kind: 'type', exported }
  }

  if (node.type === 'const_item' || node.type === 'static_item') {
    const name = nameOfTypeIdentifier(node)
    if (!name) return undefined
    // Mirror the regex extractor — only ALL_CAPS module-level
    // const / static count as structural signals. Lowercase
    // `static foo: T = ...` is rare and noisy.
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) return undefined
    return { name, kind: 'const', exported }
  }

  if (node.type === 'mod_item') {
    const name = nameOfTypeIdentifier(node)
    if (!name) return undefined
    return { name, kind: 'module', exported }
  }

  return undefined
}

function extractSymbolFromLine(parser: TSNode, line: string): StructuralSymbol | undefined {
  if (!line.trim()) return undefined
  // Mirror the regex gate: up to 4 spaces of indent OK (rustfmt
  // commonly indents impl-block fns by 4), deeper indent ≈ body
  // content we don't want to surface as a top-level symbol.
  const indent = line.match(/^[\t ]*/)?.[0] ?? ''
  if (indent.length > 4) return undefined

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

export const treeSitterRustParser: StructuralParser = {
  id: PARSER_KIND,
  async summarize(fileDiff: FileDiff): Promise<string | undefined> {
    if (!isRustFile(fileDiff.file)) return undefined

    const loaded = await getTreeSitterParser('rust')
    if (!loaded) return undefined

    return summarizeStructuralDiff(fileDiff, {
      label: 'Rust',
      parseLine: (line) => extractSymbolFromLine(loaded.parser, line),
    })
  },
}
