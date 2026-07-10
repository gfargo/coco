/**
 * Render smoke test for the `g?` view-keys which-key strip (#1137).
 *
 * Structural, not visual: stub `Text` / `Box` collect props into a
 * synthetic React tree so we can flatten the rendered text without
 * pulling Ink (ESM) into ts-jest. Same trick as `singlePane.test.ts`.
 */
import { createElement } from 'react'
import * as React from 'react'
import { createLogInkContextStatus } from '../chrome/context'
import { createLogInkTheme } from '../chrome/theme'
import { createLogInkState } from '../../workstation/runtime/inkViewModel'
import { renderDetailPanel } from './detailPanel'
import { renderChoicePanel, renderConfirmationPanel, renderHelpPanel, renderSplitPlanOverlay } from './overlays'
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
  // The view-keys overlay returns before any per-view detail surface, so
  // the `React` arg is unused here — pass the real instance for shape.
  return renderDetailPanel(
    React,
    {
      h: createElement,
      components: { Box, Text },
      state,
      context,
      contextStatus,
      bodyRows: 24,
      width: 60,
      theme,
    },
    {
      detail: undefined,
      loading: false,
      filePreview: undefined,
      filePreviewLoading: false,
      tabbed: false,
    }
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
    const text = flattenText(renderConfirmationPanel(createElement, components, state, {}, 80, theme, false))
    expect(text).toContain('Force-delete branch')
    expect(text).toContain('fully merged')
    expect(text).toContain('git branch -D')
    expect(text).not.toContain('Destructive Git action requires confirmation')
  })

  it('keeps the generic warning for an ordinary destructive confirm', () => {
    const state = { ...createLogInkState([]), pendingConfirmationId: 'delete-branch' }
    const text = flattenText(renderConfirmationPanel(createElement, components, state, {}, 60, theme, false))
    expect(text).toContain('Destructive Git action requires confirmation')
  })
})

describe('confirmation target naming', () => {
  const components: LogInkComponents = { Box, Text }

  // Regression: destructive fallback keys (D / T / X / W) reach the
  // confirm from views where the target list isn't on screen, and the
  // panel showed only generic copy — the user confirmed blind.
  it('names the branch a delete-branch confirm will act on', () => {
    const state = { ...createLogInkState([]), pendingConfirmationId: 'delete-branch' }
    const context = {
      branches: {
        localBranches: [
          { shortName: 'main', current: true, ahead: 0, behind: 0 },
          { shortName: 'feature/login', current: false, ahead: 0, behind: 0 },
        ],
      },
    } as never
    const text = flattenText(renderConfirmationPanel(createElement, components, state, context, 80, theme, false))
    // Cursor at index 0 — the sorted list pins the current branch first.
    expect(text).toContain('branch: main')
  })

  it('names the cursored commit for cherry-pick confirms', () => {
    const rows = [{
      type: 'commit' as const, graph: '*', shortHash: 'abc1234', hash: 'abc1234'.padEnd(12, '0'),
      parents: [], date: '2026-05-01', author: 'Coco', refs: [], message: 'fix: the thing',
    }]
    const state = { ...createLogInkState(rows), pendingConfirmationId: 'cherry-pick-commit' }
    const text = flattenText(renderConfirmationPanel(createElement, components, state, {}, 80, theme, false))
    expect(text).toContain('commit abc1234: fix: the thing')
  })
})

describe('rebase-onto-branch confirmation panel (#0.71)', () => {
  const components: LogInkComponents = { Box, Text }

  it('renders the per-invocation warning naming both branches', () => {
    const state = {
      ...createLogInkState([]),
      pendingConfirmationId: 'rebase-onto-branch',
      pendingConfirmationPayload: "Rebase feature onto main? This rewrites feature's history.",
    }
    const text = flattenText(renderConfirmationPanel(createElement, components, state, {}, 80, theme, false))
    expect(text).toContain('Rebase current onto selected ref')
    expect(text).toContain("Rebase feature onto main? This rewrites feature's history.")
    expect(text).not.toContain('Destructive Git action requires confirmation')
  })

  it('falls back to a static warning when the payload is absent', () => {
    const state = { ...createLogInkState([]), pendingConfirmationId: 'rebase-onto-branch' }
    const text = flattenText(renderConfirmationPanel(createElement, components, state, {}, 80, theme, false))
    expect(text).toContain('Rebase rewrites the current branch')
  })
})

describe('checkout-created-branch confirmation panel (#1326)', () => {
  const components: LogInkComponents = { Box, Text }

  it('renders the branch name from payload and the switch-now prompt', () => {
    const state = {
      ...createLogInkState([]),
      pendingConfirmationId: 'checkout-created-branch',
      pendingConfirmationPayload: 'feature/foo',
    }
    const text = flattenText(renderConfirmationPanel(createElement, components, state, {}, 80, theme, false))
    expect(text).toContain('Check out created branch')
    expect(text).toContain("feature/foo")
    expect(text).toContain('switch to it now')
    expect(text).not.toContain('Destructive Git action requires confirmation')
  })

  it('falls back to a generic message when the payload is absent', () => {
    const state = { ...createLogInkState([]), pendingConfirmationId: 'checkout-created-branch' }
    const text = flattenText(renderConfirmationPanel(createElement, components, state, {}, 80, theme, false))
    expect(text).toContain('Branch created')
    expect(text).toContain('switch to it now')
    expect(text).not.toContain('Destructive Git action requires confirmation')
  })
})

describe('global-undo confirmation panel (#1361)', () => {
  const components: LogInkComponents = { Box, Text }

  it('renders the runtime-resolved undo description from payload', () => {
    const state = {
      ...createLogInkState([]),
      pendingConfirmationId: 'global-undo',
      pendingConfirmationPayload: "Undo checkout: switch back to 'main' (currently on 'feature').",
    }
    const text = flattenText(renderConfirmationPanel(createElement, components, state, {}, 80, theme, false))
    expect(text).toContain('Undo last operation')
    expect(text).toContain("Undo checkout: switch back to 'main' (currently on 'feature').")
    expect(text).not.toContain('Destructive Git action requires confirmation')
  })

  it('falls back to a generic message when the payload is absent', () => {
    const state = { ...createLogInkState([]), pendingConfirmationId: 'global-undo' }
    const text = flattenText(renderConfirmationPanel(createElement, components, state, {}, 80, theme, false))
    expect(text).toContain('Undo the last git operation using the reflog.')
    expect(text).not.toContain('Destructive Git action requires confirmation')
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

describe('split-plan overlay — dedupe rescue warning (#1462)', () => {
  const components: LogInkComponents = { Box, Text }

  function stateWithDedupeWarning() {
    return {
      ...createLogInkState([]),
      splitPlan: {
        status: 'ready' as const,
        scrollOffset: 0,
        plan: {
          groups: [
            { title: 'feat: docs', files: ['docs/page.tsx'], hunks: [] },
            { title: 'chore: misc', files: ['package.json'], hunks: [] },
          ],
        },
        dedupeWarnings: [
          {
            kind: 'file' as const,
            id: 'docs/page.tsx',
            keptGroupIndex: 0,
            keptGroupTitle: 'feat: docs',
            droppedGroupIndices: [1],
            droppedGroupTitles: ['chore: misc'],
          },
        ],
      },
    }
  }

  it('renders a warning banner naming the file and the kept/dropped commits', () => {
    const text = flattenText(
      renderSplitPlanOverlay(createElement, components, stateWithDedupeWarning(), 100, 40, theme, false)
    )
    expect(text).toContain('auto-resolved')
    expect(text).toContain('docs/page.tsx')
    expect(text).toContain('kept in "feat: docs"')
    expect(text).toContain('dropped from "chore: misc"')
  })

  it('renders no warning banner when there are no dedupe warnings', () => {
    const state = stateWithDedupeWarning()
    state.splitPlan.dedupeWarnings = []
    const text = flattenText(renderSplitPlanOverlay(createElement, components, state, 100, 40, theme, false))
    expect(text).not.toContain('auto-resolved')
  })
})

describe('choice panel — worktree-checkout conflict (#1175, #1181)', () => {
  const components: LogInkComponents = { Box, Text }

  const conflictPrompt = (dirty: boolean) => ({
    id: 'worktree-checkout-conflict',
    title: "'feat/x' is checked out in another worktree",
    warning: `Checked out at /repo/.wt/foo.${dirty ? ' That worktree has uncommitted changes — removal will be refused until it is clean or stashed.' : ''}`,
    options: [
      { key: 'y', label: 'Switch to that worktree', intent: 'switch-worktree' as const },
      { key: 'r', label: 'Remove worktree & check out here', workflowId: 'conflict-remove-worktree-checkout', destructive: true },
      { key: 'x', label: 'Remove worktree & delete branch', workflowId: 'conflict-remove-worktree-branch', destructive: true },
    ],
  })

  it('names the branch + worktree and lists every option with its key', () => {
    const text = flattenText(renderChoicePanel(createElement, components, conflictPrompt(false), 100, theme, false))
    expect(text).toContain('feat/x')
    expect(text).toContain('/repo/.wt/foo')
    expect(text).toContain('y  Switch to that worktree')
    expect(text).toContain('r  Remove worktree & check out here')
    expect(text).toContain('x  Remove worktree & delete branch')
    expect(text).toContain('n/Esc  cancel')
    // Generic confirmation copy must not leak into the choice panel.
    expect(text).not.toContain('Destructive Git action requires confirmation')
  })

  it('surfaces the dirty-worktree warning', () => {
    const text = flattenText(renderChoicePanel(createElement, components, conflictPrompt(true), 120, theme, false))
    expect(text).toContain('uncommitted changes')
  })
})

describe('help overlay filter line cell-truncation (#1431)', () => {
  const components: LogInkComponents = { Box, Text }
  const width = 40
  const longFilter = 'a'.repeat(200)

  it('truncates the in-progress filter input line instead of wrapping', () => {
    const state = {
      ...createLogInkState([]),
      showHelp: true,
      helpFilterMode: true,
      helpFilter: longFilter,
    }
    const text = flattenText(renderHelpPanel(createElement, components, state, width, theme, false))
    expect(text).toContain('filter:')
    expect(text).not.toContain(longFilter)
    // The longest run of the filter's repeated character left in the
    // output must respect the panel's row budget (width - 4), not wrap.
    const longestRun = Math.max(...(text.match(/a+/g) ?? ['']).map((run) => run.length))
    expect(longestRun).toBeLessThanOrEqual(width - 4)
  })

  it('truncates the no-match line instead of wrapping', () => {
    const state = {
      ...createLogInkState([]),
      showHelp: true,
      helpFilterMode: false,
      helpFilter: longFilter,
    }
    const text = flattenText(renderHelpPanel(createElement, components, state, width, theme, false))
    expect(text).toContain('No bindings match')
    expect(text).not.toContain(longFilter)
  })
})
