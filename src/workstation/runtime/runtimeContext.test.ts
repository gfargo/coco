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
import { getLogInkRuntimeContext } from './runtimeContext'

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
