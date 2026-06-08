/**
 * Structural tests for `renderWorktreesSurface`. Stubs `Text` / `Box` per the
 * `surfaces/status/statusRender.test.ts` pattern.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../commands/log/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type { WorktreeEntry, WorktreeOverview } from '../../../git/worktreeData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderWorktreesSurface } from './index'

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

function makeEntry(overrides: Partial<WorktreeEntry> = {}): WorktreeEntry {
  return {
    path: '/repo',
    head: 'abc1234',
    branch: 'main',
    detached: false,
    bare: false,
    current: true,
    dirty: false,
    ...overrides,
  } as WorktreeEntry
}

function makeOverview(worktrees: WorktreeEntry[]): WorktreeOverview {
  return { currentPath: '/repo', worktrees }
}

function render(
  state: LogInkState,
  options: { worktreeList?: WorktreeOverview; loading?: boolean } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = options.worktreeList
    ? { worktreeList: options.worktreeList }
    : {}
  const contextStatus = options.loading
    ? updateLogInkContextStatus(createLogInkContextStatus('idle'), 'worktreeList', 'loading')
    : createLogInkContextStatus('ready')
  return renderWorktreesSurface({
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

describe('renderWorktreesSurface', () => {
  it('renders an empty state when no worktrees are listed', () => {
    const tree = render(makeState(), { worktreeList: makeOverview([]) })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders a loading placeholder while worktrees hydrate', () => {
    expect(render(makeState(), { loading: true })).toBeDefined()
  })

  it('renders rows for populated worktrees', () => {
    const tree = render(makeState(), {
      worktreeList: makeOverview([
        makeEntry(),
        makeEntry({ path: '/repo-wt', branch: 'feature/x', current: false, dirty: true }),
      ]),
    })
    expect(tree).toBeDefined()
  })

  it('reflects focus state via border color', () => {
    const overview = makeOverview([makeEntry()])
    const focused = render(makeState({ focus: 'commits' }), { worktreeList: overview })
    const blurred = render(makeState({ focus: 'sidebar' }), { worktreeList: overview })
    expect((focused.props as StubProps).borderColor).not.toBe(
      (blurred.props as StubProps).borderColor
    )
  })

  it('structural snapshot — empty', () => {
    expect(render(makeState(), { worktreeList: makeOverview([]) })).toMatchSnapshot()
  })

  it('structural snapshot — populated', () => {
    expect(
      render(makeState(), { worktreeList: makeOverview([makeEntry()]) })
    ).toMatchSnapshot()
  })
})
