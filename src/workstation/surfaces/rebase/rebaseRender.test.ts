/**
 * Structural tests for `renderRebaseSurface` (#1359), following the
 * bisect/reflog stub pattern.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import { createLogInkContextStatus } from '../../chrome/context'
import type { LogInkComponents } from '../../runtime/types'
import { renderRebaseSurface } from './index'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const components: LogInkComponents = { Box, Text }

function render(
  state: LogInkState,
  options: { theme?: ReturnType<typeof createLogInkTheme> } = {}
): ReactElement {
  return renderRebaseSurface({
    h: createElement,
    components,
    state,
    context: {},
    contextStatus: createLogInkContextStatus('ready'),
    bodyRows: 20,
    width: 100,
    theme: options.theme ?? createLogInkTheme({}),
  })
}

function flatten(node: unknown, out: string[] = []): string[] {
  if (node == null) return out
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    node.forEach((child) => flatten(child, out))
    return out
  }
  const props = (node as { props?: { children?: unknown } }).props
  if (props) flatten(props.children, out)
  return out
}

/** Collects every `color` prop set anywhere in the tree (undefined entries omitted). */
function collectColors(node: unknown, out: string[] = []): string[] {
  if (node == null) return out
  if (Array.isArray(node)) {
    node.forEach((child) => collectColors(child, out))
    return out
  }
  const props = (node as { props?: { children?: unknown; color?: unknown } }).props
  if (!props) return out
  if (typeof props.color === 'string') out.push(props.color)
  collectColors(props.children, out)
  return out
}

const planRows = [
  { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'feat: one', author: 'Coco', date: '2026-05-01', action: 'pick' as const },
  { sha: 'b'.repeat(40), shortSha: 'bbbbbbb', subject: 'wip: fix', author: 'Coco', date: '2026-05-02', action: 'fixup' as const },
  { sha: 'c'.repeat(40), shortSha: 'ccccccc', subject: 'debug junk', author: 'Coco', date: '2026-05-03', action: 'drop' as const },
  { sha: 'd'.repeat(40), shortSha: 'ddddddd', subject: 'old title', author: 'Coco', date: '2026-05-04', action: 'reword' as const, newMessage: 'feat: new title' },
]

describe('renderRebaseSurface', () => {
  it('renders an empty-state hint when no plan is open', () => {
    const text = flatten(render(createLogInkState([]))).join('\n')
    expect(text).toContain('press i on a history commit')
  })

  it('renders rows with action tags, the resulting-count preview, and the reworded subject', () => {
    const state: LogInkState = {
      ...createLogInkState([]),
      activeView: 'rebase',
      rebasePlan: { rows: planRows, selectedIndex: 1 },
    }
    const text = flatten(render(state)).join('\n')
    // 4 in plan; drop removes one, fixup folds one → 2 resulting commits.
    expect(text).toContain('4 in plan · 2 results after squash/drop')
    expect(text).toContain('pick   aaaaaaa feat: one')
    expect(text).toContain('❯ fixup  bbbbbbb wip: fix')
    expect(text).toContain('drop   ccccccc debug junk')
    expect(text).toContain('reword ddddddd feat: new title (reworded)')
  })

  it('emits no color props under NO_COLOR, including for the selected row (#1611)', () => {
    // `createLogInkTheme({ noColor: true })` already zeroes `theme.colors`
    // to `{}`, so this passes even pre-fix under today's theme
    // construction — it's the explicit `theme.noColor` guards in
    // `actionColor` (and the selected-row color) that make the surface
    // match the convention every sibling surface follows (stateColor /
    // flagColor), rather than relying on that implementation detail.
    const state: LogInkState = {
      ...createLogInkState([]),
      activeView: 'rebase',
      rebasePlan: { rows: planRows, selectedIndex: 1 },
    }
    const tree = render(state, { theme: createLogInkTheme({ noColor: true }) })
    expect(collectColors(tree)).toEqual([])
  })
})
