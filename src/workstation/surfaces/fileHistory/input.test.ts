import { handleFileHistoryInput } from './input'
import { createLogInkState } from '../../runtime/inkViewModel'
import type { GitLogRow } from '../../../git/logData'

/**
 * Direct coverage for the file-history-view input handlers extracted out
 * of `inkInput.ts`'s router (#1722). `inkInput.test.ts` keeps its existing
 * file-history cases too — those exercise the full `getLogInkInputEvents`
 * router and guard that it actually delegates here at each of the seven
 * call sites; these tests pin down the handler's own per-slot logic in
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

const fileHistoryState = (overrides: { fileHistoryCommitCount?: number; fileHistorySelectedHash?: string } = {}) => {
  const state = createLogInkState(rows)
  return {
    state: { ...state, activeView: 'file-history' as const },
    context: {
      fileHistoryCommitCount: overrides.fileHistoryCommitCount,
      fileHistorySelectedHash: overrides.fileHistorySelectedHash,
    },
  }
}

describe('handleFileHistoryInput', () => {
  it('returns null outside the file-history view for every slot', () => {
    const state = { ...createLogInkState(rows), activeView: 'history' as const }
    expect(handleFileHistoryInput(state, 'k', {}, {}, 'move-up')).toBeNull()
    expect(handleFileHistoryInput(state, 'j', {}, {}, 'move-down')).toBeNull()
    expect(handleFileHistoryInput(state, 'g', {}, {}, 'jump-top')).toBeNull()
    expect(handleFileHistoryInput(state, 'G', {}, {}, 'jump-bottom')).toBeNull()
    expect(handleFileHistoryInput(state, '', { pageUp: true }, {}, 'page-up')).toBeNull()
    expect(handleFileHistoryInput(state, '', { pageDown: true }, {}, 'page-down')).toBeNull()
    expect(handleFileHistoryInput(state, '', { return: true }, {}, 'enter')).toBeNull()
  })

  describe('jump-top / jump-bottom slots', () => {
    it('jumps to the first commit and sets an echo status when commits exist', () => {
      const { state, context } = fileHistoryState({ fileHistoryCommitCount: 25 })
      expect(handleFileHistoryInput(state, 'g', {}, context, 'jump-top')).toEqual([
        { type: 'action', action: { type: 'moveFileHistory', delta: -25, count: 25 } },
        { type: 'action', action: { type: 'setStatus', value: 'jumped to first commit', ttl: 'echo' } },
      ])
    })

    it('jumps to the last commit and sets an echo status when commits exist', () => {
      const { state, context } = fileHistoryState({ fileHistoryCommitCount: 25 })
      expect(handleFileHistoryInput(state, 'G', {}, context, 'jump-bottom')).toEqual([
        { type: 'action', action: { type: 'moveFileHistory', delta: 25, count: 25 } },
        { type: 'action', action: { type: 'setStatus', value: 'jumped to last commit', ttl: 'echo' } },
      ])
    })

    it('swallows the keystroke (returns []) rather than falling through when there are no commits', () => {
      const { state, context } = fileHistoryState({ fileHistoryCommitCount: 0 })
      expect(handleFileHistoryInput(state, 'g', {}, context, 'jump-top')).toEqual([])
      expect(handleFileHistoryInput(state, 'G', {}, context, 'jump-bottom')).toEqual([])
    })
  })

  describe('move-up / move-down slots', () => {
    it('moves by one commit when commits exist', () => {
      const { state, context } = fileHistoryState({ fileHistoryCommitCount: 25 })
      expect(handleFileHistoryInput(state, 'k', {}, context, 'move-up')).toEqual([
        { type: 'action', action: { type: 'moveFileHistory', delta: -1, count: 25 } },
      ])
      expect(handleFileHistoryInput(state, 'j', {}, context, 'move-down')).toEqual([
        { type: 'action', action: { type: 'moveFileHistory', delta: 1, count: 25 } },
      ])
    })

    it('falls through (returns null) rather than swallowing when there are no commits', () => {
      const { state, context } = fileHistoryState({ fileHistoryCommitCount: 0 })
      expect(handleFileHistoryInput(state, 'k', {}, context, 'move-up')).toBeNull()
      expect(handleFileHistoryInput(state, 'j', {}, context, 'move-down')).toBeNull()
    })
  })

  describe('page-up / page-down slots', () => {
    it('pages by ten commits when commits exist', () => {
      const { state, context } = fileHistoryState({ fileHistoryCommitCount: 25 })
      expect(handleFileHistoryInput(state, '', { pageUp: true }, context, 'page-up')).toEqual([
        { type: 'action', action: { type: 'moveFileHistory', delta: -10, count: 25 } },
      ])
      expect(handleFileHistoryInput(state, '', { pageDown: true }, context, 'page-down')).toEqual([
        { type: 'action', action: { type: 'moveFileHistory', delta: 10, count: 25 } },
      ])
    })

    it('swallows the keystroke (returns []) rather than falling through when there are no commits', () => {
      const { state, context } = fileHistoryState({ fileHistoryCommitCount: 0 })
      expect(handleFileHistoryInput(state, '', { pageUp: true }, context, 'page-up')).toEqual([])
      expect(handleFileHistoryInput(state, '', { pageDown: true }, context, 'page-down')).toEqual([])
    })
  })

  describe('enter slot', () => {
    it('drills into the diff for the selected commit, preferring the matched history index', () => {
      const { state, context } = fileHistoryState({ fileHistorySelectedHash: 'abc123456789' })
      expect(handleFileHistoryInput(state, '', { return: true }, context, 'enter')).toEqual([
        {
          type: 'action',
          action: { type: 'navigateOpenDiffForCommit', sha: 'abc123456789', commitIndex: 0 },
        },
        { type: 'action', action: { type: 'setStatus', value: 'viewing diff for abc1234' } },
      ])
    })

    it('falls back to state.selectedIndex when the sha is not in the loaded commits window', () => {
      const { state, context } = fileHistoryState({ fileHistorySelectedHash: 'deadbeef0000' })
      const withSelectedIndex = { ...state, selectedIndex: 3 }
      expect(handleFileHistoryInput(withSelectedIndex, '', { return: true }, context, 'enter')).toEqual([
        {
          type: 'action',
          action: { type: 'navigateOpenDiffForCommit', sha: 'deadbeef0000', commitIndex: 3 },
        },
        { type: 'action', action: { type: 'setStatus', value: 'viewing diff for deadbee' } },
      ])
    })

    it('returns null when Enter is not pressed', () => {
      const { state, context } = fileHistoryState({ fileHistorySelectedHash: 'abc123456789' })
      expect(handleFileHistoryInput(state, '', {}, context, 'enter')).toBeNull()
    })

    it('returns null when there is no selected hash', () => {
      const { state, context } = fileHistoryState({ fileHistorySelectedHash: undefined })
      expect(handleFileHistoryInput(state, '', { return: true }, context, 'enter')).toBeNull()
    })
  })
})
