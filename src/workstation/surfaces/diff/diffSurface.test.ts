/**
 * Worktree-staging diff header — the hunk-staging progress rail (#1184).
 *
 * The header shows `Hunk n/N` + a rail with one marker per hunk
 * (filled = staged, hollow = unstaged, current bracketed) + a
 * staged/total count, so staging progress reads at a glance.
 *
 * Stub `Text` / `Box` so the tree flattens without pulling Ink (ESM)
 * into ts-jest — same pattern as the other surface tests.
 */
import { createElement } from 'react'
import { createLogInkState } from '../../../commands/log/inkViewModel'
import { createLogInkContextStatus } from '../../chrome/context'
import { createLogInkTheme } from '../../chrome/theme'
import { renderDiffSurface } from './index'
import type { LogInkComponents, LogInkContext, SurfaceRenderContext } from '../../runtime/types'
import type { DiffSurfaceData } from './index'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const components: LogInkComponents = { Box, Text }
const theme = createLogInkTheme({ noColor: false })

function flattenText(node: unknown): string {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join('')
  const el = node as { props?: { children?: unknown } }
  if (el.props && 'children' in el.props) return flattenText(el.props.children)
  return ''
}

// Four hunks: #1 staged, #2 unstaged, #3 staged, #4 unstaged.
const hunkStates = ['staged', 'unstaged', 'staged', 'unstaged'] as const

// Hunk `@@` headers at line offsets 0/5/10/15 → the current hunk is
// derived from the viewport's scroll offset (#1185): offset 0 → hunk 1,
// 5 → hunk 2, 10 → hunk 3, 15 → hunk 4.
const hunkOffsets = [0, 5, 10, 15]
const diffLines = Array.from({ length: 20 }, (_, i) => (hunkOffsets.includes(i) ? `@@ hunk ${i} @@` : ` line ${i}`))

function render(worktreeDiffOffset: number): string {
  const base = createLogInkState([])
  const ctx = {
    h: createElement,
    components,
    state: {
      ...base,
      activeView: 'diff',
      diffSource: 'worktree',
      focus: 'commits',
      selectedWorktreeFileIndex: 0,
      worktreeDiffOffset,
    },
    context: {
      worktree: {
        files: [{ path: 'src/a.ts', indexStatus: 'M', worktreeStatus: 'M', state: 'unstaged' }],
        stagedCount: 2,
        unstagedCount: 2,
        untrackedCount: 0,
      },
    } as unknown as LogInkContext,
    contextStatus: createLogInkContextStatus('ready'),
    bodyRows: 30,
    width: 100,
    theme,
  } as unknown as SurfaceRenderContext

  const diff = {
    worktreeDiff: {
      filePath: 'src/a.ts',
      untracked: false,
      lines: diffLines,
      hunkOffsets,
    },
    worktreeDiffLoading: false,
    worktreeHunks: { hunks: hunkStates.map((state) => ({ state })) },
    worktreeHunksLoading: false,
    filePreview: undefined,
    filePreviewLoading: false,
    commitDiffHunkOffsets: undefined,
    selectedDetailFile: undefined,
    stashDiffLines: undefined,
    stashDiffLoading: false,
    compareDiffLines: undefined,
    compareDiffLoading: false,
    syntaxSpans: undefined,
  } as unknown as DiffSurfaceData

  return flattenText(renderDiffSurface(ctx, diff))
}

describe('worktree diff — hunk staging rail (#1184, #1185)', () => {
  it('renders a marker per hunk with the current one (by scroll offset) bracketed', () => {
    // Scrolled to hunk 2 (offset 5, unstaged): ● [○] ● ○
    expect(render(5)).toContain('●[○]●○')
  })

  it('moves the bracket to the hunk the viewport is on', () => {
    // Scrolled to hunk 3 (offset 10, staged): ● ○ [●] ○
    expect(render(10)).toContain('●○[●]○')
  })

  it('shows the staged/total count and hunk position', () => {
    const text = render(0)
    expect(text).toContain('Hunk 1/4')
    expect(text).toContain('2/4 staged')
  })
})
