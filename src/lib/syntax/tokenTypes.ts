/**
 * Normalized syntax token types for the diff highlighter.
 *
 * Tree-sitter highlight queries emit fine-grained capture names
 * (`function.method`, `type.builtin`, `punctuation.bracket`, …). We
 * collapse those onto a small, render-friendly set of token types — one
 * color slot per type — so the theme only has to define a handful of
 * syntax colors and the renderer only has to switch on a closed enum.
 */
export type SyntaxTokenType =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'type'
  | 'function'
  | 'property'
  | 'constant'
  | 'plain'

/**
 * Map a tree-sitter capture name to a normalized token type. Captures
 * are dotted (`a.b.c`); we key off the leading segment and fold the rest
 * in. Anything we don't have a color for collapses to `plain` (rendered
 * in the default foreground), so unmapped captures degrade gracefully.
 */
export function captureToToken(capture: string): SyntaxTokenType {
  const base = capture.split('.')[0]
  switch (base) {
    case 'keyword':
      return 'keyword'
    case 'string':
      return 'string'
    case 'comment':
      return 'comment'
    case 'number':
      return 'number'
    case 'type':
      return 'type'
    case 'function':
    case 'method':
    case 'constructor':
      return 'function'
    case 'property':
      return 'property'
    case 'constant':
      return 'constant'
    default:
      return 'plain'
  }
}
