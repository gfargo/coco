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
import { createLogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkContextStatus } from '../../chrome/context'
import { cellWidth } from '../../chrome/text'
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

function build(worktreeDiffOffset: number, width = 100, manyHunks = false): unknown {
  const base = createLogInkState([])
  const hunks = manyHunks
    ? Array.from({ length: 40 }, (_, i) => ({ state: i % 2 ? 'staged' : 'unstaged' }))
    : hunkStates.map((state) => ({ state }))
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
    width,
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
    worktreeHunks: { hunks },
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

  return renderDiffSurface(ctx, diff)
}

function render(worktreeDiffOffset: number): string {
  return flattenText(build(worktreeDiffOffset))
}

/** Flatten each header line (`diff-surface-header-*`) into its own string. */
function headerLines(node: unknown, out: string[] = []): string[] {
  if (node == null || node === false || typeof node === 'string' || typeof node === 'number') return out
  if (Array.isArray(node)) { node.forEach((n) => headerLines(n, out)); return out }
  const el = node as { key?: unknown; props?: { children?: unknown } }
  if (typeof el.key === 'string' && /^diff-surface-header-\d+$/.test(el.key)) {
    out.push(flattenText(el))
    return out
  }
  if (el.props && 'children' in el.props) headerLines(el.props.children, out)
  return out
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

  it('truncates the header to the panel interior at the narrow floor (#1187)', () => {
    // A 16-hunk rail would blow past a 50-col panel; the header must
    // truncate to the interior (width - 4), not the old hardcoded 140.
    const width = 50
    const lines = headerLines(build(0, width, true))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(cellWidth(line)).toBeLessThanOrEqual(width - 4)
    }
  })
})

describe('PR diff surface (#1363)', () => {
  const prPatch = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    'diff --git a/src/b.ts b/src/b.ts',
    '--- a/src/b.ts',
    '+++ b/src/b.ts',
    '@@ -2 +2 @@',
    '-two',
    '+three',
  ]

  function buildPr(overrides: {
    lines?: string[]
    loading?: boolean
    error?: string
    offset?: number
  } = {}): unknown {
    const base = createLogInkState([])
    const ctx = {
      h: createElement,
      components,
      state: {
        ...base,
        activeView: 'diff',
        diffSource: 'pr',
        prDiffNumber: 962,
        focus: 'commits',
        diffPreviewOffset: overrides.offset ?? 0,
      },
      context: {
        pullRequestList: {
          available: true,
          authenticated: true,
          pullRequests: [
            { number: 962, title: 'feat: triage detail' },
          ],
        },
      } as unknown as LogInkContext,
      contextStatus: createLogInkContextStatus('ready'),
      bodyRows: 30,
      width: 100,
      theme,
    } as unknown as SurfaceRenderContext

    const diff = {
      worktreeDiff: undefined,
      worktreeDiffLoading: false,
      worktreeHunks: undefined,
      worktreeHunksLoading: false,
      filePreview: undefined,
      filePreviewLoading: false,
      commitDiffHunkOffsets: undefined,
      selectedDetailFile: undefined,
      stashDiffLines: undefined,
      stashDiffLoading: false,
      compareDiffLines: undefined,
      compareDiffLoading: false,
      prDiffLines: overrides.lines,
      prDiffLoading: overrides.loading ?? false,
      prDiffError: overrides.error,
      syntaxSpans: undefined,
    } as unknown as DiffSurfaceData

    return renderDiffSurface(ctx, diff)
  }

  it('renders the PR title bar with the number + triage-list title', () => {
    const text = flattenText(buildPr({ lines: prPatch }))
    expect(text).toContain('PR diff')
    expect(text).toContain('#962 feat: triage detail')
  })

  it('shows the surface-states loading line while the patch fetch runs', () => {
    const text = flattenText(buildPr({ loading: true }))
    expect(text).toContain('Loading diff for #962…')
  })

  it('surfaces a fetch failure with recovery hints instead of a bare empty state', () => {
    const text = flattenText(buildPr({ error: 'gh auth token expired.', lines: [] }))
    expect(text).toContain('Could not load the diff: gh auth token expired.')
    expect(text).toContain('Press esc to go back')
  })

  it('renders the empty-patch hint for a diff-less PR', () => {
    const text = flattenText(buildPr({ lines: [] }))
    expect(text).toContain('No diff to display for this pull request.')
  })

  it('segments the patch per file and tracks the file containing the scroll offset', () => {
    // Offset 0 sits inside the first file.
    expect(flattenText(buildPr({ lines: prPatch }))).toContain('File 1/2: src/a.ts')
    // Offset 7 sits inside the second file (its header is line 6).
    expect(flattenText(buildPr({ lines: prPatch, offset: 7 }))).toContain('File 2/2: src/b.ts')
  })

  it('replaces diff --git headers with compact ▾ path markers', () => {
    const text = flattenText(buildPr({ lines: prPatch }))
    expect(text).toContain('▾ src/a.ts')
    expect(text).not.toContain('diff --git a/src/a.ts')
  })
})
