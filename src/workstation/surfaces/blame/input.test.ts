import { handleBlameInput } from './input'
import { createLogInkState } from '../../runtime/inkViewModel'
import type { GitLogRow } from '../../../git/logData'

/**
 * Direct coverage for the blame-view input handlers extracted out of
 * `inkInput.ts`'s router (#1722). `inkInput.test.ts` keeps its existing
 * blame cases too — those exercise the full `getLogInkInputEvents` router
 * and guard that it actually delegates here at each of the seven call
 * sites; these tests pin down the handler's own per-slot logic in
 * isolation.
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

const blameState = (overrides: { blameLineCount?: number; blamePath?: string } = {}) => {
  const state = createLogInkState(rows)
  return {
    state: { ...state, activeView: 'blame' as const, blamePath: overrides.blamePath },
    context: { blameLineCount: overrides.blameLineCount },
  }
}

describe('handleBlameInput', () => {
  it('returns null outside the blame view for every slot', () => {
    const state = { ...createLogInkState(rows), activeView: 'history' as const }
    expect(handleBlameInput(state, 'k', {}, {}, 'move-up')).toBeNull()
    expect(handleBlameInput(state, 'j', {}, {}, 'move-down')).toBeNull()
    expect(handleBlameInput(state, 'g', {}, {}, 'jump-top')).toBeNull()
    expect(handleBlameInput(state, 'G', {}, {}, 'jump-bottom')).toBeNull()
    expect(handleBlameInput(state, '', { pageUp: true }, {}, 'page-up')).toBeNull()
    expect(handleBlameInput(state, '', { pageDown: true }, {}, 'page-down')).toBeNull()
    expect(handleBlameInput(state, 'L', {}, {}, 'open-file-history')).toBeNull()
  })

  describe('jump-top / jump-bottom slots', () => {
    it('jumps to the first line and sets an echo status when lines exist', () => {
      const { state, context } = blameState({ blameLineCount: 40 })
      expect(handleBlameInput(state, 'g', {}, context, 'jump-top')).toEqual([
        { type: 'action', action: { type: 'moveList', list: 'blame', delta: -40, count: 40 } },
        { type: 'action', action: { type: 'setStatus', value: 'jumped to first line', ttl: 'echo' } },
      ])
    })

    it('jumps to the last line and sets an echo status when lines exist', () => {
      const { state, context } = blameState({ blameLineCount: 40 })
      expect(handleBlameInput(state, 'G', {}, context, 'jump-bottom')).toEqual([
        { type: 'action', action: { type: 'moveList', list: 'blame', delta: 40, count: 40 } },
        { type: 'action', action: { type: 'setStatus', value: 'jumped to last line', ttl: 'echo' } },
      ])
    })

    it('swallows the keystroke (returns []) rather than falling through when there are no lines', () => {
      const { state, context } = blameState({ blameLineCount: 0 })
      expect(handleBlameInput(state, 'g', {}, context, 'jump-top')).toEqual([])
      expect(handleBlameInput(state, 'G', {}, context, 'jump-bottom')).toEqual([])
    })
  })

  describe('move-up / move-down slots', () => {
    it('moves by one line when lines exist', () => {
      const { state, context } = blameState({ blameLineCount: 40 })
      expect(handleBlameInput(state, 'k', {}, context, 'move-up')).toEqual([
        { type: 'action', action: { type: 'moveList', list: 'blame', delta: -1, count: 40 } },
      ])
      expect(handleBlameInput(state, 'j', {}, context, 'move-down')).toEqual([
        { type: 'action', action: { type: 'moveList', list: 'blame', delta: 1, count: 40 } },
      ])
    })

    it('falls through (returns null) rather than swallowing when there are no lines', () => {
      const { state, context } = blameState({ blameLineCount: 0 })
      expect(handleBlameInput(state, 'k', {}, context, 'move-up')).toBeNull()
      expect(handleBlameInput(state, 'j', {}, context, 'move-down')).toBeNull()
    })
  })

  describe('page-up / page-down slots', () => {
    it('pages by ten lines when lines exist', () => {
      const { state, context } = blameState({ blameLineCount: 40 })
      expect(handleBlameInput(state, '', { pageUp: true }, context, 'page-up')).toEqual([
        { type: 'action', action: { type: 'moveList', list: 'blame', delta: -10, count: 40 } },
      ])
      expect(handleBlameInput(state, '', { pageDown: true }, context, 'page-down')).toEqual([
        { type: 'action', action: { type: 'moveList', list: 'blame', delta: 10, count: 40 } },
      ])
    })

    it('swallows the keystroke (returns []) rather than falling through when there are no lines', () => {
      const { state, context } = blameState({ blameLineCount: 0 })
      expect(handleBlameInput(state, '', { pageUp: true }, context, 'page-up')).toEqual([])
      expect(handleBlameInput(state, '', { pageDown: true }, context, 'page-down')).toEqual([])
    })
  })

  describe('open-file-history slot', () => {
    it('opens file-history for the blamed path on "L"', () => {
      const { state, context } = blameState({ blamePath: 'src/foo.ts' })
      expect(handleBlameInput(state, 'L', {}, context, 'open-file-history')).toEqual([
        { type: 'action', action: { type: 'navigateOpenFileHistoryForPath', path: 'src/foo.ts' } },
      ])
    })

    it('returns null for a key other than "L"', () => {
      const { state, context } = blameState({ blamePath: 'src/foo.ts' })
      expect(handleBlameInput(state, 'l', {}, context, 'open-file-history')).toBeNull()
    })

    it('returns null when there is no blamed path', () => {
      const { state, context } = blameState({ blamePath: undefined })
      expect(handleBlameInput(state, 'L', {}, context, 'open-file-history')).toBeNull()
    })
  })
})

describe('blame drill-down (#2212)', () => {
  const HASH = 'a'.repeat(40)
  const drill = (key: object, value: string, context: object, extra: object = {}) => {
    const { state } = blameState({ blameLineCount: 3, blamePath: 'src/a.ts' })
    return handleBlameInput({ ...state, ...extra } as typeof state, value, key, context, 'drill')
  }

  it('Enter opens the cursored line\'s commit', () => {
    expect(drill({ return: true }, '', { blameSelectedHash: HASH })).toEqual([
      { type: 'action', action: { type: 'navigateOpenDiffForCommit', sha: HASH, commitIndex: 0 } },
      { type: 'action', action: { type: 'setStatus', value: `viewing diff for ${HASH.slice(0, 7)}` } },
    ])
  })

  it('p re-blames at the commit\'s parent', () => {
    const events = drill({}, 'p', { blameSelectedHash: HASH })
    expect(events?.[0]).toEqual({ type: 'action', action: { type: 'blameReblame', rev: `${HASH}^` } })
  })

  it('refuses uncommitted lines for both keys', () => {
    const zero = '0'.repeat(40)
    for (const [key, value] of [[{ return: true }, ''], [{}, 'p']] as const) {
      expect(drill(key, value, { blameSelectedHash: zero })?.[0]).toMatchObject({
        action: { type: 'setStatus', kind: 'warning' },
      })
    }
  })

  it('ignores other keys', () => {
    expect(drill({}, 'x', { blameSelectedHash: HASH })).toBeNull()
  })

  it('Esc steps back only while there is an earlier revision', () => {
    const { state } = blameState({ blamePath: 'src/a.ts' })
    expect(handleBlameInput(state, '', { escape: true }, {}, 'back')).toBeNull()
    const stacked = { ...state, blameRevStack: [{ selectedIndex: 4 }] }
    expect(handleBlameInput(stacked, '', { escape: true }, {}, 'back')?.[0])
      .toEqual({ type: 'action', action: { type: 'blameBack' } })
  })
})
