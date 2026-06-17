/**
 * Tests for the detail-panel dispatcher's surface wiring (#1237 surface
 * migration).
 *
 * The per-view detail surfaces (commit panel, diff detail, the preview
 * panels, the history inspector) now mount as context-reading components:
 * `renderDetailPanel` returns `h(<Surface>Component, props)` instead of
 * calling the positional renderer inline. These tests pin that routing
 * without a React renderer — we assert the dispatcher returns an element
 * whose type is the correctly-named component for the active view, and
 * that the per-render slices (detail / loading / file preview / tabbed)
 * ride as props. The surfaces' own output stays covered by the colocated
 * `surfaces/detail` suites (unchanged by the migration); the overlays stay
 * positional and are covered by `overlays.test.ts`.
 */
import type * as ReactTypes from 'react'
import { renderDetailPanel, type DetailPanelExtras } from './detailPanel'
import type { LogInkState } from './inkViewModel'
import type { SurfaceRenderContext } from './types'

type CapturedElement = { type: ReactTypes.FC; props: Record<string, unknown> | null }
function makeReact(): typeof ReactTypes {
  return {
    createElement: (type: ReactTypes.FC, props: unknown) => ({ type, props }),
    createContext: () => ({ displayName: '' }),
  } as unknown as typeof ReactTypes
}

function makeSurface(state: Partial<LogInkState>): SurfaceRenderContext {
  const React = makeReact()
  return {
    h: React.createElement,
    components: { Box: () => null, Text: () => null } as unknown as SurfaceRenderContext['components'],
    // All overlay flags absent (falsy) so dispatch reaches the view branches.
    state: { focus: 'detail', ...state } as unknown as LogInkState,
    context: {},
    contextStatus: {} as unknown as SurfaceRenderContext['contextStatus'],
    bodyRows: 30,
    width: 60,
    theme: {} as unknown as SurfaceRenderContext['theme'],
  }
}

const EXTRAS: DetailPanelExtras = {
  detail: { hash: 'abc' } as unknown as DetailPanelExtras['detail'],
  loading: true,
  filePreview: undefined,
  filePreviewLoading: false,
  tabbed: true,
}

function dispatch(state: Partial<LogInkState>): CapturedElement {
  const React = makeReact()
  return renderDetailPanel(React, makeSurface(state), EXTRAS) as unknown as CapturedElement
}

describe('renderDetailPanel — detail surface wiring', () => {
  it.each([
    [{ activeView: 'status' }, 'CommitPanel'],
    [{ activeView: 'diff', diffSource: 'worktree' }, 'CommitPanel'],
    [{ activeView: 'compose' }, 'ComposeContextPanel'],
    [{ activeView: 'history', pendingCommitFocused: true }, 'ComposeContextPanel'],
    [{ activeView: 'branches' }, 'BranchPreviewPanel'],
    [{ activeView: 'tags' }, 'TagPreviewPanel'],
    [{ activeView: 'stash' }, 'StashPreviewPanel'],
    [{ activeView: 'submodules' }, 'SubmodulePreviewPanel'],
    [{ activeView: 'issues' }, 'IssueTriagePreviewPanel'],
    [{ activeView: 'pull-request-triage' }, 'PullRequestTriagePreviewPanel'],
  ] as Array<[Partial<LogInkState>, string]>)(
    'routes %o to the %s component',
    (state, displayName) => {
      const el = dispatch(state)
      expect(typeof el.type).toBe('function')
      expect(el.type.displayName).toBe(displayName)
    }
  )

  it('routes commit-sourced diff to CommitDiffDetail with detail + loading props', () => {
    const el = dispatch({ activeView: 'diff', diffSource: 'commit' })
    expect(el.type.displayName).toBe('CommitDiffDetail')
    const props = el.props as { detail: { hash: string }; loading: boolean }
    expect(props.detail).toEqual({ hash: 'abc' })
    expect(props.loading).toBe(true)
  })

  it('falls through to HistoryInspector with the inspector slices as props', () => {
    const el = dispatch({ activeView: 'history' })
    expect(el.type.displayName).toBe('HistoryInspector')
    const props = el.props as { detail: unknown; tabbed: boolean }
    expect(props.detail).toEqual({ hash: 'abc' })
    expect(props.tabbed).toBe(true)
  })

  it('caches detail components across calls (stable identity)', () => {
    const first = dispatch({ activeView: 'status' })
    const second = dispatch({ activeView: 'status' })
    expect(second.type).toBe(first.type)
  })
})
