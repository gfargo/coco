import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as React from 'react'
import type { LogInkRuntime } from './types'
import {
  RECOVERY_MAX_QUICK_FAILURES,
  RECOVERY_QUICK_FAILURE_MS,
  createErrorBoundary,
  type RecoveryPanelProps,
  type RecoveryRef,
} from './errorBoundary'

// A render error never reaches a boundary outside a renderer, and Ink 7 is
// ESM-only under this CommonJS Jest, so the class is exercised directly: the
// catch hooks are called by hand and `setState` applies synchronously. The
// real mount is covered by driving the built TUI in a terminal (#2206).

const Box = (() => null) as unknown as LogInkRuntime['ink']['Box']
const Text = (() => null) as unknown as LogInkRuntime['ink']['Text']

function makeInk() {
  const exit = jest.fn()
  let handler: ((input: string, key: { ctrl?: boolean }) => void) | undefined
  const ink = {
    Box,
    Text,
    useApp: () => ({ exit }),
    useInput: (fn: typeof handler) => { handler = fn },
  } as unknown as LogInkRuntime['ink']
  return { ink, exit, press: (input: string, key: { ctrl?: boolean } = {}) => handler?.(input, key) }
}

/** The strings in an element tree, for asserting what a panel says. */
function textOf(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  if (Array.isArray(node)) return node.flatMap(textOf)
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: unknown } }).props.children)
  return []
}

describe('app-level error boundary (#2206)', () => {
  const originalCache = process.env.XDG_CACHE_HOME
  let cache: string

  beforeEach(() => {
    cache = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-boundary-'))
    process.env.XDG_CACHE_HOME = cache
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalCache === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = originalCache
    fs.rmSync(cache, { recursive: true, force: true })
  })

  function mount(recoveryRef?: RecoveryRef, children: React.ReactNode = 'app') {
    const { ink, exit, press } = makeInk()
    const { Boundary, RecoveryPanel } = createErrorBoundary(React, ink)
    const boundary = new Boundary({ recoveryRef, children })
    // `setState` applies at once instead of waiting for a renderer.
    boundary.setState = ((update: unknown) => {
      const next = typeof update === 'function' ? (update as (s: typeof boundary.state) => object)(boundary.state) : update
      boundary.state = { ...boundary.state, ...(next as object) }
    }) as typeof boundary.setState
    const catchError = (error: unknown) => {
      Object.assign(boundary.state, Boundary.getDerivedStateFromError(error))
      boundary.componentDidCatch(error, { componentStack: '\n    at Surface' })
    }
    return { boundary, Boundary, RecoveryPanel, catchError, exit, press }
  }

  it('turns a render error into error state', () => {
    const error = new Error('boom')
    expect(createErrorBoundary(React, makeInk().ink).Boundary.getDerivedStateFromError(error)).toEqual({ hasError: true, error })
  })

  it('renders its children when nothing has failed', () => {
    const { boundary } = mount(undefined, 'the app')
    const out = boundary.render() as React.ReactElement<{ children: unknown }>
    expect(out.type).toBe(React.Fragment)
    expect(out.props.children).toBe('the app')
  })

  it('writes a crash log with the component stack when it catches', () => {
    const { catchError, boundary } = mount()
    catchError(new Error('boom'))

    const logPath = boundary.state.logPath as string
    expect(boundary.state.logResolved).toBe(true)
    const text = fs.readFileSync(logPath, 'utf8')
    expect(text).toContain('source:   render')
    expect(text).toContain('boom')
    expect(text).toContain('at Surface')
  })

  it('saves the commit draft in progress beside the log', () => {
    const { catchError, boundary } = mount({ current: { draft: 'feat: half written\n\nwith a body' } })
    catchError(new Error('boom'))

    expect(fs.readFileSync(boundary.state.draftPath as string, 'utf8')).toBe('feat: half written\n\nwith a body')
  })

  it('saves no draft when there is none', () => {
    const { catchError, boundary } = mount({ current: {} })
    catchError(new Error('boom'))
    expect(boundary.state.draftPath).toBeUndefined()
  })

  it('shows the recovery panel with what it knows, and offers a reload', () => {
    const { catchError, boundary } = mount({ current: { draft: 'wip' } })
    catchError(new Error('boom'))
    const panel = boundary.render() as React.ReactElement<RecoveryPanelProps>

    expect(panel.props).toMatchObject({ canRetry: true, logResolved: true, error: expect.objectContaining({ message: 'boom' }) })
    expect(panel.props.logPath).toContain('crash-')
    expect(panel.props.draftPath).toContain('draft-')
  })

  it('reloads by remounting the children, and clears the error', () => {
    const { catchError, boundary } = mount()
    const first = (boundary.render() as React.ReactElement).key
    catchError(new Error('boom'))
    boundary.retry()

    expect(boundary.state).toMatchObject({ hasError: false, error: undefined, logPath: undefined, draftPath: undefined, logResolved: false })
    const out = boundary.render() as React.ReactElement
    expect(out.type).toBe(React.Fragment)
    // A new key is what makes React throw the old tree away.
    expect(out.key).not.toBe(first)
  })

  describe('a reload that keeps failing', () => {
    it('withdraws the reload after a few failures right after a reload', () => {
      const now = jest.spyOn(Date, 'now')
      const { catchError, boundary } = mount()
      let clock = 1_000_000
      now.mockImplementation(() => clock)

      catchError(new Error('boom'))
      for (let i = 1; i < RECOVERY_MAX_QUICK_FAILURES; i += 1) {
        expect((boundary.render() as React.ReactElement<RecoveryPanelProps>).props.canRetry).toBe(true)
        boundary.retry()
        clock += 100
        catchError(new Error('boom again'))
      }

      expect(boundary.state.quickFailures).toBe(RECOVERY_MAX_QUICK_FAILURES)
      expect((boundary.render() as React.ReactElement<RecoveryPanelProps>).props.canRetry).toBe(false)
    })

    it('counts a failure long after a reload as a new one, not a loop', () => {
      const now = jest.spyOn(Date, 'now')
      const { catchError, boundary } = mount()
      let clock = 1_000_000
      now.mockImplementation(() => clock)

      catchError(new Error('boom'))
      boundary.retry()
      clock += 100
      catchError(new Error('again'))
      expect(boundary.state.quickFailures).toBe(2)

      boundary.retry()
      clock += RECOVERY_QUICK_FAILURE_MS + 1
      catchError(new Error('much later'))
      expect(boundary.state.quickFailures).toBe(1)
      expect((boundary.render() as React.ReactElement<RecoveryPanelProps>).props.canRetry).toBe(true)
    })
  })

  describe('recovery panel', () => {
    const base: RecoveryPanelProps = {
      error: new Error('boom\nsecond line'),
      logResolved: true,
      logPath: '/cache/coco/crashes/crash-1.log',
      draftPath: '/cache/coco/crashes/draft-1.txt',
      canRetry: true,
      onRetry: jest.fn(),
    }

    it('says what happened, where the log is, and where the draft went', () => {
      const { RecoveryPanel } = mount()
      const text = textOf(RecoveryPanel(base)).join('\n')
      expect(text).toContain('coco hit an error and stopped this view')
      expect(text).toContain('boom')
      expect(text).not.toContain('second line')
      expect(text).toContain('Details: /cache/coco/crashes/crash-1.log')
      expect(text).toContain('Your commit draft was saved to /cache/coco/crashes/draft-1.txt')
      expect(text).toContain('r reload the view')
    })

    it('does not claim the log failed before the write has finished', () => {
      const { RecoveryPanel } = mount()
      const text = textOf(RecoveryPanel({ ...base, logResolved: false, logPath: undefined, draftPath: undefined })).join('\n')
      expect(text).not.toContain('could not be written')
    })

    it('says so when the log could not be written', () => {
      const { RecoveryPanel } = mount()
      const text = textOf(RecoveryPanel({ ...base, logPath: undefined, draftPath: undefined })).join('\n')
      expect(text).toContain('A crash log could not be written.')
    })

    it('offers only quit once reloading has been withdrawn', () => {
      const { RecoveryPanel } = mount()
      const text = textOf(RecoveryPanel({ ...base, canRetry: false })).join('\n')
      expect(text).not.toContain('r reload')
      expect(text).toContain('q quit')
      expect(text).toContain('no longer offered')
    })

    it('reloads on r', () => {
      const onRetry = jest.fn()
      const { RecoveryPanel, press } = mount()
      RecoveryPanel({ ...base, onRetry })
      press('r')
      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('ignores r once reloading is withdrawn', () => {
      const onRetry = jest.fn()
      const { RecoveryPanel, press } = mount()
      RecoveryPanel({ ...base, canRetry: false, onRetry })
      press('r')
      expect(onRetry).not.toHaveBeenCalled()
    })

    it('quits on q and on Ctrl-C, and ignores other keys', () => {
      const { RecoveryPanel, press, exit } = mount()
      RecoveryPanel(base)
      press('x')
      press('c')
      expect(exit).not.toHaveBeenCalled()
      press('q')
      expect(exit).toHaveBeenCalledTimes(1)
      press('c', { ctrl: true })
      expect(exit).toHaveBeenCalledTimes(2)
    })
  })
})
