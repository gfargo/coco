/**
 * Sidebar list tabs render the SAME sorted+filtered lists the input
 * layer clamps against and the workflow runner resolves targets from
 * (#1341). Before the fix the branches tab rendered the raw unfiltered
 * list, so with an active filter the highlighted row and the acted-on
 * row could be different branches.
 *
 * Stub `Text` / `Box` so the tree flattens without pulling Ink (ESM)
 * into ts-jest — same pattern as `currentBranchHighlight.test.ts`.
 */
import { createElement } from 'react'
import { createLogInkState } from '../../workstation/runtime/inkViewModel'
import { createLogInkContextStatus } from '../chrome/context'
import { createLogInkTheme } from '../chrome/theme'
import { renderSidebar } from './sidebar'
import type { LogInkComponents, LogInkContext } from './types'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const components: LogInkComponents = { Box, Text }
const theme = createLogInkTheme({})

function flattenText(node: unknown): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('\n')
  const el = node as { props?: { children?: unknown } }
  if (el.props && 'children' in el.props) return flattenText(el.props.children)
  return ''
}

const context: LogInkContext = {
  branches: {
    currentBranch: 'main',
    dirty: false,
    remoteBranches: [],
    localBranches: [
      { type: 'local', name: 'main', shortName: 'main', hash: 'a1', current: true, date: '2024-01-03', subject: 's', ahead: 0, behind: 0 },
      { type: 'local', name: 'feat/login', shortName: 'feat/login', hash: 'b2', current: false, date: '2024-01-02', subject: 's', ahead: 0, behind: 0 },
      { type: 'local', name: 'fix/crash', shortName: 'fix/crash', hash: 'c3', current: false, date: '2024-01-01', subject: 's', ahead: 0, behind: 0 },
    ],
  },
}

function renderBranchesTab(filter: string): string {
  const base = createLogInkState([])
  const state = {
    ...base,
    sidebarTab: 'branches' as const,
    focus: 'sidebar' as const,
    filter,
  }
  const tree = renderSidebar(
    createElement, components, state, context,
    createLogInkContextStatus('ready'), 40, 30, theme, 0
  )
  return flattenText(tree)
}

describe('sidebar list tabs honor the active filter (#1341)', () => {
  it('renders only the filter matches in the branches tab', () => {
    const text = renderBranchesTab('feat')
    expect(text).toContain('feat/login')
    expect(text).not.toContain('fix/crash')
    // `main` appears in the "Current:" header line but must not appear
    // as a selectable row — assert via the row marker spacing.
    expect(text).toContain('Current: main')
  })

  it('shows the narrowing as n/N in the tab header', () => {
    expect(renderBranchesTab('feat')).toContain('[Branches (1/3)]')
    // No filter → plain total, same as before.
    expect(renderBranchesTab('')).toContain('[Branches (3)]')
  })
})
