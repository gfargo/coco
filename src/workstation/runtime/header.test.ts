/**
 * Tests for the header surface component (#1136, 0.72 phase 7).
 *
 * The header migrated from a positional `renderHeader(...)` render
 * function into `createLogInkHeader(React, h, components)`, which returns
 * a `React.memo` component that reads `state` / `context` / `theme` /
 * `layout` from `LogInkRuntimeContext` via `useLogInkRuntime`. It's the
 * first real consumer of that context.
 *
 * Rendering convention: like `footer.test.ts` and the other runtime
 * surface tests, we stub `Box` / `Text` (Ink is ESM-only and the suite
 * runs under ts-jest's CommonJS sandbox, which is why the project mocks
 * ESM packages rather than importing them — see the `@langchain/*` mocks
 * in jest.config.mjs). The component's only hook is `useLogInkRuntime`,
 * which is a thin wrapper over `React.useContext`. Because the runtime
 * React instance is injected (`createLogInkHeader(React, ...)` and
 * `useLogInkRuntime(React)` both take it as a parameter), we hand them a
 * thin shim that delegates to real React but overrides `useContext` to
 * return a minimal runtime value, then invoke the rendered component.
 * This exercises the real consumer path — context read → chip derivation
 * → element tree — without pulling Ink's ESM reconciler into the
 * CommonJS test runtime, and without mutating React's (non-configurable)
 * namespace exports.
 */
import { createElement, type ReactElement } from 'react'
import * as React from 'react'
import { createLogInkContextStatus } from '../chrome/context'
import { getLogInkLayout } from '../chrome/layout'
import { createLogInkTheme } from '../chrome/theme'
import { createLogInkState } from '../../workstation/runtime/inkViewModel'
import { createLogInkHeader, type LogInkHeaderProps } from './header'
import {
  useLogInkRuntime,
  type LogInkRuntimeContextValue,
} from './runtimeContext'
import type { LogInkContext } from './types'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

// Recursively collect every string fragment in the rendered element tree
// so assertions can look for chip labels regardless of how the Text spans
// nest. Mirrors `lastFrame()`-style text matching without a renderer.
function collectText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  const el = node as { props?: { children?: unknown } }
  return el.props ? collectText(el.props.children) : ''
}

function makeRuntimeValue(
  overrides: Partial<LogInkRuntimeContextValue> = {}
): LogInkRuntimeContextValue {
  const context: LogInkContext = {
    provider: {
      currentBranch: 'main',
      repository: { owner: 'gfargo', name: 'coco', provider: 'github' },
    },
  } as unknown as LogInkContext
  return {
    state: createLogInkState([]),
    dispatch: () => {},
    theme: createLogInkTheme({ noColor: true }),
    // Wide layout so the chip row fits without hitting the narrow
    // fallback path — we want the per-chip labels in the output.
    layout: getLogInkLayout({ columns: 160, rows: 40 }),
    context,
    // The header doesn't read these, but the runtime context value now
    // also carries them (#1237 surface migration) so the type requires them.
    contextStatus: createLogInkContextStatus('idle'),
    h: createElement,
    components: { Box, Text },
    ...overrides,
  }
}

// A thin React shim whose `useContext` returns a fixed value; everything
// else delegates to the real React instance. Injecting this is how we
// feed the runtime context value without a renderer (and without
// redefining React's frozen namespace exports).
function reactWithContext(value: LogInkRuntimeContextValue | null): typeof React {
  return new Proxy(React, {
    get(target, prop, receiver) {
      if (prop === 'useContext') return () => value
      return Reflect.get(target, prop, receiver)
    },
  }) as typeof React
}

// Render the memo component by feeding the runtime value through the
// shimmed `useContext`. `React.memo` wraps the function on `.type`;
// invoking that runs the body (and `useLogInkRuntime`).
function renderHeader(
  value: LogInkRuntimeContextValue,
  props: Partial<LogInkHeaderProps> = {}
): ReactElement {
  const shim = reactWithContext(value)
  const LogInkHeader = createLogInkHeader(shim, createElement, { Box, Text })
  const inner = (LogInkHeader as unknown as { type: (p: LogInkHeaderProps) => ReactElement }).type
  return inner({
    contextStatus: (props.contextStatus ?? { state: 'idle' }) as never,
    appLabel: props.appLabel ?? 'coco',
  })
}

describe('createLogInkHeader', () => {
  it('returns a memoized component (stable subtree, not re-created inline)', () => {
    const Component = createLogInkHeader(React, createElement, { Box, Text })
    // React.memo wraps the function — exposing it on `.type`. This is the
    // shape app.ts relies on when it memoizes the factory call once.
    expect(typeof (Component as unknown as { type: unknown }).type).toBe('function')
    expect((Component as unknown as { type: { name: string } }).type.name).toBe('LogInkHeader')
  })

  it('reads context and renders the app label + repo chip', () => {
    const tree = renderHeader(makeRuntimeValue())
    const text = collectText(tree)
    // appLabel comes from props; repo comes from context.provider — both
    // landing in the output proves the consumer wired context through.
    expect(text).toContain('coco')
    expect(text).toContain('gfargo/coco')
  })

  it('renders the current branch chip sourced from context', () => {
    const tree = renderHeader(makeRuntimeValue())
    expect(collectText(tree)).toContain('main')
  })

  it('wraps the chips in a 3-high bordered Box (layout unchanged)', () => {
    const tree = renderHeader(makeRuntimeValue())
    const props = (tree as unknown as { props: StubProps }).props
    expect(props.height).toBe(3)
    expect(props.borderStyle).toBeDefined()
    expect(props.paddingX).toBe(1)
  })

  it('falls back to a single truncated Text span on a very narrow terminal', () => {
    // A wide breadcrumb forces the assembled chip row well past the
    // 80-col budget, so the component takes the single-fragment fallback
    // path (one Text element, not the interleaved chip/separator array).
    const wideState = {
      ...createLogInkState([]),
      filter: 'x'.repeat(40),
      filterMode: true,
    }
    const tree = renderHeader(
      makeRuntimeValue({
        state: wideState,
        layout: getLogInkLayout({ columns: 80, rows: 40 }),
      })
    )
    const children = (tree as unknown as { props: { children: unknown } }).props.children
    expect(Array.isArray(children)).toBe(false)
  })

  it('useLogInkRuntime throws when no provider value is present', () => {
    // Outside the provider `useContext` yields the context default (null);
    // the hook must guard loudly rather than hand back null.
    const shim = reactWithContext(null)
    expect(() => useLogInkRuntime(shim)).toThrow(
      'useLogInkRuntime must be called inside a LogInkRuntimeContext provider'
    )
  })
})
