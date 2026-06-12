/**
 * Structural tests for `renderBlameSurface`. Stubs `Text` / `Box` per
 * the `surfaces/remotes/remotesRender.test.ts` pattern.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import { createLogInkContextStatus } from '../../chrome/context'
import type { BlameLine, BlameResult } from '../../../git/blameData'
import type { LogInkComponents } from '../../runtime/types'
import { renderBlameSurface, type BlameSurfaceData } from './index'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const components: LogInkComponents = { Box, Text }

function makeState(overrides: Partial<LogInkState> = {}): LogInkState {
  return { ...createLogInkState([]), activeView: 'blame', blamePath: 'src/example.ts', ...overrides }
}

function makeLine(overrides: Partial<BlameLine> = {}): BlameLine {
  return {
    hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    shortHash: 'a1b2c3d4',
    author: 'Ada Lovelace',
    authorTime: 1700000000,
    lineNumber: 1,
    content: 'const answer = 42',
    ...overrides,
  }
}

function render(state: LogInkState, data: BlameSurfaceData): ReactElement {
  const theme = createLogInkTheme({})
  return renderBlameSurface(
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

describe('renderBlameSurface', () => {
  it('renders a loading placeholder while blame hydrates', () => {
    const tree = render(makeState(), { blame: undefined, loading: true })
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('treats a cold cache (no blame, has path) as loading', () => {
    expect(render(makeState(), { blame: undefined, loading: false })).toBeDefined()
  })

  it('renders an empty / failure state when blame failed', () => {
    const failed: BlameResult = { ok: false, path: 'logo.png', message: 'binary file' }
    const tree = render(makeState({ blamePath: 'logo.png' }), { blame: failed, loading: false })
    expect(tree).toBeDefined()
  })

  it('renders gutter + content rows for populated blame', () => {
    const blame: BlameResult = {
      ok: true,
      path: 'src/example.ts',
      lines: [makeLine(), makeLine({ lineNumber: 2, content: 'return answer' })],
    }
    expect(render(makeState(), { blame, loading: false })).toBeDefined()
  })

  it('reflects focus state via border color', () => {
    const blame: BlameResult = { ok: true, path: 'src/example.ts', lines: [makeLine()] }
    const focused = render(makeState({ focus: 'commits' }), { blame, loading: false })
    const blurred = render(makeState({ focus: 'sidebar' }), { blame, loading: false })
    expect((focused.props as StubProps).borderColor).not.toBe(
      (blurred.props as StubProps).borderColor
    )
  })

  it('structural snapshot — loading', () => {
    expect(render(makeState(), { blame: undefined, loading: true })).toMatchSnapshot()
  })

  it('structural snapshot — empty / failure', () => {
    const failed: BlameResult = { ok: false, path: 'logo.png', message: 'binary file' }
    expect(render(makeState({ blamePath: 'logo.png' }), { blame: failed, loading: false }))
      .toMatchSnapshot()
  })

  it('structural snapshot — populated', () => {
    const blame: BlameResult = {
      ok: true,
      path: 'src/example.ts',
      lines: [
        makeLine(),
        makeLine({ lineNumber: 2, content: 'return answer', author: 'Grace Hopper', shortHash: '99887766' }),
      ],
    }
    expect(render(makeState(), { blame, loading: false })).toMatchSnapshot()
  })
})
