import { createElement } from 'react'
import { createLogInkState } from '../inkViewModel'
import { createLogInkContextStatus } from '../../chrome/context'
import { createLogInkTheme } from '../../chrome/theme'
import { cellWidth } from '../../chrome/text'
import { renderStashSurface } from '../../surfaces/stash/index'
import { renderDiffSurface } from '../../surfaces/diff/index'
import type { LogInkComponents, LogInkContext, SurfaceRenderContext } from '../types'
import type { DiffSurfaceData } from '../../surfaces/diff/index'
import { renderToLines } from './renderToLines'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const components: LogInkComponents = { Box, Text }

describe('renderToLines', () => {
  it('returns nothing for null / false / undefined / true', () => {
    expect(renderToLines(null, Text, Box)).toEqual([])
    expect(renderToLines(false, Text, Box)).toEqual([])
    expect(renderToLines(undefined, Text, Box)).toEqual([])
    expect(renderToLines(true, Text, Box)).toEqual([])
  })

  it('treats a bare string/number as a single line', () => {
    expect(renderToLines('hello', Text, Box)).toEqual(['hello'])
    expect(renderToLines(42, Text, Box)).toEqual(['42'])
  })

  it('collapses a Text element (and nested spans) into one line', () => {
    const el = createElement(Text, {}, 'a', createElement(Text, {}, 'b'), 'c')
    expect(renderToLines(el, Text, Box)).toEqual(['abc'])
  })

  it('stacks column children into one line per child', () => {
    const el = createElement(
      Box,
      { flexDirection: 'column' },
      createElement(Text, {}, 'line one'),
      createElement(Text, {}, 'line two')
    )
    expect(renderToLines(el, Text, Box)).toEqual(['line one', 'line two'])
  })

  it('zips row children side by side into a single joined line', () => {
    const el = createElement(
      Box,
      { flexDirection: 'row' },
      createElement(Text, {}, 'left'),
      createElement(Text, {}, 'right')
    )
    expect(renderToLines(el, Text, Box)).toEqual(['leftright'])
  })

  it('defaults to row (zip) when flexDirection is unset, matching Ink', () => {
    const el = createElement(Box, {}, createElement(Text, {}, 'a'), createElement(Text, {}, 'b'))
    expect(renderToLines(el, Text, Box)).toEqual(['ab'])
  })

  it('zips uneven-height row siblings, padding shorter columns with empty cells', () => {
    const left = createElement(Box, { flexDirection: 'column' }, createElement(Text, {}, 'L1'))
    const right = createElement(
      Box,
      { flexDirection: 'column' },
      createElement(Text, {}, 'R1'),
      createElement(Text, {}, 'R2')
    )
    const el = createElement(Box, { flexDirection: 'row' }, left, right)
    expect(renderToLines(el, Text, Box)).toEqual(['L1R1', 'R2'])
  })

  it('handles nested Box-in-Box (column of rows)', () => {
    const row = (a: string, b: string) =>
      createElement(Box, { flexDirection: 'row' }, createElement(Text, {}, a), createElement(Text, {}, b))
    const el = createElement(Box, { flexDirection: 'column' }, row('a', 'b'), row('c', 'd'))
    expect(renderToLines(el, Text, Box)).toEqual(['ab', 'cd'])
  })

  it('drops false/null/undefined children mixed into an array', () => {
    const el = createElement(
      Box,
      { flexDirection: 'column' },
      createElement(Text, {}, 'kept'),
      false,
      null,
      undefined
    )
    expect(renderToLines(el, Text, Box)).toEqual(['kept'])
  })

  it('treats an empty Box as contributing no lines', () => {
    const el = createElement(Box, { flexDirection: 'column' })
    expect(renderToLines(el, Text, Box)).toEqual([])
  })

  it('treats row-reverse / column-reverse the same as their base direction', () => {
    const columnReverse = createElement(
      Box,
      { flexDirection: 'column-reverse' },
      createElement(Text, {}, 'a'),
      createElement(Text, {}, 'b')
    )
    expect(renderToLines(columnReverse, Text, Box)).toEqual(['a', 'b'])

    const rowReverse = createElement(
      Box,
      { flexDirection: 'row-reverse' },
      createElement(Text, {}, 'a'),
      createElement(Text, {}, 'b')
    )
    expect(renderToLines(rowReverse, Text, Box)).toEqual(['ab'])
  })

  // Cross-check against real surfaces' existing keyed-extraction tests
  // (stash's `leafRows`, diff's `headerLines`) so the generic flattener
  // is trusted to reproduce equivalent line content before relying on
  // it project-wide.
  describe('cross-check against known-good surfaces', () => {
    const theme = createLogInkTheme({ noColor: false })

    it('matches stash surface row content (stashTable.test.ts fixture)', () => {
      const stashes = [
        { ref: 'stash@{0}', hash: 'a1', baseHash: 'a1p', date: '2024-01-10', branch: 'feat/new-themes', message: 'e721919 regenerate schema for 14 new theme presets and more', files: ['a.ts', 'b.ts'] },
      ]
      const context: LogInkContext = { stashes: { stashes } } as unknown as LogInkContext
      const ctx: SurfaceRenderContext = {
        h: createElement,
        components,
        state: { ...createLogInkState([]), activeView: 'stash', focus: 'commits' },
        context,
        contextStatus: createLogInkContextStatus('ready'),
        bodyRows: 30,
        width: 100,
        theme,
      }
      const lines = renderToLines(renderStashSurface(ctx, 0), Text, Box)
      const joined = lines.join('\n')
      expect(joined).toContain('stash@{0}')
      expect(joined).toContain('feat/new-themes')
      expect(joined).toContain('regenerate schema')
      for (const line of lines) {
        expect(cellWidth(line)).toBeLessThanOrEqual(100 - 4)
      }
    })

    it('matches diff surface header content (diffSurface.test.ts fixture)', () => {
      const base = createLogInkState([])
      const hunkStates = ['staged', 'unstaged', 'staged', 'unstaged'] as const
      const hunkOffsets = [0, 5, 10, 15]
      const diffLines = Array.from({ length: 20 }, (_, i) =>
        hunkOffsets.includes(i) ? `@@ hunk ${i} @@` : ` line ${i}`
      )
      const ctx = {
        h: createElement,
        components,
        state: {
          ...base,
          activeView: 'diff',
          diffSource: 'worktree',
          focus: 'commits',
          selectedWorktreeFileIndex: 0,
          worktreeDiffOffset: 5,
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
        worktreeDiff: { filePath: 'src/a.ts', untracked: false, lines: diffLines, hunkOffsets },
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
      const lines = renderToLines(renderDiffSurface(ctx, diff), Text, Box)
      const joined = lines.join('\n')
      expect(joined).toContain('●[○]●○')
      expect(joined).toContain('Hunk 2/4')
      expect(joined).toContain('2/4 staged')
    })
  })
})
