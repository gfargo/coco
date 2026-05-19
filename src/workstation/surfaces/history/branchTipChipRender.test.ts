/**
 * Structural snapshot tests for `renderBranchTipChip`.
 *
 * Why: the chip is colour-coded by kind (`head` → success, `local` →
 * info, `remote` → warning) and renders subtly differently for
 * selected rows and `noColor` mode. Easy to break inadvertently
 * when refactoring nearby code. The shape of the returned React tree
 * captures every visual decision the function makes, so snapshotting
 * it pins the contract cleanly.
 *
 * These are STRUCTURAL snapshots, not visual frame captures: we
 * inspect the React element tree directly (Text stubs collect props)
 * rather than running Ink and capturing terminal escape codes. That
 * makes the snapshots deterministic across CI and developer terminals
 * and the diffs human-readable.
 */
import { createElement } from 'react'
import type { GitLogCommitRow } from '../../../commands/log/data'
import { createLogInkTheme } from '../../chrome/theme'
import { renderBranchTipChip } from './index'

// Stub Text component: a functional component that wraps its props
// and children into a synthetic 'text' element so jest's snapshot
// serializer pretty-prints the React tree without depending on Ink.
// We coerce to `any` because the real LogInkComponents['Text'] is
// Ink's Text type and we don't want to import Ink (ESM) inside a
// ts-jest CJS test. What ends up in the snapshot is what matters.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Text = ((props: any) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { children, ...rest } = props as any
  return createElement('text', rest, children)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any

function makeRow(refs: string[]): GitLogCommitRow {
  return {
    type: 'commit',
    graph: '*',
    shortHash: 'abc1234',
    hash: 'abc1234deadbeef',
    parents: [],
    date: '2026-05-18',
    author: 'Alice',
    refs,
    message: 'feat: example commit',
  }
}

function render(
  refs: string[],
  options: {
    selected?: boolean
    noColor?: boolean
    remoteNames?: string[]
  } = {}
) {
  const theme = createLogInkTheme({ noColor: options.noColor })
  const result = renderBranchTipChip(
    createElement,
    Text,
    makeRow(refs),
    theme,
    'test-key',
    options.selected ?? false,
    options.remoteNames
  )
  return { node: result.node, width: result.width, chip: result.chip }
}

describe('renderBranchTipChip — structural snapshots', () => {
  it('renders the HEAD chip as a green inverse pill', () => {
    expect(render(['HEAD -> main'])).toMatchSnapshot()
  })

  it('renders a plain local branch chip as a blue inverse pill', () => {
    expect(render(['develop'])).toMatchSnapshot()
  })

  it('renders a remote-tracking ref as a yellow inverse pill', () => {
    expect(render(['origin/main'])).toMatchSnapshot()
  })

  it('renders a slashy local branch as a blue pill when remoteNames distinguishes it', () => {
    // The critical regression case: feat/widgets contains a slash but
    // is NOT a remote ref. With remoteNames=['origin'] the classifier
    // recognizes this and paints it blue (local), not yellow (remote).
    expect(render(['feat/widgets'], { remoteNames: ['origin'] })).toMatchSnapshot()
  })

  it('falls back to the legacy "slash = remote" heuristic when remoteNames is absent', () => {
    // Without remoteNames, the same feat/widgets ref classifies as
    // remote and renders yellow. Pin the legacy behaviour so we know
    // exactly what callers without branch data get.
    expect(render(['feat/widgets'])).toMatchSnapshot()
  })

  it('drops pill styling on selected rows (the row inverse carries it)', () => {
    // When a row is selected we render the chip as bracketed plain
    // text so the row's outer inverse highlight isn't double-flipped
    // back to plain by a chip-level inverse.
    expect(render(['HEAD -> main'], { selected: true })).toMatchSnapshot()
  })

  it('renders bracketed fallback in noColor mode', () => {
    expect(render(['HEAD -> main'], { noColor: true })).toMatchSnapshot()
  })

  it('returns no node for refs without a chip-worthy entry', () => {
    const result = render(['tag: v1.0.0'])
    expect(result.node).toBeNull()
    expect(result.width).toBe(0)
    expect(result.chip).toBeUndefined()
  })

  it('reports a non-zero width for the chip-bearing variants', () => {
    expect(render(['HEAD -> main']).width).toBeGreaterThan(0)
    expect(render(['origin/main']).width).toBeGreaterThan(0)
    expect(render(['develop']).width).toBeGreaterThan(0)
  })
})
