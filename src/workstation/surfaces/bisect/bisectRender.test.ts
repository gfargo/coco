/**
 * Structural tests for `renderBisectSurface`. Stubs `Text` / `Box` per the
 * `surfaces/status/statusRender.test.ts` pattern. Unlike the uniform surfaces,
 * this renderer takes two extra args (candidate commit detail + its loading
 * flag); both are passed empty here.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../commands/log/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type { BisectStatus } from '../../../git/bisectData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderBisectSurface } from './index'

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

function render(
  state: LogInkState,
  options: { bisect?: BisectStatus; loading?: boolean } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = options.bisect ? { bisect: options.bisect } : {}
  const contextStatus = options.loading
    ? updateLogInkContextStatus(createLogInkContextStatus('idle'), 'bisect', 'loading')
    : createLogInkContextStatus('ready')
  return renderBisectSurface(
    {
      h: createElement,
      components,
      state,
      context,
      contextStatus,
      bodyRows: 30,
      width: 120,
      theme,
    },
    undefined,
    false
  )
}

describe('renderBisectSurface', () => {
  it('renders an inactive state when no bisect session is running', () => {
    const tree = render(makeState(), { bisect: { active: false, currentSha: '', log: [] } })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders when bisect context is absent', () => {
    expect(render(makeState())).toBeDefined()
  })

  it('renders a loading placeholder while bisect status hydrates', () => {
    expect(render(makeState(), { loading: true })).toBeDefined()
  })

  it('renders an active bisect session', () => {
    const tree = render(makeState(), {
      bisect: { active: true, currentSha: 'abc1234', log: [] },
    })
    expect(tree).toBeDefined()
  })

  it('structural snapshot — inactive', () => {
    expect(
      render(makeState(), { bisect: { active: false, currentSha: '', log: [] } })
    ).toMatchSnapshot()
  })

  it('structural snapshot — active', () => {
    expect(
      render(makeState(), { bisect: { active: true, currentSha: 'abc1234', log: [] } })
    ).toMatchSnapshot()
  })
})
