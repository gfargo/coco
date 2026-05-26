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
import { createLogInkState, type LogInkState } from '../../commands/log/inkViewModel'
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
  spinnerFrame = 0
): ReactElement {
  const theme = createLogInkTheme({ noColor: false })
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

  it('row 2 shows the idle tip dimmed when no status is set', () => {
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

  it('error status takes row 2 with ✗ prefix + red + bold; hints stay on row 1', () => {
    // Critical UX: errors must NOT take over the hint band like they
    // did pre-refactor — users often need ?/:/q to recover.
    const tree = asNode(render(
      makeState({ statusMessage: 'remote rejected push', statusKind: 'error' })
    ))
    const row1 = childAt(tree, 0)
    const row2 = childAt(tree, 1)
    expect(row2.props.children).toBe('✗ remote rejected push')
    expect(row2.props.color).toBe('red')
    expect(row2.props.bold).toBe(true)
    expect(row2.props.dimColor).toBe(false)
    // Row 1 still has both hint clusters.
    expect(row1.props.flexDirection).toBe('row')
    expect(row1.props.justifyContent).toBe('space-between')
    expect(row1.props.children).toHaveLength(2)
  })

  it('success status gets accent + bold + non-dim, no prefix glyph', () => {
    const tree = asNode(render(
      makeState({ statusMessage: 'pushed main to origin', statusKind: 'success' })
    ))
    const row2 = childAt(tree, 1)
    expect(row2.props.children).toBe('pushed main to origin')
    expect(row2.props.bold).toBe(true)
    expect(row2.props.dimColor).toBe(false)
  })

  it('info status is dim+muted with no prefix — matches surrounding chrome', () => {
    // Default informational status (no kind set) shouldn't compete
    // with the hint band — same dim treatment as the hints.
    const tree = asNode(render(makeState({ statusMessage: 'on branch main' })))
    const row2 = childAt(tree, 1)
    expect(row2.props.children).toBe('on branch main')
    expect(row2.props.dimColor).toBe(true)
    expect(row2.props.bold).toBe(false)
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
