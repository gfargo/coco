/**
 * Runtime React Context for the workstation (#1136).
 *
 * The render layer currently drills `state` / `dispatch` / `theme` /
 * `layout` / `context` through every `render*Surface` signature, so
 * adding a feature repeatedly means threading one more value through
 * `app → mainPanel → render<View>Surface`. This Context is the single
 * place those five values live; surfaces read what they need from it
 * instead of receiving 10–15 positional props.
 *
 * Why a factory (`getLogInkRuntimeContext(React)`) instead of a plain
 * module-level `React.createContext(...)`: the workstation never
 * statically imports React. `ink` + `react` are ESM-only and loaded via
 * dynamicImport at boot (see `inkRuntime.ts`), so the rest of the
 * codebase compiles without bundling them. The Context object must be
 * built from that same runtime React instance — the one that renders
 * the tree and the one a consumer's `useContext` reads from have to be
 * identical. There is exactly one React instance per process, so we
 * lazily create the Context on first use and cache it; `LogInkApp`'s
 * provider and (in later PRs) the surface consumers all share the one
 * identity.
 */

import type * as ReactTypes from 'react'
import type { LogInkAction, LogInkState } from '../../workstation/runtime/inkViewModel'
import type { LogInkContextStatus } from '../chrome/context'
import type { LogInkLayout } from '../chrome/layout'
import type { LogInkTheme } from '../chrome/theme'
import type { LogInkComponents, LogInkContext, SurfaceRenderContext } from './types'

/**
 * The value carried by `LogInkRuntimeContext`. Intentionally the exact
 * five values #1136 calls out as the most-drilled. As surfaces migrate
 * off explicit props in later PRs this shape may grow (e.g. the loaded
 * `contextStatus` and the per-surface async slices), but it stays the
 * single source those consumers read from.
 */
export type LogInkRuntimeContextValue = {
  state: LogInkState
  dispatch: (action: LogInkAction) => void
  theme: LogInkTheme
  layout: LogInkLayout
  context: LogInkContext
  /**
   * Loading status per context key (#1237 surface migration). Surfaces
   * read this to render per-slice "loading…" affordances; it was the
   * `contextStatus` field threaded through every `SurfaceRenderContext`.
   * App-wide and recomputed each render, like `state`.
   */
  contextStatus: LogInkContextStatus
  /**
   * Runtime render primitives — `React.createElement` (`h`) and the ink
   * `{ Box, Text }` pair. The workstation never statically imports
   * react/ink (both ESM, dynamic-import at boot), so a migrated surface
   * component can't `import` them; they ride in the context, set once at
   * the root. Stable for the life of the process.
   */
  h: typeof ReactTypes.createElement
  components: LogInkComponents
}

type LogInkRuntimeContext = ReactTypes.Context<LogInkRuntimeContextValue | null>

let cachedContext: LogInkRuntimeContext | null = null

/**
 * Lazily create (and thereafter return) the process-wide
 * `LogInkRuntimeContext`, bound to the runtime React instance. Pass the
 * same `React` the tree is rendered with — `LogInkApp` uses `deps.React`;
 * tests use the statically-imported `react`.
 */
export function getLogInkRuntimeContext(React: typeof ReactTypes): LogInkRuntimeContext {
  if (!cachedContext) {
    cachedContext = React.createContext<LogInkRuntimeContextValue | null>(null)
    cachedContext.displayName = 'LogInkRuntimeContext'
  }
  return cachedContext
}

/**
 * Read the runtime context from inside a component rendered under the
 * provider. Throws when called outside the provider so a missing-provider
 * wiring bug surfaces loudly instead of as a confusing `null` deref.
 *
 * No consumers exist yet (PR 1 only installs the provider); the surface
 * families migrate onto this in subsequent PRs.
 */
export function useLogInkRuntime(React: typeof ReactTypes): LogInkRuntimeContextValue {
  const value = React.useContext(getLogInkRuntimeContext(React))
  if (!value) {
    throw new Error('useLogInkRuntime must be called inside a LogInkRuntimeContext provider')
  }
  return value
}

/**
 * Which panel a surface renders into. The main panel and the detail
 * inspector have different widths, so a surface reconstructing its
 * {@link SurfaceRenderContext} from the runtime context must say which.
 */
export type SurfacePanel = 'main' | 'detail'

/**
 * Rebuild the {@link SurfaceRenderContext} a `render*Surface` fn expects
 * from the runtime context (#1237 surface migration). A migrated surface
 * component calls this and hands the result to its existing (snapshot-
 * tested) render fn unchanged — so the proven render logic doesn't move,
 * only how it sources its inputs. `panel` selects the width.
 */
export function useSurfaceRenderContext(
  React: typeof ReactTypes,
  panel: SurfacePanel
): SurfaceRenderContext {
  const { h, components, state, context, contextStatus, theme, layout } =
    useLogInkRuntime(React)
  return {
    h,
    components,
    state,
    context,
    contextStatus,
    bodyRows: layout.bodyRows,
    width: panel === 'detail' ? layout.detailWidth : layout.mainPanelWidth,
    theme,
  }
}

/**
 * Wrap a zero-extra `render*Surface` fn — one that needs only the base
 * {@link SurfaceRenderContext}, no per-render async slice — into a thin
 * component that reads from the runtime context instead of receiving
 * props. The caller caches the returned component (a per-surface getter)
 * so its identity stays stable across renders; remounting it every render
 * would be wasteful and defeat later memoization. Surfaces that also need
 * async slices (diff data, spinner frames) write a bespoke component on
 * top of {@link useSurfaceRenderContext} instead.
 */
export function defineSurfaceComponent(
  React: typeof ReactTypes,
  renderSurface: (ctx: SurfaceRenderContext) => ReactTypes.ReactElement,
  options: { displayName: string; panel?: SurfacePanel }
): ReactTypes.FC {
  const SurfaceComponent: ReactTypes.FC = () => {
    const ctx = useSurfaceRenderContext(React, options.panel ?? 'main')
    return renderSurface(ctx)
  }
  SurfaceComponent.displayName = options.displayName
  return SurfaceComponent
}
