/**
 * Structural tests for `renderWorktreesSurface`. Stubs `Text` / `Box` per the
 * `surfaces/status/statusRender.test.ts` pattern.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type { WorktreeEntry, WorktreeOverview } from '../../../git/worktreeData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderWorktreesSurface } from './index'
import { renderToLines } from '../../runtime/testSupport/renderToLines'

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
  options: { worktreeList?: WorktreeOverview; loading?: boolean; bodyRows?: number } = {}
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
    bodyRows: options.bodyRows ?? 30,
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

  // Regression (#1620): an active filter matching zero worktrees used to
  // render the same "No linked worktrees." copy as a genuinely empty repo,
  // contradicting the header's "0/N worktrees | filter: …" line.
  describe('filtered-to-zero empty state (#1620)', () => {
    function flatten(node: unknown, out: string[] = []): string[] {
      if (node == null) return out
      if (typeof node === 'string') { out.push(node); return out }
      if (Array.isArray(node)) { node.forEach((n) => flatten(n, out)); return out }
      const props = (node as { props?: { children?: unknown } }).props
      if (props) flatten(props.children, out)
      return out
    }

    it('shows filter-aware copy, not the genuinely-empty message, when the filter matches nothing', () => {
      const tree = render(makeState({ filter: 'no-such-worktree' }), {
        worktreeList: makeOverview([makeEntry()]),
      })
      const text = flatten(tree).join('\n')
      expect(text).toContain("No worktrees match filter 'no-such-worktree'")
      expect(text).not.toContain('No linked worktrees.')
    })

    it('still shows the genuinely-empty message with no filter active', () => {
      const tree = render(makeState(), { worktreeList: makeOverview([]) })
      const text = flatten(tree).join('\n')
      expect(text).toContain('No linked worktrees.')
    })
  })

  // Regression (#1615): worktrees windowed its rows with clampListWindowStart
  // but rendered no scroll indicators, unlike every other windowed promoted
  // surface (branches, tags, stash, ...) — a long worktree list read as "this
  // is everything" with no signal that entries scrolled off either edge.
  describe('scroll indicators (#1615)', () => {
    const manyWorktrees = Array.from({ length: 30 }, (_, i) =>
      makeEntry({ path: `/repo-wt-${i}`, branch: `feature/${i}`, current: i === 0 }))

    it('shows only "more below" when cursored at the top', () => {
      const tree = render(makeState({ selectedWorktreeListIndex: 0 }), {
        worktreeList: makeOverview(manyWorktrees),
        bodyRows: 12,
      })
      const lines = renderToLines(tree, Text, Box)
      const text = lines.join('\n')
      expect(text).not.toContain('more above')
      expect(text).toContain('more below')
    })

    it('shows only "more above" when cursored at the bottom', () => {
      const tree = render(makeState({ selectedWorktreeListIndex: manyWorktrees.length - 1 }), {
        worktreeList: makeOverview(manyWorktrees),
        bodyRows: 12,
      })
      const lines = renderToLines(tree, Text, Box)
      const text = lines.join('\n')
      expect(text).toContain('more above')
      expect(text).not.toContain('more below')
    })

    it('shows both indicators mid-list and keeps the total rendered rows within bodyRows', () => {
      const bodyRows = 12
      const tree = render(makeState({ selectedWorktreeListIndex: 15 }), {
        worktreeList: makeOverview(manyWorktrees),
        bodyRows,
      })
      const lines = renderToLines(tree, Text, Box)
      const text = lines.join('\n')
      expect(text).toContain('more above')
      expect(text).toContain('more below')
      // The panel's own border isn't part of the flattened content lines
      // renderToLines counts, but it still costs 2 rows against bodyRows.
      const BORDER_ROWS = 2
      expect(lines.length + BORDER_ROWS).toBeLessThanOrEqual(bodyRows)
    })

    it('keeps the total rendered row count within bodyRows with the filter affordance active too', () => {
      const bodyRows = 12
      const tree = render(
        makeState({ selectedWorktreeListIndex: 15, filterMode: true, filter: 'feature' }),
        { worktreeList: makeOverview(manyWorktrees), bodyRows }
      )
      const lines = renderToLines(tree, Text, Box)
      const BORDER_ROWS = 2
      expect(lines.length + BORDER_ROWS).toBeLessThanOrEqual(bodyRows)
    })
  })
})
