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
import { createLogInkState, type LogInkState } from '../../../workstation/runtime/inkViewModel'
import { createLogInkTheme } from '../../chrome/theme'
import {
  createLogInkContextStatus,
  updateLogInkContextStatus,
  type LogInkContextStatus,
} from '../../chrome/context'
import type { LogInkContext, LogInkComponents } from '../../runtime/types'
import type { GitCommitDetail } from '../../../commands/log/data'
import { renderToLines } from '../../runtime/testSupport/renderToLines'
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

const HISTORY_DETAIL: GitCommitDetail = {
  shortHash: 'abc1234',
  hash: 'abc1234def5678901234567890123456789abcd',
  parents: ['0'.repeat(40)],
  date: '2026-05-18',
  author: 'Ada Lovelace',
  refs: ['HEAD -> main', 'origin/main', 'tag: v1.0.0'],
  message: 'fix(workstation): stop truncating every inspector line into confetti',
  body: 'Longer body text describing the change in more detail than the subject line.',
  files: [
    { status: 'M', path: 'src/workstation/surfaces/detail/index.ts', additions: 24, deletions: 13 },
    { status: 'A', path: 'src/workstation/chrome/text.ts', additions: 8, deletions: 0 },
  ],
  stats: { filesChanged: 2, insertions: 32, deletions: 13 },
}

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

  describe('degrade by omission (#1366)', () => {
    // At-rest column is 20-32 cells; focused widens to 36-60 (ticket
    // ranges) — exercise each at a representative width from its band.
    function renderDetail(focused: boolean, width: number): ReactElement {
      return renderHistoryInspector(
        createElement,
        components,
        makeState({ inspectorTab: 'inspector', inspectorActionIndex: 0 }),
        {},
        createLogInkContextStatus('ready'),
        HISTORY_DETAIL,
        false,
        undefined,
        false,
        width,
        false,
        theme,
        focused
      )
    }

    it('at rest, shows only the subject, hash · date, stats, and one hint', () => {
      const text = renderToLines(renderDetail(false, 28), Text, Box).join('\n')
      expect(text).toContain('fix(workstation)')
      expect(text).toContain('abc1234')
      expect(text).toContain('2 files')
      expect(text).toContain('tab → inspect')
      expect(text).not.toContain('Refs:')
      expect(text).not.toContain('Changed files:')
      expect(text).not.toContain('Actions:')
      expect(text).not.toContain('index.ts')
    })

    it('focused, reveals refs, the file list, and the actions section', () => {
      const text = renderToLines(renderDetail(true, 50), Text, Box).join('\n')
      expect(text).toContain('Refs:')
      expect(text).toContain('Changed files:')
      expect(text).toContain('index.ts')
      expect(text).toContain('Actions:')
    })
  })

  describe('single-cursor invariant across tabs (#1601)', () => {
    // Tall-stacked mode (tabbed: false) renders the file list AND the
    // actions section simultaneously — the only shape where two
    // sections could both look cursor-active at once.
    function renderTallStacked(inspectorTab: 'inspector' | 'actions'): ReactElement {
      return renderHistoryInspector(
        createElement,
        components,
        makeState({ inspectorTab, inspectorActionIndex: 0, selectedFileIndex: 0 }),
        {},
        createLogInkContextStatus('ready'),
        HISTORY_DETAIL,
        false,
        undefined,
        false,
        50,
        false,
        theme,
        true
      )
    }

    it('actions tab active: the file list shows no cursor, the actions section does', () => {
      const lines = renderToLines(renderTallStacked('actions'), Text, Box)
      const fileLine = lines.find((l) => l.includes('index.ts'))
      expect(fileLine).toBeDefined()
      expect(fileLine!.trimStart().startsWith('>')).toBe(false)
      expect(lines.join('\n')).toContain('[Actions]')
    })

    it('inspector tab active: the file list shows the cursor, the actions section does not', () => {
      const lines = renderToLines(renderTallStacked('inspector'), Text, Box)
      const fileLine = lines.find((l) => l.includes('index.ts'))
      expect(fileLine).toBeDefined()
      expect(fileLine!.trimStart().startsWith('>')).toBe(true)
      expect(lines.join('\n')).not.toContain('[Actions]')
    })
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
