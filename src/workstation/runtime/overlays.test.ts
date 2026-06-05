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
import { renderConfirmationPanel, renderSplitPlanOverlay } from './overlays'
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

describe('split-plan overlay — unclaimed group (#1180)', () => {
  const components: LogInkComponents = { Box, Text }

  function stateWithPlan() {
    return {
      ...createLogInkState([]),
      splitPlan: {
        status: 'ready' as const,
        scrollOffset: 0,
        plan: {
          groups: [
            { title: 'feat: real work', files: ['src/a.ts'], hunks: [] },
            { title: 'Left for you — not committed', files: ['scratch.md'], hunks: [], unclaimed: true },
          ],
        },
      },
    }
  }

  it('renders the unclaimed group as a "stays in your worktree" note, not a numbered commit', () => {
    const text = flattenText(renderSplitPlanOverlay(createElement, components, stateWithPlan(), 100, 40, theme, false))
    // The confident group is commit #1…
    expect(text).toContain('1. feat: real work')
    // …and the unclaimed group is NOT numbered as commit #2.
    expect(text).not.toContain('2. Left for you')
    expect(text).toContain('stays in your worktree — not committed')
  })

  it('counts only committed groups in the header', () => {
    const text = flattenText(renderSplitPlanOverlay(createElement, components, stateWithPlan(), 100, 40, theme, false))
    expect(text).toContain('1 commit(s)')
    expect(text).toContain('1 set stays staged')
  })
})

describe('worktree-checkout-conflict confirmation panel (#1175)', () => {
  const components: LogInkComponents = { Box, Text }

  it('names the branch and worktree, and explains what y does', () => {
    const state = {
      ...createLogInkState([]),
      pendingConfirmationId: 'switch-to-conflicting-worktree',
      worktreeCheckoutConflict: { branch: 'feat/x', worktreePath: '/repo/.wt/foo', dirty: false },
    }
    const text = flattenText(renderConfirmationPanel(createElement, components, state, 100, theme, false))
    expect(text).toContain('feat/x')
    expect(text).toContain('/repo/.wt/foo')
    expect(text).toContain('switch')
    // Not the generic destructive copy — switching is non-destructive.
    expect(text).not.toContain('Destructive Git action requires confirmation')
  })

  it('enumerates the switch / remove keys', () => {
    const state = {
      ...createLogInkState([]),
      pendingConfirmationId: 'switch-to-conflicting-worktree',
      worktreeCheckoutConflict: { branch: 'feat/x', worktreePath: '/repo/.wt/foo', dirty: false },
    }
    const text = flattenText(renderConfirmationPanel(createElement, components, state, 120, theme, false))
    expect(text).toContain('remove worktree & check out here')
    expect(text).toContain('remove worktree & delete branch')
  })

  it('warns when the conflicting worktree is dirty', () => {
    const state = {
      ...createLogInkState([]),
      pendingConfirmationId: 'switch-to-conflicting-worktree',
      worktreeCheckoutConflict: { branch: 'feat/x', worktreePath: '/repo/.wt/foo', dirty: true },
    }
    const text = flattenText(renderConfirmationPanel(createElement, components, state, 120, theme, false))
    expect(text).toContain('uncommitted changes')
  })
})
