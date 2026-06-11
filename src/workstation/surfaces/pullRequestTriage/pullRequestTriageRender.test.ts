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
import { __test as gitlabInternals } from '../../../git/gitlabListData'
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
    pullRequestList?: PullRequestListOverview
    loading?: boolean
    provider?: LogInkContext['provider']
  } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = {
    ...(options.pullRequestList ? { pullRequestList: options.pullRequestList } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
  }
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

  it('renders rows from GitLab-sourced merge requests (#0.70)', () => {
    // Data goes through the real GitLab parser, proving the triage surface
    // renders GitLab MRs (mapped to the shared view model) the same as gh PRs.
    const pullRequests = gitlabInternals.parseMergeRequests(
      JSON.stringify([
        {
          iid: 7,
          title: 'Add dashboard',
          web_url: 'https://gitlab.com/g/p/-/merge_requests/7',
          state: 'opened',
          draft: false,
          source_branch: 'feat/dash',
          target_branch: 'main',
          author: { username: 'gfargo' },
          labels: ['enhancement'],
          created_at: '2026-01-01',
          updated_at: '2026-01-02',
        },
        { iid: 8, title: 'WIP login', web_url: 'u', state: 'opened', draft: true, source_branch: 'fix/login', target_branch: 'main', created_at: '', updated_at: '' },
      ])
    )
    expect(pullRequests[0].number).toBe(7) // GitLab iid -> shared `number`
    expect(pullRequests[1].isDraft).toBe(true)

    const tree = render(makeState(), {
      pullRequestList: { available: true, authenticated: true, repository: { owner: 'g', name: 'p' }, pullRequests },
      provider: {
        repository: { provider: 'gitlab', owner: 'g', name: 'p' },
        authenticated: true,
      } as never,
    })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('uses Merge-request wording on a GitLab repo (#0.70)', () => {
    const tree = render(makeState(), {
      pullRequestList: { available: true, authenticated: true, pullRequests: [makePr()] },
      provider: {
        repository: { provider: 'gitlab', owner: 'g', name: 'p' },
        authenticated: true,
      } as never,
    })
    const text = treeText(tree)
    expect(text).toContain('Merge requests')
    expect(text).not.toContain('Pull requests')
  })

  it('keeps Pull-request wording on a GitHub repo (#0.70)', () => {
    const tree = render(makeState(), {
      pullRequestList: { available: true, authenticated: true, pullRequests: [makePr()] },
      provider: {
        repository: { provider: 'github', owner: 'o', name: 'r' },
        authenticated: true,
      } as never,
    })
    const text = treeText(tree)
    expect(text).toContain('Pull requests')
    expect(text).not.toContain('Merge requests')
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
