import { getBisectFooterHints, handleBisectInput } from './input'
import { createLogInkState } from '../../runtime/inkViewModel'
import type { GitLogRow } from '../../../git/logData'

/**
 * Direct coverage for the bisect-view input handler extracted out of
 * `inkInput.ts`'s router (#1625 first surface). `inkInput.test.ts` keeps
 * its existing bisect cases too — those exercise the full
 * `getLogInkInputEvents` router and guard that it actually delegates
 * here; these tests pin down the handler's own logic in isolation.
 */

const rows: GitLogRow[] = [
  {
    type: 'commit',
    graph: '*',
    shortHash: 'abc1234',
    hash: 'abc123456789',
    parents: [],
    date: '2026-04-29',
    author: 'Coco Test',
    refs: [],
    message: 'Initial commit',
  },
]

const bisectState = () => {
  const state = createLogInkState(rows)
  return { ...state, activeView: 'bisect' as const, focus: 'commits' as const }
}

describe('handleBisectInput', () => {
  it('returns null outside the bisect view', () => {
    const state = { ...bisectState(), activeView: 'history' as const }
    expect(handleBisectInput(state, 'y', {}, { bisectActive: true })).toBeNull()
  })

  it('returns null when the bisect view is not commit-focused', () => {
    const state = { ...bisectState(), focus: 'sidebar' as const }
    expect(handleBisectInput(state, 'y', {}, { bisectActive: true })).toBeNull()
  })

  it('marks good on y when a session is active and not completed', () => {
    const events = handleBisectInput(bisectState(), 'y', {}, { bisectActive: true })
    expect(events).toEqual([{ type: 'runWorkflowAction', id: 'bisect-good' }])
  })

  it('does not mark good once the bisect has completed', () => {
    const events = handleBisectInput(
      bisectState(),
      'y',
      {},
      { bisectActive: true, bisectCompletionSha: 'deadbeef' }
    )
    expect(events).toBeNull()
  })

  it('does not mark good with ctrl or meta held (yields to global shortcuts)', () => {
    expect(handleBisectInput(bisectState(), 'y', { ctrl: true }, { bisectActive: true })).toBeNull()
    expect(handleBisectInput(bisectState(), 'y', { meta: true }, { bisectActive: true })).toBeNull()
  })

  it('marks bad on b when active, but not while the g chord is armed', () => {
    const events = handleBisectInput(bisectState(), 'b', {}, { bisectActive: true })
    expect(events).toEqual([{ type: 'runWorkflowAction', id: 'bisect-bad' }])

    const armed = { ...bisectState(), pendingKey: 'g' }
    expect(handleBisectInput(armed, 'b', {}, { bisectActive: true })).toBeNull()
  })

  it('skips the candidate on s when active', () => {
    const events = handleBisectInput(bisectState(), 's', {}, { bisectActive: true })
    expect(events).toEqual([{ type: 'runWorkflowAction', id: 'bisect-skip' }])
  })

  it('enters the start wizard on s when no session is active', () => {
    const events = handleBisectInput(bisectState(), 's', {}, { bisectActive: false })
    expect(events).toEqual([
      { type: 'action', action: { type: 'setBisectPickMode', mode: 'bad' } },
      { type: 'action', action: { type: 'pushView', value: 'history' } },
      {
        type: 'action',
        action: {
          type: 'setStatus',
          value: 'Pick the BAD commit (where the bug is present). Enter to confirm · esc to cancel',
        },
      },
    ])
  })

  it('opens the reset confirmation on x when active, no-ops when inactive', () => {
    const events = handleBisectInput(bisectState(), 'x', {}, { bisectActive: true })
    expect(events).toEqual([
      { type: 'action', action: { type: 'setPendingConfirmation', value: 'bisect-reset' } },
    ])
    expect(handleBisectInput(bisectState(), 'x', {}, { bisectActive: false })).toBeNull()
  })

  it('opens the run-command prompt on R when active, no-ops when inactive', () => {
    const events = handleBisectInput(bisectState(), 'R', {}, { bisectActive: true })
    expect(events).toEqual([
      {
        type: 'action',
        action: {
          type: 'openInputPrompt',
          kind: 'bisect-run-command',
          label: 'Bisect run command (e.g. npm test, pytest -k regression)',
        },
      },
    ])
    expect(handleBisectInput(bisectState(), 'R', {}, { bisectActive: false })).toBeNull()
  })

  it('returns null for an unmatched key', () => {
    expect(handleBisectInput(bisectState(), 'q', {}, { bisectActive: true })).toBeNull()
  })
})

describe('getBisectFooterHints', () => {
  const globalHints = ['g jump', '< back', '? help', ': cmds', 'q quit']

  it('surfaces the start wizard when no session is active', () => {
    expect(getBisectFooterHints({ filterMode: false, focus: 'commits', showHelp: false }, globalHints)).toEqual({
      contextual: ['s start', 'esc back'],
      global: globalHints,
    })
  })

  it('surfaces the mark/skip/run/reset set while a session is active', () => {
    expect(
      getBisectFooterHints({ bisectActive: true, filterMode: false, focus: 'commits', showHelp: false }, globalHints)
    ).toEqual({
      contextual: ['y good', 'b bad', 's skip', 'R run', 'x reset', 'esc back'],
      global: globalHints,
    })
  })
})
