/**
 * Structural tests for `renderComposeSurface`. Stubs `Text` / `Box` per the
 * `surfaces/status/statusRender.test.ts` pattern.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type { WorktreeFile, WorktreeOverview } from '../../../git/statusData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderComposeSurface } from './index'

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

function makeWorktree(files: WorktreeFile[]): WorktreeOverview {
  return {
    files,
    stagedCount: files.filter((f) => f.state === 'staged').length,
    unstagedCount: files.filter((f) => f.state === 'unstaged').length,
    untrackedCount: files.filter((f) => f.state === 'untracked').length,
  } as WorktreeOverview
}

function render(
  state: LogInkState,
  options: { worktree?: WorktreeOverview; loading?: boolean } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = options.worktree ? { worktree: options.worktree } : {}
  const contextStatus = options.loading
    ? updateLogInkContextStatus(createLogInkContextStatus('idle'), 'worktree', 'loading')
    : createLogInkContextStatus('ready')
  return renderComposeSurface({
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

describe('renderComposeSurface', () => {
  it('renders an empty state when no staged files are present', () => {
    const tree = render(makeState(), { worktree: makeWorktree([]) })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders a loading placeholder while worktree status hydrates', () => {
    expect(render(makeState(), { loading: true })).toBeDefined()
  })

  it('renders with staged changes present', () => {
    const tree = render(makeState(), {
      worktree: makeWorktree([
        {
          path: 'src/a.ts',
          indexStatus: 'M',
          worktreeStatus: ' ',
          state: 'staged',
        } as WorktreeFile,
      ]),
    })
    expect(tree).toBeDefined()
  })

  it('structural snapshot — empty', () => {
    expect(render(makeState(), { worktree: makeWorktree([]) })).toMatchSnapshot()
  })

  it('structural snapshot — loading', () => {
    expect(render(makeState(), { loading: true })).toMatchSnapshot()
  })
})
