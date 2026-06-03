/**
 * Render smoke test for the single-pane fallback (#1135).
 *
 * At the 80×24 supported floor the workstation drops its three-panel
 * layout for one full-width pane (the focused one), Tab-cycled. This
 * exercises the two panes that used to collapse to useless 8-cell icon
 * rails — the sidebar and the inspector — at the full single-pane width,
 * confirming they render the real surface (not a stub) without throwing.
 *
 * Structural, not visual: stub `Text` / `Box` collect props into a
 * synthetic React tree so we can read the outer `width` without pulling
 * Ink (ESM) into ts-jest. Same trick as `footer.test.ts`.
 */
import { createElement } from 'react'
import { createLogInkState } from '../../commands/log/inkViewModel'
import { createLogInkContextStatus } from '../chrome/context'
import { getLogInkLayout } from '../chrome/layout'
import { createLogInkTheme } from '../chrome/theme'
import { renderDetailPanel } from './detailPanel'
import { renderSidebar } from './sidebar'
import type { LogInkContext } from './types'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

type Node = { props: StubProps }
const asNode = (value: unknown): Node => value as Node

const theme = createLogInkTheme({ noColor: false })
const context: LogInkContext = {}
const contextStatus = createLogInkContextStatus('ready')

describe('single-pane render smoke (80×24 floor)', () => {
  it('renders the sidebar full-width when it is the visible pane', () => {
    const state = createLogInkState([])
    const layout = getLogInkLayout({ columns: 80, rows: 24, sidebarFocused: true })

    expect(layout.singlePane).toBe(true)
    expect(layout.visiblePane).toBe('sidebar')

    const tree = asNode(
      renderSidebar(
        createElement,
        { Box, Text },
        state,
        context,
        contextStatus,
        layout.sidebarWidth,
        layout.bodyRows,
        theme
      )
    )
    // The full accordion sidebar renders at the whole terminal width —
    // not the retired 8-cell rail.
    expect(tree.props.width).toBe(80)
  })

  it('renders the inspector full-width when it is the visible pane', () => {
    const state = createLogInkState([])
    const layout = getLogInkLayout({ columns: 80, rows: 24, inspectorFocused: true })

    expect(layout.singlePane).toBe(true)
    expect(layout.visiblePane).toBe('inspector')

    const tree = asNode(
      renderDetailPanel(
        createElement,
        { Box, Text },
        state,
        context,
        contextStatus,
        undefined,
        false,
        undefined,
        false,
        layout.detailWidth,
        layout.inspectorTabbed,
        theme,
        layout.bodyRows
      )
    )
    expect(tree.props.width).toBe(80)
  })
})
