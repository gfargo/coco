/**
 * Render smoke test for the `g?` view-keys which-key strip (#1137).
 *
 * Structural, not visual: stub `Text` / `Box` collect props into a
 * synthetic React tree so we can flatten the rendered text without
 * pulling Ink (ESM) into ts-jest. Same trick as `singlePane.test.ts`.
 */
import { createElement } from 'react'
import { createLogInkContextStatus } from '../chrome/context'
import { createLogInkTheme } from '../chrome/theme'
import { createLogInkState } from '../../commands/log/inkViewModel'
import { renderDetailPanel } from './detailPanel'
import { renderConfirmationPanel } from './overlays'
import type { LogInkComponents, LogInkContext } from './types'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const theme = createLogInkTheme({ noColor: true })
const context: LogInkContext = {}
const contextStatus = createLogInkContextStatus('ready')

// Walk the synthetic tree and concatenate every string child into one
// blob, so a test can assert on what the user would read on screen.
function flattenText(node: unknown): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join(' ')
  const element = node as { props?: { children?: unknown } }
  if (element.props && 'children' in element.props) {
    return flattenText(element.props.children)
  }
  return ''
}

function renderViewKeys(activeView: string) {
  const state = {
    ...createLogInkState([]),
    showViewKeys: true,
    activeView: activeView as never,
  }
  return renderDetailPanel(
    createElement,
    { Box, Text },
    state,
    context,
    contextStatus,
    undefined,
    false,
    undefined,
    false,
    60,
    false,
    theme,
    24
  )
}

describe('view-keys overlay (#1137)', () => {
  it('lists the current view’s single-key actions with labels', () => {
    const text = flattenText(renderViewKeys('history'))
    // The history overloads the issue calls out are present, by label.
    expect(text).toContain('cherry-pick')
    expect(text).toContain('revert')
    // Title names the view; footer documents the progressive-disclosure hint.
    expect(text).toContain('keys')
    expect(text).toContain('history')
    expect(text).toContain('? full help')
  })

  it('reflects a different view’s context', () => {
    const text = flattenText(renderViewKeys('branches'))
    // mark-compare (m) is available wherever commits/branches focus applies.
    expect(text).toContain('mark compare')
  })
})

describe('force-delete-branch confirmation panel', () => {
  const components: LogInkComponents = { Box, Text }

  it('explains the unmerged reason instead of the generic destructive warning', () => {
    const state = { ...createLogInkState([]), pendingConfirmationId: 'force-delete-branch' }
    const text = flattenText(renderConfirmationPanel(createElement, components, state, 80, theme, false))
    expect(text).toContain('Force-delete branch')
    expect(text).toContain('fully merged')
    expect(text).toContain('git branch -D')
    expect(text).not.toContain('Destructive Git action requires confirmation')
  })

  it('keeps the generic warning for an ordinary destructive confirm', () => {
    const state = { ...createLogInkState([]), pendingConfirmationId: 'delete-branch' }
    const text = flattenText(renderConfirmationPanel(createElement, components, state, 60, theme, false))
    expect(text).toContain('Destructive Git action requires confirmation')
  })
})
