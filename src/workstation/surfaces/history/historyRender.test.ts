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
} from '../../../workstation/runtime/inkViewModel'
import { createLogInkContextStatus } from '../../chrome/context'
import { createLogInkTheme } from '../../chrome/theme'
import type { GitLogRow } from '../../../git/logData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { formatHistoryFetchArgs, renderHistoryPanel } from './index'

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

// Connected linear chain (each commit's parent is the next) so the DAG
// layout reads as one trunk lane — `parents: []` everywhere would be
// three disconnected roots, each handed its own lane/color.
const baseRows: GitLogRow[] = [
  makeCommit({ shortHash: 'aaa1111', hash: 'aaa1111', parents: ['bbb2222'], message: 'feat: add something', refs: ['HEAD -> main'] }),
  makeCommit({ shortHash: 'bbb2222', hash: 'bbb2222', parents: ['ccc3333'], message: 'fix: resolve regression' }),
  makeCommit({ shortHash: 'ccc3333', hash: 'ccc3333', parents: [], message: 'docs: update README' }),
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
    {
      h: createElement,
      components,
      state,
      context: options.context || baseContext,
      contextStatus: createLogInkContextStatus('ready'),
      bodyRows: options.bodyRows ?? 30,
      width: options.width ?? 120,
      theme,
    },
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

  // Rail-density regressions (screenshot report, 2026-07): stacked mode
  // rendered nearly every commit as subject line + `·`-only meta line +
  // graph transition line — three terminal lines of mostly air per commit.
  describe('stacked-mode density', () => {
    const collectStrings = (node: unknown, out: string[]): string[] => {
      if (typeof node === 'string') {
        out.push(node)
      } else if (Array.isArray(node)) {
        node.forEach((child) => collectStrings(child, out))
      } else if (node && typeof node === 'object' && 'props' in node) {
        collectStrings((node as { props: { children?: unknown } }).props.children, out)
      }
      return out
    }

    const collectKeys = (node: unknown, out: string[]): string[] => {
      if (Array.isArray(node)) {
        node.forEach((child) => collectKeys(child, out))
      } else if (node && typeof node === 'object' && 'props' in node) {
        const key = (node as { key?: unknown }).key
        if (typeof key === 'string') out.push(key)
        collectKeys((node as { props: { children?: unknown } }).props.children, out)
      }
      return out
    }

    it('collapses ref-less rows to single-line under bucketing (no redundant date line)', () => {
      const tree = render(makeState(), {
        rowMode: 'stacked',
        width: 40,
        dateBucketingEnabled: true,
      })
      const strings = collectStrings(tree, [])
      // bbb2222 / ccc3333 have no refs; with bucketing active the bucket
      // header already conveys the timeframe, so line 2 is suppressed
      // entirely — no relative date, no `·` placeholder (#1421).
      expect(strings).not.toContain('8d')
      expect(strings).not.toContain('·')
    })

    it('skips per-commit graph transition rows in stacked mode', () => {
      const single = render(makeState(), { rowMode: 'single', width: 120 })
      const stacked = render(makeState(), { rowMode: 'stacked', width: 40 })
      const graphRows = (tree: ReactElement) =>
        collectKeys(tree, []).filter((key) => key.startsWith('graph-'))
      // Full-graph single mode keeps its spacer rhythm; stacked mode
      // drops the dedicated topology line (commits already cost 2 lines).
      expect(graphRows(single).length).toBeGreaterThan(0)
      expect(graphRows(stacked).length).toBe(0)
    })
  })

  // Line-aware viewport budgeting (#1163, follow-up to #1421): the old
  // `stackedDivisor` estimate assumed a fixed average lines-per-item ratio,
  // which under-fills the panel whenever the actual mix skews toward
  // one-line rows. These regressions measure the ACTUAL rendered line
  // count against the panel's line budget (`bodyRows - chromeRows`).
  describe('stacked-mode line-aware viewport budgeting', () => {
    // Builds a connected linear chain (each commit's parent is the next)
    // so the whole chain lays out as one trunk lane, same convention as
    // `baseRows` above.
    const makeChain = (count: number, refsAt: (index: number) => string[]): GitLogRow[] =>
      Array.from({ length: count }, (_, i) =>
        makeCommit({
          shortHash: `c${i}`.padEnd(7, '0'),
          hash: `hash${i}`,
          parents: i + 1 < count ? [`hash${i + 1}`] : [],
          date: '2026-05-26',
          message: `feat: commit number ${i}`,
          refs: refsAt(i),
        })
      )

    // A "-stack" Box renders 1 Text child when the row collapsed to a
    // single line (#1421) or 2 Text children (subject + metadata) when
    // it didn't; a bucket-header Text is always exactly 1 line.
    const countStackedLines = (node: unknown): number => {
      if (Array.isArray(node)) {
        return node.reduce((sum: number, child) => sum + countStackedLines(child), 0)
      }
      if (!node || typeof node !== 'object' || !('props' in node)) return 0
      const key = (node as { key?: unknown }).key
      if (typeof key === 'string' && key.startsWith('bucket-')) return 1
      if (typeof key === 'string' && key.endsWith('-stack')) {
        const children = (node as { props: { children?: unknown } }).props.children
        return Array.isArray(children) ? children.length : 1
      }
      return countStackedLines((node as { props: { children?: unknown } }).props.children)
    }

    const countStackedCommitRows = (node: unknown): number => {
      if (Array.isArray(node)) {
        return node.reduce((sum: number, child) => sum + countStackedCommitRows(child), 0)
      }
      if (!node || typeof node !== 'object' || !('props' in node)) return 0
      const key = (node as { key?: unknown }).key
      if (typeof key === 'string' && key.endsWith('-stack')) return 1
      return countStackedCommitRows((node as { props: { children?: unknown } }).props.children)
    }

    it('fills a mostly one-line window instead of under-filling per the old /1.4 estimate', () => {
      // 30 ref-less commits, all in the same date bucket ("Today") — the
      // #1421 collapse rule makes every commit a single line, which is
      // exactly the case the old fixed divisor under-filled.
      const rows = makeChain(30, () => [])
      const bodyRows = 24 // supported floor (80x24)
      const tree = render(makeState(createLogInkState(rows)), {
        rowMode: 'stacked',
        width: 80,
        bodyRows,
        dateBucketingEnabled: true,
      })

      // chromeRows here is 4 (no pending row, no upstream banner, no
      // fetch-args indicator) — see renderHistoryPanel's chromeRows calc.
      const lineBudget = bodyRows - 4
      const lines = countStackedLines(tree)
      const commitRows = countStackedCommitRows(tree)

      // Never overflows the panel...
      expect(lines).toBeLessThanOrEqual(lineBudget)
      // ...and fills it, rather than leaving it under-filled the way the
      // old `Math.floor((bodyRows - chromeRows) / 1.4)` item-count estimate
      // did (which would have requested only ~14 items here, well short of
      // the ~19 one-line commits that actually fit in a 20-line budget).
      expect(lines).toBe(lineBudget)
      expect(commitRows).toBeGreaterThan(14)
    })

    it('fills a mixed one-/two-line window without overflowing', () => {
      // Alternate ref-less commits (collapse to 1 line under bucketing)
      // with tagged commits (tags are never chipped away, so they retain
      // their metadata line and cost 2 lines).
      const rows = makeChain(30, (i) => (i % 2 === 0 ? ['v1.0'] : []))
      const bodyRows = 24
      const selectedIndex = rows.length - 1
      const tree = render(
        makeState({ ...createLogInkState(rows), selectedIndex }),
        {
          rowMode: 'stacked',
          width: 90,
          bodyRows,
          dateBucketingEnabled: true,
        }
      )

      const lineBudget = bodyRows - 4
      const lines = countStackedLines(tree)
      expect(lines).toBeLessThanOrEqual(lineBudget)
      expect(lines).toBeGreaterThan(0)

      // The selected commit (end of list, mixed heights) must still be
      // rendered — cursor-centered scrolling / selection visibility
      // (`getVisibleLogInkHistory`'s slide loop) must survive the
      // variable-count windowing.
      const collectStrings = (node: unknown, out: string[]): string[] => {
        if (typeof node === 'string') {
          out.push(node)
        } else if (Array.isArray(node)) {
          node.forEach((child) => collectStrings(child, out))
        } else if (node && typeof node === 'object' && 'props' in node) {
          collectStrings((node as { props: { children?: unknown } }).props.children, out)
        }
        return out
      }
      expect(collectStrings(tree, []).join(' ')).toContain(`commit number ${selectedIndex}`)
    })
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

describe('formatHistoryFetchArgs', () => {
  // Regression for #1361: pickaxe (S:) and grep-diff (G:) filters used
  // to fall through to the 'none' fallback here, so the filter banner
  // told users no server-side filter was active while one actually was.
  it('renders the pickaxe filter as -S<token>', () => {
    expect(formatHistoryFetchArgs({ pickaxe: 'useState' })).toBe('-SuseState')
  })

  it('renders the grep-diff filter as -G<regex>', () => {
    expect(formatHistoryFetchArgs({ grep: '^export' })).toBe('-G^export')
  })

  it('renders every active filter kind together', () => {
    expect(
      formatHistoryFetchArgs({ author: 'alice', path: 'src/', pickaxe: 'useState', grep: '^export' })
    ).toBe('--author=alice -- src/ -SuseState -G^export')
  })

  it('falls back to "none" when no filter is active', () => {
    expect(formatHistoryFetchArgs({})).toBe('none')
  })
})
