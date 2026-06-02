import { createElement, type ReactElement } from 'react'
import { renderDiffLine } from './diffLineRender'
import type { LogInkTheme } from '../chrome/theme'
import type { SyntaxSpan } from '../../lib/syntax/highlightEngine'

// Stub <Text> that just records its props/children into a 'text' element
// so we can introspect the rendered tree (same approach as
// historyRender.test.ts — no Ink/ESM needed).
type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const theme: LogInkTheme = {
  noColor: false,
  ascii: false,
  borderStyle: 'round',
  colors: { gitAdded: 'green', gitDeleted: 'red', accent: 'cyan', muted: 'gray' },
} as LogInkTheme

// Flatten the rendered element into [{ text, color }] leaf segments.
function leaves(node: unknown, out: Array<{ text: string; color?: string }> = []): Array<{ text: string; color?: string }> {
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
      out.push({ text: children, color: props.color as string | undefined })
    } else {
      leaves(children, out)
    }
  }
  return out
}

function render(line: string, spans?: Map<string, SyntaxSpan[]>, maxCells = 80): ReactElement {
  return renderDiffLine(createElement, Text, line, theme, spans, maxCells, 'k')
}

describe('renderDiffLine', () => {
  it('falls back to a single plain Text when no spans are available', () => {
    const tree = render('+const x = 1')
    const segs = leaves(tree)
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('+const x = 1')
    // Added line → gitAdded color via diffLineProps.
    expect(segs[0].color).toBe('green')
  })

  it('renders a colored marker + per-token spans when spans exist', () => {
    const code = 'const x = 1'
    const spans: SyntaxSpan[] = [
      { start: 0, end: 5, token: 'keyword' }, // const
      { start: 5, end: 10, token: 'plain' }, // ' x = '
      { start: 10, end: 11, token: 'number' }, // 1
    ]
    const tree = render(`+${code}`, new Map([[code, spans]]))
    const segs = leaves(tree)
    // First leaf is the marker, colored as an addition.
    expect(segs[0]).toEqual({ text: '+', color: 'green' })
    // Then the token spans, in order, with resolved colors.
    expect(segs[1]).toEqual({ text: 'const', color: 'magenta' })
    expect(segs[2]).toEqual({ text: ' x = ', color: undefined }) // plain
    expect(segs[3]).toEqual({ text: '1', color: 'yellow' })
    // Reassembling the code reproduces the line.
    expect(segs.slice(1).map((s) => s.text).join('')).toBe(code)
  })

  it('uses the remove color for the marker on deletions', () => {
    const code = 'return y'
    const spans: SyntaxSpan[] = [{ start: 0, end: 6, token: 'keyword' }, { start: 6, end: 8, token: 'plain' }]
    const segs = leaves(render(`-${code}`, new Map([[code, spans]])))
    expect(segs[0]).toEqual({ text: '-', color: 'red' })
  })

  it('truncates highlighted spans to the cell budget (marker + code)', () => {
    const code = 'abcdefghij' // 10 chars
    const spans: SyntaxSpan[] = [{ start: 0, end: 10, token: 'plain' }]
    // maxCells 6 → marker(1) + 5 code cells.
    const segs = leaves(render(`+${code}`, new Map([[code, spans]]), 6))
    const codeText = segs.slice(1).map((s) => s.text).join('')
    expect(codeText.length).toBeLessThanOrEqual(5)
  })
})
