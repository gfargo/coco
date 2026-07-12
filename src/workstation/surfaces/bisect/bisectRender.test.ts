/**
 * Structural tests for `renderBisectSurface`. Stubs `Text` / `Box` per the
 * `surfaces/status/statusRender.test.ts` pattern. Unlike the uniform surfaces,
 * this renderer takes two extra args (candidate commit detail + its loading
 * flag); both are passed empty here.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type { BisectStatus } from '../../../git/bisectData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderBisectSurface } from './index'
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

function render(
  state: LogInkState,
  options: { bisect?: BisectStatus; loading?: boolean; bodyRows?: number } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = options.bisect ? { bisect: options.bisect } : {}
  const contextStatus = options.loading
    ? updateLogInkContextStatus(createLogInkContextStatus('idle'), 'bisect', 'loading')
    : createLogInkContextStatus('ready')
  return renderBisectSurface(
    {
      h: createElement,
      components,
      state,
      context,
      contextStatus,
      bodyRows: options.bodyRows ?? 30,
      width: 120,
      theme,
    },
    undefined,
    false
  )
}

describe('renderBisectSurface', () => {
  it('renders an inactive state when no bisect session is running', () => {
    const tree = render(makeState(), { bisect: { active: false, currentSha: '', log: [] } })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders when bisect context is absent', () => {
    expect(render(makeState())).toBeDefined()
  })

  it('renders a loading placeholder while bisect status hydrates', () => {
    expect(render(makeState(), { loading: true })).toBeDefined()
  })

  it('renders an active bisect session', () => {
    const tree = render(makeState(), {
      bisect: { active: true, currentSha: 'abc1234', log: [] },
    })
    expect(tree).toBeDefined()
  })

  it('structural snapshot — inactive', () => {
    expect(
      render(makeState(), { bisect: { active: false, currentSha: '', log: [] } })
    ).toMatchSnapshot()
  })

  it('structural snapshot — active', () => {
    expect(
      render(makeState(), { bisect: { active: true, currentSha: 'abc1234', log: [] } })
    ).toMatchSnapshot()
  })

  it('references the actual mark-good binding (y), not the chord-prefix key (g)', () => {
    const inactiveText = flattenText(
      render(makeState(), { bisect: { active: false, currentSha: '', log: [] } })
    )
    const activeText = flattenText(
      render(makeState(), { bisect: { active: true, currentSha: 'abc1234', log: [] } })
    )
    for (const text of [inactiveText, activeText]) {
      expect(text).not.toMatch(/\bg\s+(mark )?good\b/)
      expect(text).not.toMatch(/press g\b/)
    }
    expect(inactiveText).toMatch(/y\s+mark good/)
    expect(activeText).toMatch(/y good/)
    expect(activeText).toMatch(/press y/)
  })

  describe('empty-state height budget (#1585)', () => {
    // The panel's own title bar (1) + top/bottom border (2) aren't part
    // of the flattened content lines renderToLines counts, but they
    // still cost rows against bodyRows.
    const CHROME_ROWS = 3

    it('fits the 80x24 minimum-terminal budget (bodyRows: 19) by dropping the Tip section', () => {
      const tree = render(makeState(), { bisect: { active: false, currentSha: '', log: [] }, bodyRows: 19 })
      const lines = renderToLines(tree, Text, Box)
      expect(lines.length + CHROME_ROWS).toBeLessThanOrEqual(19)
      const text = lines.join('\n')
      expect(text).toContain('How to start')
      expect(text).not.toContain('Tip')
    })

    it('drops both Tip and How it works at an even tighter budget', () => {
      const tree = render(makeState(), { bisect: { active: false, currentSha: '', log: [] }, bodyRows: 14 })
      const lines = renderToLines(tree, Text, Box)
      expect(lines.length + CHROME_ROWS).toBeLessThanOrEqual(14)
      const text = lines.join('\n')
      expect(text).toContain('How to start')
      expect(text).not.toContain('Tip')
      expect(text).not.toContain('How it works')
    })

    it('shows the full explainer (including Tip) on a tall terminal', () => {
      const tree = render(makeState(), { bisect: { active: false, currentSha: '', log: [] }, bodyRows: 30 })
      const text = renderToLines(tree, Text, Box).join('\n')
      expect(text).toContain('How it works')
      expect(text).toContain('How to start')
      expect(text).toContain('Tip')
    })
  })
})

function flattenText(node: ReactElement | string | number | null | undefined): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  const children = (node as ReactElement<{ children?: unknown }>).props?.children
  if (Array.isArray(children)) {
    return children.map((child) => flattenText(child as ReactElement)).join(' ')
  }
  return flattenText(children as ReactElement)
}
