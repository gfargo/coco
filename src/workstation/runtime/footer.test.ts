/**
 * Structural snapshot tests for `renderFooter`.
 *
 * The footer is the most-glanced surface in the workstation — every
 * keystroke triggers an idle-tip cycle and most workflows poke a
 * status message. The two-row layout (hint band on row 1, status
 * band on row 2) is load-bearing for readability and easy to break by
 * accident.
 *
 * Snapshots are structural, not visual: stub `Text` / `Box` collect
 * their props and children into synthetic elements so jest pretty-
 * prints the React tree. Deterministic across CI + dev terminals.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../chrome/theme'
import { renderFooter } from './footer'
import type { LogInkContext } from './types'

// Synthetic stub for Ink's <Text> — collects every prop the renderer
// passes (color, dimColor, bold, children, …) and renders them under
// a 'text' element so jest's snapshot serializer pretty-prints the
// tree without us pulling Ink (ESM) into ts-jest. Same trick as
// `branchTipChipRender.test.ts`.
type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props as Record<string, unknown>, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const Box = ((props: StubProps) =>
  createElement('box', props as Record<string, unknown>, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

// Element-tree access helper. The renderer returns a real React
// element whose props.children is itself an array of elements — but
// the inferred type is React.ReactNode, which doesn't expose `.props`.
// Casting locally to a narrow `{ props: StubProps }` shape keeps the
// test bodies readable without scattering `as any` casts everywhere.
type Node = { props: StubProps & { children?: Node | Node[] } }
const asNode = (value: unknown): Node => value as Node
const childAt = (node: Node, index: number): Node => {
  const children = node.props.children
  if (!Array.isArray(children)) {
    throw new Error(`expected children to be an array, got: ${typeof children}`)
  }
  return children[index]
}

// Empty context — the footer only reaches into `branches.localBranches`
// etc. when sidebar tab counts are needed, and even then it handles
// `undefined` cleanly. Stripping the fields keeps the test independent
// of unrelated type evolution in BranchOverview / WorktreeOverview.
const baseContext: LogInkContext = {}

function makeState(overrides: Partial<LogInkState> = {}): LogInkState {
  return { ...createLogInkState([]), ...overrides }
}

function render(
  state: LogInkState,
  idleTip?: string,
  spinnerFrame = 0,
  options: { ascii?: boolean } = {}
): ReactElement {
  const theme = createLogInkTheme({ noColor: false, ascii: options.ascii })
  return renderFooter(
    createElement,
    { Box, Text },
    state,
    baseContext,
    theme,
    idleTip,
    spinnerFrame
  )
}

describe('renderFooter', () => {
  // The two-row layout is the whole point of this refactor — pin it
  // explicitly so a future "let's go back to one row" refactor breaks
  // the test loudly instead of regressing the UX.
  it('always wraps row 1 (hints) and row 2 (status) in a column Box with height 2', () => {
    const tree = asNode(render(makeState()))
    expect(tree.props.flexDirection).toBe('column')
    expect(tree.props.height).toBe(2)
    expect(tree.props.children).toHaveLength(2)
  })

  it('row 2 is an empty Text when no status, idle tip, or error is set', () => {
    const tree = asNode(render(makeState()))
    const row2 = childAt(tree, 1)
    expect(row2.props.children).toBe('')
    // Even an empty row still reserves the line — that's what keeps
    // the surrounding layout stable when status flips on/off.
  })

  it('row 2 shows the idle tip dimmed when no status is set (no glyph — passive channel)', () => {
    // Idle tips are the passive channel — purely educational, never
    // workflow feedback. They get no glyph prefix and stay dim+muted
    // so they blend into the chrome and don't compete with the hint
    // band. The info-kind status (with glyph + color) is the
    // contrast point.
    const tree = asNode(render(makeState(), 'press / to filter'))
    const row2 = childAt(tree, 1)
    expect(row2.props.children).toBe('press / to filter')
    expect(row2.props.dimColor).toBe(true)
    expect(row2.props.bold).toBe(false)
  })

  it('a real status message wins over an idle tip', () => {
    // Genuine workflow feedback must never be displaced by the idle
    // tip cycle — `setStatus` is the loud channel.
    const tree = asNode(render(
      makeState({ statusMessage: 'fetching…', statusLoading: true }),
      'press / to filter',
      0
    ))
    const row2 = childAt(tree, 1)
    expect(String(row2.props.children)).toContain('fetching…')
    expect(String(row2.props.children)).not.toContain('press / to filter')
  })

  it('loading status gets a spinner prefix + accent color + bold + non-dim', () => {
    const tree = asNode(render(
      makeState({ statusMessage: 'pulling…', statusLoading: true }),
      undefined,
      0
    ))
    const row2 = childAt(tree, 1)
    // The exact spinner glyph depends on `pickSpinnerFrame(0)` but the
    // body text + styling are what we care about.
    expect(String(row2.props.children)).toMatch(/.\spulling…$/)
    expect(row2.props.bold).toBe(true)
    expect(row2.props.dimColor).toBe(false)
    expect(row2.props.color).toBeDefined() // accent
  })

  it('error status renders with ✗ prefix + danger color + bold; hints stay on row 1', () => {
    // Critical UX: errors must NOT take over the hint band like they
    // did pre-refactor — users often need ?/:/q to recover.
    const tree = asNode(render(
      makeState({ statusMessage: 'remote rejected push', statusKind: 'error' })
    ))
    const row1 = childAt(tree, 0)
    const row2 = childAt(tree, 1)
    expect(row2.props.children).toBe('✗ remote rejected push')
    // Uses the theme's danger color (typically red), not a hardcoded
    // literal — so dark / light / colorblind themes can override it.
    expect(row2.props.color).toBe('red')
    expect(row2.props.bold).toBe(true)
    expect(row2.props.dimColor).toBe(false)
    // Row 1 still has both hint clusters.
    expect(row1.props.flexDirection).toBe('row')
    expect(row1.props.justifyContent).toBe('space-between')
    expect(row1.props.children).toHaveLength(2)
  })

  it('warning status renders with ⚠ prefix + warning color + bold', () => {
    // The yellow / warning kind sits between info and error — used
    // for ops that succeeded with caveats (no upstream, dirty
    // worktree, partial fetch).
    const tree = asNode(render(
      makeState({ statusMessage: 'no upstream — nothing to fetch.', statusKind: 'warning' })
    ))
    const row2 = childAt(tree, 1)
    expect(row2.props.children).toBe('⚠ no upstream — nothing to fetch.')
    expect(row2.props.color).toBe('yellow')
    expect(row2.props.bold).toBe(true)
    expect(row2.props.dimColor).toBe(false)
  })

  it('success status renders with ✓ prefix + success color + bold (distinct from loading)', () => {
    // Pre-redesign success and loading both used `accent` (cyan)
    // and the user couldn't tell "done" from "in progress" without
    // squinting at the prefix. Success now uses the theme's success
    // color (green) so the two states read at a glance.
    const tree = asNode(render(
      makeState({ statusMessage: 'pushed main to origin', statusKind: 'success' })
    ))
    const row2 = childAt(tree, 1)
    expect(row2.props.children).toBe('✓ pushed main to origin')
    expect(row2.props.color).toBe('green')
    expect(row2.props.bold).toBe(true)
    expect(row2.props.dimColor).toBe(false)
  })

  it('info status renders with ℹ prefix + info color + bold (more visible than idle tips)', () => {
    // Status messages without an explicit kind are deliberate updates
    // and should be more visible than the passive idle-tip channel.
    // Idle tips stay dim+muted; info-kind status pops with its own
    // theme color and glyph.
    const tree = asNode(render(makeState({ statusMessage: 'on branch main' })))
    const row2 = childAt(tree, 1)
    expect(row2.props.children).toBe('ℹ on branch main')
    expect(row2.props.color).toBe('blue')
    expect(row2.props.bold).toBe(true)
    expect(row2.props.dimColor).toBe(false)
  })

  it('ASCII mode degrades unicode glyphs to printable single-char fallbacks', () => {
    // Under TERM=dumb / vt100, unicode glyphs render as garbage. The
    // ASCII fallback for each kind: ! for error/warning, + for
    // success, i for info — printable everywhere.
    const errorAscii = asNode(render(
      makeState({ statusMessage: 'oops', statusKind: 'error' }),
      undefined, 0, { ascii: true }
    ))
    expect(childAt(errorAscii, 1).props.children).toBe('! oops')

    const warnAscii = asNode(render(
      makeState({ statusMessage: 'careful', statusKind: 'warning' }),
      undefined, 0, { ascii: true }
    ))
    expect(childAt(warnAscii, 1).props.children).toBe('! careful')

    const successAscii = asNode(render(
      makeState({ statusMessage: 'done', statusKind: 'success' }),
      undefined, 0, { ascii: true }
    ))
    expect(childAt(successAscii, 1).props.children).toBe('+ done')

    const infoAscii = asNode(render(
      makeState({ statusMessage: 'fyi' }),
      undefined, 0, { ascii: true }
    ))
    expect(childAt(infoAscii, 1).props.children).toBe('i fyi')
  })

  it('row 1 splits contextual vs global hints into opposite edges', () => {
    const tree = asNode(render(makeState()))
    const row1 = childAt(tree, 0)
    expect(row1.props.flexDirection).toBe('row')
    expect(row1.props.justifyContent).toBe('space-between')
    const contextual = childAt(row1, 0)
    const global = childAt(row1, 1)
    // Both clusters get the same muted treatment so neither steals
    // attention from the status row below.
    expect(contextual.props.dimColor).toBe(true)
    expect(global.props.dimColor).toBe(true)
  })

  // Single-pane fallback (#1135) — narrow terminals show one pane at a
  // time, so the footer prepends a Tab pane switcher for orientation.
  describe('single-pane pane switcher', () => {
    const renderSinglePane = (state: LogInkState) =>
      asNode(
        renderFooter(
          createElement,
          { Box, Text },
          state,
          baseContext,
          createLogInkTheme({ noColor: false }),
          undefined,
          0,
          true
        )
      )
    const contextualText = (tree: Node): string => {
      const contextual = childAt(childAt(tree, 0), 0)
      return String(contextual.props.children)
    }
    const globalText = (tree: Node): string => {
      const global = childAt(childAt(tree, 0), 1)
      return String(global.props.children)
    }

    it('prepends the switcher with the focused pane bracketed', () => {
      // Default focus is the commit list ('commits') → main is active.
      expect(contextualText(renderSinglePane(makeState()))).toContain('tab: sidebar [main] inspector')
      expect(contextualText(renderSinglePane(makeState({ focus: 'sidebar' })))).toContain('tab: [sidebar] main inspector')
      expect(contextualText(renderSinglePane(makeState({ focus: 'detail' })))).toContain('tab: sidebar main [inspector]')
    })

    it('omits the switcher when not in single-pane mode', () => {
      const tree = asNode(render(makeState()))
      expect(contextualText(tree)).not.toContain('tab:')
    })

    it('omits the switcher while an overlay owns the footer', () => {
      // The help overlay returns its own bindings; the switcher would
      // be misleading since Tab moves help focus, not the pane.
      expect(contextualText(renderSinglePane(makeState({ showHelp: true })))).not.toContain('tab:')
    })

    // #1135 v2 — peek discoverability + the in-peek snap-back affordance.
    it('surfaces "v peek" from the main / inspector pane', () => {
      expect(contextualText(renderSinglePane(makeState()))).toContain('v peek')
      expect(contextualText(renderSinglePane(makeState({ focus: 'detail' })))).toContain('v peek')
      // Not from the sidebar itself — you're already there.
      expect(contextualText(renderSinglePane(makeState({ focus: 'sidebar' })))).not.toContain('v peek')
    })

    it('swaps the switcher for the snap-back hint while peeking', () => {
      const peeking = makeState({ focus: 'sidebar', peekReturnFocus: 'commits' })
      const text = contextualText(renderSinglePane(peeking))
      expect(text).toContain('v/esc → main')
      // Mid-glance: the switcher / peek-open hint step aside.
      expect(text).not.toContain('tab:')
      expect(text).not.toContain('v peek')
    })

    // #1135 — the switcher (~29 cells) + peek affordance already claim
    // most of an 80-cell row, so the per-view hint tail and globals are
    // trimmed to fit the narrow floor without clipping.
    it('trims the global cluster to the recovery essentials', () => {
      // Drops g jump / < back / : cmds — those stay reachable via `?`.
      expect(globalText(renderSinglePane(makeState()))).toBe('? help · q quit')
      expect(globalText(renderSinglePane(makeState({ activeView: 'status' })))).toBe('? help · q quit')
    })

    it('keeps the single-pane footer within the 80-col floor', () => {
      const FLOOR = 80
      const cases: Array<Partial<LogInkState>> = [
        {}, // history / main
        { activeView: 'status' },
        { activeView: 'compose' },
        { activeView: 'diff', diffSource: 'worktree' },
        { focus: 'detail' }, // inspector visible
        { focus: 'sidebar' }, // sidebar via Tab
        { focus: 'sidebar', peekReturnFocus: 'commits' }, // peeking
      ]
      for (const overrides of cases) {
        const tree = renderSinglePane(makeState(overrides))
        const ctx = contextualText(tree)
        const glob = globalText(tree)
        // Row 1 width = contextual (joined) + global (joined) + paddingX(2)
        // + at least one cell of space-between gap. Arrow / dot glyphs are
        // single-width, so string length is a faithful column proxy here.
        expect(ctx.length + glob.length + 2 + 1).toBeLessThanOrEqual(FLOOR)
        // …and the orientation anchor is never the thing that gets cut.
        expect(ctx).toContain(overrides.peekReturnFocus ? 'v/esc → main' : 'tab:')
      }
    })

    it('keeps only the leading per-view hint in single-pane', () => {
      // Full three-pane history footer leads with `↑/↓ move`, `enter
      // diff`, … — single-pane keeps the first and drops the tail.
      const text = contextualText(renderSinglePane(makeState()))
      expect(text).toContain('↑/↓ move')
      expect(text).not.toContain('enter diff')
    })
  })

  // #1354 — the hint band must FIT the terminal. Pre-fix the footer
  // received no width at all: at the documented default 120 columns the
  // contextual + global clusters exceeded the row, both Text spans
  // wrapped, and the wrapped fragments pushed the height-2 box's status
  // row (errors, spinners, cancel hints) off-screen entirely.
  describe('hint band width fitting (#1354)', () => {
    const renderAt = (state: LogInkState, columns: number) =>
      asNode(
        renderFooter(
          createElement,
          { Box, Text },
          state,
          baseContext,
          createLogInkTheme({ noColor: false }),
          undefined,
          0,
          false,
          columns
        )
      )
    const rowText = (tree: Node): { ctx: string; glob: string } => {
      const row1 = childAt(tree, 0)
      return {
        ctx: String(childAt(row1, 0).props.children),
        glob: String(childAt(row1, 1).props.children),
      }
    }
    // The width-heaviest hint states from the audit captures.
    const cases: Array<Partial<LogInkState>> = [
      {}, // history
      { activeView: 'status' },
      { activeView: 'compose' },
      { activeView: 'diff', diffSource: 'worktree' },
      { activeView: 'diff', diffSource: 'commit' },
      { activeView: 'branches' },
      { focus: 'sidebar', sidebarTab: 'branches' },
    ]

    it.each([[120], [80]])('row 1 fits at %d columns for every heavy view', (columns) => {
      for (const overrides of cases) {
        const { ctx, glob } = rowText(renderAt(makeState(overrides), columns))
        // paddingX (2) + minimum space-between gap (>=1). Hint glyphs
        // are single-width so length is a faithful column proxy.
        expect(ctx.length + glob.length + 2 + 1).toBeLessThanOrEqual(columns)
      }
    })

    it('drops the contextual tail, keeping the leading essentials', () => {
      // Worktree diff carries the longest hint list; at 80 columns the
      // exotic tail must go while the leading movement hint survives.
      const { ctx } = rowText(
        renderAt(makeState({ activeView: 'diff', diffSource: 'worktree' }), 80)
      )
      expect(ctx).toContain('j/k lines')
      expect(ctx).not.toContain('esc back')
    })

    it('keeps the recovery globals intact at the default width', () => {
      const { glob } = rowText(
        renderAt(makeState({ activeView: 'diff', diffSource: 'worktree' }), 120)
      )
      expect(glob).toContain('? help')
      expect(glob).toContain('q quit')
    })
  })

  // Snapshot covers the no-status default — the layout most users see
  // most of the time — to catch incidental structural drift.
  it('structural snapshot — default no-status footer', () => {
    expect(render(makeState())).toMatchSnapshot()
  })

  it('structural snapshot — loading status on row 2', () => {
    expect(
      render(makeState({ statusMessage: 'fetching…', statusLoading: true }), undefined, 2)
    ).toMatchSnapshot()
  })

  it('structural snapshot — error keeps hints visible on row 1', () => {
    expect(
      render(makeState({ statusMessage: 'merge conflict', statusKind: 'error' }))
    ).toMatchSnapshot()
  })
})
