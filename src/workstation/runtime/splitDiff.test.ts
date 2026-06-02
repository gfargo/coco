import { createElement } from 'react'
import { renderSplitDiffBody } from './splitDiff'
import type { LogInkTheme } from '../chrome/theme'
import type { SyntaxSpan } from '../../lib/syntax/highlightEngine'
import type { LogInkComponents } from './types'

// Stub <Box>/<Text> that record props/children into synthetic elements
// (same approach as historyRender.test.ts) so we can introspect the tree.
type StubProps = Record<string, unknown>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const components: LogInkComponents = { Box, Text }

const theme: LogInkTheme = {
  noColor: false,
  ascii: false,
  borderStyle: 'round',
  colors: { gitAdded: 'green', gitDeleted: 'red', accent: 'cyan' },
} as LogInkTheme

// Collect [{ text, color, dimColor }] leaves from the rendered tree.
function leaves(
  node: unknown,
  out: Array<{ text: string; color?: string; dimColor?: boolean }> = []
): Array<{ text: string; color?: string; dimColor?: boolean }> {
  if (typeof node === 'string') {
    out.push({ text: node })
    return out
  }
  if (Array.isArray(node)) {
    node.forEach((child) => leaves(child, out))
    return out
  }
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props: StubProps }).props
    const children = props.children
    if (typeof children === 'string') {
      out.push({ text: children, color: props.color as string | undefined, dimColor: props.dimColor as boolean | undefined })
    } else {
      leaves(children, out)
    }
  }
  return out
}

const unified = ['@@ -1,1 +1,1 @@', '-const a = 1', '+const a = 2']

describe('renderSplitDiffBody syntax highlighting', () => {
  it('renders plain cells when no spans are supplied', () => {
    const rows = renderSplitDiffBody(createElement, components, unified, 0, 10, 200, theme, 'k')
    const text = leaves(rows).map((l) => l.text).join(' ')
    // The code is present and not split into per-token colored spans.
    expect(text).toContain('const a = 1')
    expect(text).toContain('const a = 2')
  })

  it('colors the gutter by add/remove and the code by token when spans exist', () => {
    const spans = new Map<string, SyntaxSpan[]>([
      ['const a = 1', [{ start: 0, end: 5, token: 'keyword' }, { start: 5, end: 11, token: 'plain' }]],
      ['const a = 2', [{ start: 0, end: 5, token: 'keyword' }, { start: 5, end: 11, token: 'plain' }]],
    ])
    const rows = renderSplitDiffBody(createElement, components, unified, 0, 10, 200, theme, 'k', spans)
    const segs = leaves(rows)

    // The `const` keyword renders magenta on both sides.
    const keywords = segs.filter((s) => s.text === 'const')
    expect(keywords.length).toBe(2)
    expect(keywords.every((s) => s.color === 'magenta')).toBe(true)

    // The removal-side gutter is red, the addition-side gutter is green.
    const gutters = segs.filter((s) => /^\s*\d+\s$/.test(s.text))
    expect(gutters.some((g) => g.color === 'red')).toBe(true)
    expect(gutters.some((g) => g.color === 'green')).toBe(true)
  })
})
