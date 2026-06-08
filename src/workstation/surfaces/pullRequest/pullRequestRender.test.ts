/**
 * Structural tests for `renderPullRequestSurface`. Stubs `Text` / `Box` per the
 * `surfaces/status/statusRender.test.ts` pattern.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../commands/log/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type { PullRequestInfo, PullRequestOverview } from '../../../git/pullRequestData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderPullRequestSurface } from './index'

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

function makePr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number: 42,
    title: 'Add a thing',
    url: 'https://github.com/o/r/pull/42',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'feature/x',
    baseRefName: 'main',
    ...overrides,
  } as PullRequestInfo
}

function render(
  state: LogInkState,
  options: { pullRequest?: PullRequestOverview; loading?: boolean } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = options.pullRequest ? { pullRequest: options.pullRequest } : {}
  const contextStatus = options.loading
    ? updateLogInkContextStatus(createLogInkContextStatus('idle'), 'pullRequest', 'loading')
    : createLogInkContextStatus('ready')
  return renderPullRequestSurface({
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

describe('renderPullRequestSurface', () => {
  it('renders an unavailable state when there is no GitHub remote', () => {
    const tree = render(makeState(), {
      pullRequest: { available: false, authenticated: false, message: 'No GitHub remote detected.' },
    })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders a not-authenticated state', () => {
    const tree = render(makeState(), {
      pullRequest: {
        available: true,
        authenticated: false,
        message: 'GitHub CLI is missing or not authenticated.',
      },
    })
    expect(tree).toBeDefined()
  })

  it('renders a loading placeholder while the PR hydrates', () => {
    expect(render(makeState(), { loading: true })).toBeDefined()
  })

  it('renders a populated current pull request', () => {
    const tree = render(makeState(), {
      pullRequest: {
        available: true,
        authenticated: true,
        currentBranch: 'feature/x',
        repository: { owner: 'o', name: 'r' },
        currentPullRequest: makePr(),
      },
    })
    expect(tree).toBeDefined()
  })

  it('reflects focus state via border color', () => {
    const overview: PullRequestOverview = {
      available: true,
      authenticated: true,
      currentPullRequest: makePr(),
    }
    const focused = render(makeState({ focus: 'commits' }), { pullRequest: overview })
    const blurred = render(makeState({ focus: 'sidebar' }), { pullRequest: overview })
    expect((focused.props as StubProps).borderColor).not.toBe(
      (blurred.props as StubProps).borderColor
    )
  })

  it('structural snapshot — unavailable', () => {
    expect(
      render(makeState(), {
        pullRequest: { available: false, authenticated: false, message: 'No GitHub remote detected.' },
      })
    ).toMatchSnapshot()
  })

  it('structural snapshot — populated', () => {
    expect(
      render(makeState(), {
        pullRequest: {
          available: true,
          authenticated: true,
          currentPullRequest: makePr(),
        },
      })
    ).toMatchSnapshot()
  })
})
