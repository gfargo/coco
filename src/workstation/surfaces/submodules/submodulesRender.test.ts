/**
 * Structural tests for `renderSubmodulesSurface`. Stubs `Text` / `Box` per the
 * `surfaces/status/statusRender.test.ts` pattern.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type { SubmoduleEntry, SubmoduleOverview } from '../../../git/submoduleData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderSubmodulesSurface } from './index'
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

function makeEntry(overrides: Partial<SubmoduleEntry> = {}): SubmoduleEntry {
  return {
    name: 'vendor/lib',
    path: 'vendor/lib',
    pinnedSha: 'abc1234',
    flag: 'clean',
    ...overrides,
  } as SubmoduleEntry
}

function render(
  state: LogInkState,
  options: { submodules?: SubmoduleOverview; loading?: boolean; bodyRows?: number } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = options.submodules ? { submodules: options.submodules } : {}
  const contextStatus = options.loading
    ? updateLogInkContextStatus(createLogInkContextStatus('idle'), 'submodules', 'loading')
    : createLogInkContextStatus('ready')
  return renderSubmodulesSurface({
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

describe('renderSubmodulesSurface', () => {
  it('renders an empty state when no submodules are registered', () => {
    const tree = render(makeState(), { submodules: { hasSubmodules: false, entries: [] } })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders a loading placeholder while submodules hydrate', () => {
    expect(render(makeState(), { loading: true })).toBeDefined()
  })

  it('renders rows for populated submodules', () => {
    const tree = render(makeState(), {
      submodules: {
        hasSubmodules: true,
        entries: [makeEntry(), makeEntry({ name: 'vendor/other', path: 'vendor/other' })],
      },
    })
    expect(tree).toBeDefined()
  })

  it('reflects focus state via border color', () => {
    const populated: SubmoduleOverview = { hasSubmodules: true, entries: [makeEntry()] }
    const focused = render(makeState({ focus: 'commits' }), { submodules: populated })
    const blurred = render(makeState({ focus: 'sidebar' }), { submodules: populated })
    expect((focused.props as StubProps).borderColor).not.toBe(
      (blurred.props as StubProps).borderColor
    )
  })

  it('structural snapshot — empty', () => {
    expect(
      render(makeState(), { submodules: { hasSubmodules: false, entries: [] } })
    ).toMatchSnapshot()
  })

  it('structural snapshot — populated', () => {
    expect(
      render(makeState(), { submodules: { hasSubmodules: true, entries: [makeEntry()] } })
    ).toMatchSnapshot()
  })

  // Regression (#1615): submodules windowed its rows with
  // clampListWindowStart but rendered no scroll indicators, unlike every
  // other windowed promoted surface (branches, tags, stash, ...).
  describe('scroll indicators (#1615)', () => {
    const manySubmodules: SubmoduleOverview = {
      hasSubmodules: true,
      entries: Array.from({ length: 30 }, (_, i) =>
        makeEntry({ name: `vendor/lib-${i}`, path: `vendor/lib-${i}` })),
    }

    it('shows only "more below" when cursored at the top', () => {
      const tree = render(makeState({ selectedSubmoduleIndex: 0 }), {
        submodules: manySubmodules,
        bodyRows: 12,
      })
      const text = renderToLines(tree, Text, Box).join('\n')
      expect(text).not.toContain('more above')
      expect(text).toContain('more below')
    })

    it('shows only "more above" when cursored at the bottom', () => {
      const tree = render(makeState({ selectedSubmoduleIndex: manySubmodules.entries.length - 1 }), {
        submodules: manySubmodules,
        bodyRows: 12,
      })
      const text = renderToLines(tree, Text, Box).join('\n')
      expect(text).toContain('more above')
      expect(text).not.toContain('more below')
    })

    it('shows both indicators mid-list and keeps the total rendered rows within bodyRows', () => {
      const bodyRows = 12
      const tree = render(makeState({ selectedSubmoduleIndex: 15 }), {
        submodules: manySubmodules,
        bodyRows,
      })
      const lines = renderToLines(tree, Text, Box)
      const text = lines.join('\n')
      expect(text).toContain('more above')
      expect(text).toContain('more below')
      const BORDER_ROWS = 2
      expect(lines.length + BORDER_ROWS).toBeLessThanOrEqual(bodyRows)
    })

    it('keeps the total rendered row count within bodyRows with the filter affordance active too', () => {
      const bodyRows = 12
      const tree = render(
        makeState({ selectedSubmoduleIndex: 15, filterMode: true, filter: 'vendor' }),
        { submodules: manySubmodules, bodyRows }
      )
      const lines = renderToLines(tree, Text, Box)
      const BORDER_ROWS = 2
      expect(lines.length + BORDER_ROWS).toBeLessThanOrEqual(bodyRows)
    })
  })
})
