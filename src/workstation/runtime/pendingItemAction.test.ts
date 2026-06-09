/**
 * Pending item-action inline spinner (#1137 follow-up).
 *
 * When an async action is in flight against a list-item row — a delete,
 * or (since the rename) a branch checkout — the targeted row shows an
 * inline spinner in place of its leading status icon (branches /
 * worktrees) or appended to the row (tags / stashes, which have no
 * leading icon). These tests cover the pure helper + reducer and assert
 * the spinner glyph lands on the right row in every surface and in the
 * sidebar, for both the delete and checkout actions.
 *
 * Stub `Text` / `Box` so the React tree can be flattened to text without
 * pulling Ink (ESM) into ts-jest — same pattern as `overlays.test.ts`.
 */
import { createElement } from 'react'
import {
  applyLogInkAction,
  createLogInkState,
  isPendingItemAction,
  type LogInkPendingItemAction,
} from '../../workstation/runtime/inkViewModel'
import { inlineSpinnerGlyph } from '../chrome/spinner'
import { createLogInkContextStatus } from '../chrome/context'
import { createLogInkTheme } from '../chrome/theme'
import { renderBranchesSurface } from '../surfaces/branches'
import { renderTagsSurface } from '../surfaces/tags'
import { renderStashSurface } from '../surfaces/stash'
import { renderWorktreesSurface } from '../surfaces/worktrees'
import { renderSidebar } from './sidebar'
import type { LogInkComponents, LogInkContext, SurfaceRenderContext } from './types'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const components: LogInkComponents = { Box, Text }
const theme = createLogInkTheme({ noColor: false })
const SPIN = inlineSpinnerGlyph(0, theme.ascii)

function flattenText(node: unknown): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join(' ')
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
      { type: 'local', name: 'main', shortName: 'main', hash: 'a1', current: true, date: '2024-01-01', subject: 's', ahead: 0, behind: 0 },
      { type: 'local', name: 'feat/x', shortName: 'feat/x', hash: 'b2', current: false, date: '2024-01-02', subject: 's', ahead: 0, behind: 0 },
    ],
  },
  tags: {
    tags: [
      { name: 'v1.0.0', hash: 'c3', date: '2024-01-01', subject: 'release one' },
      { name: 'v1.1.0', hash: 'c4', date: '2024-01-02', subject: 'release two' },
    ],
  },
  stashes: {
    stashes: [
      { ref: 'stash@{0}', hash: 'd5', baseHash: 'd5p', date: '2024-01-01', branch: 'main', message: 'wip one', files: ['a.ts'] },
      { ref: 'stash@{1}', hash: 'd6', baseHash: 'd6p', date: '2024-01-02', branch: 'main', message: 'wip two', files: ['b.ts'] },
    ],
  },
  worktreeList: {
    currentPath: '/repo',
    worktrees: [
      { path: '/repo', branch: 'main', detached: false, bare: false, current: true, dirty: false },
      { path: '/repo/wt', branch: 'feat/x', detached: false, bare: false, current: false, dirty: false },
    ],
  },
}

function ctxFor(
  view: 'branches' | 'tags' | 'stash' | 'worktrees',
  pending?: LogInkPendingItemAction
): SurfaceRenderContext {
  const base = createLogInkState([])
  return {
    h: createElement,
    components,
    state: { ...base, activeView: view, focus: 'commits', pendingItemAction: pending },
    context,
    contextStatus: createLogInkContextStatus('ready'),
    bodyRows: 30,
    width: 70,
    theme,
  }
}

describe('isPendingItemAction', () => {
  it('matches only on the same kind AND id', () => {
    const pending: LogInkPendingItemAction = { kind: 'branch', id: 'feat/x', action: 'delete' }
    expect(isPendingItemAction(pending, 'branch', 'feat/x')).toBe(true)
    expect(isPendingItemAction(pending, 'branch', 'main')).toBe(false) // id differs
    expect(isPendingItemAction(pending, 'tag', 'feat/x')).toBe(false) // kind differs
    expect(isPendingItemAction(undefined, 'branch', 'feat/x')).toBe(false)
  })

  it('is action-agnostic — a checkout in flight spins the same as a delete', () => {
    const checkout: LogInkPendingItemAction = { kind: 'branch', id: 'feat/x', action: 'checkout' }
    expect(isPendingItemAction(checkout, 'branch', 'feat/x')).toBe(true)
  })
})

describe('setPendingItemAction reducer', () => {
  it('sets and clears the pending target without touching anything else', () => {
    let state = createLogInkState([])
    expect(state.pendingItemAction).toBeUndefined()
    state = applyLogInkAction(state, { type: 'setPendingItemAction', value: { kind: 'stash', id: 'stash@{0}', action: 'delete' } })
    expect(state.pendingItemAction).toEqual({ kind: 'stash', id: 'stash@{0}', action: 'delete' })
    state = applyLogInkAction(state, { type: 'setPendingItemAction', value: undefined })
    expect(state.pendingItemAction).toBeUndefined()
  })
})

describe('inline pending spinner per surface', () => {
  it('branches: swaps the targeted row marker for a spinner, leaving others alone', () => {
    const plain = flattenText(renderBranchesSurface(ctxFor('branches'), 0))
    expect(plain).not.toContain(SPIN)

    const pending = flattenText(renderBranchesSurface(ctxFor('branches', { kind: 'branch', id: 'feat/x', action: 'delete' }), 0))
    expect(pending).toContain(SPIN)
    expect(pending).toContain('feat/x') // row still shows its name
  })

  it('branches: a pending checkout spins the targeted row too', () => {
    const pending = flattenText(renderBranchesSurface(ctxFor('branches', { kind: 'branch', id: 'feat/x', action: 'checkout' }), 0))
    expect(pending).toContain(SPIN)
    expect(pending).toContain('feat/x')
  })

  it('worktrees: swaps the targeted row marker for a spinner', () => {
    const pending = flattenText(renderWorktreesSurface(ctxFor('worktrees', { kind: 'worktree', id: '/repo/wt', action: 'delete' }), 0))
    expect(pending).toContain(SPIN)
    expect(flattenText(renderWorktreesSurface(ctxFor('worktrees'), 0))).not.toContain(SPIN)
  })

  it('tags: appends a spinner (no leading icon to swap)', () => {
    const pending = flattenText(renderTagsSurface(ctxFor('tags', { kind: 'tag', id: 'v1.1.0', action: 'delete' }), 0))
    expect(pending).toContain(SPIN)
    expect(pending).toContain('v1.1.0')
    expect(flattenText(renderTagsSurface(ctxFor('tags'), 0))).not.toContain(SPIN)
  })

  it('stashes: appends a spinner', () => {
    const pending = flattenText(renderStashSurface(ctxFor('stash', { kind: 'stash', id: 'stash@{1}', action: 'delete' }), 0))
    expect(pending).toContain(SPIN)
    expect(flattenText(renderStashSurface(ctxFor('stash'), 0))).not.toContain(SPIN)
  })
})

describe('inline pending spinner in the sidebar', () => {
  it('shows the spinner on the targeted branch row of the active tab', () => {
    const base = createLogInkState([])
    const state = { ...base, sidebarTab: 'branches' as const, focus: 'sidebar' as const, pendingItemAction: { kind: 'branch' as const, id: 'feat/x', action: 'delete' as const } }
    const tree = renderSidebar(createElement, components, state, context, createLogInkContextStatus('ready'), 40, 30, theme, 0)
    expect(flattenText(tree)).toContain(SPIN)
  })

  it('shows the spinner on a branch being checked out', () => {
    const base = createLogInkState([])
    const state = { ...base, sidebarTab: 'branches' as const, focus: 'sidebar' as const, pendingItemAction: { kind: 'branch' as const, id: 'feat/x', action: 'checkout' as const } }
    const tree = renderSidebar(createElement, components, state, context, createLogInkContextStatus('ready'), 40, 30, theme, 0)
    expect(flattenText(tree)).toContain(SPIN)
  })
})
