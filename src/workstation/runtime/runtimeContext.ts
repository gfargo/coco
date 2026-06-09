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
import type { LogInkLayout } from '../chrome/layout'
import type { LogInkTheme } from '../chrome/theme'
import type { LogInkContext } from './types'

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
