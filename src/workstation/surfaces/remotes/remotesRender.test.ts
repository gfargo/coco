/**
 * Structural tests for `renderRemotesSurface`. Stubs `Text` / `Box` per the
 * `surfaces/submodules/submodulesRender.test.ts` pattern.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type { RemoteEntry, RemoteOverview } from '../../../git/remoteData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderRemotesSurface } from './index'

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

function makeEntry(overrides: Partial<RemoteEntry> = {}): RemoteEntry {
  return {
    name: 'origin',
    fetchUrl: 'git@github.com:gfargo/coco.git',
    pushUrl: 'git@github.com:gfargo/coco.git',
    ...overrides,
  }
}

function render(
  state: LogInkState,
  options: { remotes?: RemoteOverview; loading?: boolean } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = options.remotes ? { remotes: options.remotes } : {}
  const contextStatus = options.loading
    ? updateLogInkContextStatus(createLogInkContextStatus('idle'), 'remotes', 'loading')
    : createLogInkContextStatus('ready')
  return renderRemotesSurface({
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

describe('renderRemotesSurface', () => {
  it('renders an empty state when no remotes are configured', () => {
    const tree = render(makeState(), { remotes: { hasRemotes: false, entries: [] } })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders a loading placeholder while remotes hydrate', () => {
    expect(render(makeState(), { loading: true })).toBeDefined()
  })

  it('renders rows for populated remotes', () => {
    const tree = render(makeState(), {
      remotes: {
        hasRemotes: true,
        entries: [
          makeEntry(),
          makeEntry({ name: 'upstream', fetchUrl: 'https://example.com/up.git', pushUrl: 'https://example.com/up.git' }),
        ],
      },
    })
    expect(tree).toBeDefined()
  })

  it('reflects focus state via border color', () => {
    const populated: RemoteOverview = { hasRemotes: true, entries: [makeEntry()] }
    const focused = render(makeState({ focus: 'commits' }), { remotes: populated })
    const blurred = render(makeState({ focus: 'sidebar' }), { remotes: populated })
    expect((focused.props as StubProps).borderColor).not.toBe(
      (blurred.props as StubProps).borderColor
    )
  })

  it('structural snapshot — empty', () => {
    expect(
      render(makeState(), { remotes: { hasRemotes: false, entries: [] } })
    ).toMatchSnapshot()
  })

  it('structural snapshot — populated', () => {
    expect(
      render(makeState(), { remotes: { hasRemotes: true, entries: [makeEntry()] } })
    ).toMatchSnapshot()
  })

  it('structural snapshot — divergent push URL', () => {
    expect(
      render(makeState(), {
        remotes: {
          hasRemotes: true,
          entries: [makeEntry({ pushUrl: 'git@github.com:me/fork.git' })],
        },
      })
    ).toMatchSnapshot()
  })
})
