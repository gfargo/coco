/**
 * Structural tests for `renderPullRequestSurface`. Stubs `Text` / `Box` per the
 * `surfaces/status/statusRender.test.ts` pattern.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
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

/** Flatten an Ink element tree into the concatenated visible text. */
function treeText(node: unknown): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(treeText).join('')
  const el = node as { props?: { children?: unknown } }
  return el.props ? treeText(el.props.children) : ''
}

function render(
  state: LogInkState,
  options: {
    pullRequest?: PullRequestOverview
    loading?: boolean
    provider?: LogInkContext['provider']
  } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = {
    ...(options.pullRequest ? { pullRequest: options.pullRequest } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
  }
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

  it('uses Merge-request wording on a GitLab repo (#0.70)', () => {
    const tree = render(makeState(), {
      pullRequest: {
        available: true,
        authenticated: true,
        currentPullRequest: makePr(),
      },
      provider: {
        repository: { provider: 'gitlab', owner: 'g', name: 'p' },
        authenticated: true,
      } as never,
    })
    const text = treeText(tree)
    expect(text).toContain('Merge request')
    expect(text).not.toContain('Pull request')
  })

  it('keeps Pull-request wording on a GitHub repo (#0.70)', () => {
    const tree = render(makeState(), {
      pullRequest: {
        available: true,
        authenticated: true,
        currentPullRequest: makePr(),
      },
      provider: {
        repository: { provider: 'github', owner: 'o', name: 'r' },
        authenticated: true,
      } as never,
    })
    const text = treeText(tree)
    expect(text).toContain('Pull request')
    expect(text).not.toContain('Merge request')
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
