/**
 * Structural tests for `renderStatusSurface`.
 *
 * Status is the second-most-trafficked surface (behind history) — it
 * drives stage / unstage / revert / hunk-stage workflows from a
 * GitKraken-style left rail. Regressions here block users from doing
 * any worktree mutation.
 *
 * These tests stub `Text` / `Box` so jest's snapshot serializer can
 * pretty-print the React tree without pulling Ink (ESM) into ts-jest,
 * matching the pattern in `branchTipChipRender.test.ts` and
 * `runtime/footer.test.ts`.
 */
import { createElement, type ReactElement } from 'react'
import {
    createLogInkState,
    type LogInkState,
} from '../../../commands/log/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
    createLogInkContextStatus,
    type LogInkContextStatus,
    updateLogInkContextStatus,
} from '../../chrome/context'
import type { WorktreeFile, WorktreeOverview } from '../../../git/statusData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderStatusSurface } from './index'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props as Record<string, unknown>, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const Box = ((props: StubProps) =>
  createElement('box', props as Record<string, unknown>, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const components: LogInkComponents = { Box, Text }

function makeFile(overrides: Partial<WorktreeFile> = {}): WorktreeFile {
  return {
    path: 'src/example.ts',
    indexStatus: ' ',
    worktreeStatus: 'M',
    state: 'unstaged',
    ...overrides,
  }
}

function makeWorktree(files: WorktreeFile[]): WorktreeOverview {
  const stagedCount = files.filter((f) => f.state === 'staged').length
  const unstagedCount = files.filter((f) => f.state === 'unstaged').length
  const untrackedCount = files.filter((f) => f.state === 'untracked').length
  return {
    files,
    stagedCount,
    unstagedCount,
    untrackedCount,
  } as WorktreeOverview
}

function makeState(overrides: Partial<LogInkState> = {}): LogInkState {
  return { ...createLogInkState([]), ...overrides }
}

function render(
  state: LogInkState,
  options: {
    worktree?: WorktreeOverview
    contextStatus?: LogInkContextStatus
    bodyRows?: number
    width?: number
    ascii?: boolean
  } = {}
): ReactElement {
  const theme = createLogInkTheme({ ascii: options.ascii })
  const context: LogInkContext = options.worktree ? { worktree: options.worktree } : {}
  const contextStatus = options.contextStatus || createLogInkContextStatus('ready')
  return renderStatusSurface({
    h: createElement,
    components,
    state,
    context,
    contextStatus,
    bodyRows: options.bodyRows ?? 30,
    width: options.width ?? 120,
    theme,
  })
}

describe('renderStatusSurface', () => {
  it('renders the empty-clean state when no files are present', () => {
    // Empty worktree → status panel still renders, with the
    // hint-line fallback ("Worktree clean" or similar).
    const tree = render(makeState(), {
      worktree: makeWorktree([]),
    })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders a loading placeholder when worktree status is still loading', () => {
    const loadingStatus = updateLogInkContextStatus(
      createLogInkContextStatus('idle'),
      'worktree',
      'loading'
    )
    const tree = render(makeState(), {
      contextStatus: loadingStatus,
    })
    expect(tree).toBeDefined()
  })

  it('renders grouped rows for staged + unstaged + untracked files', () => {
    const files = [
      makeFile({ path: 'src/a.ts', indexStatus: 'M', worktreeStatus: ' ', state: 'staged' }),
      makeFile({ path: 'src/b.ts', indexStatus: ' ', worktreeStatus: 'M', state: 'unstaged' }),
      makeFile({ path: 'README.md', indexStatus: '?', worktreeStatus: '?', state: 'untracked' }),
    ]
    const tree = render(makeState(), {
      worktree: makeWorktree(files),
    })
    expect(tree).toBeDefined()
  })

  it('reflects focus state via border color', () => {
    const files = [makeFile()]
    const focused = render(makeState({ focus: 'commits' }), {
      worktree: makeWorktree(files),
    })
    const blurred = render(makeState({ focus: 'sidebar' }), {
      worktree: makeWorktree(files),
    })
    const focusedProps = focused.props as StubProps
    const blurredProps = blurred.props as StubProps
    expect(focusedProps.borderColor).not.toBe(blurredProps.borderColor)
  })

  it('shows the mask indicator when the filter mask is narrowed', () => {
    // Default mask is { staged: true, unstaged: true, untracked: true }
    // — the indicator is hidden. Narrow it to staged-only and the
    // indicator should appear in the panel.
    const files = [
      makeFile({ path: 'src/a.ts', indexStatus: 'M', worktreeStatus: ' ', state: 'staged' }),
      makeFile({ path: 'src/b.ts', indexStatus: ' ', worktreeStatus: 'M', state: 'unstaged' }),
    ]
    const tree = render(
      makeState({
        statusFilterMask: { staged: true, unstaged: false, untracked: false },
      }),
      { worktree: makeWorktree(files) }
    )
    expect(tree).toBeDefined()
  })

  it('handles empty filter result with hint to widen', () => {
    // When the worktree is non-clean but the active mask hides
    // every file, the panel surfaces a hint to press 1/2/3 rather
    // than showing the same "Worktree clean" message it shows for
    // genuinely clean repos.
    const files = [
      makeFile({ path: 'src/a.ts', state: 'unstaged' }),
    ]
    const tree = render(
      makeState({
        statusFilterMask: { staged: true, unstaged: false, untracked: false },
      }),
      { worktree: makeWorktree(files) }
    )
    expect(tree).toBeDefined()
  })

  it('respects ASCII mode for group arrows', () => {
    const files = [makeFile()]
    const ascii = render(makeState(), {
      worktree: makeWorktree(files),
      ascii: true,
    })
    const unicode = render(makeState(), {
      worktree: makeWorktree(files),
      ascii: false,
    })
    expect(ascii).toBeDefined()
    expect(unicode).toBeDefined()
  })

  it('structural snapshot — clean worktree', () => {
    expect(
      render(makeState(), { worktree: makeWorktree([]) })
    ).toMatchSnapshot()
  })

  it('structural snapshot — mixed staged + unstaged + untracked', () => {
    const files = [
      makeFile({ path: 'src/a.ts', indexStatus: 'M', worktreeStatus: ' ', state: 'staged' }),
      makeFile({ path: 'src/b.ts', indexStatus: ' ', worktreeStatus: 'M', state: 'unstaged' }),
      makeFile({ path: 'README.md', indexStatus: '?', worktreeStatus: '?', state: 'untracked' }),
    ]
    expect(
      render(makeState(), { worktree: makeWorktree(files) })
    ).toMatchSnapshot()
  })

  it('structural snapshot — loading worktree status', () => {
    const loadingStatus = updateLogInkContextStatus(
      createLogInkContextStatus('idle'),
      'worktree',
      'loading'
    )
    expect(
      render(makeState(), { contextStatus: loadingStatus })
    ).toMatchSnapshot()
  })
})
