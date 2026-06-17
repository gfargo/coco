/**
 * Unit tests for the runtime React Context factory (#1136).
 *
 * The factory exists because the workstation loads React via
 * dynamicImport at boot, so the Context can't be a module-level
 * `createContext()` — it must be built from (and cached against) the one
 * runtime React instance. These tests pin the two properties later PRs
 * depend on: a stable shared identity, and a labelled context.
 *
 * Renderer-free on purpose: the hook (`useLogInkRuntime`) needs a React
 * renderer the workstation test suite doesn't pull in, so its
 * provider-presence contract is exercised once a real consumer lands.
 */
import * as React from 'react'
import type { LogInkContextStatus } from '../chrome/context'
import type { LogInkLayout } from '../chrome/layout'
import type { LogInkTheme } from '../chrome/theme'
import type { LogInkState } from './inkViewModel'
import type { LogInkComponents, LogInkContext, SurfaceRenderContext } from './types'
import {
  defineSurfaceComponent,
  getLogInkRuntimeContext,
  useLogInkRuntime,
  useSurfaceRenderContext,
  type LogInkRuntimeContextValue,
} from './runtimeContext'

describe('getLogInkRuntimeContext', () => {
  it('returns a stable, shared context identity across calls', () => {
    const first = getLogInkRuntimeContext(React)
    const second = getLogInkRuntimeContext(React)
    // Surfaces (provider + future consumers) must resolve the same
    // object or useContext would read a different provider's value.
    expect(second).toBe(first)
  })

  it('labels the context and exposes Provider / Consumer', () => {
    const context = getLogInkRuntimeContext(React)
    expect(context.displayName).toBe('LogInkRuntimeContext')
    expect(context.Provider).toBeDefined()
    expect(context.Consumer).toBeDefined()
  })
})

/**
 * Renderer-free fake-React harness (mirrors the surface/hook test pattern).
 * `useContext` is stubbed to return a fixed value so we can exercise the
 * consumer hooks without pulling in a React renderer the workstation suite
 * doesn't bundle. `createContext` returns a throwaway — the real factory's
 * cached identity is covered above; here we only care about the read path.
 */
function makeReact(value: LogInkRuntimeContextValue | null): typeof React {
  return {
    createContext: () => ({ displayName: '' }),
    useContext: () => value,
  } as unknown as typeof React
}

/** Sentinel values; the hooks pass these through, so identity is asserted. */
function makeRuntimeValue(): LogInkRuntimeContextValue {
  const h = (() => null) as unknown as typeof React.createElement
  const components = { Box: () => null, Text: () => null } as unknown as LogInkComponents
  return {
    state: { sentinel: 'state' } as unknown as LogInkState,
    dispatch: jest.fn(),
    theme: { sentinel: 'theme' } as unknown as LogInkTheme,
    layout: { bodyRows: 30, mainPanelWidth: 80, detailWidth: 40 } as unknown as LogInkLayout,
    context: { sentinel: 'context' } as unknown as LogInkContext,
    contextStatus: { sentinel: 'status' } as unknown as LogInkContextStatus,
    h,
    components,
  }
}

describe('useLogInkRuntime', () => {
  it('returns the context value when provided', () => {
    const value = makeRuntimeValue()
    expect(useLogInkRuntime(makeReact(value))).toBe(value)
  })

  it('throws outside a provider (null context value)', () => {
    expect(() => useLogInkRuntime(makeReact(null))).toThrow(
      /must be called inside a LogInkRuntimeContext provider/
    )
  })
})

describe('useSurfaceRenderContext', () => {
  it('rebuilds the SurfaceRenderContext, passing core values through by identity', () => {
    const value = makeRuntimeValue()
    const ctx = useSurfaceRenderContext(makeReact(value), 'main')
    expect(ctx.h).toBe(value.h)
    expect(ctx.components).toBe(value.components)
    expect(ctx.state).toBe(value.state)
    expect(ctx.context).toBe(value.context)
    expect(ctx.contextStatus).toBe(value.contextStatus)
    expect(ctx.theme).toBe(value.theme)
    expect(ctx.bodyRows).toBe(30)
  })

  it('selects the main-panel width for the main panel', () => {
    const ctx = useSurfaceRenderContext(makeReact(makeRuntimeValue()), 'main')
    expect(ctx.width).toBe(80)
  })

  it('selects the detail width for the detail panel', () => {
    const ctx = useSurfaceRenderContext(makeReact(makeRuntimeValue()), 'detail')
    expect(ctx.width).toBe(40)
  })
})

describe('defineSurfaceComponent', () => {
  it('wraps a render fn into a labelled component that feeds it the rebuilt ctx', () => {
    const value = makeRuntimeValue()
    const sentinel = { type: 'box' } as unknown as React.ReactElement
    const renderSurface = jest.fn<React.ReactElement, [SurfaceRenderContext]>(() => sentinel)

    const Component = defineSurfaceComponent(makeReact(value), renderSurface, {
      displayName: 'TestSurface',
    })
    expect(Component.displayName).toBe('TestSurface')

    // Invoke the function component directly (no renderer needed).
    const out = (Component as () => React.ReactElement)()
    expect(out).toBe(sentinel)
    expect(renderSurface).toHaveBeenCalledTimes(1)
    const ctx = renderSurface.mock.calls[0][0]
    // Defaults to the main panel.
    expect(ctx.width).toBe(80)
    expect(ctx.state).toBe(value.state)
  })

  it('honors the detail panel option', () => {
    const value = makeRuntimeValue()
    const renderSurface = jest.fn<React.ReactElement, [SurfaceRenderContext]>(
      () => ({ type: 'box' } as unknown as React.ReactElement)
    )
    const Component = defineSurfaceComponent(makeReact(value), renderSurface, {
      displayName: 'TestDetail',
      panel: 'detail',
    })
    ;(Component as () => React.ReactElement)()
    const ctx = renderSurface.mock.calls[0][0]
    expect(ctx.width).toBe(40)
  })
})
