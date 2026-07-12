/**
 * Structural tests for `renderTagsSurface`. Stubs `Text` / `Box` so jest's
 * snapshot serializer can print the tree without pulling Ink through ts-jest,
 * matching `surfaces/status/statusRender.test.ts`.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
} from '../../chrome/context'
import type { GitTagRef, TagOverview } from '../../../git/tagData'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import { renderTagsSurface } from './index'
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

function makeTag(overrides: Partial<GitTagRef> = {}): GitTagRef {
  return { name: 'v1.0.0', hash: 'abc1234', date: '2024-01-01', subject: 'release', ...overrides }
}

function render(
  state: LogInkState,
  options: { tags?: TagOverview; loading?: boolean; bodyRows?: number } = {}
): ReactElement {
  const theme = createLogInkTheme({})
  const context: LogInkContext = options.tags ? { tags: options.tags } : {}
  const contextStatus = options.loading
    ? updateLogInkContextStatus(createLogInkContextStatus('idle'), 'tags', 'loading')
    : createLogInkContextStatus('ready')
  return renderTagsSurface({
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

describe('renderTagsSurface', () => {
  it('renders an empty state when no tags exist', () => {
    const tree = render(makeState(), { tags: { tags: [] } })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders a loading placeholder while tags hydrate', () => {
    expect(render(makeState(), { loading: true })).toBeDefined()
  })

  it('renders rows for populated tags', () => {
    const tree = render(makeState(), {
      tags: { tags: [makeTag(), makeTag({ name: 'v0.9.0', subject: 'beta' })] },
    })
    expect(tree).toBeDefined()
  })

  it('reflects focus state via border color', () => {
    const focused = render(makeState({ focus: 'commits' }), { tags: { tags: [makeTag()] } })
    const blurred = render(makeState({ focus: 'sidebar' }), { tags: { tags: [makeTag()] } })
    expect((focused.props as StubProps).borderColor).not.toBe(
      (blurred.props as StubProps).borderColor
    )
  })

  it('structural snapshot — empty', () => {
    expect(render(makeState(), { tags: { tags: [] } })).toMatchSnapshot()
  })

  it('structural snapshot — populated', () => {
    expect(render(makeState(), { tags: { tags: [makeTag()] } })).toMatchSnapshot()
  })

  describe('row budget with both scroll indicators (#1581, mirrors #1392)', () => {
    // 30 tags at bodyRows: 12 (listRows would be 8 with no reduction) —
    // cursored mid-list so BOTH "more above" and "more below" render at
    // once. Before the fix, listRows only reserved a single spare row
    // for the indicator pair, so the panel grew past its box.
    const manyTags: TagOverview = {
      tags: Array.from({ length: 30 }, (_, i) => makeTag({ name: `v${i}.0.0`, subject: `release ${i}` })),
    }
    // The panel's own top/bottom border isn't part of the flattened
    // content lines renderToLines counts, but it still costs 2 rows
    // against bodyRows (mirrors renderBudget.test.ts's BORDER_ROWS).
    const BORDER_ROWS = 2

    it('keeps the total rendered row count within bodyRows, no filter', () => {
      const tree = render(makeState({ selectedTagIndex: 15 }), { tags: manyTags, bodyRows: 12 })
      const lines = renderToLines(tree, Text, Box)
      expect(lines.length + BORDER_ROWS).toBeLessThanOrEqual(12)
    })

    it('keeps the total rendered row count within bodyRows, filter mode active', () => {
      const tree = render(makeState({ selectedTagIndex: 15, filterMode: true }), {
        tags: manyTags,
        bodyRows: 12,
      })
      const lines = renderToLines(tree, Text, Box)
      expect(lines.length + BORDER_ROWS).toBeLessThanOrEqual(12)
    })
  })
})
