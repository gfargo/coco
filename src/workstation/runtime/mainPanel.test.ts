/**
 * Tests for the main-panel dispatcher's zero-extra surface wiring
 * (#1237 surface migration).
 *
 * The nine zero-extra views (those whose renderer needs only the base
 * SurfaceRenderContext) are now mounted as context-reading components:
 * `renderMainPanel` returns `h(<Surface>Component)` instead of calling the
 * render fn inline. These tests pin that wiring without a React renderer —
 * we only assert the dispatcher returns an element whose type is the
 * correctly-named, cached surface component for the active view. The
 * surfaces' own render output stays covered by their colocated
 * render-snapshot suites (unchanged by the migration).
 */
import type * as ReactTypes from 'react'
import { renderMainPanel, type MainPanelExtras } from './mainPanel'
import type { LogInkState } from './inkViewModel'
import type { SurfaceRenderContext } from './types'

// `h` stub: records (type, props) so we can read back the element the
// dispatcher created. The cached surface components carry the displayName
// defineSurfaceComponent set, which is what we assert against.
type CapturedElement = { type: ReactTypes.FC; props: unknown }
function makeReact(): typeof ReactTypes {
  return {
    createElement: (type: ReactTypes.FC, props: unknown) => ({ type, props }),
    // The dispatcher's zero-extra components are built via
    // defineSurfaceComponent, which only needs createContext lazily; it's
    // never invoked here because we don't render the returned component.
    createContext: () => ({ displayName: '' }),
  } as unknown as typeof ReactTypes
}

function makeSurface(activeView: string): SurfaceRenderContext {
  const React = makeReact()
  return {
    h: React.createElement,
    components: { Box: () => null, Text: () => null } as unknown as SurfaceRenderContext['components'],
    state: { activeView, splitPlan: undefined } as unknown as LogInkState,
    context: {},
    contextStatus: {} as unknown as SurfaceRenderContext['contextStatus'],
    bodyRows: 30,
    width: 80,
    theme: {} as unknown as SurfaceRenderContext['theme'],
  }
}

// Minimal extras — the zero-extra branches don't read any of these.
const EXTRAS = {} as unknown as MainPanelExtras

const ZERO_EXTRA_VIEWS: Array<[view: string, displayName: string]> = [
  ['status', 'StatusSurface'],
  ['reflog', 'ReflogSurface'],
  ['submodules', 'SubmodulesSurface'],
  ['remotes', 'RemotesSurface'],
  ['pull-request', 'PullRequestSurface'],
  ['pull-request-triage', 'PullRequestTriageSurface'],
  ['issues', 'IssuesTriageSurface'],
  ['conflicts', 'ConflictsSurface'],
  ['changelog', 'ChangelogSurface'],
]

describe('renderMainPanel — zero-extra surface wiring', () => {
  it.each(ZERO_EXTRA_VIEWS)(
    'mounts the %s view as the %s component (not an inline render)',
    (view, displayName) => {
      const React = makeReact()
      const el = renderMainPanel(React, makeSurface(view), EXTRAS) as unknown as CapturedElement
      expect(typeof el.type).toBe('function')
      expect(el.type.displayName).toBe(displayName)
      // Zero-extra components take no props — they self-serve from context.
      expect(el.props == null || Object.keys(el.props).length === 0).toBe(true)
    }
  )

  it('caches components across calls (stable identity per view)', () => {
    const React = makeReact()
    const first = renderMainPanel(React, makeSurface('status'), EXTRAS) as unknown as CapturedElement
    const second = renderMainPanel(React, makeSurface('status'), EXTRAS) as unknown as CapturedElement
    // Same component object each render — remounting a fresh type every
    // render would be wasteful and defeat later memoization.
    expect(second.type).toBe(first.type)
  })
})
