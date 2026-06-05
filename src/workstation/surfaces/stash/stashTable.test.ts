/**
 * Stash surface table layout.
 *
 * The stash list renders as an aligned table — `ref · age · branch ·
 * files · message` with a column header — instead of the old run-on
 * `·`-joined string. These tests assert the header is present, the
 * columns carry their data, rows never exceed the panel's interior width
 * (the old `width - 2` truncation overflowed by 2 cells and wrapped),
 * and the branch column sheds on narrow terminals.
 *
 * Stub `Text` / `Box` so the tree flattens without pulling Ink (ESM)
 * into ts-jest — same pattern as `pendingItemAction.test.ts`.
 */
import { createElement } from 'react'
import { createLogInkState } from '../../../commands/log/inkViewModel'
import { createLogInkContextStatus } from '../../chrome/context'
import { createLogInkTheme } from '../../chrome/theme'
import { cellWidth } from '../../chrome/text'
import { renderStashSurface } from './index'
import type { LogInkComponents, LogInkContext, SurfaceRenderContext } from '../../runtime/types'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const components: LogInkComponents = { Box, Text }
const theme = createLogInkTheme({ noColor: false })

function flattenText(node: unknown): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  const el = node as { props?: { children?: unknown } }
  if (el.props && 'children' in el.props) return flattenText(el.props.children)
  return ''
}

/**
 * Flatten every top-level line element — the data rows (`stash-<n>`) and
 * the column header (`stash-col-header`) — identified by React key. We
 * stop descending once a line is found so nested metadata spans don't
 * count as separate rows.
 */
function leafRows(node: unknown, out: string[] = []): string[] {
  if (node == null || node === false || typeof node === 'string' || typeof node === 'number') return out
  if (Array.isArray(node)) { node.forEach((n) => leafRows(n, out)); return out }
  const el = node as { key?: unknown; props?: { children?: unknown } }
  if (typeof el.key === 'string' && /^stash-(\d+|col-header)$/.test(el.key)) {
    out.push(flattenText(el))
    return out
  }
  if (el.props && 'children' in el.props) leafRows(el.props.children, out)
  return out
}

const stashes = [
  { ref: 'stash@{0}', hash: 'a1', baseHash: 'a1p', date: '2024-01-10', branch: 'feat/new-themes', message: 'e721919 regenerate schema for 14 new theme presets and more', files: ['a.ts', 'b.ts'] },
  { ref: 'stash@{1}', hash: 'b2', baseHash: 'b2p', date: '2024-01-09', branch: 'main', message: '2cbeb35 tighten Ink types (closes #1078)', files: ['c.ts'] },
  { ref: 'stash@{2}', hash: 'c3', baseHash: 'c3p', date: '2022-02-01', branch: 'chore/resolve-bundle-issues-and-more', message: 'WIP on chore/resolve-bundle-issues', files: ['d.ts', 'e.ts', 'f.ts'] },
]

const context: LogInkContext = {
  stashes: { stashes },
} as unknown as LogInkContext

function ctx(width: number): SurfaceRenderContext {
  const base = createLogInkState([])
  return {
    h: createElement,
    components,
    state: { ...base, activeView: 'stash', focus: 'commits' },
    context,
    contextStatus: createLogInkContextStatus('ready'),
    bodyRows: 30,
    width,
    theme,
  }
}

describe('stash surface — aligned table', () => {
  it('renders a column header labelling the fields', () => {
    const flat = flattenText(renderStashSurface(ctx(100), 0))
    expect(flat).toContain('ref')
    expect(flat).toContain('age')
    expect(flat).toContain('branch')
    expect(flat).toContain('files')
    expect(flat).toContain('message')
  })

  it('shows each stash with its ref, branch, and message at a wide width', () => {
    const flat = flattenText(renderStashSurface(ctx(100), 0))
    expect(flat).toContain('stash@{0}')
    expect(flat).toContain('feat/new-themes')
    expect(flat).toContain('regenerate schema')
  })

  it('never lets a row exceed the panel interior width (no wrap)', () => {
    const width = 90
    const interior = width - 4 // border (2) + paddingX (2)
    const rows = leafRows(renderStashSurface(ctx(width), 0))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(cellWidth(row)).toBeLessThanOrEqual(interior)
    }
  })

  it('sheds the branch column on a narrow terminal', () => {
    const flat = flattenText(renderStashSurface(ctx(48), 0))
    // ref + message survive; the branch name is dropped to protect the
    // message floor (it stays visible in the preview pane).
    expect(flat).toContain('stash@{0}')
    expect(flat).not.toContain('feat/new-themes')
  })
})
