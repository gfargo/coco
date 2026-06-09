/**
 * Structural tests for `renderPullRequestTriageSurface`. Stubs `Text` / `Box`
 * per the `surfaces/status/statusRender.test.ts` pattern. Data flows in via
 * `context.pullRequestList`.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type {
  PullRequestListItem,
  PullRequestListOverview,
} from '../../../git/pullRequestListData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderPullRequestTriageSurface } from './index'

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

function makePr(overrides: Partial<PullRequestListItem> = {}): PullRequestListItem {
  return {
    number: 42,
    title: 'Add a thing',
    url: 'https://github.com/o/r/pull/42',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'feature/x',
    baseRefName: 'main',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-02',
    ...overrides,
  } as PullRequestListItem
}

function render(
  state: LogInkState,
  options: { pullRequestList?: PullRequestListOverview; loading?: boolean } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = options.pullRequestList
    ? { pullRequestList: options.pullRequestList }
    : {}
  const contextStatus = options.loading
    ? updateLogInkContextStatus(createLogInkContextStatus('idle'), 'pullRequestList', 'loading')
    : createLogInkContextStatus('ready')
  return renderPullRequestTriageSurface({
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

describe('renderPullRequestTriageSurface', () => {
  it('renders an unavailable state with no GitHub remote', () => {
    const tree = render(makeState(), {
      pullRequestList: {
        available: false,
        authenticated: false,
        message: 'No GitHub remote detected.',
      },
    })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders an empty authenticated list', () => {
    const tree = render(makeState(), {
      pullRequestList: { available: true, authenticated: true, pullRequests: [] },
    })
    expect(tree).toBeDefined()
  })

  it('renders a loading placeholder while PRs hydrate', () => {
    expect(render(makeState(), { loading: true })).toBeDefined()
  })

  it('renders rows for a populated PR list', () => {
    const tree = render(makeState(), {
      pullRequestList: {
        available: true,
        authenticated: true,
        pullRequests: [makePr(), makePr({ number: 43, title: 'Draft', isDraft: true })],
      },
    })
    expect(tree).toBeDefined()
  })

  it('structural snapshot — empty list', () => {
    expect(
      render(makeState(), {
        pullRequestList: { available: true, authenticated: true, pullRequests: [] },
      })
    ).toMatchSnapshot()
  })

  it('structural snapshot — populated', () => {
    expect(
      render(makeState(), {
        pullRequestList: { available: true, authenticated: true, pullRequests: [makePr()] },
      })
    ).toMatchSnapshot()
  })
})
