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

  describe('body overflow scrolling (#1345)', () => {
    // bodyRows: 30 → bodyRowsAvailable = 20; one row goes to the
    // overflow marker, so 19 body lines stay visible of the 30 below.
    const longBody = Array.from({ length: 30 }, (_, i) =>
      `L${String(i + 1).padStart(2, '0')}`).join('\n')

    function treeText(node: unknown): string {
      if (node == null || node === false) return ''
      if (typeof node === 'string' || typeof node === 'number') return String(node)
      if (Array.isArray(node)) return node.map(treeText).join('\n')
      const el = node as { props?: { children?: unknown } }
      return el.props ? treeText(el.props.children) : ''
    }

    it('pins the window to the tail while editing the body', () => {
      const base = createLogInkState([])
      const state = makeState({
        activeView: 'compose',
        commitCompose: { ...base.commitCompose, body: longBody, editing: true, field: 'body' },
      })
      const text = treeText(render(state, { worktree: makeWorktree([]) }))
      // The insertion point (last line) is visible; the head is elided
      // behind an explicit marker.
      expect(text).toContain('L30')
      expect(text).not.toContain('L01')
      expect(text).toContain('↑ 11 earlier lines')
    })

    it('keeps the head slice with a more-lines marker when not editing', () => {
      const base = createLogInkState([])
      const state = makeState({
        activeView: 'compose',
        commitCompose: { ...base.commitCompose, body: longBody, editing: false, field: 'body' },
      })
      const text = treeText(render(state, { worktree: makeWorktree([]) }))
      expect(text).toContain('L01')
      expect(text).not.toContain('L30')
      expect(text).toContain('↓ 11 more lines')
    })
  })

  it('structural snapshot — empty', () => {
    expect(render(makeState(), { worktree: makeWorktree([]) })).toMatchSnapshot()
  })

  it('structural snapshot — loading', () => {
    expect(render(makeState(), { loading: true })).toMatchSnapshot()
  })
})
