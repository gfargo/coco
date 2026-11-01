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
import type { GitCommitDetail } from '../../../git/logData'
import { renderToLines } from '../../runtime/testSupport/renderToLines'
import {
  renderBranchPreviewPanel,
  renderCommitDiffDetail,
  renderCommitPanel,
  renderComposeContextPanel,
  AT_REST_RICH_MIN_WIDTH,
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

  // Regression (#1632): the Summary field wrapped to an unbounded number
  // of visual lines — unlike Body just below it, which already caps at
  // 12 wrapped lines — so a long pasted subject could push this panel's
  // height well past its column budget.
  it('caps a long wrapped Summary the same generous-but-bounded way Body already is', () => {
    const base = createLogInkState([])
    const longSummary = Array.from({ length: 8 }, (_, i) => `word${i + 1}`).join(' ')
    const state = makeState({
      commitCompose: { ...base.commitCompose, summary: longSummary, editing: false, field: 'summary' },
    })
    const tree = renderCommitPanel(
      createElement, components, state, {}, createLogInkContextStatus('ready'), 30, theme, false
    )
    const lines = renderToLines(tree, Text, Box)
    const summaryLines = lines.filter((line) => /word\d/.test(line))
    expect(summaryLines.length).toBeLessThanOrEqual(3)
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

    it('focused, shows the signature beside the date for a signed commit and nothing for an unsigned one (#2214)', () => {
      const render = (signature?: { status: string; signer?: string; key?: string }) => renderToLines(
        renderHistoryInspector(
          createElement, components,
          makeState({ inspectorTab: 'inspector', inspectorActionIndex: 0 }),
          {}, createLogInkContextStatus('ready'),
          { ...HISTORY_DETAIL, signature },
          false, undefined, false, 80, false, theme, true
        ),
        Text, Box
      ).join('\n')
      expect(render({ status: 'G', signer: 'Alice', key: 'KEY1' })).toContain('✓ signed by Alice (KEY1)')
      expect(render({ status: 'B' })).toContain('✗ BAD signature')
      expect(render(undefined)).not.toContain('signed')
    })

    it('focused, reveals refs, the file list, and the actions section', () => {
      const text = renderToLines(renderDetail(true, 50), Text, Box).join('\n')
      expect(text).toContain('Refs:')
      expect(text).toContain('Changed files:')
      expect(text).toContain('index.ts')
      expect(text).toContain('Actions:')
    })
  })

  // #2158: at 48+ cells the at-rest inspector shows the start of the body and
  // the changed files, so "what did this commit touch?" needs no Tab.
  describe('wide at rest (#2158)', () => {
    function renderRest(width: number, tabbed = false, detail: GitCommitDetail = HISTORY_DETAIL): string {
      return renderToLines(renderHistoryInspector(
        createElement,
        components,
        makeState(),
        {},
        createLogInkContextStatus('ready'),
        detail,
        false,
        undefined,
        false,
        width,
        tabbed,
        theme,
        false
      ), Text, Box).join('\n')
    }

    it('shows the body start and the changed files once the column has room', () => {
      const text = renderRest(AT_REST_RICH_MIN_WIDTH)
      expect(text).toContain('Longer body text')
      expect(text).toContain('Changed files:')
      expect(text).toContain('index.ts')
      expect(text).toContain('text.ts')
      expect(text).toContain('tab → inspect')
      // Still the condensed view: refs and the actions list wait for focus.
      expect(text).not.toContain('Refs:')
      expect(text).not.toContain('Actions:')
    })

    it('stays the four-line summary just below the threshold', () => {
      const text = renderRest(AT_REST_RICH_MIN_WIDTH - 1)
      expect(text).not.toContain('Changed files:')
      expect(text).not.toContain('Longer body text')
    })

    it('stays condensed on a short terminal, where there are no spare rows', () => {
      expect(renderRest(AT_REST_RICH_MIN_WIDTH + 12, true)).not.toContain('Changed files:')
    })

    it('caps a long file list and says how many are left', () => {
      const files = Array.from({ length: 12 }, (_, index) => ({ status: 'M', path: `src/file${index}.ts`, additions: 1, deletions: 0 }))
      const text = renderRest(60, false, { ...HISTORY_DETAIL, files, stats: { filesChanged: 12, insertions: 12, deletions: 0 } })
      expect(text).toContain('file0.ts')
      expect(text).toContain('file5.ts')
      expect(text).not.toContain('file6.ts')
      expect(text).toContain('… +6 more')
    })

    it('omits the body block for a commit without one', () => {
      const text = renderRest(60, false, { ...HISTORY_DETAIL, body: '' })
      expect(text).toContain('Changed files:')
      expect(text).not.toContain('Longer body text')
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

  describe('Notes tab (#OSS-2057)', () => {
    function renderNotes(
      opts: { tabbed: boolean; commitNoteByHash?: Map<string, string | undefined> } = { tabbed: false }
    ): ReactElement {
      return renderHistoryInspector(
        createElement,
        components,
        makeState({ inspectorTab: 'notes', selectedFileIndex: 0 }),
        { commitNoteByHash: opts.commitNoteByHash },
        createLogInkContextStatus('ready'),
        HISTORY_DETAIL,
        false,
        undefined,
        false,
        60,
        opts.tabbed,
        theme,
        true
      )
    }

    it('the tab header shows [Notes] alongside [Inspector] and [Actions]', () => {
      const lines = renderToLines(renderNotes(), Text, Box)
      const header = lines.find((l) => l.includes('[Notes]'))
      expect(header).toBeDefined()
      expect(header).toContain('Inspector')
      expect(header).toContain('Actions')
    })

    it('shows a loading placeholder before the note has been fetched (key absent from the cache)', () => {
      const text = renderToLines(renderNotes({ tabbed: true }), Text, Box).join('\n')
      expect(text).toContain('Loading note')
    })

    it('shows the note body once loaded', () => {
      const cache = new Map([[HISTORY_DETAIL.hash, 'blocked on #42']])
      const text = renderToLines(renderNotes({ tabbed: true, commitNoteByHash: cache }), Text, Box).join('\n')
      expect(text).toContain('blocked on #42')
    })

    it('shows the empty-state copy when the fetch found no note (key present, value undefined)', () => {
      const cache = new Map<string, string | undefined>([[HISTORY_DETAIL.hash, undefined]])
      const text = renderToLines(renderNotes({ tabbed: true, commitNoteByHash: cache }), Text, Box).join('\n')
      expect(text).toContain('No note on this commit')
    })

    it('tall mode stacks the notes section alongside the inspector and actions sections', () => {
      const cache = new Map([[HISTORY_DETAIL.hash, 'blocked on #42']])
      const text = renderToLines(renderNotes({ tabbed: false, commitNoteByHash: cache }), Text, Box).join('\n')
      expect(text).toContain('blocked on #42')
      expect(text).toContain('Changed files:')
      expect(text).toContain('Actions:')
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
