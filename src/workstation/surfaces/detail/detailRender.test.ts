/**
 * Structural tests for the `detail` / inspector / preview surface family.
 *
 * Unlike the uniform surfaces, this module exports ~10 bespoke renderers. Most
 * share the same positional signature
 * `(h, components, state, context, contextStatus, width, theme, focused)`; two
 * take extra args (`renderHistoryInspector`, `renderCommitDiffDetail`). These
 * tests exercise the empty/loading fallback path of each — the most common
 * runtime state — plus a few snapshots. Stubs `Text` / `Box` per the
 * `surfaces/status/statusRender.test.ts` pattern.
 */
import { createElement, type ReactElement } from 'react'
import { createLogInkState, type LogInkState } from '../../../commands/log/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
  type LogInkContextStatus,
} from '../../chrome/context'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import {
  renderBranchPreviewPanel,
  renderCommitDiffDetail,
  renderCommitPanel,
  renderComposeContextPanel,
  renderHistoryInspector,
  renderIssueTriagePreviewPanel,
  renderPullRequestTriagePreviewPanel,
  renderStashPreviewPanel,
  renderSubmodulePreviewPanel,
  renderTagPreviewPanel,
} from './index'

type StubProps = Record<string, unknown>
const Text = ((props: StubProps) =>
  createElement('text', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>
const Box = ((props: StubProps) =>
  createElement('box', props, props.children as React.ReactNode)
) as unknown as React.ComponentType<StubProps>

const components: LogInkComponents = { Box, Text }
const theme = createLogInkTheme({})

function makeState(overrides: Partial<LogInkState> = {}): LogInkState {
  return { ...createLogInkState([]), ...overrides }
}

/** The shared 8-arg positional signature most preview panels use. */
function commonArgs(
  context: LogInkContext = {},
  contextStatus: LogInkContextStatus = createLogInkContextStatus('ready'),
  focused = false
): [
  typeof createElement,
  LogInkComponents,
  LogInkState,
  LogInkContext,
  LogInkContextStatus,
  number,
  ReturnType<typeof createLogInkTheme>,
  boolean
] {
  return [createElement, components, makeState(), context, contextStatus, 100, theme, focused]
}

const commonPanels: Array<[string, (...args: ReturnType<typeof commonArgs>) => ReactElement]> = [
  ['renderComposeContextPanel', renderComposeContextPanel],
  ['renderBranchPreviewPanel', renderBranchPreviewPanel],
  ['renderTagPreviewPanel', renderTagPreviewPanel],
  ['renderStashPreviewPanel', renderStashPreviewPanel],
  ['renderSubmodulePreviewPanel', renderSubmodulePreviewPanel],
  ['renderCommitPanel', renderCommitPanel],
  ['renderIssueTriagePreviewPanel', renderIssueTriagePreviewPanel],
  ['renderPullRequestTriagePreviewPanel', renderPullRequestTriagePreviewPanel],
]

describe('detail surface — shared-signature preview panels', () => {
  it.each(commonPanels)('%s renders an empty fallback', (_name, fn) => {
    const tree = fn(...commonArgs())
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('reflects focus state via border color (renderCommitPanel)', () => {
    const focused = renderCommitPanel(...commonArgs({}, createLogInkContextStatus('ready'), true))
    const blurred = renderCommitPanel(...commonArgs({}, createLogInkContextStatus('ready'), false))
    expect((focused.props as StubProps).borderColor).not.toBe(
      (blurred.props as StubProps).borderColor
    )
  })

  it('renders a loading branch preview', () => {
    const loading = updateLogInkContextStatus(
      createLogInkContextStatus('idle'),
      'branches',
      'loading'
    )
    expect(renderBranchPreviewPanel(...commonArgs({}, loading))).toBeDefined()
  })
})

describe('renderHistoryInspector', () => {
  function render(detail: undefined, loading: boolean): ReactElement {
    return renderHistoryInspector(
      createElement,
      components,
      makeState(),
      {},
      createLogInkContextStatus('ready'),
      detail,
      loading,
      undefined,
      false,
      100,
      false,
      theme,
      false
    )
  }

  it('renders the no-detail fallback', () => {
    const tree = render(undefined, false)
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders the loading fallback', () => {
    expect(render(undefined, true)).toBeDefined()
  })

  it('structural snapshot — no detail', () => {
    expect(render(undefined, false)).toMatchSnapshot()
  })
})

describe('renderCommitDiffDetail', () => {
  function render(loading: boolean): ReactElement {
    return renderCommitDiffDetail(
      createElement,
      components,
      makeState(),
      undefined,
      loading,
      100,
      theme,
      false
    )
  }

  it('renders the no-detail fallback', () => {
    const tree = render(false)
    expect(tree).toBeDefined()
    expect(tree.type).toBe(Box)
  })

  it('renders the loading fallback', () => {
    expect(render(true)).toBeDefined()
  })

  it('structural snapshot — no detail', () => {
    expect(render(false)).toMatchSnapshot()
  })
})
