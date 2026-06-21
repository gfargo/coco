/**
 * Structural tests for `renderFileHistorySurface`. Mirrors the
 * `blameRender.test.ts` pattern — stubs Text/Box, constructs a minimal
 * SurfaceRenderContext, and asserts render shape.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import { createLogInkContextStatus } from '../../chrome/context'
import type { FileHistoryCommit, FileHistoryResult } from '../../../git/fileHistoryData'
import type { LogInkComponents } from '../../runtime/types'
import { renderFileHistorySurface, formatCommitAge, type FileHistorySurfaceData } from './index'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const components: LogInkComponents = { Box, Text }

function makeState(overrides: Partial<LogInkState> = {}): LogInkState {
  return {
    ...createLogInkState([]),
    activeView: 'file-history',
    fileHistoryPath: 'src/example.ts',
    ...overrides,
  }
}

function makeCommit(overrides: Partial<FileHistoryCommit> = {}): FileHistoryCommit {
  return {
    hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    shortHash: 'a1b2c3d4',
    author: 'Ada Lovelace',
    authorTime: 1700000000,
    subject: 'feat: add example file',
    ...overrides,
  }
}

function render(state: LogInkState, data: FileHistorySurfaceData): ReactElement {
  const theme = createLogInkTheme({})
  return renderFileHistorySurface(
    {
      h: createElement,
      components,
      state,
      context: {},
      contextStatus: createLogInkContextStatus('ready'),
      bodyRows: 30,
      width: 120,
      theme,
    },
    data,
  )
}

function collectText(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join(' ')
  if (typeof node === 'object' && 'props' in (node as object)) {
    const el = node as { props?: { children?: unknown } }
    return collectText(el.props?.children)
  }
  return ''
}

describe('renderFileHistorySurface', () => {
  it('renders a loading placeholder while history hydrates', () => {
    const tree = render(makeState(), { history: undefined, loading: true })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('treats a cold cache (no history, has path) as loading', () => {
    expect(render(makeState(), { history: undefined, loading: false })).toBeDefined()
  })

  it('renders an error state when history failed', () => {
    const failed: FileHistoryResult = { ok: false, path: 'missing.ts', message: 'not a git repo' }
    const tree = render(makeState({ fileHistoryPath: 'missing.ts' }), {
      history: failed,
      loading: false,
    })
    expect(tree).toBeDefined()
  })

  it('renders commit rows for populated history', () => {
    const history: FileHistoryResult = {
      ok: true,
      path: 'src/example.ts',
      commits: [
        makeCommit(),
        makeCommit({ shortHash: '99887766', subject: 'fix: correct calc', author: 'Grace Hopper' }),
      ],
    }
    expect(render(makeState(), { history, loading: false })).toBeDefined()
  })

  it('reflects focus state via border color', () => {
    const history: FileHistoryResult = { ok: true, path: 'src/example.ts', commits: [makeCommit()] }
    const focused = render(makeState({ focus: 'commits' }), { history, loading: false })
    const blurred = render(makeState({ focus: 'sidebar' }), { history, loading: false })
    expect((focused.props as StubProps).borderColor).not.toBe(
      (blurred.props as StubProps).borderColor
    )
  })

  it('structural snapshot — loading', () => {
    const tree = render(makeState(), { history: undefined, loading: true })
    expect(tree.type).toBe(Box)
    expect(tree.props.flexDirection).toBe('column')
    expect(tree.props.width).toBe(120)
    const text = collectText(tree)
    expect(text).toContain('File History')
    expect(text).toContain('loading history')
    expect(text).toContain('Loading file history')
    expect(text).toContain('src/example.ts')
  })

  it('structural snapshot — error state', () => {
    const failed: FileHistoryResult = { ok: false, path: 'bin.exe', message: 'not a git repo' }
    const tree = render(makeState({ fileHistoryPath: 'bin.exe' }), { history: failed, loading: false })
    expect(tree.type).toBe(Box)
    const text = collectText(tree)
    expect(text).toContain('File History')
    expect(text).toContain('0 commits')
    expect(text).toContain('error: not a git repo')
    expect(text).toContain('bin.exe')
  })

  it('structural snapshot — populated', () => {
    const history: FileHistoryResult = {
      ok: true,
      path: 'src/example.ts',
      commits: [
        makeCommit(),
        makeCommit({
          shortHash: '99887766',
          hash: '9988776655443322110099887766554433221100',
          author: 'Grace Hopper',
          subject: 'fix: correct calculation',
          authorTime: 1710000000,
        }),
      ],
    }
    const tree = render(makeState(), { history, loading: false })
    expect(tree.type).toBe(Box)
    const text = collectText(tree)
    expect(text).toContain('File History')
    expect(text).toContain('1/2 commits')
    expect(text).toContain('a1b2c3d4')
    expect(text).toContain('Ada Lovelace')
    expect(text).toContain('feat: add example file')
    expect(text).toContain('99887766')
    expect(text).toContain('Grace Hopper')
    expect(text).toContain('fix: correct calculation')
  })
})

describe('formatCommitAge', () => {
  const base = 1700000000

  it('returns "just now" for future or same timestamps', () => {
    expect(formatCommitAge(base + 10, base)).toBe('just now')
    expect(formatCommitAge(base, base)).toBe('just now')
  })

  it('returns "today" for same-day commits', () => {
    expect(formatCommitAge(base - 3600, base)).toBe('today')
  })

  it('returns days for commits under 2 weeks old', () => {
    expect(formatCommitAge(base - 86400 * 5, base)).toBe('5d ago')
  })

  it('returns weeks for commits between 2 and 9 weeks old', () => {
    expect(formatCommitAge(base - 86400 * 21, base)).toBe('3w ago')
  })

  it('returns months for commits between 9 weeks and a year old', () => {
    expect(formatCommitAge(base - 86400 * 90, base)).toBe('3mo ago')
  })

  it('returns years for commits over a year old', () => {
    expect(formatCommitAge(base - 86400 * 400, base)).toBe('1y ago')
  })
})
