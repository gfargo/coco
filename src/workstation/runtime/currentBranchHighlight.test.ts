/**
 * Current-branch colour highlight.
 *
 * The checked-out branch is painted in the theme's `success` colour so
 * "where am I?" reads at a glance — in both the full branches surface
 * and the sidebar branches tab. These tests walk the rendered tree for a
 * coloured span carrying the current branch's name and assert non-current
 * branches stay uncoloured.
 *
 * Stub `Text` / `Box` so the tree flattens without pulling Ink (ESM)
 * into ts-jest — same pattern as `pendingItemAction.test.ts`.
 */
import { createElement } from 'react'
import { createLogInkState } from '../../workstation/runtime/inkViewModel'
import { createLogInkContextStatus } from '../chrome/context'
import { createLogInkTheme } from '../chrome/theme'
import { renderBranchesSurface } from '../surfaces/branches'
import { renderSidebar } from './sidebar'
import type { LogInkComponents, LogInkContext, SurfaceRenderContext } from './types'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const components: LogInkComponents = { Box, Text }
const theme = createLogInkTheme({ noColor: false })
const SUCCESS = theme.colors.success as string

function flattenText(node: unknown): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  const el = node as { props?: { children?: unknown } }
  if (el.props && 'children' in el.props) return flattenText(el.props.children)
  return ''
}

/** All text rendered under a span whose `color` prop equals `color`. */
function textWithColor(node: unknown, color: string): string {
  if (node == null || node === false || typeof node === 'string' || typeof node === 'number') {
    return ''
  }
  if (Array.isArray(node)) return node.map((n) => textWithColor(n, color)).join('')
  const el = node as { props?: { color?: string; children?: unknown } }
  if (el.props?.color === color) return flattenText(el.props.children)
  return el.props && 'children' in el.props ? textWithColor(el.props.children, color) : ''
}

const context: LogInkContext = {
  branches: {
    currentBranch: 'main',
    dirty: false,
    remoteBranches: [],
    localBranches: [
      { type: 'local', name: 'main', shortName: 'main', hash: 'a1', current: true, date: '2024-01-01', subject: 's', ahead: 0, behind: 0 },
      { type: 'local', name: 'feat/x', shortName: 'feat/x', hash: 'b2', current: false, upstream: 'origin/feat/x', date: '2024-01-02', subject: 's', ahead: 0, behind: 0 },
    ],
  },
}

function surfaceCtx(): SurfaceRenderContext {
  const base = createLogInkState([])
  return {
    h: createElement,
    components,
    state: { ...base, activeView: 'branches', focus: 'commits' },
    context,
    contextStatus: createLogInkContextStatus('ready'),
    bodyRows: 30,
    width: 70,
    theme,
  }
}

describe('current-branch highlight — branches surface', () => {
  it('paints the current branch name in the success colour', () => {
    const tree = renderBranchesSurface(surfaceCtx(), 0)
    expect(textWithColor(tree, SUCCESS)).toContain('main')
  })

  it('leaves non-current branches out of the success colour', () => {
    const tree = renderBranchesSurface(surfaceCtx(), 0)
    expect(textWithColor(tree, SUCCESS)).not.toContain('feat/x')
  })
})

describe('current-branch highlight — sidebar', () => {
  it('paints the current branch row in the success colour', () => {
    // Cursor on feat/x (index 1) so the current branch (main, index 0)
    // is NOT the active selection — the selection's inverse styling
    // deliberately owns a focused row's colour, so the green only shows
    // when the current branch isn't the one under the cursor.
    const base = createLogInkState([])
    const state = { ...base, sidebarTab: 'branches' as const, focus: 'sidebar' as const, selectedBranchIndex: 1 }
    const tree = renderSidebar(createElement, components, state, context, createLogInkContextStatus('ready'), 40, 30, theme, 0)
    expect(textWithColor(tree, SUCCESS)).toContain('main')
    expect(textWithColor(tree, SUCCESS)).not.toContain('feat/x')
  })
})
