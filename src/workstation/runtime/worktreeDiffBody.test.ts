import { createElement } from 'react'
import { renderWorktreeDiffBody, type WorktreeDiffBodyParams } from './worktreeDiffBody'
import type { LogInkTheme } from '../chrome/theme'
import type { WorktreeHunk } from '../../git/statusHunks'
import type { LogInkComponents } from './types'

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
  colors: { accent: 'cyan', gitAdded: 'green', gitDeleted: 'red', muted: 'gray' },
} as LogInkTheme

// Flatten leaves to { text, color, dimColor }.
function leaves(node: unknown, out: Array<{ text: string; color?: string; dimColor?: boolean }> = []) {
  if (typeof node === 'string') { out.push({ text: node }); return out }
  if (Array.isArray(node)) { node.forEach((c) => leaves(c, out)); return out }
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props: StubProps }).props
    const children = props.children
    if (typeof children === 'string') {
      out.push({ text: children, color: props.color as string | undefined, dimColor: props.dimColor as boolean | undefined })
    } else leaves(children, out)
  }
  return out
}

// A worktree diff: a staged hunk (lines 0-2) then an unstaged hunk (3-5).
const lines = [
  '@@ -1,1 +1,1 @@',      // 0  staged hunk header
  '-old staged',          // 1
  '+new staged',          // 2
  '@@ -5,1 +5,2 @@',      // 3  unstaged hunk header
  '-old unstaged',        // 4
  '+new unstaged',        // 5
]
const hunks = [
  { state: 'staged' } as WorktreeHunk,
  { state: 'unstaged' } as WorktreeHunk,
]

function render(selectedIndex: number) {
  const params: WorktreeDiffBodyParams = {
    lines, offset: 0, visibleRows: 10, width: 120, theme,
    syntaxSpans: undefined, hunkOffsets: [0, 3], hunks, selectedIndex, keyPrefix: 'k',
  }
  return renderWorktreeDiffBody(createElement, components, params)
}

describe('renderWorktreeDiffBody', () => {
  it('badges each hunk header by staged state', () => {
    const segs = leaves(render(1))
    const all = segs.map((s) => s.text)
    // Staged hunk badge ● and unstaged badge ○ both present.
    expect(all).toContain('● ')
    expect(all).toContain('○ ')
  })

  it('draws the accent gutter bar down the SELECTED hunk only', () => {
    const segs = leaves(render(1)) // unstaged hunk (lines 3-5) selected
    // The accent-colored bar char appears (gutter), and there are both
    // selected (▎) and unselected ( ) gutter cells.
    const bars = segs.filter((s) => s.text === '▎' && s.color === 'cyan')
    const blanks = segs.filter((s) => s.text === ' ' && s.color === 'cyan')
    expect(bars.length).toBe(3)   // 3 lines of the selected hunk
    expect(blanks.length).toBe(3) // 3 lines of the non-selected hunk
  })

  it('dims the body of a staged ("done") hunk', () => {
    const segs = leaves(render(1))
    // The staged hunk's body lines render dim.
    const stagedBody = segs.find((s) => s.text.includes('old staged'))
    expect(stagedBody?.dimColor).toBe(true)
  })

  it('moves the bar when a different hunk is selected', () => {
    const seg0 = leaves(render(0)).filter((s) => s.text === '▎')
    expect(seg0.length).toBe(3) // still 3 lines, now the first (staged) hunk
  })
})
