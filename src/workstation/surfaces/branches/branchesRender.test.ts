/**
 * Structural tests for `renderBranchesSurface`.
 *
 * Mirrors the stubbing pattern in `surfaces/status/statusRender.test.ts`:
 * `Text` / `Box` are stubbed so jest's snapshot serializer can print the
 * React tree without pulling Ink (ESM) through ts-jest.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type { BranchOverview, BranchRef } from '../../../git/branchData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderBranchesSurface } from './index'
import { renderToLines } from '../../runtime/testSupport/renderToLines'
import { cellWidth } from '../../chrome/text'

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

function makeRef(overrides: Partial<BranchRef> = {}): BranchRef {
  return {
    type: 'local',
    name: 'main',
    shortName: 'main',
    hash: 'abc1234',
    current: false,
    date: '2024-01-01',
    subject: 'init',
    ahead: 0,
    behind: 0,
    ...overrides,
  } as BranchRef
}

function makeBranches(overrides: Partial<BranchOverview> = {}): BranchOverview {
  return {
    currentBranch: 'main',
    dirty: false,
    localBranches: [],
    remoteBranches: [],
    ...overrides,
  } as BranchOverview
}

function render(
  state: LogInkState,
  options: { branches?: BranchOverview; loading?: boolean } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = options.branches ? { branches: options.branches } : {}
  const contextStatus = options.loading
    ? updateLogInkContextStatus(createLogInkContextStatus('idle'), 'branches', 'loading')
    : createLogInkContextStatus('ready')
  return renderBranchesSurface({
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

describe('renderBranchesSurface', () => {
  it('renders an empty state when no branches are present', () => {
    const tree = render(makeState(), { branches: makeBranches() })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders a loading placeholder while branches hydrate', () => {
    const tree = render(makeState(), { loading: true })
    expect(tree).toBeDefined()
  })

  it('renders rows for populated local + remote branches', () => {
    const tree = render(makeState(), {
      branches: makeBranches({
        currentBranch: 'main',
        localBranches: [
          makeRef({ shortName: 'main', name: 'main', current: true }),
          makeRef({ shortName: 'feature/x', name: 'feature/x' }),
        ],
        remoteBranches: [
          makeRef({ type: 'remote', shortName: 'origin/main', name: 'origin/main', remote: 'origin' }),
        ],
      }),
    })
    expect(tree).toBeDefined()
  })

  it('reflects focus state via border color', () => {
    const focused = render(makeState({ focus: 'commits' }), { branches: makeBranches() })
    const blurred = render(makeState({ focus: 'sidebar' }), { branches: makeBranches() })
    expect((focused.props as StubProps).borderColor).not.toBe(
      (blurred.props as StubProps).borderColor
    )
  })

  it('structural snapshot — empty', () => {
    expect(render(makeState(), { branches: makeBranches() })).toMatchSnapshot()
  })

  it('structural snapshot — populated', () => {
    expect(
      render(makeState(), {
        branches: makeBranches({
          localBranches: [makeRef({ shortName: 'main', name: 'main', current: true })],
        }),
      })
    ).toMatchSnapshot()
  })

  // Regression (#1624): the name-column width was computed from
  // `branch.shortName.length` (UTF-16 code units) and padded with
  // `.padEnd` (code units again), so a wide-glyph branch name mis-measured
  // and shifted the divergence column relative to an ASCII-named row.
  describe('wide-glyph branch names align the divergence column (#1624)', () => {
    function divergenceColumnOffset(tree: ReactElement): number {
      const lines = renderToLines(tree, Text, Box)
      const marker = ' no upstream'
      const line = lines.find((entry) => entry.endsWith(marker))
      if (!line) throw new Error(`no rendered line ended with "${marker}"`)
      return cellWidth(line.slice(0, line.length - marker.length))
    }

    it('a CJK branch name lands the divergence column at the same cell offset as an ASCII name', () => {
      const asciiTree = render(makeState(), {
        branches: makeBranches({
          localBranches: [makeRef({ shortName: 'ab', name: 'ab', date: '2024-01-01' })],
        }),
      })
      const wideTree = render(makeState(), {
        branches: makeBranches({
          localBranches: [makeRef({ shortName: '日本', name: '日本', date: '2024-01-01' })],
        }),
      })

      expect(divergenceColumnOffset(asciiTree)).toBe(divergenceColumnOffset(wideTree))
    })
  })
})
