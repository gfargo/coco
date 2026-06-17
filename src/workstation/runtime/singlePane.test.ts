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
import * as React from 'react'
import { createLogInkState } from '../../workstation/runtime/inkViewModel'
import { createLogInkContextStatus } from '../chrome/context'
import { getLogInkLayout } from '../chrome/layout'
import { createLogInkTheme } from '../chrome/theme'
import { renderDetailPanel } from './detailPanel'
import type { LogInkRuntimeContextValue } from './runtimeContext'
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

// The detail surfaces now mount as components that read width/etc. from
// LogInkRuntimeContext (#1237). A thin React shim whose `useContext`
// returns a fixed runtime value lets us render the inspector component
// without a renderer (same trick as header.test.ts).
function reactWithRuntime(value: LogInkRuntimeContextValue): typeof React {
  return new Proxy(React, {
    get(target, prop, receiver) {
      if (prop === 'useContext') return () => value
      return Reflect.get(target, prop, receiver)
    },
  }) as typeof React
}

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

    // The inspector mounts as the HistoryInspector component; it reads its
    // width from the runtime context's `layout.detailWidth` (80 here).
    const runtimeValue: LogInkRuntimeContextValue = {
      state,
      dispatch: () => {},
      theme,
      layout,
      context,
      contextStatus,
      h: createElement,
      components: { Box, Text },
    }
    const shim = reactWithRuntime(runtimeValue)
    const element = renderDetailPanel(
      shim,
      {
        h: createElement,
        components: { Box, Text },
        state,
        context,
        contextStatus,
        bodyRows: layout.bodyRows,
        width: layout.detailWidth,
        theme,
      },
      {
        detail: undefined,
        loading: false,
        filePreview: undefined,
        filePreviewLoading: false,
        tabbed: false,
      }
    ) as unknown as { type: (props: unknown) => unknown; props: unknown }

    // Render the returned component through the shim to reach the surface.
    const tree = asNode(element.type(element.props))
    expect(tree.props.width).toBe(80)
  })
})
