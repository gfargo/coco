/**
 * Structural tests for `renderConflictsSurface`. Stubs `Text` / `Box` per the
 * `surfaces/status/statusRender.test.ts` pattern.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type { GitOperationOverview } from '../../../git/operationData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderConflictsSurface } from './index'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const components: LogInkComponents = { Box, Text }

function makeState(overrides: Partial<LogInkState> = {}): LogInkState {
  return { ...createLogInkState([]), ...overrides }
}

function makeOperation(overrides: Partial<GitOperationOverview> = {}): GitOperationOverview {
  return {
    operation: 'none',
    conflictedFiles: [],
    conflictMarkers: [],
    hooks: { hooksPath: '.git/hooks', configuredHooks: [] },
    aiConflictHelpAvailable: false,
    ...overrides,
  }
}

function render(
  state: LogInkState,
  options: { operation?: GitOperationOverview; loading?: boolean } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = options.operation ? { operation: options.operation } : {}
  const contextStatus = options.loading
    ? updateLogInkContextStatus(createLogInkContextStatus('idle'), 'operation', 'loading')
    : createLogInkContextStatus('ready')
  return renderConflictsSurface({
    h: createElement,
    components,
    state,
    context,
    contextStatus,
    bodyRows: 30,
    width: 120,
    theme,
  })
}

describe('renderConflictsSurface', () => {
  it('renders a no-operation fallback when nothing is in progress', () => {
    const tree = render(makeState(), { operation: makeOperation() })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders when operation context is absent', () => {
    expect(render(makeState())).toBeDefined()
  })

  it('renders a loading placeholder while operation status hydrates', () => {
    expect(render(makeState(), { loading: true })).toBeDefined()
  })

  it('renders a merge-in-progress state with no remaining conflicts', () => {
    const tree = render(makeState(), {
      operation: makeOperation({ operation: 'merge', conflictedFiles: [] }),
    })
    expect(tree).toBeDefined()
  })

  it('reflects focus state via border color', () => {
    const op = makeOperation({ operation: 'merge' })
    const focused = render(makeState({ focus: 'commits' }), { operation: op })
    const blurred = render(makeState({ focus: 'sidebar' }), { operation: op })
    expect((focused.props as StubProps).borderColor).not.toBe(
      (blurred.props as StubProps).borderColor
    )
  })

  it('structural snapshot — no operation', () => {
    expect(render(makeState(), { operation: makeOperation() })).toMatchSnapshot()
  })

  it('structural snapshot — merge in progress', () => {
    expect(
      render(makeState(), { operation: makeOperation({ operation: 'merge' }) })
    ).toMatchSnapshot()
  })
})
