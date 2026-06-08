/**
 * Structural tests for `renderReflogSurface`. Stubs `Text` / `Box` per the
 * `surfaces/status/statusRender.test.ts` pattern.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../commands/log/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type { ReflogOverview, ReflogViewEntry } from '../../../git/reflogData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderReflogSurface } from './index'

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

function makeEntry(overrides: Partial<ReflogViewEntry> = {}): ReflogViewEntry {
  return {
    selector: 'HEAD@{0}',
    hash: 'abc1234',
    relativeDate: '2 hours ago',
    subject: 'commit: latest work',
    ...overrides,
  }
}

function render(
  state: LogInkState,
  options: { reflog?: ReflogOverview; loading?: boolean } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = options.reflog ? { reflog: options.reflog } : {}
  const contextStatus = options.loading
    ? updateLogInkContextStatus(createLogInkContextStatus('idle'), 'reflog', 'loading')
    : createLogInkContextStatus('ready')
  return renderReflogSurface({
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

describe('renderReflogSurface', () => {
  it('renders an empty state when no reflog entries exist', () => {
    const tree = render(makeState(), { reflog: { entries: [] } })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders a loading placeholder while the reflog hydrates', () => {
    expect(render(makeState(), { loading: true })).toBeDefined()
  })

  it('renders rows for populated reflog entries', () => {
    const tree = render(makeState(), {
      reflog: {
        entries: [
          makeEntry(),
          makeEntry({ selector: 'HEAD@{1}', subject: 'checkout: moving to feature/x' }),
        ],
      },
    })
    expect(tree).toBeDefined()
  })

  it('reflects focus state via border color', () => {
    const focused = render(makeState({ focus: 'commits' }), { reflog: { entries: [makeEntry()] } })
    const blurred = render(makeState({ focus: 'sidebar' }), { reflog: { entries: [makeEntry()] } })
    expect((focused.props as StubProps).borderColor).not.toBe(
      (blurred.props as StubProps).borderColor
    )
  })

  it('structural snapshot — empty', () => {
    expect(render(makeState(), { reflog: { entries: [] } })).toMatchSnapshot()
  })

  it('structural snapshot — populated', () => {
    expect(render(makeState(), { reflog: { entries: [makeEntry()] } })).toMatchSnapshot()
  })
})
