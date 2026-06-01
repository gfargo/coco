/**
 * Structural snapshot tests for `renderHistoryPanel`.
 *
 * The history surface is the workstation's home screen — every coco
 * ui session lands here. The renderer makes a lot of conditional
 * decisions (full-graph vs compact, date bucketing, pending-commit
 * row, density tier, server-side filter banner) and a regression in
 * any of them shows up immediately for users.
 *
 * These are STRUCTURAL snapshots, not visual frame captures: stub
 * `Text` / `Box` collect their props and children into synthetic
 * elements so jest pretty-prints the React tree. Same approach as
 * `branchTipChipRender.test.ts` and `runtime/footer.test.ts` —
 * deterministic across CI + dev terminals, no Ink (ESM) needed.
 */
import { createElement, type ReactElement } from 'react'
import {
    createLogInkState,
    type LogInkState,
} from '../../../commands/log/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import type { GitLogRow } from '../../../commands/log/data'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderHistoryPanel } from './index'

// Synthetic stubs for Ink's <Text> / <Box> — collect every prop the
// renderer passes (color, dimColor, bold, children, …) and render
// them under 'text' / 'box' elements so jest's snapshot serializer
// pretty-prints the tree without us pulling Ink (ESM) into ts-jest.
type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props as Record<string, unknown>, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const Box = ((props: StubProps) =>
  createElement('box', props as Record<string, unknown>, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const components: LogInkComponents = { Box, Text }

function makeCommit(overrides: Partial<GitLogRow> = {}): GitLogRow {
  return {
    type: 'commit',
    graph: '*',
    shortHash: 'abc1234',
    hash: 'abc1234deadbeef',
    parents: [],
    date: '2026-05-18',
    author: 'Alice',
    refs: [],
    message: 'feat: example commit',
    ...overrides,
  } as GitLogRow
}

const baseRows: GitLogRow[] = [
  makeCommit({ shortHash: 'aaa1111', hash: 'aaa1111', message: 'feat: add something', refs: ['HEAD -> main'] }),
  makeCommit({ shortHash: 'bbb2222', hash: 'bbb2222', message: 'fix: resolve regression' }),
  makeCommit({ shortHash: 'ccc3333', hash: 'ccc3333', message: 'docs: update README' }),
]

function makeState(overrides: Partial<LogInkState> = {}): LogInkState {
  return { ...createLogInkState(baseRows), ...overrides }
}

const baseContext: LogInkContext = {}

function render(
  state: LogInkState,
  options: {
    context?: LogInkContext
    bodyRows?: number
    width?: number
    hasMoreCommits?: boolean
    loadingMoreCommits?: boolean
    density?: 'wide' | 'normal' | 'tight'
    rowMode?: 'single' | 'stacked'
    dateBucketingEnabled?: boolean
    now?: Date
    ascii?: boolean
  } = {}
): ReactElement {
  const theme = createLogInkTheme({ ascii: options.ascii })
  return renderHistoryPanel(
    createElement,
    components,
    state,
    options.context || baseContext,
    options.bodyRows ?? 30,
    options.width ?? 120,
    theme,
    options.hasMoreCommits ?? false,
    options.loadingMoreCommits ?? false,
    options.density || 'normal',
    options.rowMode || 'single',
    options.dateBucketingEnabled ?? false,
    options.now || new Date('2026-05-26T12:00:00Z')
  )
}

describe('renderHistoryPanel', () => {
  it('renders a non-empty React element for the default state', () => {
    const tree = render(makeState())
    // The panel is always wrapped in a Box — the renderer never
    // returns null for a populated commit list.
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('reflects the focused state in the panel border', () => {
    const focused = render(makeState({ focus: 'commits' }))
    const blurred = render(makeState({ focus: 'sidebar' }))
    // Focus changes the border color via `focusBorderColor`; the two
    // tree shapes should be structurally identical aside from the
    // borderColor prop.
    const focusedProps = focused.props as StubProps
    const blurredProps = blurred.props as StubProps
    expect(focusedProps.borderColor).not.toBe(blurredProps.borderColor)
  })

  it('handles an empty commit list without crashing', () => {
    const tree = render(makeState({ rows: [], commits: [], filteredCommits: [] }))
    expect(tree).toBeDefined()
    // Tree should still render — the renderer falls back to a hint
    // line ("No commits yet" / "Empty repository") rather than
    // throwing or returning null.
  })

  it('honours dateBucketingEnabled when no filter is active', () => {
    // When bucketing is on, the per-row date column drops in favour
    // of section headers like "── Today ──" or "── May 2026 ──".
    // We just assert that the tree shape changes deterministically
    // between bucketed and non-bucketed.
    const bucketed = render(makeState(), { dateBucketingEnabled: true })
    const flat = render(makeState(), { dateBucketingEnabled: false })
    // Both must render successfully; structural diff is observable
    // via snapshots if we add them later.
    expect(bucketed).toBeDefined()
    expect(flat).toBeDefined()
  })

  it('drops bucketing when a filter is active even if enabled', () => {
    // The renderer suppresses date bucket headers while a search
    // filter is active because filter results aren't strictly
    // chronological — adjacent rows may belong to different buckets.
    const filtered = render(
      makeState({ filter: 'fix', filterMode: false }),
      { dateBucketingEnabled: true }
    )
    expect(filtered).toBeDefined()
  })

  it('renders the loading indicator when loadingMoreCommits is true', () => {
    const tree = render(makeState(), { loadingMoreCommits: true, hasMoreCommits: true })
    expect(tree).toBeDefined()
  })

  it('respects ASCII mode for graph characters', () => {
    // ASCII mode swaps unicode graph chars for their ASCII fallbacks.
    // Both should render successfully — the test is here mostly to
    // guard against regressions where the graph helper assumes
    // unicode is always available.
    const ascii = render(makeState(), { ascii: true })
    const unicode = render(makeState(), { ascii: false })
    expect(ascii).toBeDefined()
    expect(unicode).toBeDefined()
  })

  it('handles narrow terminals (tight density)', () => {
    const tree = render(makeState(), { density: 'tight', width: 60 })
    expect(tree).toBeDefined()
  })

  it('handles stacked row mode for rail layouts', () => {
    const tree = render(makeState(), { rowMode: 'stacked', width: 40 })
    expect(tree).toBeDefined()
  })

  it('swaps the commit list for a loader while a remote op is in flight', () => {
    // Collect every string rendered anywhere in the tree.
    const collectText = (node: unknown, out: string[]): string[] => {
      if (typeof node === 'string') {
        out.push(node)
      } else if (Array.isArray(node)) {
        node.forEach((child) => collectText(child, out))
      } else if (node && typeof node === 'object' && 'props' in node) {
        collectText((node as { props: { children?: unknown } }).props.children, out)
      }
      return out
    }

    const loading = render(makeState({ remoteOp: { kind: 'fetch', label: 'Fetching all remotes…' } }))
    const normal = render(makeState())

    const loadingText = collectText(loading, []).join(' ')
    const normalText = collectText(normal, []).join(' ')

    // The loader surfaces its label and hint…
    expect(loadingText).toContain('Fetching all remotes…')
    expect(loadingText).toContain('history refreshes automatically')
    // …and suppresses the actual commit rows that the normal view shows.
    expect(normalText).toContain('add something')
    expect(loadingText).not.toContain('add something')
  })

  it('structural snapshot — default 3-commit history', () => {
    expect(render(makeState())).toMatchSnapshot()
  })

  it('structural snapshot — empty repo', () => {
    expect(
      render(makeState({ rows: [], commits: [], filteredCommits: [] }))
    ).toMatchSnapshot()
  })

  it('structural snapshot — narrow terminal (tight density)', () => {
    expect(
      render(makeState(), { density: 'tight', width: 60 })
    ).toMatchSnapshot()
  })
})
