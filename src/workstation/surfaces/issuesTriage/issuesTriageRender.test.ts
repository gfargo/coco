/**
 * Structural tests for `renderIssuesTriageSurface`. Stubs `Text` / `Box` per the
 * `surfaces/status/statusRender.test.ts` pattern. Data flows in via
 * `context.issueList`.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type { IssueListItem, IssueListOverview } from '../../../git/issuesListData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { __test as gitlabInternals } from '../../../git/gitlabListData'
import { cellWidth } from '../../chrome/text'
import { renderIssuesTriageSurface } from './index'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const components: LogInkComponents = { Box, Text }

/** Flatten an element (sub)tree into its concatenated visible text. */
function treeText(node: unknown): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(treeText).join('')
  const el = node as { props?: { children?: unknown } }
  return el.props ? treeText(el.props.children) : ''
}

function makeState(overrides: Partial<LogInkState> = {}): LogInkState {
  return { ...createLogInkState([]), ...overrides }
}

function makeIssue(overrides: Partial<IssueListItem> = {}): IssueListItem {
  return {
    number: 1,
    title: 'Something is broken',
    url: 'https://github.com/o/r/issues/1',
    state: 'OPEN',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-02',
    ...overrides,
  } as IssueListItem
}

function render(
  state: LogInkState,
  options: { issueList?: IssueListOverview; loading?: boolean; width?: number } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = options.issueList ? { issueList: options.issueList } : {}
  const contextStatus = options.loading
    ? updateLogInkContextStatus(createLogInkContextStatus('idle'), 'issueList', 'loading')
    : createLogInkContextStatus('ready')
  return renderIssuesTriageSurface({
    h: createElement,
    components,
    state,
    context,
    contextStatus,
    bodyRows: 30,
    width: options.width ?? 120,
    theme,
  })
}

describe('renderIssuesTriageSurface', () => {
  it('renders an unavailable state with no GitHub remote', () => {
    const tree = render(makeState(), {
      issueList: { available: false, authenticated: false, message: 'No GitHub remote detected.' },
    })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders rows from GitLab-sourced issues (#0.70)', () => {
    const issues = gitlabInternals.parseIssues(
      JSON.stringify([
        {
          iid: 3,
          title: 'Investigate slow load',
          web_url: 'https://gitlab.com/g/p/-/issues/3',
          state: 'opened',
          author: { username: 'gfargo' },
          labels: ['triage'],
          user_notes_count: 2,
          created_at: '2026-01-01',
          updated_at: '2026-01-02',
        },
      ])
    )
    expect(issues[0]).toMatchObject({ number: 3, state: 'OPEN', labels: ['triage'], comments: 2 })

    const tree = render(makeState(), {
      issueList: { available: true, authenticated: true, repository: { owner: 'g', name: 'p' }, issues },
    })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders an empty authenticated list', () => {
    const tree = render(makeState(), {
      issueList: { available: true, authenticated: true, issues: [] },
    })
    expect(tree).toBeDefined()
  })

  it('renders a loading placeholder while issues hydrate', () => {
    expect(render(makeState(), { loading: true })).toBeDefined()
  })

  it('renders rows for a populated issue list', () => {
    const tree = render(makeState(), {
      issueList: {
        available: true,
        authenticated: true,
        issues: [makeIssue(), makeIssue({ number: 2, title: 'Another', state: 'CLOSED' })],
      },
    })
    expect(tree).toBeDefined()
  })

  it('keeps rows within the panel width when labels are long (#1339)', () => {
    const width = 80
    const tree = render(makeState(), {
      width,
      issueList: {
        available: true,
        authenticated: true,
        issues: [
          makeIssue({
            number: 1234,
            title: 'A fairly long issue title that already competes for row space',
            author: 'somebody-with-a-name',
            comments: 12,
            labels: ['bug', 'help wanted', 'good first issue', 'documentation', 'needs-triage'],
          }),
        ],
      },
    })
    const children = (tree.props as { children: unknown[] }).children
    const rows = children
      .flat()
      .map(treeText)
      .filter((line) => line.includes('#1234'))
    expect(rows).toHaveLength(1)
    // Border (2) + paddingX (2) leave width - 4 cells for row content.
    expect(cellWidth(rows[0])).toBeLessThanOrEqual(width - 4)
    // Labels are budgeted in, not dropped: at least the opening bracket
    // plus some label text must survive the truncation.
    expect(rows[0]).toContain(' [bug')
  })

  it('structural snapshot — empty list', () => {
    expect(
      render(makeState(), { issueList: { available: true, authenticated: true, issues: [] } })
    ).toMatchSnapshot()
  })

  it('structural snapshot — populated', () => {
    expect(
      render(makeState(), {
        issueList: { available: true, authenticated: true, issues: [makeIssue()] },
      })
    ).toMatchSnapshot()
  })
})
