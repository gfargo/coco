/**
 * Generic structural-tree flattener for the render-budget invariant
 * harness (OSS-462 / #1419).
 *
 * Every workstation surface builds its tree from exactly two component
 * references — `components.Box` and `components.Text` — passed in via
 * `SurfaceRenderContext`. Tests already stub those two references with
 * plain functions (see any `*Render.test.ts`), which makes `el.type
 * === Text` / `el.type === Box` a reliable identity check without
 * relying on a surface-specific `key` naming convention the way
 * `headerLines` / `leafRows` helpers in individual surface tests do.
 *
 * Ink's `Box` defaults `flexDirection` to `'row'` and `Text` is always
 * a leaf (it never contains a `Box`), so flattening a tree into the
 * lines it would occupy on screen is a small flex layout:
 *   - `Text`: atomic — its children collapse into a single line.
 *   - `Box` with `flexDirection: 'column'` (or `'column-reverse'`):
 *     children stack — concatenate each child's lines in order.
 *   - `Box` with `flexDirection: 'row'` (or `'row-reverse'`, or
 *     unset): children sit side by side — zip line `i` of every
 *     child into one joined line.
 */
export function renderToLines(node: unknown, Text: unknown, Box: unknown): string[] {
  if (node == null || node === false || node === true) return []

  if (typeof node === 'string' || typeof node === 'number') return [String(node)]

  if (Array.isArray(node)) return node.flatMap((child) => renderToLines(child, Text, Box))

  const el = node as {
    type?: unknown
    props?: { children?: unknown; flexDirection?: string }
  }

  if (el.type === Text) return [flattenTextChildren(el.props?.children)]

  const children = normalizeChildren(el.props?.children)
  const groups = children.map((child) => renderToLines(child, Text, Box))
  const direction = el.props?.flexDirection ?? 'row'

  // `-reverse` variants only affect visual order, not the width / row
  // count invariants this harness checks, so they fold into the same
  // branch as their base direction.
  if (direction === 'column' || direction === 'column-reverse') {
    return groups.flat()
  }

  const maxLines = Math.max(0, ...groups.map((group) => group.length))
  return Array.from({ length: maxLines }, (_, index) =>
    groups.map((group) => group[index] ?? '').join('')
  )
}

function normalizeChildren(children: unknown): unknown[] {
  if (children == null || children === false || children === true) return []
  return Array.isArray(children) ? children : [children]
}

function flattenTextChildren(node: unknown): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenTextChildren).join('')
  const el = node as { props?: { children?: unknown } }
  if (el.props && 'children' in el.props) return flattenTextChildren(el.props.children)
  return ''
}
