/**
 * Structural tests for `renderChangelogSurface`. Stubs `Text` / `Box` per the
 * `surfaces/status/statusRender.test.ts` pattern. Changelog state flows from
 * `state.changelogView` rather than a context key, so the states are driven by
 * overriding that view's status.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../commands/log/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import { createLogInkContextStatus } from '../../chrome/context'
import type { LogInkComponents } from '../../runtime/types'
import { renderChangelogSurface } from './index'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const components: LogInkComponents = { Box, Text }

function makeState(changelogView: Partial<LogInkState['changelogView']> = {}): LogInkState {
  const base = createLogInkState([])
  return { ...base, changelogView: { ...base.changelogView, ...changelogView } }
}

function render(state: LogInkState): ReactElement {
  return renderChangelogSurface({
    h: createElement,
    components,
    state,
    context: {},
    contextStatus: createLogInkContextStatus('ready'),
    bodyRows: 30,
    width: 120,
    theme: createLogInkTheme({}),
  })
}

describe('renderChangelogSurface', () => {
  it('renders the idle/empty state', () => {
    const tree = render(makeState())
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders the loading state', () => {
    expect(render(makeState({ status: 'loading' }))).toBeDefined()
  })

  it('renders the error state', () => {
    const tree = render(makeState({ status: 'error', error: 'boom' }))
    expect(tree).toBeDefined()
  })

  it('structural snapshot — idle', () => {
    expect(render(makeState())).toMatchSnapshot()
  })

  it('structural snapshot — loading', () => {
    expect(render(makeState({ status: 'loading' }))).toMatchSnapshot()
  })

  it('structural snapshot — error', () => {
    expect(render(makeState({ status: 'error', error: 'boom' }))).toMatchSnapshot()
  })
})
