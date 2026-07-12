/**
 * Structural tests for `renderReflogSurface`. Stubs `Text` / `Box` per the
 * `surfaces/status/statusRender.test.ts` pattern.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type { ReflogOverview, ReflogViewEntry } from '../../../git/reflogData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderReflogSurface } from './index'
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

function makeEntry(overrides: Partial<ReflogViewEntry> = {}): ReflogViewEntry {
  return {
    selector: 'HEAD@{0}',
    hash: 'abc1234',
    relativeDate: '2 hours ago',
    subject: 'commit: latest work',
    ...overrides,
  }
}

function render(
  state: LogInkState,
  options: { reflog?: ReflogOverview; loading?: boolean; bodyRows?: number } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = options.reflog ? { reflog: options.reflog } : {}
  const contextStatus = options.loading
    ? updateLogInkContextStatus(createLogInkContextStatus('idle'), 'reflog', 'loading')
    : createLogInkContextStatus('ready')
  return renderReflogSurface({
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

describe('renderReflogSurface', () => {
  it('renders an empty state when no reflog entries exist', () => {
    const tree = render(makeState(), { reflog: { entries: [] } })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders a loading placeholder while the reflog hydrates', () => {
    expect(render(makeState(), { loading: true })).toBeDefined()
  })

  it('renders rows for populated reflog entries', () => {
    const tree = render(makeState(), {
      reflog: {
        entries: [
          makeEntry(),
          makeEntry({ selector: 'HEAD@{1}', subject: 'checkout: moving to feature/x' }),
        ],
      },
    })
    expect(tree).toBeDefined()
  })

  it('reflects focus state via border color', () => {
    const focused = render(makeState({ focus: 'commits' }), { reflog: { entries: [makeEntry()] } })
    const blurred = render(makeState({ focus: 'sidebar' }), { reflog: { entries: [makeEntry()] } })
    expect((focused.props as StubProps).borderColor).not.toBe(
      (blurred.props as StubProps).borderColor
    )
  })

  it('structural snapshot — empty', () => {
    expect(render(makeState(), { reflog: { entries: [] } })).toMatchSnapshot()
  })

  it('structural snapshot — populated', () => {
    expect(render(makeState(), { reflog: { entries: [makeEntry()] } })).toMatchSnapshot()
  })

  // Regression (#1615): reflog windowed its rows with clampListWindowStart
  // but rendered no scroll indicators, unlike every other windowed promoted
  // surface (branches, tags, stash, ...) — and reflogs routinely have
  // hundreds of entries, so this reads as "this is the whole reflog."
  describe('scroll indicators (#1615)', () => {
    const manyEntries: ReflogOverview = {
      entries: Array.from({ length: 30 }, (_, i) =>
        makeEntry({ selector: `HEAD@{${i}}`, subject: `commit: change ${i}` })),
    }

    it('shows only "more below" when cursored at the top', () => {
      const tree = render(makeState({ selectedReflogIndex: 0 }), { reflog: manyEntries, bodyRows: 12 })
      const text = renderToLines(tree, Text, Box).join('\n')
      expect(text).not.toContain('more above')
      expect(text).toContain('more below')
    })

    it('shows only "more above" when cursored at the bottom', () => {
      const tree = render(makeState({ selectedReflogIndex: manyEntries.entries.length - 1 }), {
        reflog: manyEntries,
        bodyRows: 12,
      })
      const text = renderToLines(tree, Text, Box).join('\n')
      expect(text).toContain('more above')
      expect(text).not.toContain('more below')
    })

    it('shows both indicators mid-list and keeps the total rendered rows within bodyRows', () => {
      const bodyRows = 12
      const tree = render(makeState({ selectedReflogIndex: 15 }), { reflog: manyEntries, bodyRows })
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
        makeState({ selectedReflogIndex: 15, filterMode: true, filter: 'commit' }),
        { reflog: manyEntries, bodyRows }
      )
      const lines = renderToLines(tree, Text, Box)
      const BORDER_ROWS = 2
      expect(lines.length + BORDER_ROWS).toBeLessThanOrEqual(bodyRows)
    })
  })
})
